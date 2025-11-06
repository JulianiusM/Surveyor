/**
 * Controller unit tests (services + util mocked).
 */

jest.mock('../../src/modules/database/services/EventService', () => ({
    createEventTx: jest.fn(),
    getRegistrationFor: jest.fn(),
    getActivityPlansForEvent: jest.fn(),
    getPackingListsForEvent: jest.fn(),
    getDriverListsForEvent: jest.fn(),
    getRegistrationsForEvent: jest.fn(),
    deleteEvent: jest.fn(),
    isEventFull: jest.fn(),
    isRegisteredForEvent: jest.fn(),
    registerUser: jest.fn(),
    registerGuest: jest.fn(),
    deleteRegistrationFor: jest.fn(),
    updateEventMeta: jest.fn(),
    updateEventTitle: jest.fn(),
    updateEventDescription: jest.fn(),
    updateEventDates: jest.fn(),
}));

jest.mock('../../src/modules/lib/util', () => ({
    // Keep these deterministic for tests
    isWithinWindow: jest.fn(() => true),
    rewriteISOToZone: jest.fn((iso: string, tz: string) => `rewritten:${iso}:${tz}`),
}));

import controller from '../../src/controller/eventController';
import * as eventService from '../../src/modules/database/services/EventService';
import {APIError, ValidationError} from '../../src/modules/lib/errors';
import {isWithinWindow, rewriteISOToZone} from '../../src/modules/lib/util';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    registerAttendance,
    cancelRegistration,
    updateEventSettings,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    it('sanitizes and maps fields; rewrites deadline with tz; flags and numbers handled', () => {
        const body = {
            title: 'Retreat',
            description: '',
            startDate: '2025-05-01',
            endDate: '2025-05-03',
            location: '',
            bindingDeadline: '2025-04-30T18:00',
            requireDietaryInfo: 'on',
            maxParticipants: '', // becomes null
            deadlineTz: 'Europe/Berlin',
        };

        const out = preprocessCreate(body);

        expect(rewriteISOToZone).toHaveBeenCalledWith('2025-04-30T18:00', 'Europe/Berlin');
        expect(out).toMatchObject({
            title: 'Retreat',
            description: null,
            startDate: '2025-05-01',
            endDate: '2025-05-03',
            location: null,
            bindingDeadline: 'rewritten:2025-04-30T18:00:Europe/Berlin',
            requireDietaryInfo: true,
            maxParticipants: null,
            timezone: 'Europe/Berlin',
        });
    });

    it('accepts empty bindingDeadline and deadlineTz -> bindingDeadline null', () => {
        const out = preprocessCreate({
            title: 'E',
            startDate: '2025-01-01',
            endDate: '2025-01-02',
            description: '',
            location: '',
            bindingDeadline: '',
            deadlineTz: '',
        });
        expect(out.bindingDeadline).toBeNull();
        expect(out.timezone).toBeNull();
    });

    it('rejects schema errors', () => {
        expect(() =>
            preprocessCreate({
                title: '',
                startDate: 'bad',
                endDate: '2025-01-02',
                description: '',
            })
        ).toThrow(ValidationError);
    });

    it('rejects when startDate > endDate', () => {
        expect(() =>
            preprocessCreate({
                title: 'X',
                startDate: '2025-02-02',
                endDate: '2025-02-01',
                description: '',
            })
        ).toThrow(ValidationError);
    });
});

describe('createEntity / afterCreateItems / deleteEntity', () => {
    it('createEntity forwards fields to service', async () => {
        (eventService.createEventTx as jest.Mock).mockResolvedValue('ev-1');
        const data = {
            title: 'T',
            description: 'D',
            startDate: '2025-01-01',
            endDate: '2025-01-02',
            location: 'Loc',
            bindingDeadline: 'DL',
            requireDietaryInfo: true,
            maxParticipants: 20,
            timezone: 'UTC',
        };
        const id = await createEntity(9, data);
        expect(id).toBe('ev-1');
        expect(eventService.createEventTx).toHaveBeenCalledWith(
            9, 'T', 'D', '2025-01-01', '2025-01-02', 'Loc', 'DL', true, 20, 'UTC'
        );
        await expect(afterCreateItems()).resolves.toBeUndefined();
    });

    it('deleteEntity delegates to service', async () => {
        await deleteEntity({id: 'e1'} as any, {} as any);
        expect(eventService.deleteEvent).toHaveBeenCalledWith('e1');
    });
});

