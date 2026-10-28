/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
    RoundingMode, ParticipantAttendance, RequirementOverrideInput, RequirementOverrideLike,
    RoleRequirementInput, RoleRequirementLike, StayRequirementInput, ParticipantRequirementResult,
    ShiftSlot, ShiftParticipant, ShiftParticipantGroup, ShiftRequirementParticipantResult,
    ShiftRequirementComputationResult, ParticipantRequirementSummary, RequirementCapacitySummary,
    BaselineRequirementDiagnostics, BaselineRequirementComputationResult, RequirementCapacitySlot,
    RequirementAnalysisInput, RequirementAnalysisResult,
    HypotheticalRoleCoverageResult, RequirementPlanInput, BaselineSlotInput,
} from "../../types/ActivityRequirementTypes";

interface DaysWindow {
    start: string;
    end: string;
    days: number;
}

/** Count an inclusive civil-date interval without advancing past its endpoint.
 * Reversed intervals contribute no days; stepping retains its existing invalid-date failure. */
export function countInclusiveDays(start: string, end: string): number {
    if (start > end) return 0;
    // Civil UTC coordinates avoid DST and years-below-100 constructor behavior.
    // Constant arithmetic also makes admission of a large saved range inexpensive.
    const first = new Date(start + 'T00:00:00Z').getTime();
    const last = new Date(end + 'T00:00:00Z').getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last)) throw new RangeError('Invalid time value');
    return Math.floor((last - first) / 86_400_000) + 1;
}

export function clampAttendanceWindow(planStart: string, planEnd: string, arrival?: string | null, departure?: string | null): DaysWindow | null {
    const start = arrival && arrival > planStart ? arrival : planStart;
    const end = departure && departure < planEnd ? departure : planEnd;

    if (start > planEnd || end < planStart || start > end) return null;

    return {
        start,
        end,
        days: countInclusiveDays(start, end),
    };
}

/** Apply the saved rounding choice, retaining CEIL for the default branch. */
export function applyRounding(value: number, mode: RoundingMode): number {
    // This is used when constructing proportional tables and baseline estimates;
    // exact saved requirements are resolved separately without another rounding.
    switch (mode) {
        case "FLOOR":
            return Math.floor(value);
        case "ROUND":
            return Math.round(value);
        default:
            return Math.ceil(value);
    }
}

export function toParticipantKey(participant: ParticipantAttendance): string {
    if (participant.profileId) return `profile:${participant.profileId}`;
    return "participant:unknown";
}

export function toParticipantName(participant: ParticipantAttendance): string {
    if (participant.name) return participant.name;
    if (participant.profileId) return `Profile #${participant.profileId}`;
    return "Participant";
}

/** Copy the supported override fields and reject invalid identity/count inputs
 * in the established validation order, without mutating the supplied draft. */
export function normalizeOverrideInput(input: RequirementOverrideInput): RequirementOverrideInput {
    // Normalize optional identifiers while retaining the submitted count for the
    // distinct missing, finite, integer and non-negative checks below.
    const normalized: RequirementOverrideInput = {
        id: input.id,
        roleId: input.roleId == null ? null : Number(input.roleId),
        profileId: input.profileId ?? null,
        requiredShifts: input.requiredShifts,
    };

    if (!normalized.profileId) {
        throw new Error("Override requires a userId or guestId");
    }

    if (normalized.requiredShifts == null || Number.isNaN(normalized.requiredShifts)) {
        throw new Error("Override required shifts must be defined");
    }

    if (!Number.isFinite(normalized.requiredShifts)) {
        throw new Error("Override required shifts must be finite");
    }

    if (!Number.isInteger(normalized.requiredShifts)) {
        throw new Error("Override required shifts must be an integer");
    }

    if (normalized.requiredShifts < 0) {
        throw new Error("Override required shifts must be non-negative");
    }

    return normalized;
}

/** Normalize a role identifier and validate its exact non-negative shift count. */
export function normalizeRoleRequirementInput(input: RoleRequirementInput): RoleRequirementInput {
    // Validate the role before the count so callers retain the same first error
    // when both fields are invalid.
    const normalized: RoleRequirementInput = {
        roleId: Number(input.roleId),
        requiredShifts: input.requiredShifts,
    };

    if (!Number.isInteger(normalized.roleId) || Number(normalized.roleId) <= 0) {
        throw new Error("Role id must be a positive integer");
    }

    if (normalized.requiredShifts == null || Number.isNaN(normalized.requiredShifts)) {
        throw new Error("Role required shifts must be defined");
    }

    if (!Number.isFinite(normalized.requiredShifts)) {
        throw new Error("Role required shifts must be finite");
    }

    if (!Number.isInteger(normalized.requiredShifts)) {
        throw new Error("Role required shifts must be an integer");
    }

    if (normalized.requiredShifts < 0) {
        throw new Error("Role required shifts must be non-negative");
    }

    return normalized;
}

/** Copy a stay-duration requirement into the shared calculation shape and reject
 * invalid day/count values without changing the caller's draft or saved object. */
