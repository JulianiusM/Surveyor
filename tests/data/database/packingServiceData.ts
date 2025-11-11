/**
 * Test data for packing.service.test.ts
 * Organized into test scenarios with all test data externalized
 */

export const packingListCrudData = [
    {
        description: 'creates/updates/deletes a PackingList; fetch by id and user',
        listId: 'test-packing-list-1',
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

export const packingItemsTransactionalData = [
    {
        description: 'transactional create (list+items), item CRUD, reorder, counts, last number, requiredByAll',
        userId: 1,
        listData: {
            title: 'Trip to Alps',
            description: 'winter gear',
            allowGuestAdd: true,
            guestManage: false,
        },
        initialItems: [
            {id: 'item-1', title: 'Backpack', description: '', maxAssignees: 1, requiredByAll: false, pos: 1},
            {id: 'item-2', title: 'Stove', description: 'gas', maxAssignees: 2, requiredByAll: false, pos: 2},
            {id: 'item-3', title: 'First Aid', description: '', maxAssignees: 1, requiredByAll: true, pos: 3},
        ],
        expectedInitialIds: ['item-1', 'item-2', 'item-3'],
        additionalItems: [
            {id: 'item-4', title: 'Tent', pos: 10},
            {id: 'item-5', title: 'Rope', pos: 20},
        ],
        expectedAfterAdd: ['item-1', 'item-2', 'item-3', 'item-4', 'item-5'],
        singleItem: {id: 'item-6', title: 'Snacks', pos: 15},
        expectedAfterSingle: ['item-1', 'item-2', 'item-3', 'item-4', 'item-6', 'item-5'],
        itemUpdate: {
            itemId: 'item-1',
            updates: {
                title: 'Backpack (65L)',
                description: 'with rain cover',
                pos: 5,
            },
        },
        reorder: [
            {itemId: 'item-2', position: 1},
            {itemId: 'item-1', position: 2},
        ],
        expectedAfterReorder: ['item-2', 'item-1'],
        requiredByAllToggle: {
            itemId: 'item-1',
            value: true,
        },
        deleteItemId: 'item-5',
        expectedLastNumberInitial: 20,
        expectedLastNumberAfterDelete: 15,
    },
];

export const packingAssignmentsData = [
    {
        description: 'assigns/unassigns (user+guest), counts, assignees map, and deletion by assignId',
        listData: {
            title: 'AssignTest',
            description: '',
            allowGuestAdd: true,
            guestManage: true,
        },
        userId: 1,
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
        items: [
            {id: 'pack-item-1', title: 'Cook set', pos: 1},
            {id: 'pack-item-2', title: 'Water jugs', pos: 2},
        ],
        assignments: {
            userItemId: 'pack-item-1',
            guestItemId: 'pack-item-2',
            userId: 2,
            guestId: 11,
        },
        expectedCounts: {
            'pack-item-1': 1,
            'pack-item-2': 1,
        },
        expectedUserItems: ['pack-item-1'],
        expectedGuestItems: ['pack-item-2'],
        expectedAssigneeNames: {
            'pack-item-1': 'User Two',
            'pack-item-2': 'guestOne',
        },
        expectedCountsAfterGuestDelete: {
            'pack-item-1': 1,
            'pack-item-2': 0,
        },
        expectedFinalCounts: {
            'pack-item-1': 0,
            'pack-item-2': 0,
        },
    },
];
