/**
 * Controller unit tests for the Drivers controller (services mocked).
 */

jest.mock('../../src/modules/database/services/DriverService', () => ({
    createDriversList: jest.fn(),
    getDriversItems: jest.fn(),
    getDriversAssignmentsForUser: jest.fn(),
    getDriversAssignmentsForGuest: jest.fn(),
    getDriversItemAssignees: jest.fn(),

    updateDriversListDescription: jest.fn(),
    reorderDriversItems: jest.fn(),
    getLastDriversItemNumber: jest.fn(),

    createDriversItemUser: jest.fn(),
    createDriversItemGuest: jest.fn(),
    updateDriversItem: jest.fn(),

    deleteDriversAssignment: jest.fn(),
    updateDriversFlags: jest.fn(),
    deleteDriversItem: jest.fn(),
    deleteDriversList: jest.fn(),

    assignDriversItemToUser: jest.fn(),
    assignDriversItemToGuest: jest.fn(),
    unassignDriversItemUser: jest.fn(),
    unassignDriversItemGuest: jest.fn(),
}));

jest.mock('../../src/modules/lib/util', () => ({
    generateUniqueId: jest.fn(() => 'uid-xyz'),
    ENTITIES: {
        ACTIVITY: 'activity',
        DRIVERS: 'drivers',
        EVENT: 'event',
        PACKING: 'packing',
        SURVEY: 'survey',
    },
}));

jest.mock('../../src/modules/permissionEngine', () => ({
    saveDefaultPermsFromBody: jest.fn(),
}));

import controller from '../../src/controller/driversController';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as permissionEngine from '../../src/modules/permissionEngine';
import {APIError, ValidationError} from '../../src/modules/lib/errors';
import {setupMock, verifyMockCall, verifyResult} from '../keywords/common/controllerKeywords';
import * as testData from '../data/controller/driversData';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    reorderItems,
    quickAddItem,
    updateItemDescription,
    updateItemAttr,
    deleteAssignment,
    updateSettings,
    deleteItem,

    getAssignmentAccessMapping,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    test.each(testData.preprocessCreateData)(
        '$description',
        ({input, expected, shouldThrow}) => {
            if (shouldThrow) {
                expect(() => preprocessCreate(input)).toThrow(shouldThrow === 'ValidationError' ? ValidationError : Error);
            } else {
                const out = preprocessCreate(input);
                expect(out).toMatchObject(expected);
            }
        }
    );
});