export function normalizeStayRequirementInput(input: StayRequirementInput): StayRequirementInput {
    // Only the declared numeric inputs enter the normalized calculation value;
    // transport fields and any extra properties remain with the caller.
    const normalized: StayRequirementInput = {
        stayDays: input.stayDays,
        requiredShifts: input.requiredShifts,
    };

    // A duration identifies a positive number of civil days, while its required
    // shift count may be zero. Preserve the existing separate validation errors.
    if (!Number.isInteger(normalized.stayDays) || normalized.stayDays <= 0) {
        throw new Error("Stay duration must be a positive integer");
    }

    if (!Number.isInteger(normalized.requiredShifts) || normalized.requiredShifts < 0) {
        throw new Error("Stay duration required shifts must be a non-negative integer");
    }

    return normalized;
}

/** Build one rounded requirement for each possible positive stay duration. */
export function buildProportionalStayRequirements(
    planDays: number,
    fullStayRequirement: number,
    roundingMode: RoundingMode,
): StayRequirementInput[] {
    if (!Number.isInteger(planDays) || planDays <= 0) return [];

    // Rounding belongs to table creation; consumers later use these saved counts
    // verbatim instead of recalculating each participant's fractional share.
    return Array.from({length: planDays}, (_, index) => {
        const stayDays = index + 1;
        return {
            stayDays,
            requiredShifts: applyRounding(fullStayRequirement * (stayDays / planDays), roundingMode),
        };
    });
}

/** Deduplicate slot identifiers by their string key, preserving first value/order. */
function normalizeFeasibleSlots(slotIds: Array<string | number> | undefined): Array<string | number> {
    if (!slotIds) return [];

    const seen = new Set<string>();
    const normalized: Array<string | number> = [];

    // Numeric and textual forms of the same identifier describe one feasible slot.
    for (const slotId of slotIds) {
        const key = String(slotId);
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(slotId);
    }

    return normalized;
}

function toShiftParticipantKey(participant: ShiftParticipant): string {
    const knownKey = toParticipantKey(participant);
    if (knownKey !== "participant:unknown") return knownKey;
    return `participant:${participant.participantId}`;
}

function ensureNonNegativeInteger(value: number | null | undefined, fallback = 0): number {
    if (value == null) return fallback;
    if (!Number.isFinite(value) || Number.isNaN(value)) return fallback;
    return Math.max(0, Math.trunc(value));
}

/** Choose a participant's lowest matching role override before their general
 * override; saved identifiers deterministically resolve equal requirements. */
export function selectOverride(participant: ParticipantAttendance, overrides: RequirementOverrideLike[]): RequirementOverrideLike | undefined {
    const key = participant.profileId ?? null;
    const roleIds = participant.roleIds ?? [];

    // Accept hydrated relations and plain projections through the same profile
    // identity before considering the participant's current roles.
    const matching = overrides.filter((override) => {
        const profileId = override.profile?.id ?? override.profileId;
        return profileId != null && key === profileId;
    });
    const roleSpecific = matching
        .filter((override) => override.roleId != null && roleIds.includes(Number(override.roleId)))
        .sort((a, b) => {
            const requirementDifference = a.requiredShifts - b.requiredShifts;
            if (requirementDifference !== 0) return requirementDifference;
            return (a.id ?? 0) - (b.id ?? 0);
        });

    if (roleSpecific.length > 0) return roleSpecific[0];

    // A general override is eligible only when no role-specific override matched.
    return matching
        .filter((override) => override.roleId == null)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
}

/** Resolve the smallest configured requirement among the participant's roles,
 * keeping no matching role distinct from a matching zero requirement. */
export function resolveRoleFixedRequirement(roleRequirements: RoleRequirementLike[], roleIds: number[] | undefined): number | null {
    if (!roleIds || roleIds.length === 0) return null;

    let minRequirement = Number.POSITIVE_INFINITY;
    let hasMatch = false;

    // Multiple roles reduce to the least required count, never an additive total.
    for (const requirement of roleRequirements) {
        if (!roleIds.includes(Number(requirement.roleId))) continue;
        minRequirement = Math.min(minRequirement, ensureNonNegativeInteger(requirement.requiredShifts));
        hasMatch = true;
    }

    return hasMatch ? minRequirement : null;
}

/** Require exactly one entry for every duration from one through the plan length. */
export function hasCompleteStayRequirements(planDays: number, stayRequirements: Array<Pick<StayRequirementInput, "stayDays">>): boolean {
    if (!Number.isInteger(planDays) || planDays <= 0 || stayRequirements.length !== planDays) return false;
    // Cardinality alone cannot detect a duplicated duration or a missing middle day.
    const days = new Set(stayRequirements.map((requirement) => Number(requirement.stayDays)));
    return days.size === planDays && Array.from({length: planDays}, (_, index) => index + 1).every((day) => days.has(day));
}

/** Check the shared requirement value domain without throwing or changing drafts. */
export function hasValidRequirementValues(
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[],
): boolean {
    // Keep role, personal and duration validation in one analysis predicate; an
    // override accepts either its plain profile identifier or hydrated relation.
    const nonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;
    return roleRequirements.every((requirement) =>
        Number.isInteger(Number(requirement.roleId))
        && Number(requirement.roleId) > 0
        && nonNegativeInteger(requirement.requiredShifts))
        && overrides.every((override) => {
            if (override.profileId == null && override.profile?.id == null) return false;
            const validRole = override.roleId == null
                || (Number.isInteger(Number(override.roleId)) && Number(override.roleId) > 0);
            return validRole && nonNegativeInteger(override.requiredShifts);
        })
        && stayRequirements.every((requirement) =>
            Number.isInteger(requirement.stayDays)
            && requirement.stayDays > 0
            && nonNegativeInteger(requirement.requiredShifts));
}

