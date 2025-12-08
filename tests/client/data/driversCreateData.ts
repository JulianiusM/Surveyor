/**
 * Test data for drivers-create.ts module
 */

export const driversCreateTestData = {
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
