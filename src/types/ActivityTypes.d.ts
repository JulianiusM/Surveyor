export type SlotAssignmentRow = {
    assignment_id: number;
    slot_id: string;
    uname: string | null;
    gname: string | null;
    user_id: number | null;
    guest_id: string | null;
    roles: string | null;
};

export type SlotAssignee = {
    id: number;
    user_id: number | null;
    guest_id: string | null;
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