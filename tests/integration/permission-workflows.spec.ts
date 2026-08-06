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

describe('permission user stories', () => {
    it('delegates view access to an event administrator', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(viewAdmin);
    });

    it('upgrades a delegated administrator permission mask', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        await entityAdminController.updateAdmin('event', eventId, participant.id, {mask: viewAdmin | PERM.ACCESS_ADMIN});
        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(viewAdmin | PERM.ACCESS_ADMIN);
    });

    it('lists delegated administrators with their profile', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        expect(await adminService.listAdmins('event', eventId)).toContainEqual(expect.objectContaining({profile: expect.objectContaining({id: participant.id})}));
    });

    it('removes delegated event administration', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        await entityAdminController.removeAdmin('event', eventId, participant.id);
        expect(await adminService.isAdmin('event', eventId, participant.id)).toBe(false);
    });

    it('keeps permissions isolated between entities', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        const otherEventId = await createIntegrationEvent(owner.id, 'Permission isolation event');
        expect(await adminService.getProfilePerms('event', otherEventId, participant.id)).toBe(0);
    });

    it('persists public audience access', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Public permission event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {public: ['ACCESS_VIEW']}});
        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({public: viewAdmin});
    });

    it('persists authenticated audience access', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Authenticated permission event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {authenticated: ['ACCESS_VIEW']}});
        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({authenticated: viewAdmin});
    });

    it('persists guest audience access', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Guest permission event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {guest: ['ACCESS_VIEW']}});
        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({guest: viewAdmin});
    });

    it('persists participant audience access', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant permission event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {participant: ['ACCESS_VIEW']}});
        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({participant: viewAdmin});
    });

    it('updates one audience without erasing another', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {public: ['ACCESS_VIEW'], authenticated: ['ACCESS_CREATE']}});
        await eventController.updateSettings(eventId, {defaultPerms: {public: ['ACCESS_VIEW', 'ACCESS_REGISTRATION']}});
        expect(await adminService.getDefaultPerms('event', eventId)).toEqual({
            public: PERM.ACCESS_VIEW | PERM.ACCESS_REGISTRATION,
            authenticated: PERM.ACCESS_CREATE,
        });
    });

    it('stores an explicit zero mask to revoke an audience', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;

        await eventController.updateSettings(eventId, {defaultPerms: {public: ['ACCESS_VIEW']}});
        await eventController.updateSettings(eventId, {defaultPerms: {public: []}});
        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({public: 0});
    });

    it('finds only entities matching the requested permission mask', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});

        expect(await adminService.getIds('event', participant.id, PERM.ACCESS_VIEW)).toContain(eventId);
        expect(await adminService.getIds('event', participant.id, PERM.ACCESS_ADMIN)).not.toContain(eventId);
    });

    it('includes owned and delegated packing lists in management', async () => {

        const listId = await packingService.createPackingListTx(owner.id, 'Delegated packing', 'Shared', []);
        await entityAdminController.addAdmin('packing', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await packingService.getManagedLists(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('includes owned and delegated activity plans in management', async () => {

        const planId = await activityService.createActivityPlanTx(owner.id, 'Delegated activity', 'Shared', '2027-06-01', '2027-06-03', []);
        await entityAdminController.addAdmin('activity', planId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await activityService.getManagedPlans(participant.id)).map((plan) => plan.id)).toContain(planId);
    });

    it('includes owned and delegated drivers lists in management', async () => {

        const listId = await driverService.createDriversList(owner.id, 'Delegated drivers', 'Shared');
        await entityAdminController.addAdmin('drivers', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await driverService.getManagedListsForProfile(participant.id)).map((list) => list.id)).toContain(listId);
    });

});
