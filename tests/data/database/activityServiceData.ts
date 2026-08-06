/**
 * Test data for activity service database integration tests
 */

export interface ActivityPlanInput {
    ownerId: number;
    title: string;
    description: string;
    from: string;
    to: string;
    rolesEnabled: boolean;
    showContactInfo: boolean;
}

export interface ActivitySlotInput {
    id?: string;
    title: string;
    day: string;
    pos: number;
    maxAssignees: number;
}

export interface RoleTestCase {
    description: string;
    roleName: string;
    expectedCreations: number;
}

export const roleTestData: RoleTestCase[] = [
    {
        description: 'ensureRoleId creates default role once and returns stable id',
        roleName: 'default',
        expectedCreations: 1,
    },
];

export interface AssignmentLifecycleTestCase {
    description: string;
    plan: ActivityPlanInput;
    slot: ActivitySlotInput;
    userId: number;
    guestId?: number;
    roleName: string;
    expectDeletion: boolean;
}

export const assignmentLifecycleTestData: AssignmentLifecycleTestCase[] = [
    {
        description: 'ensureAssignment + assignRole + doUnassignRole lifecycle',
        plan: {
            ownerId: 1,
            title: 'T',
            description: 'D',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: true,
        },
        slot: {
            title: 'S1',
            day: '2025-01-01',
            pos: 1,
            maxAssignees: 5,
        },
        userId: 1,
        roleName: 'default',
        expectDeletion: true,
    },
];

export interface CreatePlanTxTestCase {
    description: string;
    plan: ActivityPlanInput;
    slots: ActivitySlotInput[];
}

export const createPlanTxTestData: CreatePlanTxTestCase[] = [
    {
        description: 'inserts plan + slots and returns the new plan id',
        plan: {
            ownerId: 1,
            title: 'Title',
            description: 'Desc',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: false,
        },
        slots: [
            { title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 2 },
            { title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 3 },
        ],
    },
];

export interface UserData {
    username: string;
    email: string;
    name?: string;
}

export interface SlotAssigneesTestCase {
    description: string;
    plan: ActivityPlanInput;
    slot: ActivitySlotInput;
    user: UserData;
    roleName: string;
    expectedSlotCount: number;
}

export const slotAssigneesTestData: SlotAssigneesTestCase[] = [
    {
        description: 'getActivitySlotAssignees returns map with assignee name and roles',
        plan: {
            ownerId: 1,
            title: 'T',
            description: 'D',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: true,
        },
        slot: {
            title: 'S1',
            day: '2025-01-01',
            pos: 1,
            maxAssignees: 5,
        },
        user: {
            username: 'U1',
            email: 'u1@example.com',
        },
        roleName: 'lead',
        expectedSlotCount: 1,
    },
];

export interface PlanParticipantsTestCase {
    description: string;
    plan: ActivityPlanInput;
    slots: ActivitySlotInput[];
    user: UserData;
    roles: string[];
    expectedCount: number;
    expectedRoles: string[];
}

export const planParticipantsTestData: PlanParticipantsTestCase[] = [
    {
        description: 'getActivityPlanParticipants aggregates distinct assignments and roles per name',
        plan: {
            ownerId: 1,
            title: 'T',
            description: 'D',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: true,
        },
        slots: [
            { title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1 },
            { title: 'B', day: '2025-01-01', pos: 2, maxAssignees: 1 },
        ],
        user: {
            username: 'alice',
            email: 'alice@example.com',
        },
        roles: ['lead', 'helper'],
        expectedCount: 2,
        expectedRoles: ['helper', 'lead'],
    },
];

export interface SlotRolesTestCase {
    description: string;
    plan: ActivityPlanInput;
    slot: ActivitySlotInput;
    roleNames: string[];
    expectedRoleNames: string[];
}

export const slotRolesTestData: SlotRolesTestCase[] = [
    {
        description: 'addActivitySlotRoles + getActivitySlotRoles maps slot->roles',
        plan: {
            ownerId: 1,
            title: 'T',
            description: 'D',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: true,
        },
        slot: {
            title: 'S',
            day: '2025-01-01',
            pos: 1,
            maxAssignees: 2,
        },
        roleNames: ['helper', 'lead'],
        expectedRoleNames: ['helper', 'lead'],
    },
];

export interface DeleteAssignmentTestCase {
    description: string;
    plan: ActivityPlanInput;
    slot: ActivitySlotInput;
    userId: number;
}

export const deleteAssignmentTestData: DeleteAssignmentTestCase[] = [
    {
        description: 'deleteActivitySlotAssignment removes assignment',
        plan: {
            ownerId: 1,
            title: 'T',
            description: 'D',
            from: '2025-01-01',
            to: '2025-01-02',
            rolesEnabled: true,
            showContactInfo: true,
        },
        slot: {
            title: 'X',
            day: '2025-01-01',
            pos: 1,
            maxAssignees: 1,
        },
        userId: 1,
    },
];
