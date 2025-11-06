/**
 * Controller unit tests (services mocked).
 * Focus: validation, orchestration, and error mapping — no DB involved.
 */

jest.mock('../../src/modules/database/services/ActivityService', () => ({
    createActivityPlanTx: jest.fn(),
    getActivitySlots: jest.fn(),
    getActivitySlotAssignmentsForUser: jest.fn(),
    getActivitySlotAssignmentsForGuest: jest.fn(),
    getActivitySlotAssignees: jest.fn(),
    getActivityPlanParticipants: jest.fn(),
    getActivitySlotRoles: jest.fn(),
    updateActivityPlanDescription: jest.fn(),
    reorderActivitySlots: jest.fn(),
    getLastActivitySlotNumber: jest.fn(),
    addActivitySlot: jest.fn(),
    updateActivitySlot: jest.fn(),
    deleteActivitySlotAssignment: jest.fn(),
    updateActivityPlanFlags: jest.fn(),
    deleteActivitySlot: jest.fn(),
    addActivitySlotRoles: jest.fn(),
    assignActivitySlotToUser: jest.fn(),
    assignActivitySlotToGuest: jest.fn(),
    unassignActivitySlotUser: jest.fn(),
    unassignActivitySlotGuest: jest.fn(),
    assignActivityAssignmentRoleToUser: jest.fn(),
    assignActivityAssignmentRoleToGuest: jest.fn(),
    unassignActivityAssignmentRoleFromUser: jest.fn(),
    unassignActivityAssignmentRoleFromGuest: jest.fn(),
    deleteActivityPlan: jest.fn(),
}));

jest.mock('../../src/modules/database/services/UserService', () => ({
    getAllRoles: jest.fn(),
}));

// Make IDs deterministic and date parsing stable
jest.mock('../../src/modules/lib/util', () => ({
    generateUniqueId: jest.fn(() => 'uid-123'),
    // Simple stable parser: treat date as local midnight
    fromISOtoLocal: (s: string) => new Date(`${s}T00:00:00`),
}));

import controller from '../../src/controller/activityController';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as userService from '../../src/modules/database/services/UserService';
import {APIError, ValidationError} from '../../src/modules/lib/errors';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    reorderSlots,
    quickAddSlot,
    updateSlotDescription,
    updateSlotAttr,
    deleteAssignment,
    updateSettings,
    deleteSlot,
    addSlotRole,

    getAssignmentAccessMapping,
    getRoleAccessMapping,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    const validSlot = {
        id: '11111111-1111-4111-8111-111111111111', // v4-ish
        day: '2024-01-02',
        pos: 1,
        title: 'Morning shift',
        description: '',
        maxAssignees: 2,
    };

    it('sanitizes valid payload, flattens slots, maps flags and description', () => {
        const body = {
            title: 'Event',
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            allowGuestAdd: 'on',
            guestManage: '',      // off
            description: '',      // becomes null
            slots: JSON.stringify({'2024-01-02': [validSlot]}),
        };

        const res = preprocessCreate(body);
        expect(res).toMatchObject({
            title: 'Event',
            description: null,
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            allowGuestAdd: true,
            guestManage: false,
        });
        expect(Array.isArray(res.slots)).toBe(true);
        expect(res.slots).toHaveLength(1);
        expect(res.slots[0]).toMatchObject({day: '2024-01-02', title: 'Morning shift'});
    });

    it('throws ValidationError on invalid slots JSON', () => {
        const body = {
            title: 'X',
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            description: '',
            slots: '{bad json',
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });

    it('throws ValidationError on schema problems (missing title)', () => {
        const body = {
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            description: '',
            slots: JSON.stringify({'2024-01-02': [validSlot]}),
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });

    it('throws ValidationError if slot day outside start/end range', () => {
        const body = {
            title: 'Event',
            startDate: '2024-01-10',
            endDate: '2024-01-12',
            description: '',
            slots: JSON.stringify({'2024-01-05': [{...validSlot, day: '2024-01-05'}]}),
        };
        expect(() => preprocessCreate(body)).toThrow(ValidationError);
    });
});

