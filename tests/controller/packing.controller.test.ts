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

jest.mock('../../src/modules/lib/util', () => ({
    generateUniqueId: jest.fn(() => 'uid-123'),
}));

import controller from '../../src/controller/packingController';
import * as packingService from '../../src/modules/database/services/PackingService';
import {APIError, ValidationError} from '../../src/modules/lib/errors';

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
    it('parses, validates, and normalizes a valid payload', () => {
        const body = {
            title: 'Trip packing',
            description: '',
            allowGuestAdd: 'on',     // Boolean('on') → true
            guestManage: '',         // Boolean('') → false
            items: JSON.stringify([
                {title: 'Tent', description: '', maxAssignees: 1, requiredByAll: true},
                {title: 'Stove', description: 'gas', maxAssignees: 2, requiredByAll: false},
            ]),
        };

        const res = preprocessCreate(body);
        expect(res).toMatchObject({
            title: 'Trip packing',
            description: null,
            allowGuestAdd: true,
            guestManage: false,
        });
        expect(res.items).toHaveLength(2);
        expect(res.items[0]).toMatchObject({title: 'Tent', requiredByAll: true, maxAssignees: 1});
    });

    it('throws ValidationError on invalid JSON', () => {
        const body = {title: 'X', items: '[bad json'};
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });

    it('throws ValidationError on schema errors (missing item fields)', () => {
        const body = {
            title: 'X',
            items: JSON.stringify([{description: '', maxAssignees: 1, requiredByAll: true}]), // missing title
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });

    it('requires at least one item', () => {
        const body = {
            title: 'X',
            items: JSON.stringify([]),
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });
});