/** Resolve one participant's exact saved requirement: a personal override precedes
 * a matching role, then the configured stay duration. Missing attendance dates use
 * the full plan window; nonoverlapping attendance contributes zero. */
export function calculateParticipantRequirement(
    plan: RequirementPlanInput,
    participant: ParticipantAttendance,
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[] = [],
): ParticipantRequirementResult {
    // Clip attendance to the plan before selecting any requirement. Diagnostics
    // still retain the saved rounding mode when no attendance overlaps the plan.
    const roundingMode: RoundingMode = plan.roundingMode ?? "CEIL";
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    const attendance = clampAttendanceWindow(plan.startDate, plan.endDate, participant.arrivalDate ?? undefined, participant.departureDate ?? undefined);
    if (!attendance || planDays === 0) {
        return {
            participantKey: toParticipantKey(participant),
            requiredShifts: 0,
            source: "none",
            breakdown: {
                attendanceDays: 0,
                planDays,
                proportionalRequirement: 0,
                appliedRounding: roundingMode,
            },
        };
    }

    const ratio = attendance.days / planDays;

    let requiredShifts = 0;
    let source: ParticipantRequirementResult["source"] = "none";
    let roleRequirement: number | null = null;
    const stayDurationRequirement = stayRequirements.find(
        (requirement) => Number(requirement.stayDays) === attendance.days,
    )?.requiredShifts;
    const override = selectOverride(participant, overrides);
    const requirementFromOverride = override?.requiredShifts ?? null;

    if (plan.assignmentMode === "REQUIRED") {
        roleRequirement = resolveRoleFixedRequirement(roleRequirements, participant.roleIds);

        // Runtime values are exact. Rounding is confined to creation of the saved
        // stay-duration table, never applied again while resolving a participant.
        if (requirementFromOverride != null) {
            requiredShifts = requirementFromOverride;
            source = "override";
        } else if (roleRequirement != null) {
            requiredShifts = roleRequirement;
            source = "role";
        } else if (stayDurationRequirement != null) {
            requiredShifts = stayDurationRequirement;
            source = "general";
        } else {
            source = "unconfigured";
        }
    }

    return {
        participantKey: toParticipantKey(participant),
        requiredShifts,
        source,
        breakdown: {
            attendanceDays: attendance.days,
            planDays,
            proportionalRequirement: plan.generalRequiredShifts != null ? plan.generalRequiredShifts * ratio : 0,
            stayDurationRequirement,
            appliedRounding: roundingMode,
            roleRequirement: roleRequirement ?? undefined,
            overrideRequirement: requirementFromOverride ?? undefined,
        },
    };
}

/** Resolve the same saved requirement rules for each participant, keyed by profile. */
export function calculateRequirementsForParticipants(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[] = [],
): Record<string, ParticipantRequirementResult> {
    // Preserve input iteration and key replacement semantics for repeated profiles.
    const result: Record<string, ParticipantRequirementResult> = {};
    for (const participant of participants) {
        const requirement = calculateParticipantRequirement(plan, participant, roleRequirements, overrides, stayRequirements);
        result[requirement.participantKey] = requirement;
    }
    return result;
}

/** Combine resolved requirements with assignment counts for participant display,
 * retaining the supplied participant order and optional attendance details. */
export function summarizeParticipantRequirements(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    assignments: Record<string, unknown[]>,
    stayRequirements: StayRequirementInput[] = [],
): ParticipantRequirementSummary[] {
    // Calculate policy once, then project display counts without changing saved
    // assignments or allowing an over-assignment to produce negative remaining work.
    const requirementMap = calculateRequirementsForParticipants(plan, participants, roleRequirements, overrides, stayRequirements);

    return participants.map((participant) => {
        const participantKey = toParticipantKey(participant);
        const requirement = requirementMap[participantKey];
        const requiredShifts = requirement?.requiredShifts ?? 0;
        const assignedShifts = assignments[participantKey]?.length ?? 0;

        return {
            participantKey,
            name: participant.name ?? null,
            roleIds: participant.roleIds ?? [],
            requiredShifts,
            assignedShifts,
            remainingShifts: Math.max(requiredShifts - assignedShifts, 0),
            source: requirement?.source ?? "none",
            attendanceDays: requirement?.breakdown.attendanceDays ?? 0,
            attendance: participant.arrivalDate || participant.departureDate
                ? {arrivalDate: participant.arrivalDate, departureDate: participant.departureDate}
                : undefined,
        };
    });
}

interface RolePosition {
    slotId: string | number;
    day: string;
    roleId: number;
    ordinal: number;
}

interface FlowEdge {
    to: number;
    reverseIndex: number;
    capacity: number;
    cost: number;
}

interface HeapEntry {
    node: number;
    distance: number;
}

/** Insert a shortest-path candidate into the in-place minimum-distance heap. */
function pushHeap(heap: HeapEntry[], entry: HeapEntry): void {
    heap.push(entry);
    let index = heap.length - 1;
    // Move larger ancestors down until the new candidate satisfies heap ordering.
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent].distance <= entry.distance) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = entry;
}

