/** Browser analysis and backend requirement calculations share these pure contracts.
 * They describe admitted inputs and results without ORM, request or browser state. */
export type RoundingMode = 'CEIL' | 'ROUND' | 'FLOOR';

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

export interface RequirementPlanInput {
    assignmentMode: "FREE" | "REQUIRED";
    generalRequiredShifts?: number | null;
    roundingMode?: RoundingMode | null;
    startDate: string;
    endDate: string;
}

export interface BaselineSlotInput {
    id: string | number;
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    maxAssignees?: number | null;
    roles?: HypotheticalRoleCapacity[];
}
/** Read-only requirement collections use independent, bounded pages on oversized plans. */
export type RequirementPageSection = 'stays' | 'roles' | 'overrides';
