/**
 * Test data for drivers-create.ts module
 */

import {deepCopy} from "../helpers/util";

const _driversCreateTestData = {
    formElements: {
        form: { id: 'packingForm' },
        itemTable: { id: 'itemTable' },
        itemsJson: { id: 'itemsJson' },
    },
    sampleItems: [
        { title: 'Driver 1', description: 'Desc 1', maxAssignees: 2 },
        { title: 'Driver 2', description: '', maxAssignees: 1 },
        { title: 'Driver 3', description: 'Desc 3', maxAssignees: 3 },
    ],
    emptyFormData: [],
    singleItemFormData: [
        { title: 'Solo Driver', description: 'Solo desc', maxAssignees: 1 },
    ],
};

export const driversCreateTestData = () => deepCopy(_driversCreateTestData) as typeof _driversCreateTestData;
