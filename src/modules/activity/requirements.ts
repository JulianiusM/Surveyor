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

import type {ParticipantRow} from "../../types/EventTypes";
import type {ActivityPlan} from "../database/entities/activity/ActivityPlan";

export type RoundingMode = NonNullable<ActivityPlan["roundingMode"]>;

export interface ParticipantAttendance {
    profileId?: string | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
    roleIds?: number[];
    name?: string | null;
}

export interface RequirementOverrideInput {
    id?: number;
    roleId?: number | null;
    profileId?: string | null;
    profile?: { id?: string | null; name?: string | null } | null;
    requiredShifts: number;
}

export interface RequirementOverrideLike extends Omit<RequirementOverrideInput, "roleId"> {
    roleId?: number | string | null;
}

export interface RoleRequirementInput {
    roleId: number;
    requiredShifts: number;
}

export interface RoleRequirementLike extends Omit<RoleRequirementInput, "roleId"> {
    roleId: number | string;
}

export interface StayRequirementInput {
    stayDays: number;
    requiredShifts: number;
}

export interface ParticipantRequirementResult {
    participantKey: string;
    requiredShifts: number;
    source: "none" | "general" | "role" | "override" | "unconfigured";
    breakdown: {
        attendanceDays: number;
        planDays: number;
        proportionalRequirement: number;
        stayDurationRequirement?: number;
        appliedRounding: RoundingMode;
        roleRequirement?: number;
        overrideRequirement?: number;
    };
}

export interface ShiftSlot {
    slotId: string | number;
    capacity: number;
}

export interface ShiftParticipant extends ParticipantAttendance {
    participantId: string | number;
    feasibleSlotIds?: Array<string | number>;
    explicitFixedShifts?: number | null;
    roleFixedRequirement?: number | null;
    attendanceFactor?: number;
}

export type ShiftParticipantGroup = "explicit" | "role-fixed" | "baseline";

export interface ShiftRequirementParticipantResult {
    participantId: string | number;
    participantKey: string;
    requiredShifts: number;
    group: ShiftParticipantGroup;
    attendanceFactor: number;
    feasibleSlotCount: number;
    fixedContribution: number;
    baselineContribution: number;
}

export interface ShiftRequirementComputationResult {
    participants: ShiftRequirementParticipantResult[];
    totalRequiredShifts: number;
    totalFixedShifts: number;
    remainingShifts: number;
    baseline: number;
    sumRequiredShifts: number;
    feasible: boolean;
    overshoot: number;
    deficit: number;
    hypotheticalRoleCoverage?: HypotheticalRoleCoverageResult;
}

export interface ParticipantRequirementSummary {
    participantKey: string;
    name?: string | null;
    roleIds?: number[];
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: ParticipantRequirementResult["source"];
    attendanceDays: number;
    attendance?: { arrivalDate?: string | null; departureDate?: string | null };
}

export interface RequirementCapacitySummary {
    availableSlots: number;
    requiredSlots: number;
    difference: number;
    configurationComplete: boolean;
    hypotheticalRoleCoverage?: HypotheticalRoleCoverageResult;
}

export interface BaselineRequirementDiagnostics {
    exact: boolean;
    baselineInfluencesRequirements: boolean;
    fixedRequiredShifts: number;
    stayBasedParticipantCount: number;
    reason?: "fixed-requirements-fill-capacity" | "no-stay-based-participants" | "integer-rounding-gap";
}

export interface BaselineRequirementComputationResult extends ShiftRequirementComputationResult {
    stayRequirements: StayRequirementInput[];
    projectedRequiredShifts: number;
    projectedDifference: number;
    diagnostics: BaselineRequirementDiagnostics;
}

export interface RequirementCapacitySlot {
    id: string | number;
    day?: string;
    startTime?: string | null;
    endTime?: string | null;
    maxAssignees?: number | null;
    roles?: HypotheticalRoleCapacity[];
}

export interface RequirementAnalysisInput {
    plan: RequirementPlanInput;
    participants: ParticipantAttendance[];
    roleRequirements: RoleRequirementLike[];
    overrides: RequirementOverrideLike[];
    stayRequirements: StayRequirementInput[];
    slots: RequirementCapacitySlot[];
    assignedShiftCounts?: Record<string, number>;
}