describe('fetchForView', () => {
    const baseEvent = (overrides: any = {}) => ({
        id: 'e1',
        ownerId: 1,
        title: 'T',
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        maxParticipants: 2,
        ...overrides,
    });

    beforeEach(() => {
        (eventService.getRegistrationsForEvent as jest.Mock).mockResolvedValue([{}, {}]); // 2 participants
    });

    it('anonymous: no scoped lists, registration null, computes isFull', async () => {
        const res = await fetchForView(baseEvent(), {} as any);
        expect(res.registration).toBeNull();
        expect(res.activityPlans).toEqual([]);
        expect(res.packingLists).toEqual([]);
        expect(res.driverLists).toEqual([]);
        expect(res.isFull).toBe(true);
        expect(eventService.getActivityPlansForEvent).not.toHaveBeenCalled();
    });

    it('owner sees scoped lists even without registration', async () => {
        (eventService.getActivityPlansForEvent as jest.Mock).mockResolvedValue(['ap']);
        (eventService.getPackingListsForEvent as jest.Mock).mockResolvedValue(['pl']);
        (eventService.getDriverListsForEvent as jest.Mock).mockResolvedValue(['dl']);

        const res = await fetchForView(baseEvent(), {user: {id: 1}} as any);
        expect(res.activityPlans).toEqual(['ap']);
        expect(res.packingLists).toEqual(['pl']);
        expect(res.driverLists).toEqual(['dl']);
    });

    it('registered user (non-owner) sees scoped lists', async () => {
        (eventService.getRegistrationFor as jest.Mock).mockResolvedValue({id: 'r1'});
        (eventService.getActivityPlansForEvent as jest.Mock).mockResolvedValue(['ap']);
        (eventService.getPackingListsForEvent as jest.Mock).mockResolvedValue(['pl']);
        (eventService.getDriverListsForEvent as jest.Mock).mockResolvedValue(['dl']);

        const res = await fetchForView(baseEvent({ownerId: 99}), {user: {id: 2}} as any);
        expect(eventService.getRegistrationFor).toHaveBeenCalledWith({userId: 2}, 'e1');
        expect(res.registration).toEqual({id: 'r1'});
        expect(res.activityPlans).toEqual(['ap']);
    });

    it('registered guest branch', async () => {
        (eventService.getRegistrationFor as jest.Mock).mockResolvedValue({id: 'rg'});
        const res = await fetchForView(baseEvent({ownerId: 99}), {guest: {id: 7}} as any);
        expect(eventService.getRegistrationFor).toHaveBeenCalledWith({guestId: 7}, 'e1');
        expect(res.registration).toEqual({id: 'rg'});
    });

    it('isFull false when maxParticipants undefined (treated as infinite)', async () => {
        (eventService.getRegistrationsForEvent as jest.Mock).mockResolvedValue([{}, {}, {}, {}]);
        const res = await fetchForView(baseEvent({maxParticipants: undefined}), {} as any);
        expect(res.isFull).toBe(false);
    });
});

describe('fetchForDuplicate', () => {
    it('returns the given event', async () => {
        const ev = {id: 'e9'};
        await expect(fetchForDuplicate(ev as any, {} as any)).resolves.toBe(ev);
    });
});

describe('registerAttendance', () => {
    const event = {
        id: 'e1',
        startDate: '2025-01-01',
        endDate: '2025-01-10',
    };

    it('registers user; trims allergy notes; dietary single value allowed', async () => {
        (eventService.isEventFull as jest.Mock).mockResolvedValue(false);
        (isWithinWindow as jest.Mock).mockReturnValue(true);

        await expect(
            registerAttendance(event as any, {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-05',
                dietary: 'VEGAN',
                allergyNotes: '  nuts  ',
            }, {user: {id: 5}} as any)
        ).resolves.toBe('Registration saved');

        expect(eventService.registerUser).toHaveBeenCalledWith(
            'e1', 5, '2025-01-02', '2025-01-05', ['VEGAN'], 'nuts'
        );
    });

    it('registers guest; dietary array, empty allergy -> null', async () => {
        (eventService.isEventFull as jest.Mock).mockResolvedValue(false);
        (isWithinWindow as jest.Mock).mockReturnValue(true);

        await registerAttendance(event as any, {
            arrivalDate: '2025-01-03',
            departureDate: '2025-01-04',
            dietary: ['FISH', 'VEGETARIAN'],
            allergyNotes: '',
        }, {guest: {id: 9}} as any);

        expect(eventService.registerGuest).toHaveBeenCalledWith(
            'e1', 9, '2025-01-03', '2025-01-04', ['FISH', 'VEGETARIAN'], null
        );
    });

    it('blocks when event is full and user not already registered', async () => {
        (eventService.isEventFull as jest.Mock).mockResolvedValue(true);
        (eventService.isRegisteredForEvent as jest.Mock).mockResolvedValue(false);

        await expect(
            registerAttendance(event as any, {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-03',
            }, {user: {id: 1}} as any)
        ).rejects.toBeInstanceOf(APIError);
    });

    it('allows update if full but already registered', async () => {
        (eventService.isEventFull as jest.Mock).mockResolvedValue(true);
        (eventService.isRegisteredForEvent as jest.Mock).mockResolvedValue(true);
        (isWithinWindow as jest.Mock).mockReturnValue(true);

        await registerAttendance(event as any, {
            arrivalDate: '2025-01-02',
            departureDate: '2025-01-03',
        }, {user: {id: 1}} as any);

        expect(eventService.registerUser).toHaveBeenCalled();
    });

    it('rejects invalid schema (missing arrivalDate)', async () => {
        await expect(
            registerAttendance(event as any, {departureDate: '2025-01-02'}, {user: {id: 1}} as any)
        ).rejects.toBeInstanceOf(APIError);
    });

    it('rejects when dates outside event window', async () => {
        (eventService.isEventFull as jest.Mock).mockResolvedValue(false);
        (isWithinWindow as jest.Mock).mockReturnValue(false);

        await expect(
            registerAttendance(event as any, {
                arrivalDate: '2024-12-31',
                departureDate: '2025-01-15',
            }, {user: {id: 1}} as any)
        ).rejects.toBeInstanceOf(APIError);
    });

    it('rejects when unauthenticated', async () => {
        await expect(
            registerAttendance(event as any, {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-03',
            }, {} as any)
        ).rejects.toBeInstanceOf(APIError);
    });
});

