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
}));

import controller from '../../src/controller/driversController';
import * as driverService from '../../src/modules/database/services/DriverService';
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

    getAssignmentAccessMapping,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    it('sanitizes valid payload, converts flags to booleans, coalesces description', () => {
        const body = {
            title: 'Drivers',
            description: '',
            allowGuestAdd: 'anything truthy', // -> Boolean(...) === true
            guestManage: '',                  // -> false
            items: JSON.stringify([
                {title: 'A', description: '', maxAssignees: 2},
            ]),
        };

        const out = preprocessCreate(body);
        expect(out).toMatchObject({
            title: 'Drivers',
            description: null,
            allowGuestAdd: true,
            guestManage: false,
        });
    });

    it('throws ValidationError on invalid items JSON', () => {
        const body = {
            title: 'X',
            items: '{bad json',
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });

    it('throws ValidationError when required title is missing', () => {
        const body = {
            description: 'no title',
            items: '[]',
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });
});

describe('createEntity / afterCreateItems', () => {
    it('delegates to createDriversList and returns id', async () => {
        (driverService.createDriversList as jest.Mock).mockResolvedValue('list-123');

        const listData = {
            title: 'T',
            description: 'D',
            allowGuestAdd: true,
            guestManage: false,
        };

        const id = await createEntity(7, listData);
        expect(id).toBe('list-123');
        expect(driverService.createDriversList).toHaveBeenCalledWith(7, 'T', 'D', true, false);

        await expect(afterCreateItems()).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const list = {id: 'L1'};

    const items = [
        {id: 'a', assignedCount: 0, maxAssignees: 2, title: 'A'}, // empty + open
        {id: 'b', assignedCount: 1, maxAssignees: 1, title: 'B'}, // full
        {id: 'c', assignedCount: 0, maxAssignees: 1, title: 'C'}, // empty + open
    ];

    const assigneeLists = {
        a: [{userId: 10, name: 'Alice'}, {name: 'Temp'}],
        b: [{guestId: 3, name: 'Bob'}],
        c: [{userId: 10, name: 'Alice'}, {name: 'Temp'}],
    };

    beforeEach(() => {
        (driverService.getDriversItems as jest.Mock).mockResolvedValue(items);
        (driverService.getDriversItemAssignees as jest.Mock).mockResolvedValue(assigneeLists);
    });

    it('uses user assignments and computes counters and participant set size', async () => {
        (driverService.getDriversAssignmentsForUser as jest.Mock).mockResolvedValue(['a']);
        const session = {user: {id: 99}};

        const out = await fetchForView(list as any, session as any);
        expect(driverService.getDriversAssignmentsForUser).toHaveBeenCalledWith('L1', 99);
        expect(out.assignments).toEqual(['a']);

        // participants: u_10, g_3, 'Temp' => 3 unique
        expect(out.counters).toEqual({participants: 3, open: 2, empty: 2});
    });

    it('uses guest assignments when no user', async () => {
        (driverService.getDriversAssignmentsForGuest as jest.Mock).mockResolvedValue(['b']);
        const session = {guest: {id: 7}};

        const out = await fetchForView(list as any, session as any);
        expect(driverService.getDriversAssignmentsForGuest).toHaveBeenCalledWith('L1', 7);
        expect(out.assignments).toEqual(['b']);
    });

    it('falls back to empty assignments when no principal', async () => {
        const out = await fetchForView(list as any, {} as any);
        expect(out.assignments).toEqual([]);
    });
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('fetchForDuplicate returns items array', async () => {
        const mock = [{id: 'x'}];
        (driverService.getDriversItems as jest.Mock).mockResolvedValue(mock);

        const out = await fetchForDuplicate({id: 'L9'} as any, {} as any);
        expect(out).toBe(mock);
    });

    it('deleteEntity delegates to deleteDriversList', async () => {
        await deleteEntity({id: 'L5'} as any, {} as any);
        expect(driverService.deleteDriversList).toHaveBeenCalledWith('L5');
    });
});

describe('API helpers', () => {
    describe('updateDescription', () => {
        it('updates when <= 2000 chars', async () => {
            await expect(updateDescription('L1', {description: 'ok'})).resolves.toBe('Description updated');
            expect(driverService.updateDriversListDescription).toHaveBeenCalledWith('L1', 'ok');
        });

        it('rejects when too long', async () => {
            const long = 'x'.repeat(2001);
            await expect(updateDescription('L1', {description: long})).rejects.toBeInstanceOf(APIError);
        });
    });

    it('reorderItems passes through and returns message', async () => {
        await expect(reorderItems('L1', [{itemId: 'i1', position: 3}])).resolves.toBe('Order saved');
        expect(driverService.reorderDriversItems).toHaveBeenCalledWith('L1', [{itemId: 'i1', position: 3}]);
    });

    describe('quickAddItem', () => {
        beforeEach(() => {
            (driverService.getLastDriversItemNumber as jest.Mock).mockResolvedValue(2);
        });

        it('creates item for logged-in user with next pos and numeric max', async () => {
            const session = {user: {id: 42}};
            await expect(
                quickAddItem({id: 'L1'} as any, {title: 'Hammer', description: 'Steel', max: '3'}, session as any)
            ).resolves.toBe('Item added');

            expect(driverService.createDriversItemUser).toHaveBeenCalledWith(
                'L1',
                42,
                expect.objectContaining({
                    id: 'uid-xyz',
                    title: 'Hammer',
                    description: 'Steel',
                    maxAssignees: 3,
                    pos: 3,
                })
            );
        });

        it('creates item for guest if no user', async () => {
            const session = {guest: {id: 9}};
            await quickAddItem({id: 'L1'} as any, {title: 'Nails', max: 0}, session as any);
            // max 0 -> default 1
            expect(driverService.createDriversItemGuest).toHaveBeenCalledWith(
                'L1',
                9,
                expect.objectContaining({maxAssignees: 1})
            );
        });

        it('rejects when not logged in', async () => {
            await expect(
                quickAddItem({id: 'L1'} as any, {title: 'Glue'}, {} as any)
            ).rejects.toBeInstanceOf(APIError);
        });

        it('rejects missing title', async () => {
            await expect(
                quickAddItem({id: 'L1'} as any, {title: ''}, {user: {id: 1}} as any)
            ).rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateItemDescription', () => {
        it('returns ok if update true', async () => {
            (driverService.updateDriversItem as jest.Mock).mockResolvedValue(true);
            await expect(updateItemDescription('it1', {description: 'd'})).resolves.toBe('Description updated');
            expect(driverService.updateDriversItem).toHaveBeenCalledWith('it1', {description: 'd'});
        });

        it('throws 500 if update false', async () => {
            (driverService.updateDriversItem as jest.Mock).mockResolvedValue(false);
            await expect(updateItemDescription('it1', {description: 'd'})).rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateItemAttr', () => {
        it('rejects invalid field', async () => {
            await expect(updateItemAttr('it1', {field: 'pos', value: 2})).rejects.toBeInstanceOf(APIError);
        });

        it('updates allowed field and returns ok', async () => {
            (driverService.updateDriversItem as jest.Mock).mockResolvedValue(true);
            await expect(updateItemAttr('it1', {field: 'title', value: 'New'})).resolves.toBe('Item updated');
            expect(driverService.updateDriversItem).toHaveBeenCalledWith('it1', {title: 'New'});
        });

        it('throws 500 when service returns false', async () => {
            (driverService.updateDriversItem as jest.Mock).mockResolvedValue(false);
            await expect(updateItemAttr('it1', {field: 'title', value: 'New'})).rejects.toBeInstanceOf(APIError);
        });
    });

    it('deleteAssignment delegates and returns message', async () => {
        await expect(deleteAssignment(77)).resolves.toBe('Assignment removed');
        expect(driverService.deleteDriversAssignment).toHaveBeenCalledWith(77);
    });

    it('updateSettings delegates and returns message', async () => {
        await expect(updateSettings('L1', {allowAdd: true, guestManage: false})).resolves.toBe('Settings saved');
        expect(driverService.updateDriversFlags).toHaveBeenCalledWith('L1', true, false);
    });

    it('deleteItem delegates and returns message', async () => {
        await expect(deleteItem('it9')).resolves.toBe('Item deleted');
        expect(driverService.deleteDriversItem).toHaveBeenCalledWith('it9');
    });
});

describe('getAssignmentAccessMapping', () => {
    it('routes to correct service functions with itemId', async () => {
        const m = getAssignmentAccessMapping();

        await m.assignToUser({itemId: 'i1'}, 5);
        await m.assignToGuest({itemId: 'i2'}, 7);
        await m.unassignFromUser({itemId: 'i3'}, 11);
        await m.unassignFromGuest({itemId: 'i4'}, 13);

        expect(driverService.assignDriversItemToUser).toHaveBeenCalledWith('i1', 5);
        expect(driverService.assignDriversItemToGuest).toHaveBeenCalledWith('i2', 7);
        expect(driverService.unassignDriversItemUser).toHaveBeenCalledWith('i3', 11);
        expect(driverService.unassignDriversItemGuest).toHaveBeenCalledWith('i4', 13);
    });
});
