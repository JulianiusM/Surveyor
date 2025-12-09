/**
 * Test data for packing.ts module
 */

import {deepCopy} from "../helpers/util";

const _packingTestData = {
    packListId: 'packing-123',
    editableElements: [
        { dataEdit: 'title', value: 'Item Title' },
        { dataEdit: 'description', value: 'Item Description' },
        { dataEdit: 'maxAssignees', value: '2' },
    ],
    descriptionElement: {
        dataEdit: 'planDescription',
        value: 'Plan description text',
    },
    itemId: 'item-456',
};

export const packingTestData = () => deepCopy(_packingTestData) as typeof _packingTestData;