/** Remove the least-distance candidate, restoring the residual-path work heap. */
function popHeap(heap: HeapEntry[]): HeapEntry | undefined {
    if (heap.length === 0) return undefined;
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length === 0) return first;

    // Fill the root hole with the last candidate, moving the cheaper child up
    // until that candidate can be placed without breaking minimum ordering.
    let index = 0;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].distance < heap[left].distance ? right : left;
        if (heap[child].distance >= last.distance) break;
        heap[index] = heap[child];
        index = child;
    }
    heap[index] = last;
    return first;
}

function addFlowEdge(graph: FlowEdge[][], from: number, to: number, capacity: number, cost: number): FlowEdge {
    const forward: FlowEdge = {to, reverseIndex: graph[to].length, capacity, cost};
    const reverse: FlowEdge = {to: from, reverseIndex: graph[from].length, capacity: 0, cost: -cost};
    graph[from].push(forward);
    graph[to].push(reverse);
    return forward;
}

function isParticipantAvailableForRoleSlot(participant: ParticipantAttendance, position: RolePosition): boolean {
    if (participant.arrivalDate && position.day < participant.arrivalDate) return false;
    if (participant.departureDate && position.day > participant.departureDate) return false;
    return true;
}

/**
 * Finds the worst-case role distribution for requirement totals. Cardinality is
 * optimized before saved requirement reduction, so every fillable role is treated
 * as filled while the largest possible amount of general demand is removed.
 */
