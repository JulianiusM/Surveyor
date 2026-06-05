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
    updateRegistrationDates,
} from '../../src/modules/database/services/EventService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities for setup/cleanup
import {Event} from '../../src/modules/database/entities/event/Event';
import {EventRegistration} from '../../src/modules/database/entities/event/EventRegistration';
import {EventRegistrationDietary} from '../../src/modules/database/entities/event/EventRegistrationDietary';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import type {DIETARY} from '../../src/types/EventTypes';

// Test data
import {
    eventCrudData,
    eventRegistrationData,
    registeredEventsData,
    eventFullData,
    eventRegistrationCheckData,
    updateRegistrationDatesData,
} from '../data/database/eventServiceData';

function toGuestId(id: string | number) {
    const raw = String(id);
    if (raw.includes('-')) return raw;
    return `00000000-0000-4000-8000-${raw.padStart(12, '0')}`;
}

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
    test.each(eventCrudData)('$description', async (testCase) => {
        const binding = testCase.initialData.bindingDeadline;
        const eid = await createEventTx(
            testCase.ownerId,
            testCase.initialData.title,
            testCase.initialData.description,
            testCase.initialData.startDate,
            testCase.initialData.endDate,
            testCase.initialData.location,
            binding,
            testCase.initialData.requireDietaryInfo,
            testCase.initialData.maxParticipants,
            testCase.initialData.timezone
        );

        // Read by id
        const ev1 = await getEventById(eid);
        expect(ev1).toBeTruthy();
        expect(ev1!.ownerId).toBe(testCase.expectedInitial.ownerId);
        expect(ev1!.title).toBe(testCase.expectedInitial.title);
        expect(ev1!.startDate).toBe(testCase.expectedInitial.startDate);
        expect(ev1!.endDate).toBe(testCase.expectedInitial.endDate);
        expect(ev1!.location).toBe(testCase.expectedInitial.location);
        expect(ev1!.bindingDeadline).toStrictEqual(new Date(binding!));
        expect(ev1!.requireDietaryInfo).toBe(testCase.expectedInitial.requireDietaryInfo);
        expect(ev1!.maxParticipants).toBe(testCase.expectedInitial.maxParticipants);
        expect(ev1!.timezone).toBe(testCase.expectedInitial.timezone);

        // Read by owner
        const owners = await getEventsByOwnerId(testCase.ownerId);
        expect(owners.map(o => o.id)).toContain(eid);

        // Update title/description/meta/dates
        await updateEventTitle(eid, testCase.updates.title);
        await updateEventDescription(eid, testCase.updates.description);
        await updateEventMeta(eid, testCase.updates.meta);
        await updateEventDates(eid, testCase.updates.dates.startDate, testCase.updates.dates.endDate);

        const ev2 = await getEventById(eid);
        expect(ev2!.title).toBe(testCase.expectedAfterUpdates.title);
        expect(ev2!.description).toBe(testCase.expectedAfterUpdates.description);
        expect(ev2!.location).toBe(testCase.expectedAfterUpdates.location);
        expect(ev2!.bindingDeadline).toStrictEqual(new Date(testCase.expectedAfterUpdates.bindingDeadline));
        expect(ev2!.requireDietaryInfo).toBe(testCase.expectedAfterUpdates.requireDietaryInfo);
        expect(ev2!.maxParticipants).toBe(testCase.expectedAfterUpdates.maxParticipants);
        expect(ev2!.timezone).toBe(testCase.expectedAfterUpdates.timezone);
        expect(ev2!.startDate).toBe(testCase.expectedAfterUpdates.startDate);
        expect(ev2!.endDate).toBe(testCase.expectedAfterUpdates.endDate);

        // Delete
        await deleteEvent(eid);
        const gone = await getEventById(eid);
        expect(gone).toBeNull();
    });

    test.each(eventRegistrationData)('$description', async (testCase) => {
        // Principals
        const user2 = AppDataSource.getRepository(User).create(testCase.principals.user);
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({
            ...testCase.principals.guest,
            id: toGuestId(testCase.principals.guest.id),
            token: `tok-${testCase.principals.guest.id}`,
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        const eid = await createEventTx(
            testCase.eventData.ownerId,
            testCase.eventData.title,
            testCase.eventData.description,
            testCase.eventData.startDate,
            testCase.eventData.endDate,
            testCase.eventData.location,
            testCase.eventData.bindingDeadline,
            testCase.eventData.requireDietaryInfo,
            testCase.eventData.maxParticipants,
            testCase.eventData.timezone
        );

        // Register user with duplicate dietary entries -> unique persisted
        const uid = await registerUser(
            eid,
            testCase.userRegistration.userId,
            testCase.userRegistration.arrivalDate,
            testCase.userRegistration.departureDate,
            testCase.userRegistration.initialChoices,
            testCase.userRegistration.note
        );
        expect(typeof uid).toBe('number');

        let userReg = await getRegistrationFor({userId: testCase.userRegistration.userId}, eid);
        expect(userReg).toBeTruthy();
        expect(userReg!.dietaryChoices!.length).toBe(testCase.expected.initialDietaryCount);
        const userChoices = userReg!.dietaryChoices!.map(d => d.choice).sort();
        expect(userChoices).toEqual(testCase.expected.initialChoices);

        // Update user registration dates and replace dietary choices
        const uid2 = await registerUser(
            eid,
            testCase.userRegistration.userId,
            testCase.userRegistration.updatedArrivalDate,
            testCase.userRegistration.updatedDepartureDate,
            testCase.userRegistration.updatedChoices,
            testCase.userRegistration.updatedNote
        );
        expect(uid2).toBe(uid); // same registration id updated

        userReg = await getRegistrationFor({userId: testCase.userRegistration.userId}, eid);
        expect(userReg!.arrivalDate).toBe(testCase.expected.updatedArrivalDate);
        expect(userReg!.dietaryChoices!.length).toBe(testCase.expected.updatedDietaryCount);
        expect(userReg!.dietaryChoices![0].choice).toBe(testCase.expected.updatedChoice);

        // Register guest
        const gid = await registerGuest(
            eid,
            toGuestId(testCase.guestRegistration.guestId),
            testCase.guestRegistration.arrivalDate,
            testCase.guestRegistration.departureDate,
            testCase.guestRegistration.dietaryChoices,
            testCase.guestRegistration.note
        );
        expect(typeof gid).toBe('number');

        // All regs for event
        const regs = await getRegistrationsForEvent(eid);
        expect(regs).toHaveLength(testCase.expected.totalRegistrations);

        // Participants projection with names & dietary
        const participants = await getEventParticipants(eid);
        const names = participants.map(p => p.name).sort();
        expect(names).toEqual(testCase.expected.participantNames);
        const pUser = participants.find(p => p.userId === testCase.userRegistration.userId)!;
        expect((pUser.dietaryChoices ?? []).length).toBe(testCase.expected.userDietaryCount);
        const pGuest = participants.find(p => p.guestId === toGuestId(testCase.guestRegistration.guestId))!;
        expect((pGuest.dietaryChoices ?? []).length).toBe(testCase.expected.guestDietaryCount);

        // Delete guest registration
        await deleteRegistrationFor(eid, {guestId: toGuestId(testCase.guestRegistration.guestId)});
        const regsAfter = await getRegistrationsForEvent(eid);
        expect(regsAfter).toHaveLength(testCase.expected.afterDeleteCount);

        // Replace dietary choices directly clears when empty
        await replaceDietaryChoices(uid!, testCase.clearDietary.choices, testCase.clearDietary.note);
        const cleared = await getRegistrationFor({userId: testCase.userRegistration.userId}, eid);
        expect(cleared!.dietaryChoices ?? []).toHaveLength(testCase.expected.clearedDietaryCount);
    });

    test.each(registeredEventsData)('$description', async (testCase) => {
        // Principals
        const user2 = AppDataSource.getRepository(User).create(testCase.principals.user);
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({
            ...testCase.principals.guest,
            id: toGuestId(testCase.principals.guest.id),
            token: `tok-${testCase.principals.guest.id}`,
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        // Events with differing start dates
        const e1 = await createEventTx(
            testCase.event1.ownerId,
            testCase.event1.title,
            testCase.event1.description,
            testCase.event1.startDate,
            testCase.event1.endDate,
            testCase.event1.location,
            testCase.event1.bindingDeadline,
            testCase.event1.requireDietaryInfo,
            testCase.event1.maxParticipants,
            testCase.event1.timezone
        );
        const e2 = await createEventTx(
            testCase.event2.ownerId,
            testCase.event2.title,
            testCase.event2.description,
            testCase.event2.startDate,
            testCase.event2.endDate,
            testCase.event2.location,
            testCase.event2.bindingDeadline,
            testCase.event2.requireDietaryInfo,
            testCase.event2.maxParticipants,
            testCase.event2.timezone
        );

        await registerUser(e1, testCase.registrations.user.event1.userId, testCase.registrations.user.event1.arrivalDate, testCase.registrations.user.event1.departureDate, null, null);
        await registerUser(e2, testCase.registrations.user.event2.userId, testCase.registrations.user.event2.arrivalDate, testCase.registrations.user.event2.departureDate, null, null);
        await registerGuest(e2, toGuestId(testCase.registrations.guest.event2.guestId), testCase.registrations.guest.event2.arrivalDate, testCase.registrations.guest.event2.departureDate, null, null);

        const userEvents = await getRegisteredEventsFor({userId: testCase.queries.user.userId});
        expect(userEvents.map(e => e.id)).toEqual(testCase.expected.userEventIds(e1, e2)); // DESC by startDate

        const guestEvents = await getRegisteredEventsFor({guestId: toGuestId(testCase.queries.guest.guestId)});
        expect(guestEvents.map(e => e.id)).toEqual(testCase.expected.guestEventIds(e2));

        const none = await getRegisteredEventsFor({});
        expect(none).toEqual(testCase.expected.noQueryResult);
    });

    test.each(eventFullData)('$description', async (testCase) => {
        if (testCase.type === 'unlimited') {
            // Unlimited
            const eUnlimited = await createEventTx(
                testCase.event.ownerId,
                testCase.event.title,
                testCase.event.description,
                testCase.event.startDate,
                testCase.event.endDate,
                testCase.event.location,
                testCase.event.bindingDeadline,
                testCase.event.requireDietaryInfo,
                testCase.event.maxParticipants,
                testCase.event.timezone
            );
            expect(await isEventFull(eUnlimited)).toBe(testCase.expected.isFull);
        } else if (testCase.type === 'limited') {
            // Limited = 1
            const eLimited = await createEventTx(
                testCase.event.ownerId,
                testCase.event.title,
                testCase.event.description,
                testCase.event.startDate,
                testCase.event.endDate,
                testCase.event.location,
                testCase.event.bindingDeadline,
                testCase.event.requireDietaryInfo,
                testCase.event.maxParticipants,
                testCase.event.timezone
            );
            expect(await isEventFull(eLimited)).toBe(testCase.expected.initialFull);
            
            await AppDataSource.getRepository(User).save(
                AppDataSource.getRepository(User).create(testCase.user)
            );
            await registerUser(eLimited, testCase.registration.userId, testCase.registration.arrivalDate, testCase.registration.departureDate, null, null);
            expect(await isEventFull(eLimited)).toBe(testCase.expected.afterRegistration);
        } else if (testCase.type === 'missing') {
            // Missing event -> throws
            await expect(isEventFull(testCase.eventId)).rejects.toThrow(testCase.expected.error);
        }
    });

    test.each(eventRegistrationCheckData)('$description', async (testCase) => {
        // Ensure clean state before this test
        await truncateAll();
        
        // Recreate owner from beforeEach
        const owner = AppDataSource.getRepository(User).create({
            id: 1,
            username: 'owner',
            name: 'Owner One',
            email: 'owner@example.com',
        });
        await AppDataSource.getRepository(User).save(owner);
        
        const user2 = AppDataSource.getRepository(User).create(testCase.principals.user);
        await AppDataSource.getRepository(User).save(user2);
        const guest1 = AppDataSource.getRepository(Guest).create({
            ...testCase.principals.guest,
            id: toGuestId(testCase.principals.guest.id),
            token: `tok-${testCase.principals.guest.id}`,
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        const eid = await createEventTx(
            testCase.event.ownerId,
            testCase.event.title,
            testCase.event.description,
            testCase.event.startDate,
            testCase.event.endDate,
            testCase.event.location,
            testCase.event.bindingDeadline,
            testCase.event.requireDietaryInfo,
            testCase.event.maxParticipants,
            testCase.event.timezone
        );

        expect(await isRegisteredForEvent({}, eid)).toBe(testCase.expected.emptyQuery);
        expect(await isRegisteredForEvent({userId: testCase.principals.user.id}, eid)).toBe(testCase.expected.userBeforeRegistration);
        expect(await isRegisteredForEvent({guestId: toGuestId(testCase.principals.guest.id)}, eid)).toBe(testCase.expected.guestBeforeRegistration);

        await registerUser(eid, testCase.registrations.user.userId, testCase.registrations.user.arrivalDate, testCase.registrations.user.departureDate, null, null);
        expect(await isRegisteredForEvent({userId: testCase.principals.user.id}, eid)).toBe(testCase.expected.userAfterRegistration);

        await registerGuest(eid, toGuestId(testCase.registrations.guest.guestId), testCase.registrations.guest.arrivalDate, testCase.registrations.guest.departureDate, null, null);
        expect(await isRegisteredForEvent({guestId: toGuestId(testCase.principals.guest.id)}, eid)).toBe(testCase.expected.guestAfterRegistration);
    });

    test.each(updateRegistrationDatesData)('$description', async (testCase) => {
        if (testCase.expected.error) {
            // Test error case - non-existent registration
            const eid = await createEventTx(
                testCase.event.ownerId,
                testCase.event.title,
                testCase.event.description,
                testCase.event.startDate,
                testCase.event.endDate,
                testCase.event.location,
                testCase.event.bindingDeadline,
                testCase.event.requireDietaryInfo,
                testCase.event.maxParticipants,
                testCase.event.timezone
            );
            await expect(updateRegistrationDates(eid, testCase.update.nonExistentRegId, testCase.update.arrivalDate, testCase.update.departureDate))
                .rejects.toThrow(testCase.expected.error);
        } else {
            // Test successful update
            const user = AppDataSource.getRepository(User).create(testCase.user);
            await AppDataSource.getRepository(User).save(user);

            const eid = await createEventTx(
                testCase.event.ownerId,
                testCase.event.title,
                testCase.event.description,
                testCase.event.startDate,
                testCase.event.endDate,
                testCase.event.location,
                testCase.event.bindingDeadline,
                testCase.event.requireDietaryInfo,
                testCase.event.maxParticipants,
                testCase.event.timezone
            );

            const regId = await registerUser(
                eid,
                testCase.initialRegistration.userId,
                testCase.initialRegistration.arrivalDate,
                testCase.initialRegistration.departureDate,
                null,
                null
            );

            await updateRegistrationDates(eid, regId, testCase.update.arrivalDate, testCase.update.departureDate);

            const updated = await getRegistrationFor({userId: testCase.user.id}, eid);
            expect(updated?.arrivalDate).toBe(testCase.expected.arrivalDate);
            expect(updated?.departureDate).toBe(testCase.expected.departureDate);
        }
    });
});
