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

import {ParticipantRow} from "../../types/EventTypes";
import {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import {ActivityPlanStayRequirement} from "../database/entities/activity/ActivityPlanStayRequirement";
import {InternalError} from "../lib/errors";

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
    requiredShifts: number;
}

export interface RoleRequirementInput {
    roleId: number;
    requiredShifts: number;
}

export interface StayRequirementInput {
    stayDays: number;
    requiredShifts: number;
}

export interface ParticipantRequirementResult {
    participantKey: string;
    requiredShifts: number;
    source: "none" | "general" | "role" | "override";
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
}

export interface RequirementCapacitySlot {
    id: string | number;
    maxAssignees?: number | null;
}

export interface RequirementCapacityRole {
    maxQty?: number | null;
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
        roleId: input.roleId ?? null,
        profileId: input.profileId ?? null,
        requiredShifts: input.requiredShifts,
    };

    if (!normalized.profileId) {
        throw new InternalError("Override requires a userId or guestId");
    }

    if (normalized.requiredShifts == null || Number.isNaN(normalized.requiredShifts)) {
        throw new InternalError("Override required shifts must be defined");
    }

    if (!Number.isFinite(normalized.requiredShifts)) {
        throw new InternalError("Override required shifts must be finite");
    }

    if (!Number.isInteger(normalized.requiredShifts)) {
        throw new InternalError("Override required shifts must be an integer");
    }

    if (normalized.requiredShifts < 0) {
        throw new InternalError("Override required shifts must be non-negative");
    }

    return normalized;
}

export function normalizeRoleRequirementInput(input: RoleRequirementInput): RoleRequirementInput {
    const normalized: RoleRequirementInput = {
        roleId: input.roleId,
        requiredShifts: input.requiredShifts,
    };

    if (!Number.isInteger(normalized.roleId) || normalized.roleId <= 0) {
        throw new InternalError("Role id must be a positive integer");
    }

    if (normalized.requiredShifts == null || Number.isNaN(normalized.requiredShifts)) {
        throw new InternalError("Role required shifts must be defined");
    }

    if (!Number.isFinite(normalized.requiredShifts)) {
        throw new InternalError("Role required shifts must be finite");
    }

    if (!Number.isInteger(normalized.requiredShifts)) {
        throw new InternalError("Role required shifts must be an integer");
    }

    if (normalized.requiredShifts < 0) {
        throw new InternalError("Role required shifts must be non-negative");
    }

    return normalized;
}

