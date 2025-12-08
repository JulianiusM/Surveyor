/**
 * Test data for list-actions.ts
 */

export const assignmentRemovalData = [
    {
        description: 'removes assignment with default permissions',
        assignId: '123',
        itemId: '456',
        baseUrl: '/api/test',
        hasPermission: true,
        expectedUrl: '/api/test/assignment/123/delete',
    },
    {
        description: 'blocks removal without permission',
        assignId: '789',
        itemId: '101',
        baseUrl: '/api/test',
        hasPermission: false,
        shouldBlock: true,
    },
];

export const itemDeletionData = [
    {
        description: 'deletes item with confirmation',
        itemId: '123',
        baseUrl: '/api/test',
        confirmMessage: 'Are you sure?',
        successMessage: 'Deleted',
        confirmed: true,
        hasPermission: true,
        expectedUrl: '/api/test/item/123/delete',
    },
    {
        description: 'cancels deletion without confirmation',
        itemId: '456',
        baseUrl: '/api/test',
        confirmMessage: 'Really delete?',
        successMessage: 'Deleted',
        confirmed: false,
        hasPermission: true,
        shouldSkip: true,
    },
    {
        description: 'blocks deletion without permission',
        itemId: '789',
        baseUrl: '/api/test',
        confirmMessage: 'Delete?',
        successMessage: 'Done',
        confirmed: true,
        hasPermission: false,
        shouldBlock: true,
    },
];

export const quickAddData = [
    {
        description: 'submits form with default permissions',
        formId: 'quick-add-form',
        baseUrl: '/api/test',
        formData: { title: 'New Item', description: 'Test' },
        hasPermission: true,
        expectedUrl: '/api/test/items',
    },
    {
        description: 'blocks submission without permission',
        formId: 'quick-add-form',
        baseUrl: '/api/test',
        formData: { title: 'Blocked Item' },
        hasPermission: false,
        shouldBlock: true,
    },
];

export const configData = [
    {
        description: 'uses default reload delay for assignment removal',
        config: {
            baseUrl: '/api/test',
        },
        expectedReloadDelay: 100,
    },
    {
        description: 'uses custom reload delay for item deletion',
        config: {
            baseUrl: '/api/test',
            confirmMessage: 'Delete?',
            successMessage: 'Done',
            reloadDelay: 500,
        },
        expectedReloadDelay: 500,
    },
    {
        description: 'uses default selector for item deletion',
        config: {
            baseUrl: '/api/test',
            confirmMessage: 'Delete?',
            successMessage: 'Done',
        },
        expectedSelector: '[data-delete-item]',
    },
    {
        description: 'uses custom selector for item deletion',
        config: {
            baseUrl: '/api/test',
            confirmMessage: 'Delete?',
            successMessage: 'Done',
            selector: '.custom-delete-btn',
        },
        expectedSelector: '.custom-delete-btn',
    },
];