export function calculateHypotheticalRoleCoverage(options: {
    plan: RequirementPlanInput;
    participants: ParticipantAttendance[];
    roleRequirements: RoleRequirementLike[];
    overrides: RequirementOverrideLike[];
    stayRequirements: StayRequirementInput[];
    slots: RequirementCapacitySlot[];
    baselineWeight?: (participant: ParticipantAttendance, roleId: number) => number;
}): HypotheticalRoleCoverageResult {
    const positions: RolePosition[] = [];
    const roleCapacityConflicts: HypotheticalRoleCoverageResult["roleCapacityConflicts"] = [];

    for (const slot of [...options.slots].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        const slotCapacity = ensureNonNegativeInteger(slot.maxAssignees);
        const roleCapacity = (slot.roles ?? []).reduce(
            (total, role) => total + ensureNonNegativeInteger(role.maxQty),
            0,
        );
        if (roleCapacity > slotCapacity) {
            roleCapacityConflicts.push({slotId: slot.id, roleCapacity, slotCapacity});
        }

        for (const role of [...(slot.roles ?? [])].sort((a, b) => a.roleId - b.roleId)) {
            const openQty = Math.max(
                ensureNonNegativeInteger(role.maxQty) - ensureNonNegativeInteger(role.assignedQty),
                0,
            );
            for (let ordinal = 0; ordinal < openQty; ordinal += 1) {
                if (slot.day) positions.push({
                    slotId: slot.id,
                    day: slot.day,
                    roleId: role.roleId,
                    ordinal,
                });
            }
        }
    }

    const overriddenParticipantIds = new Set(
        options.overrides
            .map((override) => override.profile?.id ?? override.profileId)
            .filter((profileId): profileId is string => Boolean(profileId)),
    );
    const participants = options.participants
        .filter((participant) => (participant.roleIds ?? []).length === 0)
        // Personal overrides are authoritative and stay verbatim even in the
        // hypothetical end state; only the remaining general pool can absorb
        // an as-yet-unfilled named role.
        .filter((participant) => !participant.profileId || !overriddenParticipantIds.has(participant.profileId))
        .filter((participant) => toParticipantKey(participant) !== "participant:unknown")
        .sort((a, b) => toParticipantKey(a).localeCompare(toParticipantKey(b)));

    if (participants.length === 0 || positions.length === 0) {
        return {
            matches: [],
            openRoleCount: positions.length,
            filledRoleCount: 0,
            unfilledRoleCount: positions.length,
            removedRequiredShifts: 0,
            roleCapacityConflicts,
        };
    }

    const source = 0;
    const participantOffset = 1;
    const positionOffset = participantOffset + participants.length;
    const sink = positionOffset + positions.length;
    const graph: FlowEdge[][] = Array.from({length: sink + 1}, () => []);
    const matchEdges: Array<{
        participantIndex: number;
        positionIndex: number;
        edge: FlowEdge;
        requirementBefore: number;
        requirementAfter: number;
    }> = [];
    const maximumMatches = Math.min(participants.length, positions.length);
    const benefitMultiplier = (participants.length * positions.length + 1) * (maximumMatches + 1);

    /** Add a participant's unit-capacity path and attendance-compatible role matches;
     * costs favor requirement reduction with a stable rank for deterministic ties. */
    participants.forEach(/** Add one participant's unit-capacity flow edges only
     * for attendance-eligible role positions. Requirement benefit dominates the
     * deterministic tie rank; retain before/after evidence for the selected match. */
    function addParticipantMatches(participant, participantIndex) {
        // Calculate the current requirement once before evaluating possible role changes.
        addFlowEdge(graph, source, participantOffset + participantIndex, 1, 0);
        const before = calculateParticipantRequirement(
            options.plan,
            participant,
            options.roleRequirements,
            options.overrides,
            options.stayRequirements,
        ).requiredShifts;

        /** Add one eligible role edge and retain its before/after requirement evidence. */
        positions.forEach(function addAvailablePosition(position, positionIndex) {
            // A hypothetical role cannot extend this participant's attendance.
            if (!isParticipantAvailableForRoleSlot(participant, position)) return;
            const hypotheticalParticipant = {...participant, roleIds: [position.roleId]};
            const after = calculateParticipantRequirement(
                options.plan,
                hypotheticalParticipant,
                options.roleRequirements,
                options.overrides,
                options.stayRequirements,
            ).requiredShifts;
            const benefit = options.baselineWeight
                ? options.baselineWeight(participant, position.roleId)
                : before - after;
            const normalizedBenefit = Math.round(benefit * 1_000);
            const deterministicRank = participantIndex * positions.length + positionIndex;
            const edge = addFlowEdge(
                graph,
                participantOffset + participantIndex,
                positionOffset + positionIndex,
                1,
                -normalizedBenefit * benefitMultiplier + deterministicRank,
            );
            matchEdges.push({participantIndex, positionIndex, edge, requirementBefore: before, requirementAfter: after});
        });
    });
    positions.forEach((_, positionIndex) => addFlowEdge(graph, positionOffset + positionIndex, sink, 1, 0));

    // Initial shortest-path potentials are cheap because the first residual graph is a DAG.
    // Subsequent Dijkstra passes keep matching practical for hundreds of participants.
    const potential = Array<number>(graph.length).fill(0);
    const minimumPositionCost = Array<number>(positions.length).fill(Number.POSITIVE_INFINITY);
    for (const matchEdge of matchEdges) {
        minimumPositionCost[matchEdge.positionIndex] = Math.min(
            minimumPositionCost[matchEdge.positionIndex],
            matchEdge.edge.cost,
        );
    }
    positions.forEach((_, positionIndex) => {
        const cost = minimumPositionCost[positionIndex];
        potential[positionOffset + positionIndex] = Number.isFinite(cost) ? cost : 0;
    });
    potential[sink] = positions.length > 0
        ? Math.min(...positions.map((_, positionIndex) => potential[positionOffset + positionIndex]))
        : 0;

    while (true) {
        const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
        const previousNode = Array<number>(graph.length).fill(-1);
        const previousEdge = Array<number>(graph.length).fill(-1);
        distance[source] = 0;

        const heap: HeapEntry[] = [];
        pushHeap(heap, {node: source, distance: 0});
        while (heap.length > 0) {
            const current = popHeap(heap)!;
            if (current.distance !== distance[current.node]) continue;
            graph[current.node].forEach((edge, edgeIndex) => {
                if (edge.capacity <= 0) return;
                const reducedCost = Math.max(edge.cost + potential[current.node] - potential[edge.to], 0);
                const candidateDistance = current.distance + reducedCost;
                if (candidateDistance >= distance[edge.to]) return;
                distance[edge.to] = candidateDistance;
                previousNode[edge.to] = current.node;
                previousEdge[edge.to] = edgeIndex;
                pushHeap(heap, {node: edge.to, distance: candidateDistance});
            });
        }

        if (previousNode[sink] < 0) break;
        for (let node = 0; node < graph.length; node += 1) {
            if (Number.isFinite(distance[node])) potential[node] += distance[node];
        }
        for (let node = sink; node !== source; node = previousNode[node]) {
            const edge = graph[previousNode[node]][previousEdge[node]];
            edge.capacity -= 1;
            graph[node][edge.reverseIndex].capacity += 1;
        }
    }

    const matches = matchEdges
        .filter(({edge}) => edge.capacity === 0)
        .map(({participantIndex, positionIndex, requirementBefore, requirementAfter}) => ({
            participantKey: toParticipantKey(participants[participantIndex]),
            slotId: positions[positionIndex].slotId,
            roleId: positions[positionIndex].roleId,
            requirementBefore,
            requirementAfter,
            removedRequirement: requirementBefore - requirementAfter,
        }))
        .sort((a, b) => {
            const slotDifference = String(a.slotId).localeCompare(String(b.slotId));
            if (slotDifference !== 0) return slotDifference;
            if (a.roleId !== b.roleId) return a.roleId - b.roleId;
            return a.participantKey.localeCompare(b.participantKey);
        });

    return {
        matches,
        openRoleCount: positions.length,
        filledRoleCount: matches.length,
        unfilledRoleCount: positions.length - matches.length,
        removedRequiredShifts: matches.reduce((total, match) => total + match.removedRequirement, 0),
        roleCapacityConflicts,
    };
}

/** Compare plan capacity with requirements after maximum hypothetical role coverage,
 * and report whether all saved requirement inputs form a complete configuration. */
