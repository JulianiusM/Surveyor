/**
 * Tests for eventService using the mysql (MariaDB/mysql2) DataSource mock.
 * Requires tests/db/mariadb-datasource.mock.ts and a reachable test DB.
 */

jest.mock('../../src/modules/database/dataSource', () =>
    require('../util/db/mariadb-datasource.mock')
);

import {
    createEventTx,
    deleteEvent,
    deleteRegistrationFor,
    getEventById,
    getEventParticipants,
    getEventsByOwnerId,
    getRegisteredEventsFor,
    getRegistrationFor,
    getRegistrationsForEvent,
    isEventFull,
    isRegisteredForEvent,
    registerGuest,
    registerUser,
    replaceDietaryChoices,
    updateEventDates,
    updateEventDescription,
    updateEventMeta,
    updateEventTitle,
} from '../../src/modules/database/services/EventService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities for setup/cleanup
import {Event} from '../../src/modules/database/entities/event/Event';
import {EventRegistration} from '../../src/modules/database/entities/event/EventRegistration';
import {EventRegistrationDietary} from '../../src/modules/database/entities/event/EventRegistrationDietary';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import type {DIETARY} from '../../src/types/EventTypes';

// Helper to clear relevant tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(EventRegistrationDietary).execute();
    await AppDataSource.createQueryBuilder().delete().from(EventRegistration).execute();
    await AppDataSource.createQueryBuilder().delete().from(Event).execute();
    await AppDataSource.createQueryBuilder().delete().from(User).execute();
    await AppDataSource.createQueryBuilder().delete().from(Guest).execute();

    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=1');
}

