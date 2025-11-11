/**
 * Test data for activity.service.more.test.ts
 * Contains additional integration tests for activity service CRUD operations
 */

export const planCrudTestData = [
    {
        description: 'create/get/update flags & description / list by owner / delete',
        userId: 1,
        planTitle: 'TitleZ',
        planDescription: 'DescZ',
        startDate: '2025-02-01',
        endDate: '2025-02-02',
        allowGuestAdd: true,
        guestManage: false,
        updatedAllowGuestAdd: false,
        updatedGuestManage: true,
        updatedDescription: 'DescZ+',
    },
];

export const slotCrudTestData = [
    {
        description: 'addActivitySlots + getActivitySlots groups by day and counts assignments',
        testType: 'add_and_list',
        userId: 1,
        planTitle: 'T',
        planDescription: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        slots: [
            {title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 2},
            {title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 3},
        ],
        userUsername: 'bob',
        userEmail: 'b@b',
        roleName: 'default',
        expectedDays: ['2025-01-01', '2025-01-02'],
        expectedAssignedCount: 1,
    },
    {
        description: 'updateActivitySlot returns undefined for empty input; true for changes and persists them',
        testType: 'update_slot',
        userId: 1,
        planTitle: 'T',
        planDescription: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        slotTitle: 'X',
        slotDay: '2025-01-01',
        slotPos: 1,
        slotMaxAssignees: 1,
        emptyUpdate: {},
        update: {
            title: 'X+',
            maxAssignees: 5,
            pos: 3,
            description: 'New',
        },
    },
    {
        description: 'reorderActivitySlots updates per-slot pos and getLastActivitySlotNumber works per day',
        testType: 'reorder_and_last_number',
        userId: 1,
        planTitle: 'T',
        planDescription: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        slots: [
            {title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {title: 'B', day: '2025-01-01', pos: 2, maxAssignees: 1},
            {title: 'C', day: '2025-01-02', pos: 1, maxAssignees: 1},
        ],
        reorder: [
            {slotIndex: 0, newPos: 2}, // A: 1 -> 2
            {slotIndex: 1, newPos: 1}, // B: 2 -> 1
        ],
        expectedMaxDay1: 2,
        expectedMaxDay2: 1,
    },
    {
        description: 'deleteActivitySlot removes slot',
        testType: 'delete_slot',
        userId: 1,
        planTitle: 'T',
        planDescription: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        slotTitle: 'X',
        slotDay: '2025-01-01',
        slotPos: 1,
        slotMaxAssignees: 1,
    },
    {
        description: 'ensureAssignment throws when slotId missing',
        testType: 'ensure_assignment_error',
        slotId: '',
        userId: 1,
        expectedError: 'slotId is required',
    },
];

export const assignmentTestData = [
    {
        description: 'assign/unassign for user and guest + slot assignment lookups',
        userId: 1,
        guestId: 77,
        planTitle: 'T',
        planDescription: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        slotTitle: 'S',
        slotDay: '2025-01-01',
        slotPos: 1,
        slotMaxAssignees: 2,
        roles: ['helper', 'default'],
        userRole: 'helper',
        guestRole: 'default',
        guestUsername: '',
    },
];