export function calculateRequirementCapacitySummary(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[],
    slots: RequirementCapacitySlot[],
): RequirementCapacitySummary {
    // Start with the current participant requirements, then remove only the
    // reduction supported by the hypothetical role matching calculation.
    const requirements = calculateRequirementsForParticipants(
        plan,
        participants,
        roleRequirements,
        overrides,
        stayRequirements,
    );

    const actualRequiredSlots = Object.values(requirements).reduce(
        (total, requirement) => total + requirement.requiredShifts,
        0,
    );

    const hypotheticalRoleCoverage = calculateHypotheticalRoleCoverage({
        plan,
        participants,
        roleRequirements,
        overrides,
        stayRequirements,
        slots,
    });
    const requiredSlots = actualRequiredSlots - hypotheticalRoleCoverage.removedRequiredShifts;

    const availableSlots = slots.reduce(
        (total, slot) => total + ensureNonNegativeInteger(slot.maxAssignees),
        0,
    );

    return {
        availableSlots,
        requiredSlots,
        difference: availableSlots - requiredSlots,
        configurationComplete: plan.assignmentMode !== "REQUIRED"
            || (hasCompleteStayRequirements(countInclusiveDays(plan.startDate, plan.endDate), stayRequirements)
                && hasValidRequirementValues(roleRequirements, overrides, stayRequirements)),
        hypotheticalRoleCoverage,
    };
}

/**
 * Canonical saved/draft analysis used by both the controller and the browser.
 * Inputs are deliberately plain objects so no database or DOM dependency leaks
 * into the calculation.
 */
export function calculateRequirementAnalysis(input: RequirementAnalysisInput): RequirementAnalysisResult {
    // Resolve shared policy once for participant rows, then calculate capacity
    // independently from the same supplied plan/configuration without persistence.
    const requirementMap = calculateRequirementsForParticipants(
        input.plan,
        input.participants,
        input.roleRequirements,
        input.overrides,
        input.stayRequirements,
    );
    const participants = input.participants.map((participant) => {
        const participantKey = toParticipantKey(participant);
        const requirement = requirementMap[participantKey];
        const assignedShifts = Math.max(0, Math.trunc(input.assignedShiftCounts?.[participantKey] ?? 0));
        const requiredShifts = requirement?.requiredShifts ?? 0;

        return {
            participantKey,
            name: participant.name ?? null,
            roleIds: participant.roleIds ?? [],
            requiredShifts,
            assignedShifts,
            remainingShifts: Math.max(requiredShifts - assignedShifts, 0),
            source: requirement?.source ?? "none",
            attendanceDays: requirement?.breakdown.attendanceDays ?? 0,
            attendance: participant.arrivalDate || participant.departureDate
                ? {arrivalDate: participant.arrivalDate, departureDate: participant.departureDate}
                : undefined,
        } satisfies ParticipantRequirementSummary;
    });

    return {
        participants,
        capacitySummary: calculateRequirementCapacitySummary(
            input.plan,
            input.participants,
            input.roleRequirements,
            input.overrides,
            input.stayRequirements,
            input.slots,
        ),
    };
}

/** Allocate remaining slot demand across attendance-weighted baseline participants,
 * preserving explicit and role-fixed counts and reporting rounding surplus/deficit. */
export function calculateShiftRequirementsForParticipants(
    slots: ShiftSlot[],
    participants: ShiftParticipant[],
    options?: {
        resolveFeasibleSlots?: (participant: ShiftParticipant) => Array<string | number>;
        roundingMode?: RoundingMode
    }
): ShiftRequirementComputationResult {
    const roundingMode = options?.roundingMode ?? "CEIL";
    const resolveSlots = options?.resolveFeasibleSlots;

    const slotDemand = slots.reduce((total, slot) => total + Math.max(0, slot.capacity ?? 0), 0);

    /** Resolve feasibility once and select fixed-count precedence before attendance
     * weighting or allocation of the remaining baseline demand. */
    const participantStates = participants.map(function resolveParticipantState(participant) {
        // A caller resolver may narrow feasibility; fall back to the participant's
        // supplied identifiers when it yields no value, then deduplicate once.
        const resolvedSlots = resolveSlots ? resolveSlots(participant) : participant.feasibleSlotIds;
        const feasibleSlotIds = normalizeFeasibleSlots(resolvedSlots ?? participant.feasibleSlotIds);
        const participantKey = toShiftParticipantKey(participant);

        let group: ShiftParticipantGroup = "baseline";
        if (participant.explicitFixedShifts != null) {
            group = "explicit";
        } else if (participant.roleFixedRequirement != null) {
            group = "role-fixed";
        }

        return {
            participant,
            participantKey,
            feasibleSlotIds,
            feasibleSlotCount: feasibleSlotIds.length,
            group,
        };
    });

    const maxFeasibleSlots = participantStates.reduce((max, p) => Math.max(max, p.feasibleSlotCount), 0);

    const withAttendance = participantStates.map((state) => {
        const attendanceFactor = state.participant.attendanceFactor != null
            ? Math.max(0, Math.min(state.participant.attendanceFactor, 1))
            : maxFeasibleSlots > 0 ? state.feasibleSlotCount / maxFeasibleSlots : 0;
        return {...state, attendanceFactor};
    });

    /** Resolve the count already fixed for this participant before baseline distribution. */
    const fixedContributions = withAttendance.map(function resolveFixedContribution(state) {
        // A submitted personal count takes precedence over the role-fixed count;
        // baseline participants leave all demand to the weighted calculation.
        if (state.group === "explicit") {
            return ensureNonNegativeInteger(state.participant.explicitFixedShifts);
        }

        if (state.group === "role-fixed") {
            return ensureNonNegativeInteger(state.participant.roleFixedRequirement);
        }

        return 0;
    });

    const totalFixedShifts = fixedContributions.reduce((total, value) => total + value, 0);
    const rawRemainingShifts = slotDemand - totalFixedShifts;
    const remainingShifts = Math.max(rawRemainingShifts, 0);

    // Only baseline participants contribute attendance weight to the divisor;
    // an empty pool with remaining demand is explicitly infeasible.
    const baselinePool = withAttendance
        .filter((state) => state.group === "baseline")
        .reduce((total, state) => total + state.attendanceFactor, 0);

    const infeasibleBaseline = remainingShifts > 0 && baselinePool === 0;
    const baseline = remainingShifts === 0 || baselinePool === 0 ? 0 : applyRounding(remainingShifts / baselinePool, roundingMode);

    /** Project the fixed count or rounded attendance share with its explanatory inputs. */
    const participantResults: ShiftRequirementParticipantResult[] = withAttendance.map(function projectParticipantRequirement(state, index) {
        // Baseline weighting applies only to the baseline group; explicit and role
        // groups retain the previously resolved exact fixed contribution.
        const fixedContribution = fixedContributions[index];
        const baselineContribution = state.group === "baseline"
            ? applyRounding(state.attendanceFactor * baseline, roundingMode)
            : 0;
        const requiredShifts = state.group === "baseline" ? baselineContribution : fixedContribution;

        return {
            participantId: state.participant.participantId,
            participantKey: state.participantKey,
            requiredShifts,
            group: state.group,
            attendanceFactor: state.attendanceFactor,
            feasibleSlotCount: state.feasibleSlotCount,
            fixedContribution,
            baselineContribution,
        };
    });

    const sumRequiredShifts = participantResults.reduce((total, result) => total + result.requiredShifts, 0);
    const overshoot = Math.max(sumRequiredShifts - slotDemand, 0);
    const deficit = Math.max(slotDemand - sumRequiredShifts, 0);

    const feasible = !infeasibleBaseline && deficit === 0;

    return {
        participants: participantResults,
        totalRequiredShifts: slotDemand,
        totalFixedShifts,
        remainingShifts,
        baseline,
        sumRequiredShifts,
        feasible,
        overshoot,
        deficit,
    };
}

