import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import activityController from '../../src/backend/controller/activityController';
import driversController from '../../src/backend/controller/driversController';
import * as entityAdminController from '../../src/backend/controller/entityAdminController';
import eventPoolController from '../../src/backend/controller/eventPoolController';
import * as helpController from '../../src/backend/controller/helpController';
import eventController from '../../src/backend/controller/eventController';
import packingController from '../../src/backend/controller/packingController';
import surveyController from '../../src/backend/controller/surveyController';
import * as userController from '../../src/backend/controller/userController';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {PERM} from '../../src/backend/modules/lib/permissions';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import * as surveyService from '../../src/backend/modules/database/services/SurveyService';
import * as userService from '../../src/backend/modules/database/services/UserService';
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
    it('delegates, lists, updates and revokes event administration while accepting an unchanged mask', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Permission workflow event');
        const viewAdmin = PERM.ACCESS_VIEW;
        await entityAdminController.addAdmin('event', eventId, {profileId: participant.id, mask: viewAdmin});
        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(viewAdmin);
        expect(await adminService.listAdmins('event', eventId)).toContainEqual(expect.objectContaining({profile: expect.objectContaining({id: participant.id})}));

        // Save without checkbox changes must preserve the same delegated row before
        // an actual upgrade. Reuse its persisted state instead of creating another event.
        await entityAdminController.updateAdmin('event', eventId, participant.id, {mask: viewAdmin});
        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(viewAdmin);
        expect(await adminService.isAdmin('event', eventId, participant.id)).toBe(true);
        await entityAdminController.updateAdmin('event', eventId, participant.id, {mask: viewAdmin | PERM.ACCESS_ADMIN});
        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(viewAdmin | PERM.ACCESS_ADMIN);

        // Match the original revocation fixture's exact administrator-only mask.
        // Both membership and permission-filtered discovery must forget this row.
        const adminMask = PERM.ACCESS_ADMIN;
        await entityAdminController.updateAdmin('event', eventId, participant.id, {mask: adminMask});
        expect(await adminService.getProfilePerms('event', eventId, participant.id)).toBe(adminMask);
        expect(await adminService.getIds('event', participant.id, PERM.ACCESS_ADMIN)).toContain(eventId);

        await entityAdminController.removeAdmin('event', eventId, participant.id);
        expect(await adminService.isAdmin('event', eventId, participant.id)).toBe(false);
        expect(await adminService.getIds('event', participant.id, PERM.ACCESS_ADMIN)).not.toContain(eventId);
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

    it('accepts unchanged entity audience permissions', async () => {
        // Protects the group-permission form when Save is clicked without changing any checkbox.
        const eventId = await createIntegrationEvent(owner.id, 'Unchanged audience permission event');
        const body = {defaultPerms: {public: ['ACCESS_VIEW']}};
        await eventController.updateSettings(eventId, body);

        await eventController.updateSettings(eventId, body);

        expect(await adminService.getDefaultPerms('event', eventId)).toMatchObject({public: PERM.ACCESS_VIEW});
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

    it('includes owned and delegated activity plans in management', async () => {

        const planId = await activityService.createActivityPlanTx(owner.id, 'Delegated activity', 'Shared', '2027-06-01', '2027-06-03', []);
        await entityAdminController.addAdmin('activity', planId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await activityService.getManagedPlans(participant.id)).map((plan) => plan.id)).toContain(planId);
    });

    it('persists audience permissions under a survey resource type', async () => {
        // Retain the polymorphic storage boundary formerly checked by the general
        // service suite. Packing and Drivers management remain in their own workflows.
        const surveyId = await surveyService.createSurveyTx(owner.id, 'Shared survey', 'Visibility', [
            {weekday: 'WED', week: '3'},
        ]);
        await adminService.updatePerms('survey', surveyId, {
            public: PERM.ACCESS_VIEW, authenticated: PERM.ACCESS_VIEW | PERM.ITEM_ADD,
        });
        expect(await adminService.getDefaultPerms('survey', surveyId)).toEqual({
            public: PERM.ACCESS_VIEW, authenticated: PERM.ACCESS_VIEW | PERM.ITEM_ADD,
        });
    });

});
