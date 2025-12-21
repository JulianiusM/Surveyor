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
    name: string;
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
export type ParticipantFilter = 'all' | 'assigned' | 'unassigned';

// Recommendation types
export interface RecommendationRow {
    id?: string;
    slot: {
        id: string;
        title: string;
        day?: string;
        startTime?: string | null;
        endTime?: string | null;
    };
    user?: { id: number; username: string; name?: string } | null;
    guest?: { id: number; username: string } | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
}

export interface RecommendationWarning {
    recommendation: {
        slotId: string;
        userId?: number | null;
        guestId?: number | null;
    };
    warnings: AssignmentWarning[];
}

// Requirements types
export interface RequirementParticipantSummary {
    participantKey: string;
    name?: string | null;
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: 'none' | 'general' | 'role' | 'override';
    attendance?: {
        arrivalDate?: string | null;
        departureDate?: string | null;
    };
}

export interface RequirementConfiguration {
    plan: {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
    };
    roleRequirements: { roleId: number; requiredShifts: number }[];
    overrides: {
        id?: number;
        roleId?: number | null;
        role?: RoleSummary | null;
        userId?: number | null;
        user?: { username: string, name?: string } | null;
        guestId?: number | null;
        guest?: { username: string } | null;
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
    userId?: number | null;
    guestId?: number | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
}
