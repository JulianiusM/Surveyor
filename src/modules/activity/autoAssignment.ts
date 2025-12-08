import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {compareActivitySlots} from "./timebox";
import {calculateRequirementsForParticipants, ParticipantAttendance, toParticipantKey} from "./requirements";
import {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import {RecommendationInput} from "../database/services/ActivityRecommendationService";
import * as requirementService from "../database/services/ActivityRequirementService";
import * as recommendationService from "../database/services/ActivityRecommendationService";
import * as activityService from "../database/services/ActivityService";
import * as eventService from "../database/services/EventService";
import settingsStore from "../settings";

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
    existingRecommendations?: RecommendationInput[];
}

interface ParticipantState {
    participant: ParticipantAttendance;
    participantKey: string;
    required: number;
    assigned: number;
    existingCount?: number;  // Track existing assignments separately for swap optimization
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
            existingCount: existing.length,
        });
    }

    return {states, assignmentMap};
}

// Epsilon for floating-point comparison in ratio calculations
const RATIO_COMPARISON_EPSILON = 0.0001;

// Weight to prioritize participant fairness over slot balance in combined scoring
const PARTICIPANT_SCORE_WEIGHT = 10000;

/**
 * Calculate how many eligible slots a participant has available
 * Only counts slots that can actually be assigned (have capacity or overfill is allowed)
 */
function countEligibleSlots(
    participant: ParticipantAttendance,
    slots: SlotCapacity[],
    existingAssignments: AssignmentCandidate[],
    attendancePolicy: AttendancePolicy,
    allowOvercapacity: boolean
): number {
    let count = 0;
    for (const slot of slots) {
        // Skip slots that are full if overfill is not allowed
        if (!allowOvercapacity && slot.remaining <= 0) {
            continue;
        }
        
        if (canAssign(slot.candidate, participant, existingAssignments, attendancePolicy)) {
            count++;
        }
    }
    return count;
}

/**
 * F9: Fair distribution scoring with balanced availability consideration
 * - Priority 1: Lowest ratio of assigned/required (most underserved) - FAIRNESS FIRST
 * - Priority 2: Largest absolute deficit
 * - Priority 3: Limited availability (fewer eligible slots) - tie-breaker for equal need
 * - Priority 4: Deterministic tie-breaker by participant key
 */
function scoreParticipantWithAvailability(
    a: ParticipantState,
    b: ParticipantState,
    aEligibleSlots: number,
    bEligibleSlots: number
): number {
    // Calculate ratios (lower is more underserved)
    const ratioA = a.required > 0 ? a.assigned / a.required : (a.assigned > 0 ? Number.POSITIVE_INFINITY : 0);
    const ratioB = b.required > 0 ? b.assigned / b.required : (b.assigned > 0 ? Number.POSITIVE_INFINITY : 0);

    // Priority 1: Lowest ratio (most underserved) - FAIRNESS FIRST
    if (Math.abs(ratioA - ratioB) > RATIO_COMPARISON_EPSILON) {
        return ratioA - ratioB;
    }

    // Priority 2: Largest absolute deficit
    const deficitA = Math.max(a.required - a.assigned, 0);
    const deficitB = Math.max(b.required - b.assigned, 0);
    
    if (deficitA !== deficitB) {
        return deficitB - deficitA;
    }

    // Priority 3: Limited availability as tie-breaker (fewer eligible slots = higher priority)
    // Only applies when participants have equal need
    if (aEligibleSlots !== bEligibleSlots) {
        return aEligibleSlots - bEligibleSlots;
    }

    // Priority 4: Deterministic tie-breaker
    return a.participantKey.localeCompare(b.participantKey);
}

/**
 * Weighted scoring that blends fairness and availability
 * Option 1: Allows tuning the balance between fair distribution and limited availability
 * 
 * @param availabilityWeight - Weight for availability (0-1). 0.3 means 70% fairness, 30% availability
 */
