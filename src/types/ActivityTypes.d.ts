export type SlotAssignmentRow = {
    assignmentId: number;
    itemId: string;
    name: string;
    profileId: string;
    roles: string | null;
};

export type SlotAssignee = {
    id: number;
    profileId: string;
    name: string;
    roles: string[];
};

export type PlanParticipantRow = {
    name: string;
    count: number;
    roles: string;
}

export type PlanParticipant = {
    name: string;
    count: number;
    roles: string[];
};

export type SlotAssignmentMap = Record<string, SlotAssignee[]>;