beforeAll(async () => {
    await initDataSource();
    if ('synchronize' in AppDataSource) {
        await (AppDataSource as any).synchronize(true);
    }
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

beforeEach(async () => {
    // Base owner for events
    const owner = AppDataSource.getRepository(User).create({
        id: 1,
        username: 'owner',
        name: 'Owner One',
        email: 'owner@example.com',
    });
    await AppDataSource.getRepository(User).save(owner);
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('eventService (mysql)', () => {
    it('creates, reads, updates, and deletes an Event', async () => {
        const binding = "2025-08-01T12:00:00.000Z";
        const eid = await createEventTx(
            1,
            'Camp',
            null,
            '2025-08-01',
            '2025-08-03',
            'Riverside Park',
            binding,
            true,
            10,
            'Europe/Berlin'
        );

        // Read by id
        const ev1 = await getEventById(eid);
        expect(ev1).toBeTruthy();
        expect(ev1!.ownerId).toBe(1);
        expect(ev1!.title).toBe('Camp');
        expect(ev1!.startDate).toBe('2025-08-01');
        expect(ev1!.endDate).toBe('2025-08-03');
        expect(ev1!.location).toBe('Riverside Park');
        expect(ev1!.bindingDeadline).toStrictEqual(new Date(binding));
        expect(ev1!.requireDietaryInfo).toBe(1);
        expect(ev1!.maxParticipants).toBe(10);
        expect(ev1!.timezone).toBe('Europe/Berlin');

        // Read by owner
        const owners = await getEventsByOwnerId(1);
        expect(owners.map(o => o.id)).toContain(eid);

        // Update title/description/meta/dates
        await updateEventTitle(eid, 'Camp 2025');
        await updateEventDescription(eid, 'Bring sunscreen');
        await updateEventMeta(eid, {
            location: 'Lakeview',
            bindingDeadline: '2025-07-20T18:30',
            requireDietaryInfo: false,
            maxParticipants: 25,
            timezone: 'UTC',
        });
        await updateEventDates(eid, '2025-08-02', '2025-08-04');

        const ev2 = await getEventById(eid);
        expect(ev2!.title).toBe('Camp 2025');
        expect(ev2!.description).toBe('Bring sunscreen');
        expect(ev2!.location).toBe('Lakeview');
        expect(ev2!.bindingDeadline).toStrictEqual(new Date('2025-07-20T18:30'));
        expect(ev2!.requireDietaryInfo).toBe(0);
        expect(ev2!.maxParticipants).toBe(25);
        expect(ev2!.timezone).toBe('UTC');
        expect(ev2!.startDate).toBe('2025-08-02');
        expect(ev2!.endDate).toBe('2025-08-04');

        // Delete
        await deleteEvent(eid);
        const gone = await getEventById(eid);
        expect(gone).toBeNull();
    });

    it('registers user & guest; updates registration; handles dietary choices; lists participants; deletes registration', async () => {
        // Principals
        const user2 = AppDataSource.getRepository(User).create({
            id: 2, username: 'u2', name: 'User Two', email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({
            id: 11, username: 'guestOne',
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        const eid = await createEventTx(
            1, 'Meetup', null, '2025-09-10', '2025-09-12', 'Hall A',
            null, true, 50, 'Europe/Berlin'
        );

        // Register user with duplicate dietary entries -> unique persisted
        const initialChoices = ['VEGAN', 'VEGAN', 'MEAT'] as DIETARY[];
        const uid = await registerUser(eid, 2, '2025-09-10', '2025-09-12', initialChoices, 'no peanuts');
        expect(typeof uid).toBe('number');

        let userReg = await getRegistrationFor({userId: 2}, eid);
        expect(userReg).toBeTruthy();
        expect(userReg!.dietaryChoices!.length).toBe(2);
        const userChoices = userReg!.dietaryChoices!.map(d => d.choice).sort();
        expect(userChoices).toEqual(['MEAT', 'VEGAN']);

        // Update user registration dates and replace dietary choices
        const updatedChoices = ['VEGETARIAN'] as DIETARY[];
        const uid2 = await registerUser(eid, 2, '2025-09-11', '2025-09-12', updatedChoices, 'loves veggies');
        expect(uid2).toBe(uid); // same registration id updated

        userReg = await getRegistrationFor({userId: 2}, eid);
        expect(userReg!.arrivalDate).toBe('2025-09-11');
        expect(userReg!.dietaryChoices!.length).toBe(1);
        expect(userReg!.dietaryChoices![0].choice).toBe('VEGETARIAN');

        // Register guest
        const gid = await registerGuest(eid, 11, '2025-09-10', '2025-09-12', ['HALAL'] as DIETARY[], null);
        expect(typeof gid).toBe('number');

        // All regs for event
        const regs = await getRegistrationsForEvent(eid);
        expect(regs).toHaveLength(2);

        // Participants projection with names & dietary
        const participants = await getEventParticipants(eid);
        const names = participants.map(p => p.name).sort();
        expect(names).toEqual(['User Two', 'guestOne']);
        const pUser = participants.find(p => p.userId === 2)!;
        expect((pUser.dietaryChoices ?? []).length).toBe(1);
        const pGuest = participants.find(p => p.guestId === 11)!;
        expect((pGuest.dietaryChoices ?? []).length).toBe(1);

        // Delete guest registration
        await deleteRegistrationFor(eid, {guestId: 11});
        const regsAfter = await getRegistrationsForEvent(eid);
        expect(regsAfter).toHaveLength(1);

        // Replace dietary choices directly clears when empty
        await replaceDietaryChoices(uid!, [] as unknown as DIETARY[], null);
        const cleared = await getRegistrationFor({userId: 2}, eid);
        expect(cleared!.dietaryChoices ?? []).toHaveLength(0);
    });

    it('getRegisteredEventsFor returns events for user/guest sorted by startDate DESC', async () => {
        // Principals
        const user2 = AppDataSource.getRepository(User).create({
            id: 2, username: 'u2', name: 'User Two', email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({id: 11, username: 'guestOne'});
        await AppDataSource.getRepository(Guest).save(guest1);

        // Events with differing start dates
        const e1 = await createEventTx(1, 'E1', null, '2025-12-01', '2025-12-03', null, null, false, null, null);
        const e2 = await createEventTx(1, 'E2', null, '2025-11-01', '2025-11-02', null, null, false, null, null);

        await registerUser(e1, 2, '2025-12-01', '2025-12-03', null, null);
        await registerUser(e2, 2, '2025-11-01', '2025-11-02', null, null);
        await registerGuest(e2, 11, '2025-11-01', '2025-11-02', null, null);

        const userEvents = await getRegisteredEventsFor({userId: 2});
        expect(userEvents.map(e => e.id)).toEqual([e1, e2]); // DESC by startDate

        const guestEvents = await getRegisteredEventsFor({guestId: 11});
        expect(guestEvents.map(e => e.id)).toEqual([e2]);

        const none = await getRegisteredEventsFor({});
        expect(none).toEqual([]);
    });

    it('isEventFull respects unlimited/null max, counts registrations, and throws for missing event', async () => {
        // Unlimited
        const eUnlimited = await createEventTx(1, 'Unlimited', null, '2025-10-01', '2025-10-02', null, null, true, null, null);
        expect(await isEventFull(eUnlimited)).toBe(false);

        // Limited = 1
        const eLimited = await createEventTx(1, 'Limited', null, '2025-10-10', '2025-10-12', null, null, true, 1, null);
        expect(await isEventFull(eLimited)).toBe(false);
        await AppDataSource.getRepository(User).save(
            AppDataSource.getRepository(User).create({
                id: 3,
                username: 'u3',
                name: 'User Three',
                email: 'u3@example.com'
            })
        );
        await registerUser(eLimited, 3, '2025-10-10', '2025-10-12', null, null);
        expect(await isEventFull(eLimited)).toBe(true);

        // Missing event -> throws
        await expect(isEventFull('no-such-event')).rejects.toThrow('Event not found');
    });

    it('isRegisteredForEvent returns correct booleans', async () => {
        const user2 = AppDataSource.getRepository(User).create({
            id: 2, username: 'u2', name: 'User Two', email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({id: 11, username: 'guestOne'});
        await AppDataSource.getRepository(Guest).save(guest1);

        const eid = await createEventTx(1, 'Check', null, '2025-09-20', '2025-09-21', null, null, false, null, null);

        expect(await isRegisteredForEvent({}, eid)).toBe(false);
        expect(await isRegisteredForEvent({userId: 2}, eid)).toBe(false);
        expect(await isRegisteredForEvent({guestId: 11}, eid)).toBe(false);

        await registerUser(eid, 2, '2025-09-20', '2025-09-21', null, null);
        expect(await isRegisteredForEvent({userId: 2}, eid)).toBe(true);

        await registerGuest(eid, 11, '2025-09-20', '2025-09-21', null, null);
        expect(await isRegisteredForEvent({guestId: 11}, eid)).toBe(true);
    });
});
