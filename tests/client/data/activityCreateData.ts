/**
 * Test data for activity-create.ts module
 */
import {deepCopy} from "../helpers/util";

export const _updateSlotObjData = [
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

export const updateSlotObjData = () => deepCopy(_updateSlotObjData) as typeof _updateSlotObjData

export const _getSlotObjData = [
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

export const getSlotObjData = () => deepCopy(_getSlotObjData) as typeof _getSlotObjData

export const _reIndexDayData = {
    description: 're-indexes all slots for a day',
    dateISO: '2024-01-15',
    slots: [
        {id: 'slot-1', pos: 2},
        {id: 'slot-2', pos: 0},
        {id: 'slot-3', pos: 1}
    ]
};

export const reIndexDayData = () => deepCopy(_reIndexDayData) as typeof _getSlotObjData

export const _buildSlotRowData = [
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

export const buildSlotRowData = () => deepCopy(_buildSlotRowData) as typeof _buildSlotRowData;

export const _buildDayCellData = [
    {
        description: 'builds day cell for a date',
        date: new Date('2024-01-15')
    }
];

export const buildDayCellData = () => deepCopy(_buildDayCellData) as typeof _buildDayCellData

export const _createWeekTableData = [
    {
        description: 'creates week table within date range',
        monday: new Date('2024-01-15'),
        start: new Date('2024-01-15'),
        end: new Date('2024-01-21')
    }
];

export const createWeekTableData = () => deepCopy(_createWeekTableData) as typeof _createWeekTableData

export const _buildTablesData = [
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

export const buildTablesData = () => deepCopy(_buildTablesData) as typeof _buildTablesData

export const _maybeGenerateData = [
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

export const maybeGenerateData = () => deepCopy(_maybeGenerateData) as typeof _maybeGenerateData

export const _initListenersData = {
    description: 'initializes date input listeners'
};

export const initListenersData = () => deepCopy(_initListenersData) as typeof _initListenersData

export const _initSubmitHandlerData = {
    description: 'initializes form submit handler with slot serialization'
};

export const initSubmitHandlerData = () => deepCopy(_initSubmitHandlerData) as typeof _initSubmitHandlerData

export const _initSlotDnDData = {
    description: 'initializes drag-and-drop for slot reordering'
};

export const initSlotDnDData = () => deepCopy(_initSlotDnDData) as typeof _initSlotDnDData

export const _initData = {
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

export const initData = () => deepCopy(_initData) as typeof _initData;
