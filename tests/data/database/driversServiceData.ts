/**
 * Test data for drivers.service.test.ts
 * Organized into test scenarios with all test data externalized
 */

export const driversListCrudData = [
    {
        description: 'creates and updates a DriversList; fetch by id and user',
        userId: 1,
        initialData: {
            title: 'Initial Title',
            description: 'Initial Desc',
            allowGuestAdd: true,
            guestManage: false,
        },
        expectedInitial: {
            title: 'Initial Title',
            description: 'Initial Desc',
            allowGuestAdd: 1,
            guestManage: 0,
        },
        updates: {
            title: 'New Title',
            description: 'New Desc',
            allowGuestAdd: false,
            guestManage: true,
        },
        expectedAfterUpdates: {
            title: 'New Title',
            description: 'New Desc',
            allowGuestAdd: 0,
            guestManage: 1,
        },
        flagsUpdate: {
            allowGuestAdd: true,
            guestManage: false,
        },
        expectedAfterFlags: {
            allowGuestAdd: 1,
            guestManage: 0,
        },
    },
];

export const driversItemsData = [
    {
        description: 'creates items (user+guest), enriches, reorders, updates, and computes last item number',
        userId: 1,
        listData: {
            title: 'Drivers',
            description: 'desc',
            allowGuestAdd: true,
            guestManage: false,
        },
        testUser: {
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        },
        testGuest: {
            id: 10,
            username: 'guestOne',
        },
        userItem: {
            id: 'driver-item-1',
            title: 'Pick up wood',
            description: '',
            maxAssignees: 2,
            pos: 1,
        },
        guestItem: {
            id: 'driver-item-2',
            title: 'Bring nails',
            description: 'galvanized',
            maxAssignees: 1,
            pos: 2,
        },
        expectedUserItemName: 'User Two',
        expectedGuestItemName: 'guestOne',
        itemUpdate: {
            itemId: 'driver-item-1',
            updates: {
                title: 'Pick up timber',
                description: 'oak',
                maxAssignees: 3,
                pos: 5,
            },
        },
        reorder: [
            {itemId: 'driver-item-2', position: 1},
            {itemId: 'driver-item-1', position: 2},
        ],
        expectedAfterReorder: ['driver-item-2', 'driver-item-1'],
        expectedLastNumber: 2,
        deleteItemId: 'driver-item-2',
        expectedAfterDelete: ['driver-item-1'],
    },
];

export const driversAssignmentsData = [
    {
        description: 'assigns/unassigns items (user + guest), counts, maps assignees, and deletes assignments',
        userId: 1,
        listData: {
            title: 'Drivers',
            description: 'desc',
            allowGuestAdd: true,
            guestManage: true,
        },
        testUser: {
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        },
        testGuest: {
            id: 11,
            username: 'guestOne',
        },
        userItem: {
            id: 'driver-van',
            title: 'Drive van',
            pos: 1,
            maxAssignees: 2,
        },
        guestItem: {
            id: 'driver-truck',
            title: 'Drive truck',
            pos: 2,
            maxAssignees: 1,
        },
        expectedCounts: {
            'driver-van': 1,
            'driver-truck': 1,
        },
        expectedUserItems: ['driver-van'],
        expectedGuestItems: ['driver-truck'],
        expectedAssigneeNames: {
            'driver-van': 'User Two',
            'driver-truck': 'guestOne',
        },
        expectedCountsAfterGuestDelete: {
            'driver-van': 1,
            'driver-truck': 0,
        },
        expectedFinalCounts: {
            'driver-van': 0,
            'driver-truck': 0,
        },
    },
];
