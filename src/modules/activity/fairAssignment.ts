/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import type {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import type {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import type {ActivityPlanStayRequirement} from "../database/entities/activity/ActivityPlanStayRequirement";
import type {RecommendationInput} from "../database/services/ActivityRecommendationService";
import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings} from "./availability";
import {
    calculateRequirementsForParticipants,
    countInclusiveDays,
    hasCompleteStayRequirements,
    ParticipantAttendance,
    toParticipantKey,
} from "./requirements";
import {compareSlotsByDayAndTime} from "./timebox";

export interface FairAssignmentSlot {
    id: string;
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    pos?: number | null;
    isArrivalEvening?: boolean | null;
    isDepartureMorning?: boolean | null;
    maxAssignees?: number | null;
    assignedCount?: number;
}

export interface FairAssignmentContext {
    plan: {
        assignmentMode: "FREE" | "REQUIRED";
        generalRequiredShifts?: number | null;
        roundingMode?: "CEIL" | "ROUND" | "FLOOR" | null;
        startDate: string;
        endDate: string;
        allowOverfillAfterFull?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
    };
    slots: FairAssignmentSlot[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    stayRequirements: ActivityPlanStayRequirement[];
    existingAssignments: Record<string, AssignmentCandidate[]>;
    existingRecommendations?: RecommendationInput[];
}

interface ParticipantState {
    key: string;
    participant: ParticipantAttendance;
    required: number;
    actualCount: number;
    alternativeCount: number;
}

interface PendingAssignment {
    slotId: string;
    participantKey: string;
    retained: boolean;
}

const MAX_REPAIR_DEPTH = 4;
const MAX_REPAIR_NODES = 2_000;
const MAX_FAIRNESS_MOVES = 2_000;

function isBlockingWarning(type: string): boolean {
    return ["outside_attendance", "overlap", "arrival_time_restricted", "departure_time_restricted"].includes(type);
}

function fulfilledRatio(state: ParticipantState, assigned: number): number {
    if (state.required <= 0) return assigned > 0 ? Number.POSITIVE_INFINITY : 1;
    return assigned / state.required;
}

function boundaryPenalty(participant: ParticipantAttendance, slot: FairAssignmentSlot): number {
    return Number(Boolean(
        (participant.arrivalDate && participant.arrivalDate === slot.day)
        || (participant.departureDate && participant.departureDate === slot.day),
    ));
}

const DAY_MS = 86_400_000;

function timeSeconds(value?: string | null): number | null {
    if (!value) return null;
    const [hours, minutes, seconds] = value.split(":").map(Number);
    if (![hours, minutes, seconds ?? 0].every(Number.isFinite)) return null;
    return hours * 3_600 + minutes * 60 + (seconds ?? 0);
}

function assignmentMoment(assignment: AssignmentCandidate): number {
    const dayStart = Date.parse(`${assignment.day}T00:00:00Z`);
    const start = timeSeconds(assignment.startTime);
    const end = timeSeconds(assignment.endTime);
    if (!Number.isFinite(dayStart)) return 0;
    if (start != null && end != null && end >= start) return dayStart + ((start + end) / 2) * 1_000;
    if (start != null) return dayStart + start * 1_000;
    return dayStart + DAY_MS / 2;
}

function normalizedAttendanceMoment(
    plan: FairAssignmentContext["plan"],
    participant: ParticipantAttendance,
    assignment: AssignmentCandidate,
): number {
    const arrival = participant.arrivalDate && participant.arrivalDate > plan.startDate
        ? participant.arrivalDate
        : plan.startDate;
    const departure = participant.departureDate && participant.departureDate < plan.endDate
        ? participant.departureDate
        : plan.endDate;
    const start = Date.parse(`${arrival}T00:00:00Z`);
    const endExclusive = Date.parse(`${departure}T00:00:00Z`) + DAY_MS;
    if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || endExclusive <= start) return 0.5;
    return Math.max(0, Math.min((assignmentMoment(assignment) - start) / (endExclusive - start), 1));
}

function nextTemporalAnchor(positions: number[], required: number): number {
    const available = Array.from({length: required}, (_, index) => (index + 0.5) / required);
    for (const position of [...positions].sort((a, b) => a - b)) {
        if (available.length === 0) break;
        let closestIndex = 0;
        for (let index = 1; index < available.length; index += 1) {
            if (Math.abs(position - available[index]) < Math.abs(position - available[closestIndex])) {
                closestIndex = index;
            }
        }
        available.splice(closestIndex, 1);
    }
    // When several anchors are still unused, allocate them in chronological
    // order. This prevents identical participants from consuming one another's
    // late anchors during the first fairness round.
    return available[0] ?? 0.5;
}

function toCandidate(slot: FairAssignmentSlot): AssignmentCandidate {
    return {
        id: slot.id,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        pos: slot.pos,
        isArrivalEvening: slot.isArrivalEvening,
        isDepartureMorning: slot.isDepartureMorning,
    };
}

/**
 * Allocates only default-role recommendations. Named roles stay a manual decision;
 * their capacities affect requirement analysis, not this recommendation output.
 */
export function generateFairRecommendations(context: FairAssignmentContext): RecommendationInput[] {
    // FREE mode has no targets, so it must remain a constant-time bypass.
    if (context.plan.assignmentMode === "FREE") return [];

    const planDays = countInclusiveDays(context.plan.startDate, context.plan.endDate);
    if (!hasCompleteStayRequirements(planDays, context.stayRequirements)) {
        throw new Error(`Required mode needs saved stay-duration requirements for days 1 through ${planDays}`);
    }

    const slots = [...context.slots].sort((a, b) => {
        const timeDifference = compareSlotsByDayAndTime(a, b);
        return timeDifference !== 0 ? timeDifference : a.id.localeCompare(b.id);
    });
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));
    const policy: AttendancePolicy = {
        allowArrivalDayEvening: context.plan.allowArrivalDayEvening ?? true,
        allowDepartureDayMorning: context.plan.allowDepartureDayMorning ?? true,
    };
    const requirements = calculateRequirementsForParticipants(
        context.plan,
        context.participants,
        context.roleRequirements,
        context.overrides,
        context.stayRequirements,
    );
    const lockedRecommendations: Record<string, AssignmentCandidate[]> = {};
    for (const recommendation of context.existingRecommendations ?? []) {
        if (recommendation.status !== "APPROVED" || !recommendation.profileId) continue;
        const slot = slotById.get(recommendation.itemId);
        if (!slot) continue;
        const key = `profile:${recommendation.profileId}`;
        if ((context.existingAssignments[key] ?? []).some((assignment) => assignment.id === slot.id)) continue;
        lockedRecommendations[key] ??= [];
        if (!lockedRecommendations[key].some((assignment) => assignment.id === slot.id)) {
            lockedRecommendations[key].push(toCandidate(slot));
        }
    }
    const participants = context.participants
        .map((participant): ParticipantState => {
            const key = toParticipantKey(participant);
            return {
                key,
                participant,
                required: requirements[key]?.requiredShifts ?? 0,
                actualCount: (context.existingAssignments[key]?.length ?? 0) + (lockedRecommendations[key]?.length ?? 0),
                alternativeCount: 0,
            };
        })
        .filter((state) => state.key !== "participant:unknown" && state.participant.profileId)
        .sort((a, b) => a.key.localeCompare(b.key));
    const participantByKey = new Map(participants.map((participant) => [participant.key, participant]));
    const actualSlotCount = new Map<string, number>();
    for (const assignments of Object.values(context.existingAssignments)) {
        for (const assignment of assignments) {
            actualSlotCount.set(assignment.id, (actualSlotCount.get(assignment.id) ?? 0) + 1);
        }
    }
    for (const assignments of Object.values(lockedRecommendations)) {
        for (const assignment of assignments) {
            actualSlotCount.set(assignment.id, (actualSlotCount.get(assignment.id) ?? 0) + 1);
        }
    }
    for (const slot of slots) {
        actualSlotCount.set(
            slot.id,
            Math.max(actualSlotCount.get(slot.id) ?? 0, Math.max(0, slot.assignedCount ?? 0)),
        );
    }

    const rejected = new Set(
        (context.existingRecommendations ?? [])
            .filter((recommendation) => recommendation.status === "REJECTED")
            .map((recommendation) => `${recommendation.itemId}:${recommendation.profileId}`),
    );
    const baseEligibility = new Map<string, Set<string>>();
    for (const state of participants) {
        const eligible = new Set<string>();
        for (const slot of slots) {
            const warnings = collectAssignmentWarnings(
                toCandidate(slot),
                state.participant,
                [...(context.existingAssignments[state.key] ?? []), ...(lockedRecommendations[state.key] ?? [])],
                policy,
            );
            if (!warnings.some((warning) => isBlockingWarning(warning.type))) eligible.add(slot.id);
        }
        state.alternativeCount = eligible.size;
        baseEligibility.set(state.key, eligible);
    }
    const baseSlotEligibilityCount = new Map(
        slots.map((slot) => [
            slot.id,
            participants.reduce(
                (count, participant) => count + Number(
                    (baseEligibility.get(participant.key)?.has(slot.id) ?? false)
                    && !rejected.has(`${slot.id}:${participant.participant.profileId}`),
                ),
                0,
            ),
        ]),
    );

    const pending: PendingAssignment[] = [];
    const pendingByParticipant = new Map<string, Set<PendingAssignment>>();
    const pendingBySlot = new Map<string, Set<PendingAssignment>>();
    const retainedPairs = new Set(
        (context.existingRecommendations ?? [])
            .filter((recommendation) => recommendation.status === "PENDING" && recommendation.profileId)
            .map((recommendation) => `${recommendation.itemId}:profile:${recommendation.profileId}`),
    );
    const addPending = (assignment: PendingAssignment): void => {
        pending.push(assignment);
        const participantAssignments = pendingByParticipant.get(assignment.participantKey) ?? new Set();
        participantAssignments.add(assignment);
        pendingByParticipant.set(assignment.participantKey, participantAssignments);
        const slotAssignments = pendingBySlot.get(assignment.slotId) ?? new Set();
        slotAssignments.add(assignment);
        pendingBySlot.set(assignment.slotId, slotAssignments);
    };
    const movePendingSlot = (assignment: PendingAssignment, slotId: string): void => {
        pendingBySlot.get(assignment.slotId)?.delete(assignment);
        assignment.slotId = slotId;
        const assignments = pendingBySlot.get(slotId) ?? new Set();
        assignments.add(assignment);
        pendingBySlot.set(slotId, assignments);
    };
    const movePendingParticipant = (assignment: PendingAssignment, participantKey: string): void => {
        pendingByParticipant.get(assignment.participantKey)?.delete(assignment);
        assignment.participantKey = participantKey;
        const assignments = pendingByParticipant.get(participantKey) ?? new Set();
        assignments.add(assignment);
        pendingByParticipant.set(participantKey, assignments);
    };

    const pendingForParticipant = (participantKey: string): PendingAssignment[] =>
        [...(pendingByParticipant.get(participantKey) ?? [])];
    const participantCount = (participantKey: string): number => {
        const state = participantByKey.get(participantKey);
        return (state?.actualCount ?? 0) + (pendingByParticipant.get(participantKey)?.size ?? 0);
    };
    const slotCount = (slotId: string): number =>
        (actualSlotCount.get(slotId) ?? 0) + (pendingBySlot.get(slotId)?.size ?? 0);
    const slotCapacity = (slotId: string): number => {
        const capacity = slotById.get(slotId)?.maxAssignees;
        return capacity == null ? Number.POSITIVE_INFINITY : Math.max(0, capacity);
    };
    const assignmentsForParticipant = (participantKey: string, excluded?: PendingAssignment): AssignmentCandidate[] => {
        const actual = [
            ...(context.existingAssignments[participantKey] ?? []),
            ...(lockedRecommendations[participantKey] ?? []),
        ];
        const proposed = pendingForParticipant(participantKey)
            .filter((assignment) => assignment !== excluded)
            .map((assignment) => slotById.get(assignment.slotId))
            .filter((slot): slot is FairAssignmentSlot => Boolean(slot))
            .map((slot) => toCandidate(slot));
        return [...actual, ...proposed];
    };
    const temporalTarget = (state: ParticipantState, excluded?: PendingAssignment): number => {
        if (state.required <= 0) return 0;
        const current = assignmentsForParticipant(state.key, excluded)
            .map((assignment) => normalizedAttendanceMoment(context.plan, state.participant, assignment));
        return nextTemporalAnchor(current, state.required);
    };
    const temporalIncrement = (
        state: ParticipantState,
        slot: FairAssignmentSlot,
        excluded?: PendingAssignment,
    ): number => {
        const candidate = normalizedAttendanceMoment(context.plan, state.participant, toCandidate(slot));
        const target = temporalTarget(state, excluded);
        const distance = candidate - target;
        return distance * distance;
    };
    const canTake = (state: ParticipantState, slot: FairAssignmentSlot, excluded?: PendingAssignment): boolean => {
        if (rejected.has(`${slot.id}:${state.participant.profileId}`)) return false;
        if (!baseEligibility.get(state.key)?.has(slot.id)) return false;
        const currentAssignments = assignmentsForParticipant(state.key, excluded);
        if (currentAssignments.some((assignment) => assignment.id === slot.id)) return false;
        const warnings = collectAssignmentWarnings(
            toCandidate(slot),
            state.participant,
            currentAssignments,
            policy,
        );
        return !warnings.some((warning) => isBlockingWarning(warning.type));
    };
    const deficit = (state: ParticipantState): number => Math.max(state.required - participantCount(state.key), 0);
    const candidateOrder = (slot: FairAssignmentSlot, a: ParticipantState, b: ParticipantState): number => {
        const countA = participantCount(a.key);
        const countB = participantCount(b.key);
        const ratioA = fulfilledRatio(a, countA);
        const ratioB = fulfilledRatio(b, countB);
        if (ratioA !== ratioB) return ratioA < ratioB ? -1 : 1;
        const deficitDifference = deficit(b) - deficit(a);
        if (deficitDifference !== 0) return deficitDifference;
        const excessDifference = Math.max(countA - a.required, 0) - Math.max(countB - b.required, 0);
        if (excessDifference !== 0) return excessDifference;
        if (countA !== countB) return countA - countB;
        const temporalDifference = temporalIncrement(a, slot) - temporalIncrement(b, slot);
        if (temporalDifference !== 0) return temporalDifference;
        if (a.alternativeCount !== b.alternativeCount) return a.alternativeCount - b.alternativeCount;
        const retainedA = Number(retainedPairs.has(`${slot.id}:${a.key}`));
        const retainedB = Number(retainedPairs.has(`${slot.id}:${b.key}`));
        if (retainedA !== retainedB) return retainedB - retainedA;
        const boundaryDifference = boundaryPenalty(a.participant, slot) - boundaryPenalty(b.participant, slot);
        if (boundaryDifference !== 0) return boundaryDifference;
        return a.key.localeCompare(b.key);
    };

    const eligibleDeficitParticipants = (slot: FairAssignmentSlot): ParticipantState[] => participants
        .filter((state) => deficit(state) > 0 && canTake(state, slot))
        .sort((a, b) => candidateOrder(slot, a, b));
    const underfilledSlots = (): FairAssignmentSlot[] => slots
        .filter((slot) => slotCount(slot.id) < slotCapacity(slot.id))
        .filter((slot) => Number.isFinite(slotCapacity(slot.id)) || eligibleDeficitParticipants(slot).length > 0)
        .sort((a, b) => {
            const candidateDifference = eligibleDeficitParticipants(a).length - eligibleDeficitParticipants(b).length;
            if (candidateDifference !== 0) return candidateDifference;
            const remainingA = slotCapacity(a.id) - slotCount(a.id);
            const remainingB = slotCapacity(b.id) - slotCount(b.id);
            if (remainingA !== remainingB) return remainingA - remainingB;
            return slots.indexOf(a) - slots.indexOf(b);
        });

    let repairNodes = 0;
    const repairHole = (slot: FairAssignmentSlot, depth: number, visitedSlots: Set<string>): boolean => {
        if (depth > MAX_REPAIR_DEPTH || repairNodes >= MAX_REPAIR_NODES) return false;
        repairNodes += 1;

        const direct = eligibleDeficitParticipants(slot)[0];
        if (direct) {
            addPending({
                slotId: slot.id,
                participantKey: direct.key,
                retained: retainedPairs.has(`${slot.id}:${direct.key}`),
            });
            return true;
        }

        const movable = [...participants].sort((a, b) => candidateOrder(slot, a, b));
        for (const state of movable) {
            for (const assignment of [...pendingForParticipant(state.key)].sort((a, b) => {
                const temporalDifference = temporalIncrement(state, slot, a) - temporalIncrement(state, slot, b);
                if (temporalDifference !== 0) return temporalDifference;
                if (a.retained !== b.retained) return Number(a.retained) - Number(b.retained);
                return a.slotId.localeCompare(b.slotId);
            })) {
                const oldSlot = slotById.get(assignment.slotId);
                if (!oldSlot || visitedSlots.has(oldSlot.id) || !canTake(state, slot, assignment)) continue;
                const previousSlotId = assignment.slotId;
                movePendingSlot(assignment, slot.id);
                visitedSlots.add(oldSlot.id);
                if (repairHole(oldSlot, depth + 1, visitedSlots)) return true;
                visitedSlots.delete(oldSlot.id);
                movePendingSlot(assignment, previousSlotId);
            }
        }
        return false;
    };

    const nextParticipantOrder = (a: ParticipantState, b: ParticipantState): number => {
        const countA = participantCount(a.key);
        const countB = participantCount(b.key);
        const ratioA = fulfilledRatio(a, countA);
        const ratioB = fulfilledRatio(b, countB);
        if (ratioA !== ratioB) return ratioA < ratioB ? -1 : 1;
        const deficitDifference = deficit(b) - deficit(a);
        if (deficitDifference !== 0) return deficitDifference;
        if (a.alternativeCount !== b.alternativeCount) return a.alternativeCount - b.alternativeCount;
        return a.key.localeCompare(b.key);
    };
    const precedesScore = (candidate: number[], current: number[]): boolean => {
        for (let index = 0; index < candidate.length; index += 1) {
            if (candidate[index] !== current[index]) return candidate[index] < current[index];
        }
        return false;
    };
    while (true) {
        const underserved = participants
            .filter((state) => deficit(state) > 0)
            .sort(nextParticipantOrder);
        let choice: {state: ParticipantState; slot: FairAssignmentSlot} | undefined;
        for (const state of underserved) {
            const anchor = temporalTarget(state);
            let target: FairAssignmentSlot | undefined;
            let targetScore: [number, number, number, number, number] | undefined;
            for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
                const slot = slots[slotIndex];
                if (slotCount(slot.id) >= slotCapacity(slot.id) || !canTake(state, slot)) continue;
                const distance = normalizedAttendanceMoment(context.plan, state.participant, toCandidate(slot)) - anchor;
                const score: [number, number, number, number, number] = [
                    baseSlotEligibilityCount.get(slot.id) ?? 0,
                    distance * distance,
                    -Number(retainedPairs.has(`${slot.id}:${state.key}`)),
                    boundaryPenalty(state.participant, slot),
                    slotIndex,
                ];
                if (!targetScore || precedesScore(score, targetScore)) {
                    target = slot;
                    targetScore = score;
                }
            }
            if (target) {
                choice = {state, slot: target};
                break;
            }
        }
        if (!choice) break;
        addPending({
            slotId: choice.slot.id,
            participantKey: choice.state.key,
            retained: retainedPairs.has(`${choice.slot.id}:${choice.state.key}`),
        });
    }

    // Bounded augmenting repair can move only pending work; committed assignments stay locked.
    let repaired = true;
    while (repaired && repairNodes < MAX_REPAIR_NODES) {
        repaired = false;
        for (const slot of underfilledSlots()) {
            if (repairHole(slot, 0, new Set([slot.id]))) {
                repaired = true;
                break;
            }
        }
    }

    // Same-slot ownership swaps improve fairness while preserving every filled position.
    const fairnessMetric = (): [number, number] => {
        const normalizedDeficits = participants.map((state) => state.required > 0
            ? deficit(state) / state.required
            : 0);
        return [
            normalizedDeficits.length > 0 ? Math.max(...normalizedDeficits) : 0,
            normalizedDeficits.reduce((total, value) => total + value * value, 0),
        ];
    };
    const improvesFairness = (after: [number, number], before: [number, number]): boolean =>
        after[0] < before[0] || (after[0] === before[0] && after[1] < before[1]);
    let fairnessMoves = 0;
    let fairnessImproved = true;
    while (fairnessImproved && fairnessMoves < MAX_FAIRNESS_MOVES) {
        fairnessImproved = false;
        for (const assignment of pending) {
            const slot = slotById.get(assignment.slotId);
            const current = participantByKey.get(assignment.participantKey);
            if (!slot || !current) continue;
            for (const replacement of eligibleDeficitParticipants(slot)) {
                if (replacement.key === current.key || !canTake(replacement, slot)) continue;
                const before = fairnessMetric();
                movePendingParticipant(assignment, replacement.key);
                const after = fairnessMetric();
                fairnessMoves += 1;
                if (improvesFairness(after, before)) {
                    assignment.retained = false;
                    fairnessImproved = true;
                    break;
                }
                movePendingParticipant(assignment, current.key);
            }
            if (fairnessImproved) break;
        }
    }

    // Overfill is a last-resort fairness phase after all normal fill and repair paths are exhausted.
    if (context.plan.allowOverfillAfterFull) {
        while (true) {
            const underserved = participants
                .filter((state) => deficit(state) > 0)
                .sort((a, b) => {
                    const ratioA = fulfilledRatio(a, participantCount(a.key));
                    const ratioB = fulfilledRatio(b, participantCount(b.key));
                    if (ratioA !== ratioB) return ratioA < ratioB ? -1 : 1;
                    const deficitDifference = deficit(b) - deficit(a);
                    return deficitDifference !== 0 ? deficitDifference : a.key.localeCompare(b.key);
                });
            if (underserved.length === 0) break;

            let assigned = false;
            for (const state of underserved) {
                const target = slots
                    .filter((slot) => canTake(state, slot))
                    .filter((slot) => slotCount(slot.id) >= slotCapacity(slot.id))
                    .sort((a, b) => {
                        const overfillDifference = (slotCount(a.id) - slotCapacity(a.id)) - (slotCount(b.id) - slotCapacity(b.id));
                        if (overfillDifference !== 0) return overfillDifference;
                        const temporalDifference = temporalIncrement(state, a) - temporalIncrement(state, b);
                        if (temporalDifference !== 0) return temporalDifference;
                        const boundaryDifference = boundaryPenalty(state.participant, a) - boundaryPenalty(state.participant, b);
                        return boundaryDifference !== 0 ? boundaryDifference : slots.indexOf(a) - slots.indexOf(b);
                    })[0];
                if (!target) continue;
                addPending({
                    slotId: target.id,
                    participantKey: state.key,
                    retained: retainedPairs.has(`${target.id}:${state.key}`),
                });
                assigned = true;
                break;
            }
            if (!assigned) break;
        }
    }

    return pending
        .map((assignment): RecommendationInput => ({
            itemId: assignment.slotId,
            profileId: participantByKey.get(assignment.participantKey)?.participant.profileId ?? null,
            status: "PENDING",
        }))
        .sort((a, b) => `${a.itemId}:${a.profileId}`.localeCompare(`${b.itemId}:${b.profileId}`));
}
