import {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";

export type RoundingMode = NonNullable<ActivityPlan["roundingMode"]>;

export interface ParticipantAttendance {
    userId?: number | null;
    guestId?: number | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
    roleIds?: number[];
    name?: string | null;
}

export interface RequirementOverrideInput {
    id?: number;
    roleId?: number | null;
    userId?: number | null;
    guestId?: number | null;
    requiredShifts: number;
}

export interface RoleRequirementInput {
    roleId: number;
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
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: ParticipantRequirementResult["source"];
    attendance?: {arrivalDate?: string | null; departureDate?: string | null};
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

function countInclusiveDays(start: string, end: string): number {
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

export function toParticipantKey(participant: ParticipantAttendance): string {
    if (participant.userId) return `user:${participant.userId}`;
    if (participant.guestId) return `guest:${participant.guestId}`;
    return "participant:unknown";
}

export function normalizeOverrideInput(input: RequirementOverrideInput): RequirementOverrideInput {
    const normalized: RequirementOverrideInput = {
        id: input.id,
        roleId: input.roleId ?? null,
        userId: input.userId ?? null,
        guestId: input.guestId ?? null,
        requiredShifts: input.requiredShifts,
    };

    if (!normalized.userId && !normalized.guestId) {
        throw new Error("Override requires a userId or guestId");
    }

    if (normalized.userId && normalized.guestId) {
        throw new Error("Override cannot target both user and guest");
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
        roleId: input.roleId,
        requiredShifts: input.requiredShifts,
    };

    if (!Number.isInteger(normalized.roleId) || normalized.roleId <= 0) {
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
    const keyUser = participant.userId ?? null;
    const keyGuest = participant.guestId ?? null;
    const roleIds = participant.roleIds ?? [];

    let best: ActivityPlanRequirementOverride | undefined;

    for (const override of overrides) {
        const matchesUser = override.userId != null && keyUser === override.userId;
        const matchesGuest = override.guestId != null && keyGuest === override.guestId;
        if (!matchesUser && !matchesGuest) continue;

        const roleMatch = override.roleId == null || roleIds.includes(override.roleId);
        if (!roleMatch) continue;

        if (!best) {
            best = override;
            continue;
        }

        const bestSpecificity = (best.roleId ? 1 : 0) + (best.userId ? 1 : 0) + (best.guestId ? 1 : 0);
        const currentSpecificity = (override.roleId ? 1 : 0) + (override.userId ? 1 : 0) + (override.guestId ? 1 : 0);
        if (currentSpecificity > bestSpecificity) best = override;
    }

    return best;
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
    overrides: ActivityPlanRequirementOverride[]
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

    if (plan.assignmentMode === "REQUIRED") {
        // Calculate role requirement
        roleRequirement = resolveRoleRequirement(roleRequirements, participant.roleIds, ratio, roundingMode);
        
        // Calculate general requirement
        if (plan.generalRequiredShifts != null) {
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
            appliedRounding: roundingMode,
            roleRequirement,
            overrideRequirement: requirementFromOverride ?? undefined,
        },
    };
}

export function calculateRequirementsForParticipants(
    plan: Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "startDate" | "endDate">,
    participants: ParticipantAttendance[],
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[]
): Record<string, ParticipantRequirementResult> {
    const result: Record<string, ParticipantRequirementResult> = {};
    for (const participant of participants) {
        const requirement = calculateParticipantRequirement(plan, participant, roleRequirements, overrides);
        result[requirement.participantKey] = requirement;
    }
    return result;
}

export function summarizeParticipantRequirements(
    plan: Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "startDate" | "endDate">,
    participants: ParticipantAttendance[],
    roleRequirements: ActivityPlanRequirement[],
    overrides: ActivityPlanRequirementOverride[],
    assignments: Record<string, unknown[]>,
): ParticipantRequirementSummary[] {
    const requirementMap = calculateRequirementsForParticipants(plan, participants, roleRequirements, overrides);

    return participants.map((participant) => {
        const participantKey = toParticipantKey(participant);
        const requirement = requirementMap[participantKey];
        const requiredShifts = requirement?.requiredShifts ?? 0;
        const assignedShifts = assignments[participantKey]?.length ?? 0;

        return {
            participantKey,
            name: participant.name ?? null,
            requiredShifts,
            assignedShifts,
            remainingShifts: Math.max(requiredShifts - assignedShifts, 0),
            source: requirement?.source ?? "none",
            attendance: participant.arrivalDate || participant.departureDate
                ? {arrivalDate: participant.arrivalDate, departureDate: participant.departureDate}
                : undefined,
        };
    });
}

export function calculateShiftRequirementsForParticipants(
    slots: ShiftSlot[],
    participants: ShiftParticipant[],
    options?: {resolveFeasibleSlots?: (participant: ShiftParticipant) => Array<string | number>; roundingMode?: RoundingMode}
): ShiftRequirementComputationResult {
    const roundingMode = options?.roundingMode ?? "CEIL";
    const resolveSlots = options?.resolveFeasibleSlots;

    const slotDemand = slots.reduce((total, slot) => total + Math.max(0, slot.capacity ?? 0), 0);

    const participantStates = participants.map((participant) => {
        const resolvedSlots = resolveSlots ? resolveSlots(participant) : participant.feasibleSlotIds;
        const feasibleSlotIds = normalizeFeasibleSlots(resolvedSlots ?? participant.feasibleSlotIds);
        const participantKey = toShiftParticipantKey(participant);

        const group: ShiftParticipantGroup = participant.explicitFixedShifts != null
            ? "explicit"
            : participant.roleFixedRequirement != null
                ? "role-fixed"
                : "baseline";

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
                    if (overshoot === 0) break;
                }
            }
            if (!adjusted) break;
        }
    }

    if (!infeasibleBaseline && deficit > 0 && baselineParticipants.length > 0) {
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
