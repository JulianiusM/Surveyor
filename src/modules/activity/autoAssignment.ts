import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {compareActivitySlots} from "./timebox";
import {calculateRequirementsForParticipants, ParticipantAttendance, toParticipantKey} from "./requirements";
import {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import {RecommendationInput} from "../database/services/ActivityRecommendationService";
import * as requirementService from "../database/services/ActivityRequirementService";
import * as activityService from "../database/services/ActivityService";
import * as eventService from "../database/services/EventService";

/**
 * Core automatic recommendation generator for activity plans. The engine balances required
 * shifts per participant, respects attendance policies and overlap rules, and emits staged
 * recommendations that managers can review before applying. Keep business rules centralized
 * here to avoid divergence across controllers and UI clients.
 */

interface AutoAssignmentPlan
    extends Pick<
        ActivityPlan,
        |
        "assignmentMode"
        | "generalRequiredShifts"
        | "roundingMode"
        | "startDate"
        | "endDate"
        | "allowOverfillAfterFull"
        | "allowArrivalDayEvening"
        | "allowDepartureDayMorning"
    > {}

interface AutoAssignmentSlot extends ActivitySlot {
    assignedCount?: number;
}

export interface AutoAssignmentContext {
    plan: AutoAssignmentPlan;
    slots: AutoAssignmentSlot[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    existingAssignments: Record<string, AssignmentCandidate[]>;
}

interface ParticipantState {
    participant: ParticipantAttendance;
    participantKey: string;
    required: number;
    assigned: number;
}

interface SlotCapacity {
    slot: AutoAssignmentSlot;
    remaining: number;
    candidate: AssignmentCandidate;
}

function buildSlotCapacities(slots: AutoAssignmentSlot[], includeFullSlots: boolean): SlotCapacity[] {
    return [...slots]
        .sort(compareActivitySlots)
        .map((slot) => {
            const capacity = slot.maxAssignees ?? Number.POSITIVE_INFINITY;
            const existing = Number((slot as AutoAssignmentSlot & {assignedCount?: number}).assignedCount ?? 0);
            const remaining = capacity === Number.POSITIVE_INFINITY ? capacity : Math.max(capacity - existing, 0);
            return {
                slot,
                remaining,
                candidate: toAssignmentCandidate(slot),
            } as SlotCapacity;
        })
        .filter((entry) => includeFullSlots || entry.remaining > 0);
}

function buildParticipantStates(
    ctx: AutoAssignmentContext,
): {states: Map<string, ParticipantState>; assignmentMap: Record<string, AssignmentCandidate[]>} {
    const requirements = calculateRequirementsForParticipants(
        ctx.plan,
        ctx.participants,
        ctx.roleRequirements,
        ctx.overrides,
    );

    const states = new Map<string, ParticipantState>();
    const assignmentMap: Record<string, AssignmentCandidate[]> = {};

    for (const participant of ctx.participants) {
        const participantKey = toParticipantKey(participant);
        const existing = ctx.existingAssignments[participantKey] ?? [];
        assignmentMap[participantKey] = [...existing];
        states.set(participantKey, {
            participant,
            participantKey,
            required: requirements[participantKey]?.requiredShifts ?? 0,
            assigned: existing.length,
        });
    }

    return {states, assignmentMap};
}

// Epsilon for floating-point comparison in ratio calculations
const RATIO_COMPARISON_EPSILON = 0.0001;

/**
 * Calculate how many eligible slots a participant has available
 */
function countEligibleSlots(
    participant: ParticipantAttendance,
    slots: SlotCapacity[],
    existingAssignments: AssignmentCandidate[],
    attendancePolicy: AttendancePolicy
): number {
    let count = 0;
    for (const slot of slots) {
        if (canAssign(slot.candidate, participant, existingAssignments, attendancePolicy)) {
            count++;
        }
    }
    return count;
}

/**
 * F9: Fair distribution scoring with limited availability prioritization
 * - Priority 1: Participants with more limited availability (fewer eligible slots)
 * - Priority 2: Lowest ratio of assigned/required (most underserved)
 * - Priority 3: Largest absolute deficit
 * - Priority 4: Deterministic tie-breaker by participant key
 */
function scoreParticipantWithAvailability(
    a: ParticipantState,
    b: ParticipantState,
    aEligibleSlots: number,
    bEligibleSlots: number
): number {
    // Priority 1: Limited availability (fewer eligible slots = higher priority)
    if (aEligibleSlots !== bEligibleSlots) {
        return aEligibleSlots - bEligibleSlots;
    }

    // Calculate ratios (lower is more underserved)
    const ratioA = a.required > 0 ? a.assigned / a.required : (a.assigned > 0 ? Number.POSITIVE_INFINITY : 0);
    const ratioB = b.required > 0 ? b.assigned / b.required : (b.assigned > 0 ? Number.POSITIVE_INFINITY : 0);

    // Priority 2: Lowest ratio (most underserved)
    if (Math.abs(ratioA - ratioB) > RATIO_COMPARISON_EPSILON) {
        return ratioA - ratioB;
    }

    // Priority 3: Largest absolute deficit
    const deficitA = Math.max(a.required - a.assigned, 0);
    const deficitB = Math.max(b.required - b.assigned, 0);
    
    if (deficitA !== deficitB) {
        return deficitB - deficitA;
    }

    // Priority 4: Deterministic tie-breaker
    return a.participantKey.localeCompare(b.participantKey);
}

function canAssign(
    candidate: AssignmentCandidate,
    participant: ParticipantAttendance,
    existing: AssignmentCandidate[],
    attendancePolicy: AttendancePolicy,
): boolean {
    const warnings = collectAssignmentWarnings(candidate, participant, existing, attendancePolicy);
    return warnings.every(
        (w) => !["outside_attendance", "overlap", "arrival_time_restricted", "departure_time_restricted"].includes(w.type)
    );
}

/**
 * F1-F10: Complete shift recommendation algorithm
 * - F1: Required shift calculation with deficit tracking
 * - F2: Respects existing assignments (immutable)
 * - F3: Only assigns to participants with deficit > 0
 * - F4: Respects capacity constraints in normal mode
 * - F5: Two-phase capacity handling (free capacity first, then overfill)
 * - F6: Attendance window validation
 * - F7: Arrival/departure toggles
 * - F8: No overlapping slots per participant
 * - F9: Fair distribution across participants with limited availability priority
 * - F10: Returns proposed assignments
 */
export function generateAutoRecommendations(ctx: AutoAssignmentContext): RecommendationInput[] {
    const allowOverfill = Boolean(ctx.plan.allowOverfillAfterFull);
    const {states, assignmentMap} = buildParticipantStates(ctx);

    if (!states.size) return [];

    const recommendations: RecommendationInput[] = [];

    const attendancePolicy: AttendancePolicy = {
        allowArrivalDayEvening: ctx.plan.allowArrivalDayEvening,
        allowDepartureDayMorning: ctx.plan.allowDepartureDayMorning,
    };

    // F5 Phase 1: Fill free capacity first
    const phase1Slots = buildSlotCapacities(ctx.slots, false);
    assignFairly(phase1Slots, states, assignmentMap, attendancePolicy, recommendations, false);

    // F5 Phase 2: If overfill allowed and participants still have deficit, allow overcapacity
    if (allowOverfill) {
        const phase2Slots = buildSlotCapacities(ctx.slots, true);
        assignFairly(phase2Slots, states, assignmentMap, attendancePolicy, recommendations, true);
    }

    return recommendations;
}

/**
 * Assign participants to slots fairly, one assignment at a time
 * This ensures fair distribution across both participants AND slots
 */
function assignFairly(
    slots: SlotCapacity[],
    states: Map<string, ParticipantState>,
    assignmentMap: Record<string, AssignmentCandidate[]>,
    attendancePolicy: AttendancePolicy,
    recommendations: RecommendationInput[],
    allowOvercapacity: boolean = false
): void {
    // Track slot assignment counts for fair distribution (cached and updated incrementally)
    const slotAssignmentCounts = new Map<string, number>();
    for (const slot of slots) {
        const existing = Number(slot.slot.assignedCount ?? 0);
        const newAssignments = recommendations.filter(r => r.slotId === slot.slot.id).length;
        slotAssignmentCounts.set(slot.slot.id, existing + newAssignments);
    }

    // Cache eligible slot counts (only recalculated when participant gets assigned)
    const participantEligibility = new Map<string, number>();
    const needsRecalc = new Set<string>();
    
    // Initial calculation for all participants
    for (const state of states.values()) {
        const existingAssignments = assignmentMap[state.participantKey] ?? [];
        const eligible = countEligibleSlots(state.participant, slots, existingAssignments, attendancePolicy);
        participantEligibility.set(state.participantKey, eligible);
    }

    // Continue making assignments until no more can be made
    while (true) {
        // F3: Get participants with deficit > 0
        const participantsWithDeficit = [...states.values()].filter(state => {
            const deficit = Math.max(state.required - state.assigned, 0);
            return deficit > 0;
        });

        if (participantsWithDeficit.length === 0) break;

        // Recalculate eligibility for participants who were assigned in previous iteration
        for (const key of needsRecalc) {
            const state = states.get(key);
            if (state) {
                const existingAssignments = assignmentMap[state.participantKey] ?? [];
                const eligible = countEligibleSlots(state.participant, slots, existingAssignments, attendancePolicy);
                participantEligibility.set(state.participantKey, eligible);
            }
        }
        needsRecalc.clear();

        // Find best (participant, slot) pair
        let bestMatch: {participant: ParticipantState; slot: SlotCapacity} | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const state of participantsWithDeficit) {
            const existingAssignments = assignmentMap[state.participantKey] ?? [];
            const eligibleCount = participantEligibility.get(state.participantKey) ?? 0;

            for (const slot of slots) {
                // F4/F5: Check capacity
                if (!allowOvercapacity && slot.remaining <= 0) continue;

                // F6, F7, F8: Check eligibility
                if (!canAssign(slot.candidate, state.participant, existingAssignments, attendancePolicy)) {
                    continue;
                }

                // Calculate fairness score for this (participant, slot) pair
                const participantScore = scoreParticipantForSlot(
                    state,
                    eligibleCount,
                    participantsWithDeficit,
                    participantEligibility
                );

                // Slot fairness: prefer slots with fewer assignments for balanced distribution
                // Lower score = better (less filled = preferred)
                const slotCount = slotAssignmentCounts.get(slot.slot.id) ?? 0;
                const slotScore = slotCount;  // Prefer slots with fewer total assignments

                // Combined score (lower is better)
                // Participant score is weighted heavily to prioritize participant fairness over slot balance
                const combinedScore = participantScore * 10000 + slotScore;

                if (combinedScore < bestScore) {
                    bestScore = combinedScore;
                    bestMatch = {participant: state, slot};
                }
            }
        }

        // If no valid assignment found, break
        if (!bestMatch) break;

        // Make the assignment
        const {participant, slot} = bestMatch;
        const participantAssignments = assignmentMap[participant.participantKey] ?? [];

        // F10: Create recommendation
        recommendations.push({
            slotId: slot.slot.id,
            userId: participant.participant.userId ?? null,
            guestId: participant.participant.guestId ?? null,
            status: "PENDING",
        });

        // Update state
        if (!allowOvercapacity) {
            slot.remaining -= 1;
        }
        participant.assigned += 1;
        assignmentMap[participant.participantKey] = [...participantAssignments, slot.candidate];
        
        // Update slot assignment count
        const currentCount = slotAssignmentCounts.get(slot.slot.id) ?? 0;
        slotAssignmentCounts.set(slot.slot.id, currentCount + 1);
        
        // Mark this participant for eligibility recalculation in next iteration
        needsRecalc.add(participant.participantKey);
    }
}

/**
 * Score a participant for slot assignment considering limited availability
 */
function scoreParticipantForSlot(
    participant: ParticipantState,
    eligibleSlots: number,
    allParticipants: ParticipantState[],
    eligibilityMap: Map<string, number>
): number {
    // Compare this participant with others based on fairness criteria
    let score = 0;
    
    for (const other of allParticipants) {
        if (other.participantKey === participant.participantKey) continue;
        
        const otherEligible = eligibilityMap.get(other.participantKey) ?? 0;
        const comparison = scoreParticipantWithAvailability(
            participant,
            other,
            eligibleSlots,
            otherEligible
        );
        
        // If this participant has higher priority (comparison < 0), decrease score
        // If lower priority (comparison > 0), increase score
        score += comparison;
    }
    
    return score;
}

function mergeParticipants(
    base: ParticipantAttendance[],
    supplemental: ParticipantAttendance[],
    overrides: ActivityPlanRequirementOverride[],
): ParticipantAttendance[] {
    const map = new Map<string, ParticipantAttendance>();

    const upsert = (participant: ParticipantAttendance) => {
        const key = toParticipantKey(participant);
        if (!map.has(key)) {
            map.set(key, participant);
        }
    };

    base.forEach(upsert);
    supplemental.forEach(upsert);

    for (const override of overrides) {
        const participant: ParticipantAttendance = {
            userId: override.userId ?? undefined,
            guestId: override.guestId ?? undefined,
            roleIds: override.roleId ? [override.roleId] : undefined,
        };
        upsert(participant);
    }

    return Array.from(map.values());
}

function toParticipantAttendanceFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    return Object.keys(assignments).map((key) => {
        const [type, id] = key.split(":");
        if (type === "user") {
            return {userId: Number(id)};
        }
        if (type === "guest") {
            return {guestId: Number(id)};
        }
        return {};
    });
}

