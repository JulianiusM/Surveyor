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
 * F9: Fair distribution scoring
 * - Priority 1: Lowest ratio of assigned/required (most underserved)
 * - Priority 2: Largest absolute deficit
 * - Priority 3: Deterministic tie-breaker by participant key
 */
function scoreParticipant(a: ParticipantState, b: ParticipantState): number {
    // Calculate ratios (lower is more underserved)
    const ratioA = a.required > 0 ? a.assigned / a.required : (a.assigned > 0 ? Number.POSITIVE_INFINITY : 0);
    const ratioB = b.required > 0 ? b.assigned / b.required : (b.assigned > 0 ? Number.POSITIVE_INFINITY : 0);

    // Priority 1: Lowest ratio (most underserved)
    if (Math.abs(ratioA - ratioB) > RATIO_COMPARISON_EPSILON) {
        return ratioA - ratioB;
    }

    // Priority 2: Largest absolute deficit
    const deficitA = Math.max(a.required - a.assigned, 0);
    const deficitB = Math.max(b.required - b.assigned, 0);
    
    if (deficitA !== deficitB) {
        return deficitB - deficitA;
    }

    // Priority 3: Deterministic tie-breaker
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
 * - F9: Fair distribution across participants
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
    assignToSlots(phase1Slots, states, assignmentMap, attendancePolicy, recommendations);

    // F5 Phase 2: If overfill allowed and participants still have deficit, allow overcapacity
    if (allowOverfill) {
        const phase2Slots = buildSlotCapacities(ctx.slots, true);
        
        // Filter to only slots that are now at or over capacity but participants still need assignments
        const overflowSlots = phase2Slots.filter(s => {
            const capacity = s.slot.maxAssignees ?? Number.POSITIVE_INFINITY;
            const existing = Number(s.slot.assignedCount ?? 0);
            const assigned = recommendations.filter(r => r.slotId === s.slot.id).length;
            return capacity !== Number.POSITIVE_INFINITY && (existing + assigned) >= capacity;
        });

        // Distribute overcapacity fairly - track how much each slot is over
        const slotOvercapacity = new Map<string, number>();
        
        for (const slot of overflowSlots) {
            const capacity = slot.slot.maxAssignees ?? 0;
            const existing = Number(slot.slot.assignedCount ?? 0);
            const assigned = recommendations.filter(r => r.slotId === slot.slot.id).length;
            slotOvercapacity.set(slot.slot.id, Math.max(0, existing + assigned - capacity));
        }

        // Sort slots by current overcapacity (least overloaded first for fair distribution)
        const sortedOverflowSlots = overflowSlots.sort((a, b) => {
            const overA = slotOvercapacity.get(a.slot.id) ?? 0;
            const overB = slotOvercapacity.get(b.slot.id) ?? 0;
            return overA - overB;
        });

        assignToSlots(sortedOverflowSlots, states, assignmentMap, attendancePolicy, recommendations, true);
    }

    return recommendations;
}

/**
 * Helper function to assign participants to slots
 */
function assignToSlots(
    slots: SlotCapacity[],
    states: Map<string, ParticipantState>,
    assignmentMap: Record<string, AssignmentCandidate[]>,
    attendancePolicy: AttendancePolicy,
    recommendations: RecommendationInput[],
    allowOvercapacity: boolean = false
): void {
    for (const slot of slots) {
        // F3: Filter to participants with deficit > 0
        const participantsWithDeficit = [...states.values()].filter(state => {
            const deficit = Math.max(state.required - state.assigned, 0);
            return deficit > 0;
        });

        if (participantsWithDeficit.length === 0) break;

        // F9: Sort by fairness criteria
        const candidates = participantsWithDeficit.sort(scoreParticipant);

        for (const state of candidates) {
            // Check if we've exceeded capacity (unless in overfill mode)
            if (!allowOvercapacity && slot.remaining <= 0) break;

            // F6, F7, F8: Check eligibility (attendance, arrival/departure, overlap)
            const participantAssignments = assignmentMap[state.participantKey] ?? [];
            if (!canAssign(slot.candidate, state.participant, participantAssignments, attendancePolicy)) {
                continue;
            }

            // F10: Create recommendation
            recommendations.push({
                slotId: slot.slot.id,
                userId: state.participant.userId ?? null,
                guestId: state.participant.guestId ?? null,
                status: "PENDING",
            });

            // Update state
            if (!allowOvercapacity) {
                slot.remaining -= 1;
            }
            state.assigned += 1;
            assignmentMap[state.participantKey] = [...participantAssignments, slot.candidate];

            // F3: Stop if participant's deficit is now 0
            const deficit = Math.max(state.required - state.assigned, 0);
            if (deficit === 0) {
                continue;
            }
        }
    }
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