function scoreParticipantWeighted(
    participant: ParticipantState,
    eligibleSlots: number,
    totalSlots: number,
    availabilityWeight: number
): number {
    // Fairness score: ratio of assigned/required (lower is more underserved)
    const fairnessScore = participant.required > 0 
        ? participant.assigned / participant.required 
        : (participant.assigned > 0 ? 1 : 0);
    
    // Availability score: normalized by total slots (lower eligible = higher priority = higher score)
    const availabilityScore = totalSlots > 0 
        ? 1 - (eligibleSlots / totalSlots)
        : 0;
    
    // Combined score: lower is better (will be assigned first)
    // fairnessWeight + availabilityWeight = 1.0
    const fairnessWeight = 1 - availabilityWeight;
    return (fairnessScore * fairnessWeight) + (availabilityScore * availabilityWeight);
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
 * 
 * Enhanced with:
 * - Option 1: Weighted scoring (configurable via availabilityWeight)
 * - Option 2: Post-assignment swap optimization (configurable via swapOptimizationIterations)
 * - Rejection memory: Preserves rejected state and discourages re-recommendation
 */
export function generateAutoRecommendations(
    ctx: AutoAssignmentContext
): RecommendationInput[] {
    const allowOverfill = Boolean(ctx.plan.allowOverfillAfterFull);
    const availabilityWeight = settingsStore.value.activityAvailabilityWeight;
    const swapIterations = settingsStore.value.activitySwapOptimizationIterations;
    const arrivalDeparturePenalty = settingsStore.value.activityArrivalDeparturePenalty;
    const {states, assignmentMap} = buildParticipantStates(ctx);
    
    // Build rejection memory from existing recommendations in context
    const rejectedSet = new Set<string>();
    if (ctx.existingRecommendations) {
        ctx.existingRecommendations
            .filter(r => r.status === 'REJECTED')
            .forEach(r => {
                const key = `${r.slotId}:${r.userId || ''}:${r.guestId || ''}`;
                rejectedSet.add(key);
            });
    }

    if (!states.size) return [];

    const recommendations: RecommendationInput[] = [];

    const attendancePolicy: AttendancePolicy = {
        allowArrivalDayEvening: ctx.plan.allowArrivalDayEvening,
        allowDepartureDayMorning: ctx.plan.allowDepartureDayMorning,
    };

    // F5 Phase 1: Fill free capacity first
    const phase1Slots = buildSlotCapacities(ctx.slots, false);
    assignFairly(phase1Slots, states, assignmentMap, attendancePolicy, recommendations, false, availabilityWeight, arrivalDeparturePenalty, rejectedSet);

    // F5 Phase 2: If overfill allowed and participants still have deficit, allow overcapacity
    if (allowOverfill) {
        const phase2Slots = buildSlotCapacities(ctx.slots, true);
        assignFairly(phase2Slots, states, assignmentMap, attendancePolicy, recommendations, true, availabilityWeight, arrivalDeparturePenalty, rejectedSet);
    }

    // Option 2: Post-assignment swap optimization
    // Swap optimization can ADD recommendations by moving better-served participants to alternative
    // slots, thereby freeing up slots for underserved participants. This is intentional behavior.
    if (swapIterations > 0 && recommendations.length > 0) {
        optimizeViaSwaps(recommendations, states, assignmentMap, ctx.slots, attendancePolicy, swapIterations);
    }
    
    // Post-processing: Mark previously-rejected recommendations
    // When algorithm has no choice but to re-recommend a rejected assignment,
    // mark it as REJECTED to signal: "This was rejected before, but it's the best fit available"
    if (ctx.existingRecommendations) {
        recommendations.forEach(rec => {
            const key = `${rec.slotId}:${rec.userId || ''}:${rec.guestId || ''}`;
            if (rejectedSet.has(key)) {
                rec.status = 'REJECTED';
            }
        });
    }

    return recommendations;
}

/**
 * Assign participants to slots fairly, one assignment at a time
 * This ensures fair distribution across both participants AND slots
 * 
 * @param availabilityWeight - Weight for limited availability (0-1). 0.3 means 70% fairness, 30% availability
 * @param arrivalDeparturePenalty - Penalty for slots on arrival/departure days (0-1). 0.2 means 20% penalty
 * @param rejectedSet - Set of previously rejected (participant, slot) combinations to discourage
 */
function assignFairly(
    slots: SlotCapacity[],
    states: Map<string, ParticipantState>,
    assignmentMap: Record<string, AssignmentCandidate[]>,
    attendancePolicy: AttendancePolicy,
    recommendations: RecommendationInput[],
    allowOvercapacity: boolean = false,
    availabilityWeight: number = 0.30,
    arrivalDeparturePenalty: number = 0.2,
    rejectedSet: Set<string> = new Set()
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
        const eligible = countEligibleSlots(state.participant, slots, existingAssignments, attendancePolicy, allowOvercapacity);
        participantEligibility.set(state.participantKey, eligible);
    }

    // Continue making assignments until no more can be made
    let iterationCount = 0;
    while (true) {
        iterationCount++;
        
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
                const eligible = countEligibleSlots(state.participant, slots, existingAssignments, attendancePolicy, allowOvercapacity);
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

                // Check if this (participant, slot) pair is already in recommendations (F8: prevent duplicates)
                const alreadyRecommended = recommendations.some(r =>
                    r.slotId === slot.slot.id &&
                    r.userId === (state.participant.userId ?? null) &&
                    r.guestId === (state.participant.guestId ?? null)
                );
                if (alreadyRecommended) continue;

                // F6, F7, F8: Check eligibility
                if (!canAssign(slot.candidate, state.participant, existingAssignments, attendancePolicy)) {
                    continue;
                }

                // Calculate fairness score for this (participant, slot) pair
                // Use weighted scoring if availabilityWeight is configured
                const participantScore = availabilityWeight > 0 && availabilityWeight < 1
                    ? scoreParticipantWeighted(state, eligibleCount, slots.length, availabilityWeight)
                    : scoreParticipantForSlot(state, eligibleCount, participantsWithDeficit, participantEligibility);

                // Slot fairness: consider filling degree, competition, and deficit
                // Lower score = better (prefer balanced distribution)
                const slotCount = slotAssignmentCounts.get(slot.slot.id) ?? 0;
                const capacity = slot.slot.maxAssignees ?? Number.POSITIVE_INFINITY;
                
                // Calculate filling degree (0 = empty, 1 = full, >1 = overfilled)
                const fillingDegree = capacity !== Number.POSITIVE_INFINITY ? slotCount / capacity : slotCount / 100;
                
                // Calculate competition: how many other participants could use this slot
                // Higher competition means slot is more contested
                let competition = 0;
                let slotDeficit = 0;
                for (const p of participantsWithDeficit) {
                    const pAssignments = assignmentMap[p.participantKey] ?? [];
                    if (p.participantKey !== state.participantKey && 
                        canAssign(slot.candidate, p.participant, pAssignments, attendancePolicy)) {
                        competition++;
                        slotDeficit += Math.max(p.required - p.assigned, 0);
                    }
                }
                
                // Check if this slot is on the participant's arrival or departure day
                let arrivalDeparturePenaltyValue = 0;
                if (arrivalDeparturePenalty > 0) {
                    const slotDay = slot.slot.day;
                    const arrival = state.participant.arrivalDate;
                    const departure = state.participant.departureDate;
                    
                    if ((arrival && slotDay === arrival) || (departure && slotDay === departure)) {
                        // Apply penalty to discourage assignments on arrival/departure days
                        arrivalDeparturePenaltyValue = arrivalDeparturePenalty * 100;
                    }
                }
                
                // Check if this (participant, slot) combination was previously rejected
                const rejectionKey = `${slot.slot.id}:${state.participant.userId || ''}:${state.participant.guestId || ''}`;
                const rejectionPenalty = rejectedSet.has(rejectionKey) ? 1000 : 0;
                
                // Slot scoring:
                // 1. Filling degree (primary): prefer less-filled slots
                // 2. Competition (secondary): prefer less-contested slots when filling degree is similar
                // 3. Deficit (tertiary): prefer slots where participants have higher need
                // 4. Arrival/departure penalty: discourage slots on arrival/departure days
                // 5. Rejection penalty: strongly discourage previously rejected combinations
                const slotScore = fillingDegree * 100 + (competition * 0.5) - (slotDeficit * 0.05) + arrivalDeparturePenaltyValue + rejectionPenalty;

                // Combined score (lower is better)
                // Participant score is weighted heavily to prioritize participant fairness over slot balance
                const combinedScore = participantScore * PARTICIPANT_SCORE_WEIGHT + slotScore;

                if (combinedScore < bestScore) {
                    bestScore = combinedScore;
                    bestMatch = {participant: state, slot};
                }
            }
        }

        // If no valid assignment found, break
        if (!bestMatch) {
            // All participants have deficit but no valid slots available - this is expected with limited capacity
            break;
        }

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

