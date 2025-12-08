/**
 * Test data for activity-create.ts module
 */

export const updateSlotObjData = [
    {
        description: 'adds new slot object to map',
        dateISO: '2024-01-15',
        slot: {
            id: 'slot-1',
            title: 'Meeting',
            pos: 0
        },
        isNew: true
    },
    {
        description: 'updates existing slot object',
        dateISO: '2024-01-15',
        slot: {
            id: 'slot-1',
            title: 'Updated Meeting',
            pos: 0
        },
        isNew: false
    }
];

export const getSlotObjData = [
    {
        description: 'retrieves existing slot',
        dateISO: '2024-01-15',
        slotId: 'slot-1',
        exists: true
    },
    {
        description: 'returns undefined for non-existent slot',
        dateISO: '2024-01-15',
        slotId: 'nonexistent',
        exists: false
    }
];

export const reIndexDayData = {
    description: 're-indexes all slots for a day',
    dateISO: '2024-01-15',
    slots: [
        {id: 'slot-1', pos: 2},
        {id: 'slot-2', pos: 0},
        {id: 'slot-3', pos: 1}
    ]
};

export const buildSlotRowData = [
    {
        description: 'builds slot row with prefilled data',
        dateISO: '2024-01-15',
        pos: 0,
        pref: {
            id: 'slot-1',
            title: 'Meeting',
            description: 'Team meeting',
            startTime: '14:30:00',
            endTime: '16:00:00',
            maxAssignees: 5
        }
    },
    {
        description: 'builds slot row without prefilled data',
        dateISO: '2024-01-16',
        pos: 0,
        pref: {}
    }
];

export const buildDayCellData = [
    {
        description: 'builds day cell for a date',
        date: new Date('2024-01-15')
    }
];

export const createWeekTableData = [
    {
        description: 'creates week table within date range',
        monday: new Date('2024-01-15'),
        start: new Date('2024-01-15'),
        end: new Date('2024-01-21')
    }
];

export const buildTablesData = [
    {
        description: 'builds all tables for date range',
        start: new Date('2024-01-15'),
        end: new Date('2024-01-21')
    },
    {
        description: 'builds tables for multi-week range',
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31')
    }
];

export const maybeGenerateData = [
    {
        description: 'generates tables when start and end dates are valid',
        startDate: '2024-01-15',
        endDate: '2024-01-21',
        shouldGenerate: true
    },
    {
        description: 'auto-fills end date when missing',
        startDate: '2024-01-15',
        endDate: '',
        shouldAutoFill: true
    },
    {
        description: 'validates end date is not before start date',
        startDate: '2024-01-21',
        endDate: '2024-01-15',
        shouldError: true
    },
    {
        description: 'does nothing when start date is empty',
        startDate: '',
        endDate: '2024-01-21',
        shouldGenerate: false
    }
];

export const initListenersData = {
    description: 'initializes date input listeners'
};

export const initSubmitHandlerData = {
    description: 'initializes form submit handler with slot serialization'
};

export const initSlotDnDData = {
    description: 'initializes drag-and-drop for slot reordering'
};

export const initData = {
    basicInit: {
        description: 'initializes with all functions',
        hasPrefilledSlots: false
    },
    initWithPrefilledSlots: {
        description: 'initializes with prefilled slots',
        hasPrefilledSlots: true,
        slots: {
            '2024-01-15': [
                {id: 'slot-1', title: 'Meeting', pos: 0}
            ]
        }
    }
};