export async function generatePlanRecommendations(planId: string): Promise<RecommendationInput[]> {
    const requirementConfig = await requirementService.getRequirementConfiguration(planId);
    const [plan, slots, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    if (!plan) throw new Error(`Activity plan ${planId} not found`);

    const eventParticipants = plan.event
        ? await eventService.getEventParticipants(plan.event.id)
        : [];

    const participantsFromEvent: ParticipantAttendance[] = eventParticipants.map((p) => ({
        userId: p.userId ?? undefined,
        guestId: p.guestId ?? undefined,
        arrivalDate: p.arrivalDate ?? undefined,
        departureDate: p.departureDate ?? undefined,
    }));

    const participantsFromAssignments = toParticipantAttendanceFromAssignments(existingAssignments);

    const participants = mergeParticipants(
        participantsFromEvent,
        participantsFromAssignments,
        requirementConfig.overrides,
    );

    const context: AutoAssignmentContext = {
        plan: {
            assignmentMode: plan.assignmentMode,
            generalRequiredShifts: plan.generalRequiredShifts,
            roundingMode: plan.roundingMode,
            startDate: plan.startDate,
            endDate: plan.endDate,
            allowOverfillAfterFull: plan.allowOverfillAfterFull,
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
        slots,
        participants,
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        existingAssignments,
    };

    return generateAutoRecommendations(context);
}
