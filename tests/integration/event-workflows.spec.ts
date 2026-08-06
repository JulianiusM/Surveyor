import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import eventPoolController from '../../src/controller/eventPoolController';
import * as helpController from '../../src/controller/helpController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {PERM} from '../../src/modules/lib/permissions';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
} from '../factories/integrationEntityFactory';
import {
    assignActivitySlot,
    assignDriversItem,
    assignPackingItem,
    createActivityPlanWithSlot,
    createDriversListWithItem,
    createIntegrationEvent,
    createPackingListWithItem,
    createSurveyWithCombinations,
    persistIntegrationProfile,
    registerEventAttendance,
    registerLocalAccount,
    submitSurveyResponses,
    unassignDriversItem,
    unassignPackingItem,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let secondParticipant: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
    secondParticipant = await persistIntegrationProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('event user stories', () => {
    it('creates an event with all registration-facing metadata', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        expect(await eventService.getEventById(eventId)).toMatchObject({location: 'Lakeside', timezone: 'UTC', maxParticipants: 20});
    });

    it('updates the title and description shown to participants', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await eventService.updateEventTitle(eventId, 'Participant title');
        await eventService.updateEventDescription(eventId, 'Participant description');
        expect(await eventService.getEventById(eventId)).toMatchObject({title: 'Participant title', description: 'Participant description'});
    });

    it('updates dates, capacity, dietary options, and location together', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await eventService.updateEventDates(eventId, '2027-07-01', '2027-07-05');
        await eventService.updateEventMeta(eventId, {location: 'Mountain', maxParticipants: 12, requireDietaryInfo: false, allowDietComment: false});
        expect(await eventService.getEventById(eventId)).toMatchObject({startDate: '2027-07-01', endDate: '2027-07-05', location: 'Mountain', maxParticipants: 12});
    });

    it('registers a participant for an event', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        expect(await eventService.getRegistrationFor(participant.id, eventId)).toMatchObject({arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    });

    it('updates an existing registration instead of duplicating it', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-02'});
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-02', departureDate: '2027-06-03'});
        expect(await eventService.getRegistrationsForEvent(eventId)).toHaveLength(1);
    });

    it('stores unique dietary choices and participant notes', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {
            arrivalDate: '2027-06-01', departureDate: '2027-06-03',
            dietary: ['VEGETARIAN', 'VEGETARIAN', 'ALLERGIES'], allergyNotes: 'Peanuts',
        });
        const registration = await eventService.getRegistrationFor(participant.id, eventId);
        expect(registration?.dietaryChoices).toHaveLength(2);
        expect(registration?.dietaryChoices).toContainEqual(expect.objectContaining({choice: 'ALLERGIES', additionalInfo: 'Peanuts'}));
    });

    it('replaces dietary choices on an existing registration', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: 'VEGETARIAN'});
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: 'VEGAN'});
        expect((await eventService.getRegistrationFor(participant.id, eventId))?.dietaryChoices).toMatchObject([{choice: 'VEGAN'}]);
    });

    it('lists registered events in newest-first order', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        const laterId = await eventService.createEventTx(owner.id, 'Later event', null, '2027-08-01', '2027-08-03', null, null, false, false, null, 'UTC');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(laterId, participant, {arrivalDate: '2027-08-01', departureDate: '2027-08-03'});
        const registered = await eventService.getRegisteredEventsFor(participant.id);
        expect(registered.findIndex((event) => event.id === laterId)).toBeLessThan(registered.findIndex((event) => event.id === eventId));
    });

    it('reports unlimited events as available', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Unlimited event', null);

        expect(await eventService.isEventFull(eventId)).toBe(false);
    });

    it('reports an event full when capacity is reached', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 1);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        expect(await eventService.isEventFull(eventId)).toBe(true);
    });

    it('treats an event owner as registered for access purposes', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        expect(await eventService.isRegisteredForEvent(owner.id, eventId)).toBe(true);
    });

    it('updates registration dates within the correct event', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-02'});
        const registration = await eventService.getRegistrationFor(participant.id, eventId);
        const event = await eventService.getEventById(eventId);
        await eventController.updateRegistrationDates(event!, String(registration!.id), {arrivalDate: '2027-06-02', departureDate: '2027-06-03'});
        expect(await eventService.getRegistrationFor(participant.id, eventId)).toMatchObject({arrivalDate: '2027-06-02', departureDate: '2027-06-03'});
    });

    it('deletes a participant registration within the correct event', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const registration = await eventService.getRegistrationFor(participant.id, eventId);
        const event = await eventService.getEventById(eventId);
        expect(await eventController.deleteRegistration(event!, String(registration!.id))).toBe(true);
        expect(await eventService.getRegistrationFor(participant.id, eventId)).toBeNull();
    });

    it('creates, validates, consumes, and reports a bypass link', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        const link = await eventService.createDeadlineBypassLink(eventId, owner.user.id, {maxUses: 1});
        expect(await eventService.canBypassDeadlineWithToken(eventId, link.token)).toEqual({ok: true, linkId: link.id});
        expect(await eventService.consumeDeadlineBypassToken(link.id, participant.id)).toBe(true);
        expect((await eventService.listDeadlineBypassLinks(eventId))[0]).toMatchObject({id: link.id, status: 'consumed'});
    });

    it('loads event-linked activity, packing, and drivers modules', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Workflow event', 20);

        const activityId = await activityService.createActivityPlanTx(owner.id, 'Event activity', 'Shared', '2027-06-01', '2027-06-03', [], eventId);
        const packingId = await packingService.createPackingListTx(owner.id, 'Event packing', 'Shared', [], eventId);
        const driversId = await driverService.createDriversList(owner.id, 'Event drivers', 'Shared', eventId);
        expect((await eventService.getActivityPlansForEvent(eventId)).map((plan) => plan.id)).toContain(activityId);
        expect((await eventService.getPackingListsForEvent(eventId)).map((list) => list.id)).toContain(packingId);
        expect((await eventService.getDriverListsForEvent(eventId)).map((list) => list.id)).toContain(driversId);
    });

});