export function normalizeStayRequirementInput(input: StayRequirementInput): StayRequirementInput {
    const normalized: StayRequirementInput = {
        stayDays: input.stayDays,
        requiredShifts: input.requiredShifts,
    };

    if (!Number.isInteger(normalized.stayDays) || normalized.stayDays <= 0) {
        throw new InternalError("Stay duration must be a positive integer");
    }

    if (!Number.isInteger(normalized.requiredShifts) || normalized.requiredShifts < 0) {
        throw new InternalError("Stay duration required shifts must be a non-negative integer");
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

export function selectOverride(participant: ParticipantAttendance, overrides: ActivityPlanRequirementOverride[]): ActivityPlanRequirementOverride | undefined {
    const key = participant.profileId ?? null;
    const roleIds = participant.roleIds ?? [];

    let best: ActivityPlanRequirementOverride | undefined;

    for (const override of overrides) {
        const matches = override.profile.id != null && key === override.profile.id;
        if (!matches) continue;

        const roleMatch = override.roleId == null || roleIds.includes(override.roleId);
        if (!roleMatch) continue;

        if (!best) {
            best = override;
            continue;
        }

        const bestSpecificity = calculateSpecificity(best);
        const currentSpecificity = calculateSpecificity(override);
        if (currentSpecificity > bestSpecificity) best = override;
    }

    return best;
}

function calculateSpecificity(best: ActivityPlanRequirementOverride) {
    return (best.roleId ? 1 : 0) + (best.profile.id ? 1 : 0);
}

function resolveRoleFixedRequirement(roleRequirements: ActivityPlanRequirement[], roleIds: number[] | undefined): number | null {
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

function resolveRoleRequirement(roleRequirements: ActivityPlanRequirement[], roleIds: number[] | undefined, ratio: number, roundingMode: RoundingMode): number {
    if (!roleIds || roleIds.length === 0) return 0;

    let minRequirement = Number.POSITIVE_INFINITY;
    let hasMatch = false;

    for (const requirement of roleRequirements) {
        if (!roleIds.includes(Number(requirement.roleId))) continue;

        const proportional = requirement.requiredShifts * ratio;
        const rounded = applyRounding(proportional, roundingMode);
        minRequirement = Math.min(minRequirement, rounded);
        hasMatch = true;
    }

    return hasMatch ? minRequirement : 0;
}

export function calculateParticipantRequirement(
    plan: Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "startDate" | "endDate">,
    participant: ParticipantAttendance,
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[],
    stayRequirements: ActivityPlanStayRequirement[] = [],
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

    // Check for override first
    const override = selectOverride(participant, overrides);
    const requirementFromOverride = override?.requiredShifts ?? null;

    let requiredShifts = 0;
    let source: ParticipantRequirementResult["source"] = "none";
    let roleRequirement = 0;
    let baseRequirement = 0;
    const stayDurationRequirement = stayRequirements.find(
        (requirement) => Number(requirement.stayDays) === attendance.days,
    )?.requiredShifts;

    if (plan.assignmentMode === "REQUIRED") {
        // Calculate role requirement
        roleRequirement = resolveRoleRequirement(roleRequirements, participant.roleIds, ratio, roundingMode);

        // Calculate general requirement
        if (stayDurationRequirement != null) {
            baseRequirement = stayDurationRequirement;
        } else if (plan.generalRequiredShifts != null) {
            baseRequirement = applyRounding(plan.generalRequiredShifts * ratio, roundingMode);
        }

        // Apply priority: override > role > general (override applied later)
        if (requirementFromOverride != null) {
            // Override takes absolute priority
            requiredShifts = requirementFromOverride;
            source = "override";
        } else if (roleRequirement > 0) {
            // Role requirement is used if present
            requiredShifts = roleRequirement;
            source = "role";
        } else if (baseRequirement > 0) {
            // General requirement is the fallback
            requiredShifts = baseRequirement;
            source = "general";
        }
    } else if (requirementFromOverride != null) {
        // Even in non-REQUIRED mode, overrides are respected
        requiredShifts = requirementFromOverride;
        source = "override";
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
            roleRequirement,
            overrideRequirement: requirementFromOverride ?? undefined,
        },
    };
}

type RequiredActivityFields = "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "startDate" | "endDate";

export function calculateRequirementsForParticipants(
    plan: Pick<ActivityPlan, RequiredActivityFields>,
    participants: ParticipantAttendance[],
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[],
    stayRequirements: ActivityPlanStayRequirement[] = [],
): Record<string, ParticipantRequirementResult> {
    const result: Record<string, ParticipantRequirementResult> = {};
    for (const participant of participants) {
        const requirement = calculateParticipantRequirement(plan, participant, roleRequirements, overrides, stayRequirements);
        result[requirement.participantKey] = requirement;
    }
    return result;
}

export function summarizeParticipantRequirements(
    plan: Pick<ActivityPlan, RequiredActivityFields>,
    participants: ParticipantAttendance[],
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[],
    assignments: Record<string, unknown[]>,
    stayRequirements: ActivityPlanStayRequirement[] = [],
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

export function calculateRequirementCapacitySummary(
    plan: Pick<ActivityPlan, RequiredActivityFields>,
    participants: ParticipantAttendance[],
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[],
    stayRequirements: ActivityPlanStayRequirement[],
    slots: RequirementCapacitySlot[],
    slotRoles: Record<string, RequirementCapacityRole[]>,
): RequirementCapacitySummary {
    const requirements = calculateRequirementsForParticipants(
        plan,
        participants,
        roleRequirements,
        overrides,
        stayRequirements,
    );

    const requiredSlots = Object.values(requirements).reduce(
        (total, requirement) => total + requirement.requiredShifts,
        0,
    );

    const availableSlots = slots.reduce((total, slot) => {
        const overallCapacity = ensureNonNegativeInteger(slot.maxAssignees);
        const roles = slotRoles[String(slot.id)] ?? [];
        if (!roles.length) return total + overallCapacity;

        const roleCapacity = roles.reduce(
            (roleTotal, role) => roleTotal + ensureNonNegativeInteger(role.maxQty),
            0,
        );
        return total + Math.min(overallCapacity, roleCapacity);
    }, 0);

    return {
        availableSlots,
        requiredSlots,
        difference: availableSlots - requiredSlots,
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
        const attendanceFactor = maxFeasibleSlots > 0 ? state.feasibleSlotCount / maxFeasibleSlots : 0;
        return {...state, attendanceFactor};
    });

    const fixedContributions = withAttendance.map((state) => {
        if (state.group === "explicit") {
            return ensureNonNegativeInteger(state.participant.explicitFixedShifts);
        }

        if (state.group === "role-fixed") {
            const roleRequirement = ensureNonNegativeInteger(state.participant.roleFixedRequirement);
            const scaled = state.attendanceFactor * roleRequirement;
            return applyRounding(scaled, roundingMode);
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

    const baselineParticipants = participantResults.filter((result) => result.group === "baseline");

    let sumRequiredShifts = participantResults.reduce((total, result) => total + result.requiredShifts, 0);
    let overshoot = Math.max(sumRequiredShifts - slotDemand, 0);
    let deficit = Math.max(slotDemand - sumRequiredShifts, 0);

    if (overshoot > 0 && baselineParticipants.length > 0) {
        performOvershootCalculation(baselineParticipants, baseline, overshoot);
    }

    if (!infeasibleBaseline && deficit > 0 && baselineParticipants.length > 0) {
        performDeficitCalculation(baselineParticipants, deficit);
    }

    sumRequiredShifts = participantResults.reduce((total, result) => total + result.requiredShifts, 0);
    overshoot = Math.max(sumRequiredShifts - slotDemand, 0);
    deficit = Math.max(slotDemand - sumRequiredShifts, 0);

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

function performOvershootCalculation(baselineParticipants: ShiftRequirementParticipantResult[], baseline: number, overshoot: number) {
    const orderedBySlack = [...baselineParticipants].sort((a, b) => {
        const slackA = a.requiredShifts - a.attendanceFactor * baseline;
        const slackB = b.requiredShifts - b.attendanceFactor * baseline;
        if (slackA !== slackB) return slackB - slackA;
        if (a.requiredShifts !== b.requiredShifts) return b.requiredShifts - a.requiredShifts;
        return String(b.participantKey).localeCompare(String(a.participantKey));
    });

    while (overshoot > 0) {
        let adjusted = false;
        for (const participant of orderedBySlack) {
            const fractionalTarget = participant.attendanceFactor * baseline;
            const lowerBound = Math.floor(fractionalTarget);
            if (participant.requiredShifts > lowerBound && participant.requiredShifts > 0) {
                participant.requiredShifts -= 1;
                participant.baselineContribution = participant.requiredShifts;
                overshoot -= 1;
                adjusted = true;
            }
            if (overshoot === 0) break;
        }
        if (!adjusted) break;
    }
}

function performDeficitCalculation(baselineParticipants: ShiftRequirementParticipantResult[], deficit: number) {
    const orderedByAttendance = [...baselineParticipants].sort((a, b) => {
        if (a.attendanceFactor !== b.attendanceFactor) return b.attendanceFactor - a.attendanceFactor;
        return String(a.participantKey).localeCompare(String(b.participantKey));
    });

    while (deficit > 0) {
        for (const participant of orderedByAttendance) {
            participant.requiredShifts += 1;
            participant.baselineContribution = participant.requiredShifts;
            deficit -= 1;
            if (deficit === 0) break;
        }
    }
}

interface BaselineSlotInput {
    id: string | number;
    day: string;
    maxAssignees?: number | null;
}

export function calculateBaselineRequirementForPlan(options: {
    plan: Pick<ActivityPlan, "startDate" | "endDate" | "roundingMode">;
    slots: BaselineSlotInput[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
}): ShiftRequirementComputationResult {
    const slotInputs: ShiftSlot[] = options.slots.map((slot) => ({
        slotId: slot.id,
        capacity: ensureNonNegativeInteger(slot.maxAssignees ?? 0, 0),
    }));

    const resolveFeasibleSlots = (participant: ShiftParticipant) => {
        const attendance = clampAttendanceWindow(
            options.plan.startDate,
            options.plan.endDate,
            participant.arrivalDate ?? undefined,
            participant.departureDate ?? undefined,
        );

        if (!attendance) return [] as Array<string | number>;

        return options.slots
            .filter((slot) => slot.day >= attendance.start && slot.day <= attendance.end)
            .map((slot) => slot.id);
    };

    const participants: ShiftParticipant[] = options.participants.map((participant, index) => {
        const participantKey = toParticipantKey(participant);
        const explicitOverride = selectOverride(participant, options.overrides);
        const roleFixedRequirement = explicitOverride
            ? null
            : resolveRoleFixedRequirement(options.roleRequirements, participant.roleIds);

        const participantId = participantKey === "participant:unknown"
            ? `participant:${index}`
            : participantKey;

        return {
            ...participant,
            participantId,
            feasibleSlotIds: [],
            explicitFixedShifts: explicitOverride?.requiredShifts ?? null,
            roleFixedRequirement,
        };
    });

    return calculateShiftRequirementsForParticipants(slotInputs, participants, {
        roundingMode: options.plan.roundingMode ?? "CEIL",
        resolveFeasibleSlots,
    });
}
