import type {components} from './api/v1';

/** Lexical inputs remain owned by the dated creation/slot editor until submission. */
export interface ActivitySlotDraft {
    id: string;
    day: string;
    title: string;
    description: string;
    startTime: string;
    endTime: string;
    maxAssignees: string;
    roles: string[];
}

/** A cancellation retains exactly this reviewed intent and its opaque confirmation. */
export interface ActivityAssignmentReview {
    slotId: string;
    title: string;
    assigned: boolean;
    role?: string;
    preview: components['schemas']['ActivityWarningPreview'];
}
