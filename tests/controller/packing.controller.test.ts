/**
 * Packing controller unit tests (services mocked).
 */

jest.mock('../../src/modules/database/services/PackingService', () => ({
    createPackingListTx: jest.fn(),
    getPackingItems: jest.fn(),
    getPackingAssignmentsForUser: jest.fn(),
    getPackingAssignmentsForGuest: jest.fn(),
    getPackingItemAssignees: jest.fn(),
    updatePackingListDescription: jest.fn(),
    reorderPackingItems: jest.fn(),
    getLastPackingItemNumber: jest.fn(),
    addPackingItems: jest.fn(),
    updatePackingItem: jest.fn(),
    togglePackingItemRequiredByAll: jest.fn(),
    deletePackingAssignment: jest.fn(),
    updatePackingFlags: jest.fn(),
    deletePackingItem: jest.fn(),
    assignPackingItemToUser: jest.fn(),
    assignPackingItemToGuest: jest.fn(),
    unassignPackingItemUser: jest.fn(),
    unassignPackingItemGuest: jest.fn(),
    deletePackingList: jest.fn(),
}));

import { mockUtil, mockPermissionEngine } from '../mocks/commonMocks';

jest.mock('../../src/modules/lib/util', () => mockUtil({
    generateUniqueId: jest.fn(() => 'uid-123'),
}));

jest.mock('../../src/modules/permissionEngine', () => mockPermissionEngine());

import controller from '../../src/controller/packingController';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as permissionEngine from '../../src/modules/permissionEngine';
import {APIError, ValidationError} from '../../src/modules/lib/errors';
import {setupMock, verifyMockCall, verifyResult} from '../keywords/common/controllerKeywords';
import * as testData from '../data/controller/packingData';

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
    updateRequired,

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
                const res = preprocessCreate(input);
                expect(res).toMatchObject({
                    title: expected.title,
                    description: expected.description,
                });
                expect(res.items).toHaveLength(expected.itemsLength);
                expect(res.items[0]).toMatchObject(expected.firstItem);
            }
        }
    );
});