export interface RequirementAnalysisResult {
    participants: ParticipantRequirementSummary[];
    capacitySummary: RequirementCapacitySummary;
}

export interface HypotheticalRoleCapacity {
    roleId: number;
    maxQty: number;
    assignedQty?: number;
}

export interface HypotheticalRoleMatch {
    participantKey: string;
    slotId: string | number;
    roleId: number;
    requirementBefore: number;
    requirementAfter: number;
    removedRequirement: number;
}

export interface HypotheticalRoleCoverageResult {
    matches: HypotheticalRoleMatch[];
    openRoleCount: number;
    filledRoleCount: number;
    unfilledRoleCount: number;
    removedRequiredShifts: number;
    roleCapacityConflicts: Array<{
        slotId: string | number;
        roleCapacity: number;
        slotCapacity: number;
    }>;
}

interface DaysWindow {
    start: string;
    end: string;
    days: number;
}

function addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function countInclusiveDays(start: string, end: string): number {
    if (start > end) return 0;
    let cursor = start;
    let days = 0;
    while (cursor <= end) {
        days += 1;
        cursor = addDays(cursor, 1);
    }
    return days;
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

export function applyRounding(value: number, mode: RoundingMode): number {
    switch (mode) {
        case "FLOOR":
            return Math.floor(value);
        case "ROUND":
            return Math.round(value);
        default:
            return Math.ceil(value);
    }
}

export function toParticipantKey(participant: ParticipantAttendance | ParticipantRow): string {
    if (participant.profileId) return `profile:${participant.profileId}`;
    return "participant:unknown";
}

export function toParticipantName(participant: ParticipantAttendance | ParticipantRow): string {
    if (participant.name) return participant.name;
    if (participant.profileId) return `Profile #${participant.profileId}`;
    return "Participant";
}

export function normalizeOverrideInput(input: RequirementOverrideInput): RequirementOverrideInput {
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

export function normalizeRoleRequirementInput(input: RoleRequirementInput): RoleRequirementInput {
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

export interface RequirementPlanInput {
    assignmentMode: "FREE" | "REQUIRED";
    generalRequiredShifts?: number | null;
    roundingMode?: RoundingMode | null;
    startDate: string;
    endDate: string;
}

export function normalizeStayRequirementInput(input: StayRequirementInput): StayRequirementInput {
    const normalized: StayRequirementInput = {
        stayDays: input.stayDays,
        requiredShifts: input.requiredShifts,
    };

    if (!Number.isInteger(normalized.stayDays) || normalized.stayDays <= 0) {
        throw new Error("Stay duration must be a positive integer");
    }

    if (!Number.isInteger(normalized.requiredShifts) || normalized.requiredShifts < 0) {
        throw new Error("Stay duration required shifts must be a non-negative integer");
    }

    return normalized;
}

export function buildProportionalStayRequirements(
    planDays: number,
    fullStayRequirement: number,
    roundingMode: RoundingMode,
): StayRequirementInput[] {
    if (!Number.isInteger(planDays) || planDays <= 0) return [];

    return Array.from({length: planDays}, (_, index) => {
        const stayDays = index + 1;
        return {
            stayDays,
            requiredShifts: applyRounding(fullStayRequirement * (stayDays / planDays), roundingMode),
        };
    });
}

function normalizeFeasibleSlots(slotIds: Array<string | number> | undefined): Array<string | number> {
    if (!slotIds) return [];

    const seen = new Set<string>();
    const normalized: Array<string | number> = [];

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

export function selectOverride(participant: ParticipantAttendance, overrides: RequirementOverrideLike[]): RequirementOverrideLike | undefined {
    const key = participant.profileId ?? null;
    const roleIds = participant.roleIds ?? [];

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

    return matching
        .filter((override) => override.roleId == null)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
}

export function resolveRoleFixedRequirement(roleRequirements: RoleRequirementLike[], roleIds: number[] | undefined): number | null {
    if (!roleIds || roleIds.length === 0) return null;

    let minRequirement = Number.POSITIVE_INFINITY;
    let hasMatch = false;

    for (const requirement of roleRequirements) {
        if (!roleIds.includes(Number(requirement.roleId))) continue;
        minRequirement = Math.min(minRequirement, ensureNonNegativeInteger(requirement.requiredShifts));
        hasMatch = true;
    }

    return hasMatch ? minRequirement : null;
}

export function hasCompleteStayRequirements(planDays: number, stayRequirements: Array<Pick<StayRequirementInput, "stayDays">>): boolean {
    if (!Number.isInteger(planDays) || planDays <= 0 || stayRequirements.length !== planDays) return false;
    const days = new Set(stayRequirements.map((requirement) => Number(requirement.stayDays)));
    return days.size === planDays && Array.from({length: planDays}, (_, index) => index + 1).every((day) => days.has(day));
}

export function hasValidRequirementValues(
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[],
): boolean {
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

export function calculateParticipantRequirement(
    plan: RequirementPlanInput,
    participant: ParticipantAttendance,
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[] = [],
): ParticipantRequirementResult {
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

export function calculateRequirementsForParticipants(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[] = [],
): Record<string, ParticipantRequirementResult> {
    const result: Record<string, ParticipantRequirementResult> = {};
    for (const participant of participants) {
        const requirement = calculateParticipantRequirement(plan, participant, roleRequirements, overrides, stayRequirements);
        result[requirement.participantKey] = requirement;
    }
    return result;
}

export function summarizeParticipantRequirements(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    assignments: Record<string, unknown[]>,
    stayRequirements: StayRequirementInput[] = [],
): ParticipantRequirementSummary[] {
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

function pushHeap(heap: HeapEntry[], entry: HeapEntry): void {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent].distance <= entry.distance) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = entry;
}

function popHeap(heap: HeapEntry[]): HeapEntry | undefined {
    if (heap.length === 0) return undefined;
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length === 0) return first;

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

    participants.forEach((participant, participantIndex) => {
        addFlowEdge(graph, source, participantOffset + participantIndex, 1, 0);
        const before = calculateParticipantRequirement(
            options.plan,
            participant,
            options.roleRequirements,
            options.overrides,
            options.stayRequirements,
        ).requiredShifts;

        positions.forEach((position, positionIndex) => {
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

export function calculateRequirementCapacitySummary(
    plan: RequirementPlanInput,
    participants: ParticipantAttendance[],
    roleRequirements: RoleRequirementLike[],
    overrides: RequirementOverrideLike[],
    stayRequirements: StayRequirementInput[],
    slots: RequirementCapacitySlot[],
): RequirementCapacitySummary {
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

    const participantStates = participants.map((participant) => {
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

    const fixedContributions = withAttendance.map((state) => {
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

    const baselinePool = withAttendance
        .filter((state) => state.group === "baseline")
        .reduce((total, state) => total + state.attendanceFactor, 0);

    const infeasibleBaseline = remainingShifts > 0 && baselinePool === 0;
    const baseline = remainingShifts === 0 || baselinePool === 0 ? 0 : applyRounding(remainingShifts / baselinePool, roundingMode);

    const participantResults: ShiftRequirementParticipantResult[] = withAttendance.map((state, index) => {
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

export interface BaselineSlotInput {
    id: string | number;
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    maxAssignees?: number | null;
    roles?: HypotheticalRoleCapacity[];
}

export function calculateBaselineRequirementForPlan(options: {
    plan: Pick<ActivityPlan, "startDate" | "endDate" | "roundingMode">;
    slots: BaselineSlotInput[];
    participants: ParticipantAttendance[];
    roleRequirements: RoleRequirementLike[];
    overrides: RequirementOverrideLike[];
}): BaselineRequirementComputationResult {
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
    const feasibleSlotCount = (participant: ParticipantAttendance): number => {
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
    const candidateCache = new Map<number, CandidateEvaluation>();
    const evaluate = (candidate: number): CandidateEvaluation => {
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

    const zero = evaluate(0);
    const rawUpperBound = Math.max(1, (slotDemand + zero.capacitySummary.requiredSlots + 1) * Math.max(planDays, 1));
    const upperBound = Math.min(rawUpperBound, Math.floor(Number.MAX_SAFE_INTEGER / 4));
    const upper = evaluate(upperBound);
    const baselineInfluencesRequirements = upper.capacitySummary.requiredSlots !== zero.capacitySummary.requiredSlots;

    let chosen = zero;
    if (zero.capacitySummary.requiredSlots < slotDemand && baselineInfluencesRequirements) {
        if (upper.capacitySummary.requiredSlots >= slotDemand) {
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
