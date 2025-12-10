/**
 * Test data for drivers.ts module
 */

import {deepCopy} from "../helpers/util";

const _driversTestData = {
    driversListId: 'drivers-123',
    editableElements: [
        { dataEdit: 'title', value: 'Driver Title' },
        { dataEdit: 'description', value: 'Driver Description' },
        { dataEdit: 'maxAssignees', value: '2' },
    ],
    descriptionElement: {
        dataEdit: 'planDescription',
        value: 'Plan description text',
    },
};

export const driversTestData = () => deepCopy(_driversTestData) as typeof _driversTestData;