describe('createEntity / afterCreateItems', () => {
    it('maps list + items, generates ids/positions, coerces types', async () => {
        const {userId, listData, expectedId, expectedItems} = testData.createEntityData;
        setupMock(packingService.createPackingListTx, expectedId);

        const id = await createEntity(userId, listData as any);
        
        verifyResult(id, expectedId);
        expect(packingService.createPackingListTx).toHaveBeenCalledTimes(1);
        const args = (packingService.createPackingListTx as jest.Mock).mock.calls[0];
        expect(args[0]).toBe(userId);
        expect(args[1]).toBe(listData.title);
        expect(args[2]).toBe(listData.description);
        const mappedItems = args[3];
        expect(mappedItems).toHaveLength(2);
        expect(mappedItems[0]).toMatchObject(expectedItems[0]);
        expect(mappedItems[1]).toMatchObject(expectedItems[1]);

        await expect(afterCreateItems(expectedId, {_body: {}})).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const {list, items, assignees, scenarios} = testData.fetchForViewData;

    beforeEach(() => {
        setupMock(packingService.getPackingItems, items);
        setupMock(packingService.getPackingItemAssignees, assignees);
    });

    test.each(scenarios)(
        '$description',
        async ({session, mockAssignments, mockFunc, expectedAssignments, expectedCounters}) => {
            if (mockFunc) {
                setupMock(packingService[mockFunc], mockAssignments);
            }
            
            const req = {session} as any;
            const res = await fetchForView(list as any, req);
            
            verifyResult(res.items, items);
            verifyResult(res.assignments, expectedAssignments);
            if (expectedCounters) {
                verifyResult(res.counters, expectedCounters);
            }
        }
    );
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('returns items from service', async () => {
        const {list, items} = testData.fetchForDuplicateData;
        setupMock(packingService.getPackingItems, items);
        
        const out = await fetchForDuplicate(list as any, {} as any);
        
        verifyResult(out, items);
    });

    it('delegates deletion to service', async () => {
        const {list} = testData.deleteEntityData;
        
        await deleteEntity(list as any, {} as any);
        
        verifyMockCall(packingService.deletePackingList, list.id);
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
                    verifyMockCall(packingService.updatePackingListDescription, listId, body.description);
                }
            }
        );
    });

    it('reorderItems passes through', async () => {
        const {listId, order, expectedMessage} = testData.reorderItemsData;
        
        const result = await reorderItems(listId, order);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(packingService.reorderPackingItems, listId, order);
    });

    describe('quickAddItem', () => {
        const {list, scenarios} = testData.quickAddItemData;

        test.each(scenarios)(
            '$description',
            async ({lastPos, body, expectedMessage, expectedItem, expectedMaxAssignees, expectedPosition, shouldThrow}) => {
                if (lastPos !== undefined) {
                    setupMock(packingService.getLastPackingItemNumber, lastPos);
                }
                
                if (shouldThrow) {
                    await expect(quickAddItem(list as any, body)).rejects.toBeInstanceOf(APIError);
                } else if (expectedItem) {
                    const result = await quickAddItem(list as any, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(packingService.addPackingItems, list.id, [expectedItem]);
                } else if (expectedMaxAssignees) {
                    await quickAddItem(list as any, body);
                    expect(packingService.addPackingItems).toHaveBeenCalledWith(
                        list.id,
                        [expect.objectContaining({maxAssignees: expectedMaxAssignees, position: expectedPosition})]
                    );
                }
            }
        );
    });

    describe('updateItemDescription', () => {
        test.each(testData.updateItemDescriptionData)(
            '$description',
            async ({itemId, body, mockResolve, expectedMessage, shouldThrow}) => {
                setupMock(packingService.updatePackingItem, mockResolve);
                
                if (shouldThrow) {
                    await expect(updateItemDescription(itemId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateItemDescription(itemId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(packingService.updatePackingItem, itemId, body);
                }
            }
        );
    });

    describe('updateItemAttr', () => {
        test.each(testData.updateItemAttrData)(
            '$description',
            async ({itemId, body, mockResolve, expectedMessage, expectedUpdate, shouldThrow}) => {
                if (mockResolve !== undefined) {
                    setupMock(packingService.updatePackingItem, mockResolve);
                }
                
                if (shouldThrow) {
                    await expect(updateItemAttr(itemId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateItemAttr(itemId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(packingService.updatePackingItem, itemId, expectedUpdate);
                }
            }
        );
    });

    it('updateRequired toggles requiredByAll', async () => {
        const {itemId, body, expectedMessage} = testData.updateRequiredData;
        
        const result = await updateRequired(itemId, body);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(packingService.togglePackingItemRequiredByAll, itemId, body.flag);
    });

    it('deleteAssignment passes through', async () => {
        const {assignmentId, expectedMessage} = testData.deleteAssignmentData;
        
        const result = await deleteAssignment(assignmentId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(packingService.deletePackingAssignment, assignmentId);
    });

    it('updateSettings passes through', async () => {
        const {listId, body, expectedMessage} = testData.updateSettingsData;
        
        const result = await updateSettings(listId, body);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(permissionEngine.saveDefaultPermsFromBody, 'packing', listId, body);
    });

    it('deleteItem passes through', async () => {
        const {itemId, expectedMessage} = testData.deleteItemData;
        
        const result = await deleteItem(itemId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(packingService.deletePackingItem, itemId);
    });
});

describe('getAssignmentAccessMapping', () => {
    it('routes to correct packingService functions', async () => {
        const {assignToUser, assignToGuest, unassignFromUser, unassignFromGuest} = testData.assignmentAccessMappingData;
        
        const m = getAssignmentAccessMapping();

        await m.assignToUser(assignToUser, assignToUser.userId);
        await m.assignToGuest(assignToGuest, assignToGuest.guestId);
        await m.unassignFromUser(unassignFromUser, unassignFromUser.userId);
        await m.unassignFromGuest(unassignFromGuest, unassignFromGuest.guestId);

        verifyMockCall(packingService.assignPackingItemToUser, assignToUser.itemId, assignToUser.userId);
        verifyMockCall(packingService.assignPackingItemToGuest, assignToGuest.itemId, assignToGuest.guestId);
        verifyMockCall(packingService.unassignPackingItemUser, unassignFromUser.itemId, unassignFromUser.userId);
        verifyMockCall(packingService.unassignPackingItemGuest, unassignFromGuest.itemId, unassignFromGuest.guestId);
    });
});
