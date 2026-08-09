import {Request} from 'express';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import eventController from '../../src/controller/eventController';
import eventPoolController from '../../src/controller/eventPoolController';
import * as helpController from '../../src/controller/helpController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
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

describe('remaining high-value controller workflows', () => {
    it('builds an owner dashboard across all collaborative modules', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Dashboard event');
        const planId = await createActivityPlanWithSlot(owner.id);
        const [driversId] = await createDriversListWithItem(owner.id);
        const [packingId] = await createPackingListWithItem(owner.id);
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        const dashboard = await userController.getDashboardEntities(owner);

        expect(dashboard.owner?.events?.map((event) => event.id)).toContain(eventId);
        expect(dashboard.owner?.activityPlans?.map((plan) => plan.id)).toContain(planId);
        expect(dashboard.owner?.driversLists?.map((list) => list.id)).toContain(driversId);
        expect(dashboard.owner?.packingLists?.map((list) => list.id)).toContain(packingId);
        expect(dashboard.owner?.surveys?.map((survey) => survey.id)).toContain(surveyId);
    });

    it('builds a participant dashboard from controller-driven assignments', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant dashboard event');
        const planId = await createActivityPlanWithSlot(owner.id);
        const [driversId] = await createDriversListWithItem(owner.id);
        const [packingId, packingItem] = await createPackingListWithItem(owner.id);
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await assignActivitySlot((await activityService.getActivitySlotsFlat(planId))[0].id, participant.id);
        const driversList = await driverService.getDriversListById(driversId);
        await driversController.quickAddItem(driversList!, {title: 'Participant journey'}, {profile: participant} as never);
        const participantJourney = (await driverService.getDriversItems(driversId)).find((item) => item.title === 'Participant journey')!;
        await assignDriversItem(participantJourney.id, participant.id);
        await assignPackingItem(packingItem.id, participant.id);
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});

        const dashboard = await userController.getDashboardEntities(participant);

        expect(dashboard.participant?.events?.map((event) => event.id)).toContain(eventId);
        expect(dashboard.participant?.activityPlans?.map((plan) => plan.id)).toContain(planId);
        expect(dashboard.participant?.driversLists?.map((list) => list.id)).toContain(driversId);
        expect(dashboard.participant?.packingLists?.map((list) => list.id)).toContain(packingId);
        expect(dashboard.participant?.surveys?.map((survey) => survey.id)).toContain(surveyId);
    });

    it('logs a guest into a persisted controller session', async () => {
        const guest = await userService.createGuest('Controller Guest', 'controller-guest@example.com');
        const session = {save: (done: (error?: Error) => void) => done()} as Request['session'];

        await userController.loginGuest(guest.id, guest.token, session);

        expect(session.profile?.id).toBe(guest.profile.id);
        expect(session.auth?.guest?.id).toBe(guest.id);
    });

    it('returns an activity view model with assignments and capacity counters', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const plan = await activityService.getActivityPlanById(planId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);

        const view = await activityController.fetchForView(plan!, {session: {profile: participant}} as Request);

        expect(view.assignments).toContain(slot.id);
        expect(view.counters).toMatchObject({participants: 1, empty: 0});
    });

    it('exports a complete activity schedule through the controller', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const plan = await activityService.getActivityPlanById(planId);

        const schedule = await activityController.getScheduleExport(plan!);

        expect(schedule.days).toHaveLength(3);
        expect(schedule.counters.slots).toBe(1);
        expect(schedule.weeks.length).toBeGreaterThan(0);
    });

    it('returns driver coordination counters and the current volunteer assignment', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);
        const list = await driverService.getDriversListById(listId);
        await assignDriversItem(item.id, participant.id);

        const view = await driversController.fetchForView(list!, {session: {profile: participant}} as Request);

        expect(view.assignments).toContain(item.id);
        expect(view.counters).toMatchObject({participants: 1, empty: 0});
    });

    it('returns packing counters and the current participant assignment', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);
        const list = await packingService.getPackingListById(listId);
        await assignPackingItem(item.id, participant.id);

        const view = await packingController.fetchForView(list!, {session: {profile: participant}} as Request);

        expect(view.assignments).toContain(item.id);
        expect(view.counters).toMatchObject({participants: 1, empty: 0});
    });

    it('returns survey choices and grouped participant responses', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);
        const survey = await surveyService.getSurveyById(surveyId);
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});

        const view = await surveyController.fetchForView(survey!, {} as Request);

        expect(view.combinations).toHaveLength(2);
        expect(view.responses[participant.id]).toMatchObject([{answer: 'yes'}]);
    });

    it('returns event participants and dietary totals for organizer exports', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant export event');
        await registerEventAttendance(eventId, participant, {
            arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: 'VEGETARIAN',
        });
        const event = await eventService.getEventById(eventId);

        const exportData = await eventController.getParticipantsExtended(event!);

        expect(exportData.participants).toHaveLength(1);
        expect(exportData.totals).toMatchObject({VEGETARIAN: 1});
        expect(exportData.dateTotals).toMatchObject({'2027-06-01': 1, '2027-06-03': 1});
    });

    it('creates and updates an invoice pool through controller validation', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Shared costs event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const event = await eventService.getEventById(eventId);
        const registration = await eventService.getRegistrationFor(participant.id, eventId);

        const poolId = await eventPoolController.createInvoicePool(event!, {
            name: 'Food costs', description: 'Shared meals', distribution: 'EQUAL', registrations: [registration!.id],
        });
        await eventPoolController.updatePoolSettings(event!, poolId, {
            description: 'All shared meals',
            distribution: 'NIGHTS'
        });

        expect(await invoiceService.getPoolWithInvoices(poolId)).toMatchObject({
            id: poolId, name: 'Food costs', description: 'All shared meals', distributionMethod: 'NIGHTS',
        });
    });

    it('finds users through the secure administrator search controller', async () => {
        const account = await registerLocalAccount('controller-search');
        const profiles = account.profiles;
        expect(profiles).toHaveLength(1);
        const profile = profiles![0];

        const results = await entityAdminController.searchUsers(account.username, 5);

        expect(results).toContainEqual(expect.objectContaining({
            id: profile.id,
            name: profile.name,
            username: account.username
        }));
        expect(results[0].email).not.toBe(account.email);
    });

    it('renders the help index from the maintained user documentation', () => {
        const help = helpController.fetchHelpIndex();

        expect(help.currentDoc).toBe('readme');
        expect(help.docsList.length).toBeGreaterThan(0);
        expect(help.content).toContain('<h1');
    });

    it('renders a requested help document and rewrites internal links', () => {
        const help = helpController.fetchHelpDoc('events');

        expect(help.currentDoc).toBe('events');
        expect(help.title).toBeTruthy();
        expect(help.content).toContain('/help/');
    });
});
