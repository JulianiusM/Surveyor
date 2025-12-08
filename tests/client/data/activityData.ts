/**
 * Test data for activity.ts module
 */

export const formatTimeLabelData = [
    {
        description: 'formats time with hours and minutes',
        input: '14:30:00',
        expected: '14:30'
    },
    {
        description: 'handles null time',
        input: null,
        expected: ''
    },
    {
        description: 'handles undefined time',
        input: undefined,
        expected: ''
    },
    {
        description: 'handles empty string',
        input: '',
        expected: ''
    }
];

export const describeSlotData = [
    {
        description: 'describes slot with all data',
        slotId: 'slot-1',
        slotHtml: '<div class="slot" data-slotid="slot-1" data-day="2024-01-15" data-start="14:30:00" data-end="16:00:00"><span data-edit="title">Team Meeting</span></div>',
        expected: 'Team Meeting on 2024-01-15 (14:30-16:00)'
    },
    {
        description: 'describes slot without times',
        slotId: 'slot-2',
        slotHtml: '<div class="slot" data-slotid="slot-2" data-day="2024-01-16"><span data-edit="title">Workshop</span></div>',
        expected: 'Workshop on 2024-01-16'
    },
    {
        description: 'handles missing slot element',
        slotId: 'nonexistent',
        slotHtml: '',
        expected: 'slot nonexistent'
    },
    {
        description: 'describes slot with day from container',
        slotId: 'slot-3',
        slotHtml: '<div class="slot-container" data-date="2024-01-17"><div class="slot" data-slotid="slot-3"><span data-edit="title">Presentation</span></div></div>',
        expected: 'Presentation on 2024-01-17'
    }
];

export const formatSlotLabelData = [
    {
        description: 'formats slot label with all data',
        slot: {
            title: 'Team Meeting',
            day: '2024-01-15',
            startTime: '14:30:00',
            endTime: '16:00:00'
        },
        expected: 'Team Meeting on 2024-01-15 (14:30-16:00)'
    },
    {
        description: 'formats slot label without day',
        slot: {
            title: 'Workshop',
            day: null,
            startTime: '10:00:00',
            endTime: '12:00:00'
        },
        expected: 'Workshop (10:00-12:00)'
    },
    {
        description: 'formats slot label without times',
        slot: {
            title: 'Presentation',
            day: '2024-01-16',
            startTime: null,
            endTime: null
        },
        expected: 'Presentation on 2024-01-16'
    },
    {
        description: 'handles slot without title',
        slot: {
            title: null,
            day: '2024-01-17',
            startTime: '14:00:00',
            endTime: '15:00:00'
        },
        expected: 'Slot on 2024-01-17 (14:00-15:00)'
    }
];

export const toDateTimeLocalValueData = [
    {
        description: 'converts Date object to datetime-local format',
        input: new Date('2024-01-15T14:30:00Z'),
        expected: '2024-01-15T14:30'
    },
    {
        description: 'converts ISO string to datetime-local format',
        input: '2024-01-15T14:30:00Z',
        expected: '2024-01-15T14:30'
    },
    {
        description: 'handles null date',
        input: null,
        expected: ''
    },
    {
        description: 'handles undefined date',
        input: undefined,
        expected: ''
    },
    {
        description: 'handles invalid date string',
        input: 'invalid-date',
        expected: ''
    }
];

export const toISOStringOrNullData = [
    {
        description: 'converts valid datetime-local to ISO string',
        input: '2024-01-15T14:30',
        expectedNotNull: true
    },
    {
        description: 'returns null for empty string',
        input: '',
        expectedNotNull: false
    },
    {
        description: 'returns null for invalid date',
        input: 'invalid',
        expectedNotNull: false
    }
];

export const initData = {
    basicInit: {
        description: 'initializes with all basic functions',
        planId: 'plan-123',
        hasModalElements: true,
        hasTabs: true
    },
    initWithSessionTab: {
        description: 'restores saved tab from session storage',
        planId: 'plan-456',
        savedTabId: '#participants-tab',
        hasModalElements: true,
        hasTabs: true
    },
    initWithoutPlanId: {
        description: 'handles missing plan ID gracefully',
        planId: '',
        hasModalElements: false,
        hasTabs: false
    }
};
