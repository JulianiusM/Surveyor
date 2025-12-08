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

function selectOverride(participant: ParticipantAttendance, overrides: ActivityPlanRequirementOverride[]): ActivityPlanRequirementOverride | undefined {
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