describe('createEntity / afterCreateItems', () => {
    it('passes fields to createActivityPlanTx and returns plan id', async () => {
        (activityService.createActivityPlanTx as jest.Mock).mockResolvedValue('plan-123');
        const planData = {
            title: 'T',
            description: 'D',
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            allowGuestAdd: true,
            guestManage: false,
            slots: [{id: 's1'}],
            _injectedEventId: 'evt-9',
        };
        const id = await createEntity(7, planData);
        expect(id).toBe('plan-123');
        expect(activityService.createActivityPlanTx).toHaveBeenCalledWith(
            7, 'T', 'D', '2024-01-01', '2024-01-03', true, false, [{id: 's1'}], 'evt-9'
        );
        await expect(afterCreateItems()).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const plan = {id: 'p1', startDate: '2024-01-01', endDate: '2024-01-31'};

    const slotsByDate = {
        '2024-01-10': [
            {id: 'a', assignedCount: 0, maxAssignees: 2, title: 'A'},
            {id: 'b', assignedCount: 1, maxAssignees: 1, title: 'B'},
        ],
    };

    beforeEach(() => {
        (activityService.getActivitySlots as jest.Mock).mockResolvedValue(slotsByDate);
        (activityService.getActivitySlotAssignees as jest.Mock).mockResolvedValue({a: [], b: []});
        (activityService.getActivityPlanParticipants as jest.Mock).mockResolvedValue([1, 2, 3]);
        (userService.getAllRoles as jest.Mock).mockResolvedValue(['role1']);
        (activityService.getActivitySlotRoles as jest.Mock).mockResolvedValue({a: [], b: []});
    });

    it('uses user-based assignments and computes counters', async () => {
        (activityService.getActivitySlotAssignmentsForUser as jest.Mock).mockResolvedValue(['a']);
        const session = {user: {id: 42}};
        const res = await fetchForView(plan as any, session as any);
        expect(res.assignments).toEqual(['a']);
        expect(res.counters).toEqual({participants: 3, open: 1, empty: 1}); // a empty+open, b full
    });

    it('uses guest-based assignments when no user', async () => {
        (activityService.getActivitySlotAssignmentsForGuest as jest.Mock).mockResolvedValue(['b']);
        const session = {guest: {id: 8}};
        const res = await fetchForView(plan as any, session as any);
        expect(res.assignments).toEqual(['b']);
    });

    it('falls back to empty assignments when no principal', async () => {
        const res = await fetchForView(plan as any, {} as any);
        expect(res.assignments).toEqual([]);
    });
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('fetchForDuplicate returns slot map', async () => {
        const map = {'2024-01-01': [{id: 'x'}]};
        (activityService.getActivitySlots as jest.Mock).mockResolvedValue(map);
        const out = await fetchForDuplicate({id: 'p1'} as any, {} as any);
        expect(out).toBe(map);
    });

    it('deleteEntity delegates to service', async () => {
        await deleteEntity({id: 'p9'} as any, {} as any);
        expect(activityService.deleteActivityPlan).toHaveBeenCalledWith('p9');
    });
});

describe('API helpers', () => {
    describe('updateDescription', () => {
        it('updates when <=2000 chars', async () => {
            await expect(updateDescription('p1', {description: 'ok'})).resolves.toBe('Description updated');
            expect(activityService.updateActivityPlanDescription).toHaveBeenCalledWith('p1', 'ok');
        });
        it('rejects when too long', async () => {
            const long = 'x'.repeat(2001);
            await expect(updateDescription('p1', {description: long})).rejects.toBeInstanceOf(APIError);
        });
    });

    it('reorderSlots passes through and returns message', async () => {
        await expect(reorderSlots('p1', [{slotId: 's1', pos: 2}])).resolves.toBe('Order saved');
        expect(activityService.reorderActivitySlots).toHaveBeenCalledWith('p1', [{slotId: 's1', pos: 2}]);
    });

    describe('quickAddSlot', () => {
        const plan = {id: 'p1', startDate: '2024-01-01', endDate: '2024-01-31'};

        it('creates slot with next pos and numeric maxAssignees', async () => {
            (activityService.getLastActivitySlotNumber as jest.Mock).mockResolvedValue(2);
            await expect(
                quickAddSlot(plan as any, {date: '2024-01-10', title: 'Foo', description: 'Bar', maxAssignees: '3'})
            ).resolves.toBe('Slot added');

            expect(activityService.addActivitySlot).toHaveBeenCalledWith('p1', {
                id: 'uid-123',
                day: '2024-01-10',
                title: 'Foo',
                description: 'Bar',
                maxAssignees: 3,
                pos: 3,
            });
        });

        it('defaults maxAssignees to 1 when falsy', async () => {
            (activityService.getLastActivitySlotNumber as jest.Mock).mockResolvedValue(0);
            await quickAddSlot(plan as any, {date: '2024-01-10', title: 'T', maxAssignees: 0});
            expect(activityService.addActivitySlot).toHaveBeenCalledWith('p1', expect.objectContaining({maxAssignees: 1}));
        });

        it('rejects missing title', async () => {
            await expect(quickAddSlot(plan as any, {date: '2024-01-10', title: ''}))
                .rejects.toBeInstanceOf(APIError);
        });

        it('rejects date outside range', async () => {
            await expect(quickAddSlot(plan as any, {date: '2023-12-31', title: 'X'}))
                .rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateSlotDescription', () => {
        it('returns ok if update true', async () => {
            (activityService.updateActivitySlot as jest.Mock).mockResolvedValue(true);
            await expect(updateSlotDescription('s1', {description: 'd'})).resolves.toBe('Description updated');
            expect(activityService.updateActivitySlot).toHaveBeenCalledWith('s1', {description: 'd'});
        });
        it('throws 500 if update false', async () => {
            (activityService.updateActivitySlot as jest.Mock).mockResolvedValue(false);
            await expect(updateSlotDescription('s1', {description: 'd'})).rejects.toBeInstanceOf(APIError);
        });
    });

    describe('updateSlotAttr', () => {
        it('rejects invalid field', async () => {
            await expect(updateSlotAttr('s1', {field: 'pos', value: 3})).rejects.toBeInstanceOf(APIError);
        });
        it('updates allowed field and returns ok', async () => {
            (activityService.updateActivitySlot as jest.Mock).mockResolvedValue(true);
            await expect(updateSlotAttr('s1', {field: 'title', value: 'N'})).resolves.toBe('Slot updated');
            expect(activityService.updateActivitySlot).toHaveBeenCalledWith('s1', {title: 'N'});
        });
        it('throws 500 when service returns false', async () => {
            (activityService.updateActivitySlot as jest.Mock).mockResolvedValue(false);
            await expect(updateSlotAttr('s1', {field: 'title', value: 'N'})).rejects.toBeInstanceOf(APIError);
        });
    });

    it('deleteAssignment delegates and returns message', async () => {
        await expect(deleteAssignment(99)).resolves.toBe('Assignment removed');
        expect(activityService.deleteActivitySlotAssignment).toHaveBeenCalledWith(99);
    });

    it('updateSettings delegates and returns message', async () => {
        await expect(updateSettings('p1', {allowAdd: true, guestManage: false})).resolves.toBe('Settings saved');
        expect(activityService.updateActivityPlanFlags).toHaveBeenCalledWith('p1', true, false);
    });

    it('deleteSlot delegates and returns message', async () => {
        await expect(deleteSlot('s1')).resolves.toBe('Slot deleted');
        expect(activityService.deleteActivitySlot).toHaveBeenCalledWith('s1');
    });

    describe('addSlotRole', () => {
        it('rejects invalid roles', async () => {
            await expect(addSlotRole('s1', {roles: []})).rejects.toBeInstanceOf(APIError);
            await expect(addSlotRole('s1', {roles: null})).rejects.toBeInstanceOf(APIError);
            await expect(addSlotRole('s1', {})).rejects.toBeInstanceOf(APIError);
        });
        it('adds roles when valid', async () => {
            await expect(addSlotRole('s1', {roles: [1, 2]})).resolves.toBe('Roles added');
            expect(activityService.addActivitySlotRoles).toHaveBeenCalledWith('s1', [1, 2]);
        });
    });
});

describe('access mappings', () => {
    it('getAssignmentAccessMapping routes to correct service funcs', async () => {
        const m = getAssignmentAccessMapping();
        await m.assignToUser({slotId: 's1'}, 7);
        await m.unassignFromGuest({slotId: 's2'}, 9);

        expect(activityService.assignActivitySlotToUser).toHaveBeenCalledWith('s1', 7);
        expect(activityService.unassignActivitySlotGuest).toHaveBeenCalledWith('s2', 9);
    });

    it('getRoleAccessMapping routes with role in body', async () => {
        const m = getRoleAccessMapping();
        await m.assignToUser({slotId: 's1', role: 3}, 7);

        expect(activityService.assignActivityAssignmentRoleToUser).toHaveBeenCalledWith('s1', 7, 3);
    });
});
