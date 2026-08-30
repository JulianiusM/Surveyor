/**
 * Activity Plan Types Module
 * Shared type definitions for activity plan modules
 * This file contains only type definitions to prevent circular dependencies
 */

// Bootstrap modal types
export interface BootstrapModal {
    dispose: any;
    show: () => void;
    hide: () => void;
}

export interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

// Role types
export interface RoleSummary {
    id: number;
    title: string;
    isDefault?: boolean;
    description?: string | null;
}

// Assignment warning types
export type WarningType =
    | 'outside_attendance'
    | 'arrival_day'
    | 'arrival_time_restricted'
    | 'departure_day'
    | 'departure_time_restricted'
    | 'over_capacity'
    | 'overlap';

export interface AssignmentWarning {
    type: WarningType;
    conflicts?: string[];
}

export interface WarningModal {
    confirm: (warnings: AssignmentWarning[], slotId: string) => Promise<boolean>;
}

// Slot editor types
export type SlotEditorMode = 'create' | 'edit';

// Participant types
export type ParticipantFilter =
    | 'all'
    | 'assigned'
    | 'unassigned'
    | 'unstarted'
    | 'needs-more'
    | 'complete'
    | 'no-requirement';

// Recommendation types
export type RecommendationOperation = 'ASSIGN' | 'REASSIGN' | 'UNASSIGN';

export interface RecommendationRow {
    id?: string;
    item: {
        id: string;
        title: string;
        day?: string;
        startTime?: string | null;
        endTime?: string | null;
    };
    sourceItem?: {
        id: string;
        title: string;
        day?: string;
        startTime?: string | null;
        endTime?: string | null;
    } | null;
    profile?: { id: string; name: string } | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
    operation?: RecommendationOperation;
    manual?: boolean;
    hidden?: boolean;
}

export interface RecommendationWarning {
    recommendation: {
        itemId: string;
        profileId: string;
    };
    warnings: AssignmentWarning[];
}

// Requirements types
export interface RequirementParticipantSummary {
    participantKey: string;
    name?: string | null;
    roleIds?: number[];
    roles?: string[];
    assignmentMode?: 'FREE' | 'REQUIRED';
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: 'none' | 'general' | 'role' | 'override' | 'unconfigured';
    attendanceDays: number;
    attendance?: {
        arrivalDate?: string | null;
        departureDate?: string | null;
    };
}

export interface RequirementOverrideTarget {
    key: string;
    label: string;
    profileId: string;
    arrivalDate?: string | null;
    departureDate?: string | null;
}

export interface RequirementConfiguration {
    plan: {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        startDate: string;
        endDate: string;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
        allowExternalAssignees?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
    };
    roleRequirements: { roleId: number; requiredShifts: number }[];
    stayRequirements: { stayDays: number; requiredShifts: number }[];
    capacitySummary?: {
        availableSlots: number;
        requiredSlots: number;
        difference: number;
        configurationComplete?: boolean;
        hypotheticalRoleCoverage?: {
            matches?: Array<{
                participantKey: string;
                slotId: string;
                roleId: number;
                requirementBefore: number;
                requirementAfter: number;
                removedRequirement: number;
            }>;
            openRoleCount: number;
            filledRoleCount: number;
            unfilledRoleCount: number;
            removedRequiredShifts: number;
            roleCapacityConflicts: Array<{
                slotId: string;
                roleCapacity: number;
                slotCapacity: number;
            }>;
        };
    };
    calculationContext?: {
        participants: Array<{
            profileId?: string | null;
            arrivalDate?: string | null;
            departureDate?: string | null;
            roleIds?: number[];
            name?: string | null;
        }>;
        assignedShiftCounts: Record<string, number>;
        slots: Array<{
            id: string;
            day: string;
            startTime?: string | null;
            endTime?: string | null;
            maxAssignees?: number | null;
            roles?: Array<{roleId: number; maxQty: number; assignedQty?: number}>;
        }>;
    };
    overrideTargets?: RequirementOverrideTarget[];
    overrides: {
        id?: number;
        roleId?: number | null;
        role?: RoleSummary | null;
        profileId?: string | null;
        profile?: { id: string, name: string } | null;
        requiredShifts: number;
    }[];
    participants?: RequirementParticipantSummary[];
}

// Slot roles mapping type
export interface SlotRolesMap {
    [slotId: string]: RoleSummary[];
}

export interface RecommendationSlotOption {
    id: string;
    title: string;
    day?: string;
    startTime?: string | null;
    endTime?: string | null;
}

export interface RecommendationParticipantOption {
    key: string;
    label: string;
    profileId?: string;
    arrivalDate?: string | null;
    departureDate?: string | null;
}

export interface ExistingActivityAssignment {
    item: RecommendationRow['item'];
    profile: {id: string; name: string};
    roles: string[];
}