describe('cancelRegistration', () => {
    it('cancels for user', async () => {
        await expect(cancelRegistration('e1', {user: {id: 5}} as any)).resolves.toBe('Registration cancelled');
        expect(eventService.deleteRegistrationFor).toHaveBeenCalledWith('e1', {userId: 5});
    });

    it('cancels for guest', async () => {
        await cancelRegistration('e1', {guest: {id: 7}} as any);
        expect(eventService.deleteRegistrationFor).toHaveBeenCalledWith('e1', {guestId: 7});
    });

    it('rejects when unauthenticated', async () => {
        await expect(cancelRegistration('e1', {} as any)).rejects.toBeInstanceOf(APIError);
    });
});

describe('updateEventSettings', () => {
    const ev = {
        id: 'e1',
        title: 'CurrentTitle',
        description: 'CurrentDesc',
        startDate: '2025-01-01',
        endDate: '2025-01-10',
    };

    it('validates, performs meta update, updates title/description/dates; rewrites deadline', async () => {
        const body = {
            title: 'New Title',
            description: '',
            startDate: '',        // unchanged
            endDate: '2025-01-12',
            location: '',
            bindingDeadline: '2024-12-31T23:00',
            requireDietaryInfo: 'on',
            maxParticipants: '',  // -> null
            deadlineTz: 'UTC',
        };

        const msg = await updateEventSettings(ev as any, body);
        expect(msg).toBe('Event updated');

        expect(rewriteISOToZone).toHaveBeenCalledWith('2024-12-31T23:00', 'UTC');
        expect(eventService.updateEventMeta).toHaveBeenCalledWith('e1', {
            location: null,
            bindingDeadline: 'rewritten:2024-12-31T23:00:UTC',
            requireDietaryInfo: true,
            maxParticipants: null,
            timezone: 'UTC',
        });

        // title provided (even empty string is "provided")
        expect(eventService.updateEventTitle).toHaveBeenCalledWith('e1', 'New Title');
        // description provided as '', becomes null
        expect(eventService.updateEventDescription).toHaveBeenCalledWith('e1', null);

        // dates: start falls back to current start (''), end provided
        expect(eventService.updateEventDates).toHaveBeenCalledWith('e1', '2025-01-01', '2025-01-12');
    });

    it('does not call title/desc updates when fields not provided', async () => {
        await updateEventSettings(ev as any, {bindingDeadline: ''});
        expect(eventService.updateEventTitle).not.toHaveBeenCalled();
        expect(eventService.updateEventDescription).not.toHaveBeenCalled();
    });

    it('on empty title string, falls back to existing title', async () => {
        await updateEventSettings(ev as any, {title: ''});
        expect(eventService.updateEventTitle).toHaveBeenCalledWith('e1', 'CurrentTitle');
    });

    it('rejects when start > end after merge', async () => {
        await expect(
            updateEventSettings(ev as any, {startDate: '2025-02-01', endDate: '2025-01-01'})
        ).rejects.toBeInstanceOf(APIError);
    });

    it('rejects schema errors', async () => {
        await expect(
            updateEventSettings(ev as any, {startDate: 'bad-date'})
        ).rejects.toBeInstanceOf(APIError);
    });
});
