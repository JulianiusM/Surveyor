/**
 * Test data for activity-slot-operations module
 */

export const initInlineEditData = [
    {
        description: 'initializes inline edit for plan description on double-click',
        elementHtml: '<div data-edit="planDescription">Test description</div>',
        planId: 'plan123',
        expectedCalls: 1,
    },
    {
        description: 'initializes inline edit for slot elements on double-click',
        elementHtml: '<div class="slot"><div data-edit="slotTitle">Slot title</div></div>',
        planId: 'plan123',
        expectedCalls: 1,
    },
    {
        description: 'ignores double-click on buttons within slots',
        elementHtml: '<div class="slot"><button data-edit="slotTitle">Button</button></div>',
        planId: 'plan123',
        expectedCalls: 0,
    },
    {
        description: 'ignores double-click on non-editable elements',
        elementHtml: '<div class="slot"><span>Non-editable</span></div>',
        planId: 'plan123',
        expectedCalls: 0,
    },
];

export const initDeleteData = [
    {
        description: 'deletes slot with confirmation',
        slotId: 'slot123',
        planId: 'plan456',
        confirmResult: true,
        apiSuccess: true,
        expectedAlertType: 'success',
        expectedAlertMessage: 'Deleted',
    },
    {
        description: 'cancels deletion when user declines confirmation',
        slotId: 'slot123',
        planId: 'plan456',
        confirmResult: false,
        apiSuccess: true,
        expectedAlertType: null,
        expectedAlertMessage: null,
    },
    {
        description: 'shows error when API call fails',
        slotId: 'slot123',
        planId: 'plan456',
        confirmResult: true,
        apiSuccess: false,
        apiError: 'Failed to delete slot.',
        expectedAlertType: 'error',
        expectedAlertMessage: 'Failed to delete slot.',
    },
    {
        description: 'handles missing slot ID gracefully',
        slotId: '',
        planId: 'plan456',
        confirmResult: true,
        apiSuccess: true,
        expectedAlertType: null,
        expectedAlertMessage: null,
    },
];

export const initDnDData = [
    {
        description: 'initializes drag-and-drop when user has ITEM_EDIT permission',
        planId: 'plan789',
        hasPermission: true,
        expectInitialized: true,
    },
    {
        description: 'shows error and skips initialization without ITEM_EDIT permission',
        planId: 'plan789',
        hasPermission: false,
        expectInitialized: false,
        expectedAlertType: 'error',
    },
];
