/**
 * Test data for activity-slot-editor.ts
 */

import {deepCopy} from "../helpers/util";

const _activitySlotEditorData = {
    initialization: {
        valid: {
            planId: 'plan123',
            modalId: 'slotEditorModal',
            formId: 'slotEditorForm',
            expectedBootstrapCall: true,
        },
        missingPlanId: {
            planId: '',
            expectedInit: false,
        },
        missingModal: {
            planId: 'plan123',
            modalId: 'nonExistentModal',
            expectedInit: false,
        },
    },

    roleManagement: {
        singleRole: {
            roleId: 1,
            roleName: 'Shift Leader',
            description: 'Leads the shift',
        },
        multipleRoles: [
            {id: 1, name: 'Shift Leader', description: 'Leads the shift'},
            {id: 2, name: 'Cook', description: 'Prepares food'},
            {id: 3, name: 'Server', description: 'Serves customers'},
        ],
        roleSearch: {
            term: 'cook',
            expectedMatches: ['Cook'],
        },
        newRole: {
            name: 'Dishwasher',
            expectedCreation: true,
        },
    },

    timeConversion: {
        validInput: {
            htmlTime: '14:30',
            dbTime: '14:30:00',
        },
        nullInput: {
            htmlTime: null,
            dbTime: null,
        },
        emptyString: {
            htmlTime: '',
            dbTime: null,
        },
        dbToHtml: {
            dbTime: '09:45:00',
            htmlTime: '09:45',
        },
    },

    slotCreation: {
        valid: {
            date: '2024-12-15',
            title: 'Morning Shift',
            description: 'Early morning operations',
            startTime: '08:00',
            endTime: '12:00',
            capacity: '5',
            roleIds: [1, 2],
        },
        missingTitle: {
            date: '2024-12-15',
            title: '',
            expectedError: 'Title is required.',
        },
    },

    slotEditing: {
        existing: {
            slotId: 'slot456',
            date: '2024-12-16',
            title: 'Afternoon Shift',
            description: 'Afternoon operations',
            startTime: '14:00:00',
            endTime: '18:00:00',
            capacity: '3',
            roleIds: [2, 3],
        },
    },

    apiResponses: {
        createSuccess: {
            status: 'success',
            data: {slotId: 'slot789'},
            message: 'Slot created',
        },
        createError: {
            status: 'error',
            message: 'Permission denied',
        },
        roleCreationSuccess: {
            status: 'success',
            data: [{id: 4, name: 'Dishwasher', description: null}],
        },
    },

    permissions: {
        canAdd: {
            perm: 'ITEM_ADD',
            hasPermission: true,
        },
        cannotAdd: {
            perm: 'ITEM_ADD',
            hasPermission: false,
            expectedError: 'add slots',
        },
        canEdit: {
            perm: 'ITEM_EDIT',
            hasPermission: true,
        },
    },
};

export const activitySlotEditorData = () => deepCopy(_activitySlotEditorData) as typeof _activitySlotEditorData;
