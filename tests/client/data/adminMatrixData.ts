/**
 * Test data for admin-matrix module
 */

export const permissionData = [
    {
        description: 'should collect checked permission keys',
        checkboxes: [
            {value: 'MANAGE_USERS', checked: true, bit: 1},
            {value: 'MANAGE_EVENTS', checked: true, bit: 2},
            {value: 'VIEW_REPORTS', checked: false, bit: 4},
        ],
        expectedKeys: ['MANAGE_USERS', 'MANAGE_EVENTS'],
    },
    {
        description: 'should collect no keys when none checked',
        checkboxes: [
            {value: 'MANAGE_USERS', checked: false, bit: 1},
            {value: 'MANAGE_EVENTS', checked: false, bit: 2},
        ],
        expectedKeys: [],
    },
];

export const maskApplicationData = [
    {
        description: 'should apply mask with multiple bits',
        mask: 7, // binary 111
        checkboxes: [
            {value: 'PERM_1', bit: 1},
            {value: 'PERM_2', bit: 2},
            {value: 'PERM_3', bit: 4},
            {value: 'PERM_4', bit: 8},
        ],
        expectedChecked: ['PERM_1', 'PERM_2', 'PERM_3'],
        expectedUnchecked: ['PERM_4'],
    },
    {
        description: 'should apply mask with single bit',
        mask: 4, // binary 100
        checkboxes: [
            {value: 'PERM_1', bit: 1},
            {value: 'PERM_2', bit: 2},
            {value: 'PERM_3', bit: 4},
        ],
        expectedChecked: ['PERM_3'],
        expectedUnchecked: ['PERM_1', 'PERM_2'],
    },
    {
        description: 'should apply zero mask',
        mask: 0,
        checkboxes: [
            {value: 'PERM_1', bit: 1},
            {value: 'PERM_2', bit: 2},
        ],
        expectedChecked: [],
        expectedUnchecked: ['PERM_1', 'PERM_2'],
    },
];

export const updateOperationData = [
    {
        description: 'should update permissions successfully',
        userId: '123',
        selectedPerms: ['MANAGE_USERS', 'MANAGE_EVENTS'],
        apiResponse: {status: 'success', data: null},
        expectedSuccess: true,
    },
    {
        description: 'should handle update error',
        userId: '456',
        selectedPerms: ['MANAGE_USERS'],
        apiResponse: {status: 'error', message: 'Permission denied'},
        expectedSuccess: false,
        expectedError: 'Permission denied',
    },
];

export const searchUserData = [
    {
        description: 'should search and populate datalist',
        query: 'john',
        apiResponse: {
            status: 'success',
            data: [
                {id: 1, username: 'johndoe', name: 'John Doe'},
                {id: 2, username: 'johnsmith', name: 'John Smith'},
            ],
        },
        expectedOptions: 2,
    },
    {
        description: 'should limit to 10 results',
        query: 'user',
        apiResponse: {
            status: 'success',
            data: Array.from({length: 15}, (_, i) => ({
                id: i,
                username: `user${i}`,
                name: `User ${i}`,
            })),
        },
        expectedOptions: 10,
    },
];