/**
 * Option 2: Post-assignment swap optimization
 * 
 * Implements two scenarios for improving fairness:
 * 1. Help underserved participants: Try to move other participants to different slots
 *    to free up slots within the underserved participant's attendance window
 * 2. Balance slot filling: In overfill scenarios, redistribute participants from
 *    overfilled slots to underfilled slots
 * 
 * A swap is beneficial if it reduces the maximum deficit across all participants
 */
function optimizeViaSwaps(
    recommendations: RecommendationInput[],
    states: Map<string, ParticipantState>,
    assignmentMap: Record<string, AssignmentCandidate[]>,
    slots: AutoAssignmentSlot[],
    attendancePolicy: AttendancePolicy,
    maxIterations: number
): void {
    if (maxIterations <= 0) return;
    
    // Build lookup maps for efficient access
    const slotMap = new Map<string, AutoAssignmentSlot>();
    for (const slot of slots) {
        slotMap.set(slot.id, slot);
    }
    
    const recByParticipant = new Map<string, RecommendationInput[]>();
    for (const rec of recommendations) {
        const key = rec.userId ? `user:${rec.userId}` : `guest:${rec.guestId}`;
        const existing = recByParticipant.get(key) ?? [];
        existing.push(rec);
        recByParticipant.set(key, existing);
    }
    
    // Helper: Calculate deficit for a specific participant
    const getDeficit = (key: string): number => {
        const state = states.get(key);
        if (!state) return 0;
        const assignedCount = (recByParticipant.get(key) ?? []).length + (state.existingCount ?? 0);
        return Math.max(state.required - assignedCount, 0);
    };
    
    // Helper: Calculate overall fairness metric (lower is better)
    const calculateFairnessMetric = (): number => {
        let maxDeficit = 0;
        let totalSquaredDeficit = 0;
        
        for (const key of states.keys()) {
            const deficit = getDeficit(key);
            maxDeficit = Math.max(maxDeficit, deficit);
            totalSquaredDeficit += deficit * deficit;
        }
        
        // Combine max deficit (primary) and sum of squared deficits (secondary)
        return maxDeficit * 1000 + totalSquaredDeficit;
    };
    
    // Helper: Check if participant can be assigned to a slot
    const canParticipantTakeSlot = (participantKey: string, slot: AutoAssignmentSlot, excludeSlotId?: string): boolean => {
        const state = states.get(participantKey);
        if (!state) return false;
        
        const assignments = assignmentMap[participantKey] ?? [];
        const filteredAssignments = excludeSlotId 
            ? assignments.filter(a => a.id !== excludeSlotId)
            : assignments;
        
        // Add currently recommended slots (except the one being swapped out)
        const currentRecs = recByParticipant.get(participantKey) ?? [];
        for (const rec of currentRecs) {
            if (rec.slotId === excludeSlotId) continue;
            const recSlot = slotMap.get(rec.slotId);
            if (recSlot) {
                filteredAssignments.push(toAssignmentCandidate(recSlot));
            }
        }
        
        const candidate = toAssignmentCandidate(slot);
        return canAssign(candidate, state.participant, filteredAssignments, attendancePolicy);
    };
    
    let currentMetric = calculateFairnessMetric();
    
    // Scenario 1: Help underserved participants by finding slots within their attendance window
    // Try to swap assignments so underserved participants can fill their deficits
    for (let iter = 0; iter < maxIterations; iter++) {
        let improvedThisIteration = false;
        
        const participantKeys = Array.from(states.keys());
        
        // Sort by deficit (most underserved first)
        participantKeys.sort((a, b) => getDeficit(b) - getDeficit(a));
        
        for (const underservedKey of participantKeys) {
            const underservedDeficit = getDeficit(underservedKey);
            if (underservedDeficit === 0) break; // No more underserved participants
            
            const underservedState = states.get(underservedKey);
            if (!underservedState) continue;
            
            // Find slots that the underserved participant could use
            for (const slot of slots) {
                if (!canParticipantTakeSlot(underservedKey, slot)) continue;
                
                // Check if this slot is currently assigned to someone else in recommendations
                for (const [otherKey, otherRecs] of recByParticipant.entries()) {
                    if (otherKey === underservedKey) continue;
                    
                    const recUsingThisSlot = otherRecs.find(r => r.slotId === slot.id);
                    if (!recUsingThisSlot) continue;
                    
                    const otherDeficit = getDeficit(otherKey);
                    
                    // Only swap if the other participant has a lower deficit (is better served)
                    if (otherDeficit >= underservedDeficit) continue;
                    
                    // Try to find an alternative slot for the other participant
                    for (const alternativeSlot of slots) {
                        if (alternativeSlot.id === slot.id) continue;
                        
                        // Check if other participant can take the alternative slot
                        if (!canParticipantTakeSlot(otherKey, alternativeSlot, slot.id)) continue;
                        
                        // Perform the swap: move other participant to alternative slot,
                        // free up original slot for underserved participant
                        recUsingThisSlot.slotId = alternativeSlot.id;
                        
                        // Add new recommendation for underserved participant
                        const newRec: RecommendationInput = {
                            slotId: slot.id,
                            userId: underservedState.participant.userId ?? null,
                            guestId: underservedState.participant.guestId ?? null,
                            status: "PENDING",
                        };
                        recommendations.push(newRec);
                        
                        const underservedRecs = recByParticipant.get(underservedKey) ?? [];
                        underservedRecs.push(newRec);
                        recByParticipant.set(underservedKey, underservedRecs);
                        
                        // Update assignment map for underserved participant
                        const underservedAssignments = assignmentMap[underservedKey] ?? [];
                        assignmentMap[underservedKey] = [...underservedAssignments, toAssignmentCandidate(slot)];
                        
                        // Update assignment map for other participant
                        const otherAssignments = (assignmentMap[otherKey] ?? []).filter(a => a.id !== slot.id);
                        assignmentMap[otherKey] = [...otherAssignments, toAssignmentCandidate(alternativeSlot)];
                        
                        // Check if this improved fairness
                        const newMetric = calculateFairnessMetric();
                        
                        if (newMetric < currentMetric) {
                            currentMetric = newMetric;
                            improvedThisIteration = true;
                            break; // Found a good swap, move to next underserved participant
                        } else {
                            // Revert the changes
                            recUsingThisSlot.slotId = slot.id;
                            recommendations.pop();
                            underservedRecs.pop();
                            assignmentMap[underservedKey] = underservedAssignments;
                            assignmentMap[otherKey] = [...otherAssignments.filter(a => a.id !== alternativeSlot.id), toAssignmentCandidate(slot)];
                        }
                    }
                    
                    if (improvedThisIteration) break;
                }
                
                if (improvedThisIteration) break;
            }
            
            if (improvedThisIteration) break;
        }
        
        // If no improvement found in this iteration, stop early
        if (!improvedThisIteration) {
            break;
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

export async function generatePlanRecommendations(
    planId: string,
    existingRecommendations?: RecommendationDb[]
): Promise<RecommendationInput[]> {
    const requirementConfig = await requirementService.getRequirementConfiguration(planId);
    const [plan, slots, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);
    
    // If existing recommendations not provided, load them for rejection memory
    if (!existingRecommendations) {
        existingRecommendations = await recommendationService.getRecommendations(planId).catch(() => [] as RecommendationDb[]);
    }
    
    // Convert RecommendationDb[] to RecommendationInput[] format for rejection memory
    const existingRecommendationsInput: RecommendationInput[] | undefined = existingRecommendations?.map(rec => ({
        slotId: rec.slot.id,
        userId: rec.user?.id ?? undefined,
        guestId: rec.guest?.id ?? undefined,
        status: rec.status,
    }));

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
        existingRecommendations: existingRecommendationsInput,
    };

    return generateAutoRecommendations(context);
}