describe('createEntity / afterCreateItems', () => {
    it('delegates to createDriversList and returns id', async () => {
        const {userId, listData, expectedId} = testData.createEntityData;
        setupMock(driverService.createDriversList, expectedId);

        const id = await createEntity(userId, listData);
        
        verifyResult(id, expectedId);
        verifyMockCall(driverService.createDriversList, userId, listData.title, listData.description, listData.eventId);

        await expect(afterCreateItems(expectedId, {_body: {}})).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const {list, items, assignees, scenarios} = testData.fetchForViewData;

    beforeEach(() => {
        setupMock(driverService.getDriversItems, items);
        setupMock(driverService.getDriversItemAssignees, assignees);
    });

    test.each(scenarios)(
        '$description',
        async ({session, mockAssignments, mockFunc, mockArgs, expectedAssignments, expectedCounters}) => {
            if (mockFunc) {
                setupMock(driverService[mockFunc], mockAssignments);
            }
            
            const req = {session} as any;
            const out = await fetchForView(list as any, req);
            
            if (mockArgs) {
                verifyMockCall(driverService[mockFunc], ...mockArgs);
            }
            verifyResult(out.assignments, expectedAssignments);
            if (expectedCounters) {
                verifyResult(out.counters, expectedCounters);
            }
        }
    );
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('fetchForDuplicate returns items array', async () => {
        const {list, items} = testData.fetchForDuplicateData;
        setupMock(driverService.getDriversItems, items);

        const out = await fetchForDuplicate(list as any, {} as any);
        
        verifyResult(out, items);
    });

    it('deleteEntity delegates to deleteDriversList', async () => {
        const {list} = testData.deleteEntityData;
        
        await deleteEntity(list as any, {} as any);
        
        verifyMockCall(driverService.deleteDriversList, list.id);
    });
});

describe('API helpers', () => {
    describe('updateDescription', () => {
        test.each(testData.updateDescriptionData)(
            '$description',
            async ({listId, body, expectedMessage, shouldThrow}) => {
                if (shouldThrow) {
                    await expect(updateDescription(listId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateDescription(listId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(driverService.updateDriversListDescription, listId, body.description);
                }
            }
        );
    });

    it('reorderItems passes through and returns message', async () => {
        const {listId, order, expectedMessage} = testData.reorderItemsData;
        
        const result = await reorderItems(listId, order);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(driverService.reorderDriversItems, listId, order);
    });

    describe('quickAddItem', () => {
        const {list, lastPos, scenarios} = testData.quickAddItemData;

        beforeEach(() => {
            setupMock(driverService.getLastDriversItemNumber, lastPos);
        });

        test.each(scenarios)(
            '$description',
            async ({session, body, expectedMessage, expectedService, expectedItem, expectedMaxAssignees, shouldThrow}) => {
                if (shouldThrow) {
                    await expect(quickAddItem(list as any, body, session as any)).rejects.toBeInstanceOf(APIError);
                } else if (expectedItem) {
                    const result = await quickAddItem(list as any, body, session as any);
                    verifyResult(result, expectedMessage);
                    expect(driverService[expectedService]).toHaveBeenCalledWith(
                        list.id,
                        session.user.id,
                        expect.objectContaining(expectedItem)
                    );
                } else if (expectedMaxAssignees) {
                    await quickAddItem(list as any, body, session as any);
                    expect(driverService[expectedService]).toHaveBeenCalledWith(
                        list.id,
                        session.guest.id,
                        expect.objectContaining({maxAssignees: expectedMaxAssignees})
                    );
                }
            }
        );
    });

    describe('updateItemDescription', () => {
        test.each(testData.updateItemDescriptionData)(
            '$description',
            async ({itemId, body, mockResolve, expectedMessage, shouldThrow}) => {
                setupMock(driverService.updateDriversItem, mockResolve);
                
                if (shouldThrow) {
                    await expect(updateItemDescription(itemId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateItemDescription(itemId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(driverService.updateDriversItem, itemId, body);
                }
            }
        );
    });

    describe('updateItemAttr', () => {
        test.each(testData.updateItemAttrData)(
            '$description',
            async ({itemId, body, mockResolve, expectedMessage, expectedUpdate, shouldThrow}) => {
                if (mockResolve !== undefined) {
                    setupMock(driverService.updateDriversItem, mockResolve);
                }
                
                if (shouldThrow) {
                    await expect(updateItemAttr(itemId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateItemAttr(itemId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(driverService.updateDriversItem, itemId, expectedUpdate);
                }
            }
        );
    });

    it('deleteAssignment delegates and returns message', async () => {
        const {assignmentId, expectedMessage} = testData.deleteAssignmentData;
        
        const result = await deleteAssignment(assignmentId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(driverService.deleteDriversAssignment, assignmentId);
    });

    it('updateSettings delegates and returns message', async () => {
        const {listId, body, expectedMessage} = testData.updateSettingsData;
        
        const result = await updateSettings(listId, body);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(permissionEngine.saveDefaultPermsFromBody, 'drivers', listId, body);
    });

    it('deleteItem delegates and returns message', async () => {
        const {itemId, expectedMessage} = testData.deleteItemData;
        
        const result = await deleteItem(itemId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(driverService.deleteDriversItem, itemId);
    });
});

describe('getAssignmentAccessMapping', () => {
    it('routes to correct service functions with itemId', async () => {
        const {assignToUser, assignToGuest, unassignFromUser, unassignFromGuest} = testData.assignmentAccessMappingData;
        
        const m = getAssignmentAccessMapping();

        await m.assignToUser(assignToUser, assignToUser.userId);
        await m.assignToGuest(assignToGuest, assignToGuest.guestId);
        await m.unassignFromUser(unassignFromUser, unassignFromUser.userId);
        await m.unassignFromGuest(unassignFromGuest, unassignFromGuest.guestId);

        verifyMockCall(driverService.assignDriversItemToUser, assignToUser.itemId, assignToUser.userId);
        verifyMockCall(driverService.assignDriversItemToGuest, assignToGuest.itemId, assignToGuest.guestId);
        verifyMockCall(driverService.unassignDriversItemUser, unassignFromUser.itemId, unassignFromUser.userId);
        verifyMockCall(driverService.unassignDriversItemGuest, unassignFromGuest.itemId, unassignFromGuest.guestId);
    });
});
