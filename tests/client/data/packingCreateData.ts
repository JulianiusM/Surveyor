/**
 * Test data for packing-create.ts module
 */

import {deepCopy} from "../helpers/util";

const _packingCreateTestData = {
    formElements: {
        form: { id: 'packingForm' },
        itemTable: { id: 'itemTable' },
        itemsJson: { id: 'itemsJson' },
        addItemBtn: { id: 'addItemBtn' },
    },
    sampleItems: [
        { title: 'Item 1', description: 'Desc 1', maxAssignees: 2, requiredByAll: true },
        { title: 'Item 2', description: '', maxAssignees: 1, requiredByAll: false },
        { title: 'Item 3', description: 'Desc 3', maxAssignees: 3, requiredByAll: false },
    ],
    prefilledItems: [
        { title: 'Prefilled 1', description: 'Pre desc', maxAssignees: 1, requiredByAll: true },
        { title: 'Prefilled 2', description: '', maxAssignees: 2, requiredByAll: false },
    ],
};

export const packingCreateTestData = () => deepCopy(_packingCreateTestData) as typeof _packingCreateTestData;