/** Select the closest integer stay-based baseline against the admitted plan's
 * capacity, preserving fixed participant/role requirements and hypothetical open
 * role coverage. This pure calculation returns a duration table and diagnostics;
 * it never changes assignments, settings or persistence. */
export function calculateBaselineRequirementForPlan(options: {
    plan: Pick<RequirementPlanInput, "startDate" | "endDate" | "roundingMode">;
    slots: BaselineSlotInput[];
    participants: ParticipantAttendance[];
    roleRequirements: RoleRequirementLike[];
    overrides: RequirementOverrideLike[];
}): BaselineRequirementComputationResult {
    // Capacity and attendance use the same inclusive civil-date window as the
    // saved requirement analysis. No transport or ORM entity is needed here.
    const planDays = countInclusiveDays(options.plan.startDate, options.plan.endDate);
    const slotDemand = options.slots.reduce(
        (total, slot) => total + ensureNonNegativeInteger(slot.maxAssignees ?? 0, 0),
        0,
    );
    const requirementPlan: RequirementPlanInput = {
        ...options.plan,
        assignmentMode: "REQUIRED",
        generalRequiredShifts: null,
    };
    /** Count slots within this participant's clipped inclusive attendance window. */
    const feasibleSlotCount = (participant: ParticipantAttendance): number => {
        // A participant outside the plan contributes no feasible baseline slots.
        const attendance = clampAttendanceWindow(
            options.plan.startDate,
            options.plan.endDate,
            participant.arrivalDate ?? undefined,
            participant.departureDate ?? undefined,
        );
        if (!attendance) return 0;
        return options.slots
            .filter((slot) => slot.day >= attendance.start && slot.day <= attendance.end)
            .length;
    };
    const attendanceFactorFor = (participant: ParticipantAttendance): number => {
        const attendance = clampAttendanceWindow(
            options.plan.startDate,
            options.plan.endDate,
            participant.arrivalDate ?? undefined,
            participant.departureDate ?? undefined,
        );
        return attendance && planDays > 0 ? attendance.days / planDays : 0;
    };
    interface CandidateEvaluation {
        baseline: number;
        stayRequirements: StayRequirementInput[];
        capacitySummary: RequirementCapacitySummary;
    }
    // Candidate analysis includes override precedence and hypothetical role
    // coverage. Cache complete evaluations while searching the integer range.
    const candidateCache = new Map<number, CandidateEvaluation>();
    /** Evaluate an integer baseline once with the same requirement/capacity engines as saved analysis. */
    const evaluate = (candidate: number): CandidateEvaluation => {
        // Reuse a complete candidate result during the bounded search; callers
        // receive the duration table and the matching capacity diagnostics together.
        const baseline = ensureNonNegativeInteger(candidate);
        const cached = candidateCache.get(baseline);
        if (cached) return cached;
        const stayRequirements = buildProportionalStayRequirements(
            planDays,
            baseline,
            options.plan.roundingMode ?? "CEIL",
        );
        const capacitySummary = calculateRequirementCapacitySummary(
            requirementPlan,
            options.participants,
            options.roleRequirements,
            options.overrides,
            stayRequirements,
            options.slots,
        );
        const result = {baseline, stayRequirements, capacitySummary};
        candidateCache.set(baseline, result);
        return result;
    };

    // Compare zero with a bounded upper candidate before searching. Fixed-only
    // requirements may be insensitive to every possible stay-based baseline.
    const zero = evaluate(0);
    const rawUpperBound = Math.max(1, (slotDemand + zero.capacitySummary.requiredSlots + 1) * Math.max(planDays, 1));
    const upperBound = Math.min(rawUpperBound, Math.floor(Number.MAX_SAFE_INTEGER / 4));
    const upper = evaluate(upperBound);
    const baselineInfluencesRequirements = upper.capacitySummary.requiredSlots !== zero.capacitySummary.requiredSlots;

    let chosen = zero;
    if (zero.capacitySummary.requiredSlots < slotDemand && baselineInfluencesRequirements) {
        if (upper.capacitySummary.requiredSlots >= slotDemand) {
            // Find the first baseline reaching demand, then choose its closer
            // neighbor. Equal distance retains the lower integer baseline.
            let low = 0;
            let high = upperBound;
            while (low < high) {
                const middle = Math.floor((low + high) / 2);
                if (evaluate(middle).capacitySummary.requiredSlots >= slotDemand) high = middle;
                else low = middle + 1;
            }
            const crossing = evaluate(low);
            const predecessor = evaluate(Math.max(low - 1, 0));
            const crossingDifference = Math.abs(crossing.capacitySummary.difference);
            const predecessorDifference = Math.abs(predecessor.capacitySummary.difference);
            chosen = predecessorDifference <= crossingDifference ? predecessor : crossing;
        } else {
            chosen = upper;
        }
    }

    // Participant diagnostics use the chosen hypothetical role placements only
    // for analysis. These placements remain distinct from real assignments.
    const hypotheticalRoleByParticipant = new Map(
        (chosen.capacitySummary.hypotheticalRoleCoverage?.matches ?? [])
            .map((match) => [match.participantKey, match.roleId]),
    );
    const participantResults = options.participants.map((participant, index): ShiftRequirementParticipantResult => {
        const participantKey = toParticipantKey(participant);
        const hypotheticalRoleId = hypotheticalRoleByParticipant.get(participantKey);
        const effectiveParticipant = hypotheticalRoleId == null
            ? participant
            : {...participant, roleIds: [hypotheticalRoleId]};
        const explicitOverride = selectOverride(effectiveParticipant, options.overrides);
        const roleFixedRequirement = explicitOverride == null
            ? resolveRoleFixedRequirement(options.roleRequirements, effectiveParticipant.roleIds)
            : null;
        const requirement = calculateParticipantRequirement(
            requirementPlan,
            effectiveParticipant,
            options.roleRequirements,
            options.overrides,
            chosen.stayRequirements,
        );
        const group: ShiftParticipantGroup = explicitOverride != null
            ? "explicit"
            : roleFixedRequirement != null ? "role-fixed" : "baseline";
        const fixedContribution = group === "baseline" ? 0 : requirement.requiredShifts;

        return {
            participantId: participantKey === "participant:unknown" ? `participant:${index}` : participantKey,
            participantKey,
            requiredShifts: requirement.requiredShifts,
            group,
            attendanceFactor: attendanceFactorFor(participant),
            feasibleSlotCount: feasibleSlotCount(participant),
            fixedContribution,
            baselineContribution: group === "baseline" ? requirement.requiredShifts : 0,
        };
    });
    // Aggregate the chosen projection and explain why exact capacity may be
    // unreachable without changing fixed requirements or integer rounding.
    const fixedRequiredShifts = participantResults.reduce(
        (total, participant) => total + participant.fixedContribution,
        0,
    );
    const stayBasedParticipantCount = participantResults.filter(
        (participant) => participant.group === "baseline" && participant.attendanceFactor > 0,
    ).length;
    const sumRequiredShifts = chosen.capacitySummary.requiredSlots;
    const exact = chosen.capacitySummary.difference === 0;
    let reason: BaselineRequirementDiagnostics["reason"];
    if (!baselineInfluencesRequirements) reason = "no-stay-based-participants";
    else if (chosen.baseline === 0 && fixedRequiredShifts >= slotDemand && slotDemand > 0) reason = "fixed-requirements-fill-capacity";
    else if (!exact) reason = "integer-rounding-gap";

    return {
        participants: participantResults,
        totalRequiredShifts: slotDemand,
        totalFixedShifts: fixedRequiredShifts,
        remainingShifts: Math.max(slotDemand - fixedRequiredShifts, 0),
        baseline: chosen.baseline,
        sumRequiredShifts,
        feasible: exact,
        overshoot: Math.max(sumRequiredShifts - slotDemand, 0),
        deficit: Math.max(slotDemand - sumRequiredShifts, 0),
        hypotheticalRoleCoverage: chosen.capacitySummary.hypotheticalRoleCoverage,
        stayRequirements: chosen.stayRequirements,
        projectedRequiredShifts: sumRequiredShifts,
        projectedDifference: chosen.capacitySummary.difference,
        diagnostics: {
            exact,
            baselineInfluencesRequirements,
            fixedRequiredShifts,
            stayBasedParticipantCount,
            reason,
        },
    };
}
