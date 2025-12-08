/**
 * Test data for inline-edit.ts
 */

export const enableDnDData = [
    {
        description: 'enables draggable when user has ITEM_EDIT permission',
        hasPermission: true,
        draggableCount: 3,
        expectedDraggable: true,
    },
    {
        description: 'does not enable draggable when user lacks ITEM_EDIT permission',
        hasPermission: false,
        draggableCount: 3,
        expectedDraggable: false,
    },
    {
        description: 'handles empty draggable list',
        hasPermission: true,
        draggableCount: 0,
        expectedDraggable: false,
    },
];

export const disableDnDData = [
    {
        description: 'disables all draggable elements',
        draggableCount: 5,
    },
    {
        description: 'handles empty draggable list',
        draggableCount: 0,
    },
    {
        description: 'handles single draggable element',
        draggableCount: 1,
    },
];

export const startInlineEditAreaData = [
    {
        description: 'creates textarea with old value',
        oldText: 'Existing description',
        hasPermission: true,
        expectedValue: 'Existing description',
    },
    {
        description: 'clears placeholder text',
        oldText: 'double-click to add description',
        hasPermission: true,
        expectedValue: '',
    },
    {
        description: 'blocks editing without permission',
        oldText: 'Test content',
        hasPermission: false,
        shouldBlock: true,
    },
    {
        description: 'does not recreate textarea if already exists',
        oldText: 'Test',
        hasPermission: true,
        hasExistingTextarea: true,
        shouldSkip: true,
    },
];

export const startInlineEditData = [
    {
        description: 'creates input for text field',
        field: 'title',
        oldText: 'Original Title',
        inputType: 'text',
        hasPermission: true,
    },
    {
        description: 'creates number input for maxAssignees',
        field: 'maxAssignees',
        oldText: '10',
        inputType: 'number',
        hasPermission: true,
    },
    {
        description: 'blocks editing without permission',
        field: 'title',
        oldText: 'Test',
        hasPermission: false,
        shouldBlock: true,
    },
    {
        description: 'does not recreate input if already exists',
        field: 'title',
        oldText: 'Test',
        hasPermission: true,
        hasExistingInput: true,
        shouldSkip: true,
    },
];