describe('createEntity / afterCreateItems', () => {
    it('maps list + items, generates ids/positions, coerces types', async () => {
        (packingService.createPackingListTx as jest.Mock).mockResolvedValue('list-123');

        const listData = {
            title: 'Trip',
            description: 'desc',
            allowGuestAdd: true,
            guestManage: false,
            items: [
                {title: 'Tent', description: '', maxAssignees: '2', requiredByAll: true},
                {title: 'Stove', requiredByAll: 0, maxAssignees: 0}, // coerces
            ],
        };

        const id = await createEntity(7, listData as any);
        expect(id).toBe('list-123');

        // Check call args: items transformed with id, position, coerced numbers/booleans
        expect(packingService.createPackingListTx).toHaveBeenCalledTimes(1);
        const args = (packingService.createPackingListTx as jest.Mock).mock.calls[0];
        expect(args[0]).toBe(7);                      // ownerId
        expect(args[1]).toBe('Trip');                 // title
        expect(args[2]).toBe('desc');                 // description
        expect(args[3]).toBe(true);                   // allowGuestAdd
        expect(args[4]).toBe(false);                  // guestManage
        const mappedItems = args[5];
        expect(mappedItems).toHaveLength(2);
        expect(mappedItems[0]).toMatchObject({
            id: 'uid-123',
            title: 'Tent',
            description: '',
            maxAssignees: 2,
            requiredByAll: true,
            position: 0,
        });
        expect(mappedItems[1]).toMatchObject({
            id: 'uid-123',
            title: 'Stove',
            description: '', // defaulted
            maxAssignees: 1, // Number(0) || 1 → 1
            requiredByAll: false,
            position: 1,
        });

        await expect(afterCreateItems()).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const list = {id: 'L1'};

    const items = [
        {id: 'a', title: 'A', assignedCount: 0, maxAssignees: 2, requiredByAll: false},
        {id: 'b', title: 'B', assignedCount: 1, maxAssignees: 1, requiredByAll: false},
        {id: 'c', title: 'C', assignedCount: 0, maxAssignees: 5, requiredByAll: true}, // skipped in counters
    ];

    beforeEach(() => {
        (packingService.getPackingItems as jest.Mock).mockResolvedValue(items);
        (packingService.getPackingItemAssignees as jest.Mock).mockResolvedValue({
            a: [{user_id: 1}],
            b: [{guest_id: 2}, {name: 'Anon'}],
            c: [{user_id: 1}], // should not affect counters/participants
        });
    });

    it('uses user assignments and computes counters/participants excluding requiredByAll', async () => {
        (packingService.getPackingAssignmentsForUser as jest.Mock).mockResolvedValue(['a']);
        const res = await fetchForView(list as any, {user: {id: 99}} as any);

        expect(res.items).toBe(items);
        expect(res.assignments).toEqual(['a']);
        expect(res.counters).toEqual({participants: 3, open: 1, empty: 1});
        // participants: 'u_1', 'g_2', 'Anon' from items a/b only
    });

    it('uses guest assignments when no user', async () => {
        (packingService.getPackingAssignmentsForGuest as jest.Mock).mockResolvedValue(['b']);
        const res = await fetchForView(list as any, {guest: {id: 5}} as any);
        expect(res.assignments).toEqual(['b']);
    });

    it('falls back to empty assignments with no principal', async () => {
        const res = await fetchForView(list as any, {} as any);
        expect(res.assignments).toEqual([]);
    });
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('returns items from service', async () => {
        (packingService.getPackingItems as jest.Mock).mockResolvedValue([{id: 'x'}]);
        const out = await fetchForDuplicate({id: 'L9'} as any, {} as any);
        expect(out).toEqual([{id: 'x'}]);
    });

    it('delegates deletion to service', async () => {
        await deleteEntity({id: 'L9'} as any, {} as any);
        expect(packingService.deletePackingList).toHaveBeenCalledWith('L9');
    });
});

describe('API helpers', () => {
    describe('updateDescription', () => {
        it('updates if <= 2000 chars', async () => {
            await expect(updateDescription('L1', {description: 'ok'}))
                .resolves.toBe('Description updated');
            expect(packingService.updatePackingListDescription).toHaveBeenCalledWith('L1', 'ok');
        });
        it('rejects when too long', async () => {
            const long = 'x'.repeat(2001);
            await expect(updateDescription('L1', {description: long}))
                .rejects.toBeInstanceOf(APIError);
        });
    });

    it('reorderItems passes through', async () => {
        const order = [{itemId: 'a', position: 2}];
        await expect(reorderItems('L1', order)).resolves.toBe('Order saved');
        expect(packingService.reorderPackingItems).toHaveBeenCalledWith('L1', order);
    });

    describe('quickAddItem', () => {
        const list = {id: 'L1'};

        it('adds item with next position and numeric max', async () => {
            (packingService.getLastPackingItemNumber as jest.Mock).mockResolvedValue(2);
            await expect(
                quickAddItem(list as any, {title: 'Knife', description: 'sharp', max: '3'})
            ).resolves.toBe('Item added');

            expect(packingService.addPackingItems).toHaveBeenCalledWith('L1', [{
                id: 'uid-123',
                title: 'Knife',
                description: 'sharp',
                maxAssignees: 3,
                position: 3,
            }]);
        });

        it('defaults maxAssignees to 1 when falsy', async () => {
            (packingService.getLastPackingItemNumber as jest.Mock).mockResolvedValue(0);
            await quickAddItem(list as any, {title: 'Spoon', max: 0});
            expect(packingService.addPackingItems).toHaveBeenCalledWith('L1', [
                expect.objectContaining({maxAssignees: 1, position: 1}),
            ]);
        });

        it('rejects missing title', async () => {
            await expect(quickAddItem(list as any, {title: ''}))
                .rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateItemDescription', () => {
        it('returns ok if service true', async () => {
            (packingService.updatePackingItem as jest.Mock).mockResolvedValue(true);
            await expect(updateItemDescription('i1', {description: 'd'})).resolves.toBe('Description updated');
            expect(packingService.updatePackingItem).toHaveBeenCalledWith('i1', {description: 'd'});
        });
        it('throws 500 if service false', async () => {
            (packingService.updatePackingItem as jest.Mock).mockResolvedValue(false);
            await expect(updateItemDescription('i1', {description: 'd'})).rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateItemAttr', () => {
        it('rejects invalid field', async () => {
            await expect(updateItemAttr('i1', {field: 'position', value: 3}))
                .rejects.toBeInstanceOf(APIError);
        });
        it('updates allowed field and returns ok', async () => {
            (packingService.updatePackingItem as jest.Mock).mockResolvedValue(true);
            await expect(updateItemAttr('i1', {field: 'title', value: 'New'}))
                .resolves.toBe('Item updated');
            expect(packingService.updatePackingItem).toHaveBeenCalledWith('i1', {title: 'New'});
        });
        it('throws 500 when service returns false', async () => {
            (packingService.updatePackingItem as jest.Mock).mockResolvedValue(false);
            await expect(updateItemAttr('i1', {field: 'title', value: 'New'}))
                .rejects.toBeInstanceOf(APIError);
        });
    });

    it('updateRequired toggles requiredByAll', async () => {
        await expect(updateRequired('i2', {flag: true})).resolves.toBe('Requirement updated');
        expect(packingService.togglePackingItemRequiredByAll).toHaveBeenCalledWith('i2', true);
    });

    it('deleteAssignment passes through', async () => {
        await expect(deleteAssignment('a1')).resolves.toBe('Assignment removed');
        expect(packingService.deletePackingAssignment).toHaveBeenCalledWith('a1');
    });

    it('updateSettings passes through', async () => {
        await expect(updateSettings('L1', {allowAdd: true, guestManage: false}))
            .resolves.toBe('Settings saved');
        expect(packingService.updatePackingFlags).toHaveBeenCalledWith('L1', true, false);
    });

    it('deleteItem passes through', async () => {
        await expect(deleteItem('i9')).resolves.toBe('Item deleted');
        expect(packingService.deletePackingItem).toHaveBeenCalledWith('i9');
    });
});

describe('getAssignmentAccessMapping', () => {
    it('routes to correct packingService functions', async () => {
        const m = getAssignmentAccessMapping();

        await m.assignToUser({itemId: 'i1'}, 7);
        await m.assignToGuest({itemId: 'i2'}, 5);
        await m.unassignFromUser({itemId: 'i3'}, 8);
        await m.unassignFromGuest({itemId: 'i4'}, 9);

        expect(packingService.assignPackingItemToUser).toHaveBeenCalledWith('i1', 7);
        expect(packingService.assignPackingItemToGuest).toHaveBeenCalledWith('i2', 5);
        expect(packingService.unassignPackingItemUser).toHaveBeenCalledWith('i3', 8);
        expect(packingService.unassignPackingItemGuest).toHaveBeenCalledWith('i4', 9);
    });
});
