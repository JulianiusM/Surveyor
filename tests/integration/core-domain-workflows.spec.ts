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

describe('authentication user stories', () => {
    it('registers an inactive account with a usable profile', async () => {
        const {id: userId, username} = await registerLocalAccount('registration');

        const account = await userService.getUserByUsername(username);
        expect(account?.id).toBe(userId);
        expect(Boolean(account?.isActive)).toBe(false);
        expect(account?.profiles).toHaveLength(1);
    });

    it('finds a newly registered account by email', async () => {
        const {email, id: userId, username} = await registerLocalAccount('email-lookup');

        expect(await userService.getUserByEmail(email)).toMatchObject({id: userId, username});
    });

    it('accepts the registered password and rejects a wrong password', async () => {
        const {id: userId} = await registerLocalAccount('password-check');

        await expect(userService.verifyPassword(userId, 'initial-secret')).resolves.toBe(true);
        await expect(userService.verifyPassword(userId, 'wrong-secret')).resolves.toBe(false);
    });

    it('activates an account with its persisted activation token', async () => {
        const {id: userId} = await registerLocalAccount('activation');

        const token = await userService.generateActivationToken(userId);
        expect((await userService.verifyActivationToken(token))?.id).toBe(userId);
        await userController.activateAccount(token);
        expect(Boolean((await userService.getUserById(userId))?.isActive)).toBe(true);
    });

    it('rejects an activation token after activation consumes it', async () => {
        const {id: userId} = await registerLocalAccount('activation-consumption');

        const token = await userService.generateActivationToken(userId);
        await userController.activateAccount(token);
        expect(await userService.verifyActivationToken(token)).toBeNull();
    });

    it('resets a password through the recovery-token workflow', async () => {
        const {id: userId, username} = await registerLocalAccount('password-reset');

        const token = await userService.generatePasswordResetToken(username);
        expect((await userService.verifyPasswordResetToken(token))?.id).toBe(userId);
        await userController.resetPassword(token, {password: 'replacement-secret', confirmPassword: 'replacement-secret'});
        await expect(userService.verifyPassword(userId, 'replacement-secret')).resolves.toBe(true);
    });

    it('rejects a reset token after the password is changed', async () => {
        const {username} = await registerLocalAccount('reset-consumption');

        const token = await userService.generatePasswordResetToken(username);
        await userController.resetPassword(token, {password: 'replacement-secret', confirmPassword: 'replacement-secret'});
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
    });

    it('creates a guest identity with a linked profile', async () => {
        const guest = await userService.createGuest('Camp Guest', 'camp-guest@example.com');
        expect(guest.profile).toMatchObject({name: 'Camp Guest', type: 'guest'});
    });

    it('restores a guest session using its private link token', async () => {
        const guest = await userService.createGuest('Returning Guest');
        const token = await userService.getGuestLinkToken(guest.id);
        expect(await userService.getGuestByToken(token!, guest.id)).toMatchObject({id: guest.id, profile: {id: guest.profile.id}});
    });

    it('matches guest email addresses after normalization', async () => {
        const guestEmail = 'normalized-guest@example.com';
        const guest = await userService.createGuest('Normalized Guest', `  ${guestEmail.toUpperCase()}  `);
        expect((await userService.getGuestByEmail(guestEmail)).map((match) => match.id)).toContain(guest.id);
    });

    it('links an existing local account to an OIDC identity', async () => {
        const {id: userId} = await registerLocalAccount('oidc-link');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'linked-subject');
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toMatchObject({id: userId});
    });

    it('unlinks OIDC without deleting the local account', async () => {
        const {id: userId} = await registerLocalAccount('oidc-unlink');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'unlinked-subject');
        await userService.unlinkOidc(userId);
        expect(await userService.getUserByOidc('https://identity.example', 'unlinked-subject')).toBeNull();
        expect(await userService.getUserById(userId)).not.toBeNull();
    });

    it('provisions an active OIDC account and profile just in time', async () => {
        const oidc = await userService.findOrCreateUserFromOidc('https://identity.example', {
            sub: 'jit-provisioned-subject', email: 'jit-user@example.com', preferred_username: 'jit-user', name: 'JIT User',
        });
        expect(oidc.oidcSub).toBe('jit-provisioned-subject');
        expect(Boolean(oidc.isActive)).toBe(true);
        expect(oidc.profiles).toHaveLength(1);
    });

    it('resolves an account by username, email, and numeric id', async () => {
        const {email, id: userId, username} = await registerLocalAccount('account-resolution');

        expect((await userService.findUserByNameOrEmail(username))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(email))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(userId))?.id).toBe(userId);
    });

    it('searches accounts without disclosing a raw email address', async () => {
        const {email, id: userId, username} = await registerLocalAccount('secure-search');

        const [result] = await userService.searchUsersSecure(username, 5);
        expect(result).toMatchObject({id: userId, username});
        expect(result.email).not.toBe(email);
    });

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

describe('activity plan user stories', () => {
    it('creates a plan and its schedule transactionally', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        expect(await activityService.getActivityPlanById(planId)).toMatchObject({title: 'Camp activity plan', ownerId: owner.id});
        expect(await activityService.getActivitySlotsFlat(planId)).toHaveLength(1);
    });

    it('rejects an activity plan without a participant-visible slot', async () => {
        expect(() => activityController.preprocessCreate({
            title: 'Camp activity plan', description: 'Shared schedule',
            startDate: '2027-06-01', endDate: '2027-06-03', slots: '{}',
        })).toThrow('slots');
    });

    it('adds several organizer-authored slots at once', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Lunch'}, {profile: owner} as never);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Dinner'}, {profile: owner} as never);
        expect((await activityService.getActivitySlotsFlat(planId)).map((slot) => slot.title)).toEqual(['Morning activity', 'Lunch', 'Dinner']);
    });

    it('orders a daily schedule by time and position', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Late', startTime: '18:00'}, {profile: owner} as never);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Middle', startTime: '12:00'}, {profile: owner} as never);
        expect((await activityService.getActivitySlotsFlat(planId)).map((slot) => slot.title)).toEqual(['Morning activity', 'Middle', 'Late']);
    });

    it('groups schedule slots by day for the plan view', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-02', title: 'Second day'}, {profile: owner} as never);
        expect(Object.keys(await activityService.getActivitySlots(planId))).toEqual(['2027-06-01', '2027-06-02']);
    });

    it('updates the participant-visible slot details', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        const permissions = {itemAllow: () => true} as never;
        await activityController.updateSlotAttr(slot.id, {field: 'title', value: 'Updated activity'}, permissions);
        await activityController.updateSlotAttr(slot.id, {field: 'maxAssignees', value: 8}, permissions);
        expect(await activityService.getActivitySlotById(slot.id)).toMatchObject({title: 'Updated activity', maxAssignees: 8});
    });

    it('reorders slots without recreating assignments', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {
            date: '2027-06-01', title: 'First after reorder', startTime: '08:00', endTime: '09:00',
        }, {profile: owner} as never);
        const slots = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slots[0].id, participant.id);
        const assignmentId = (await activityService.getActivitySlotAssignees(planId))[slots[0].id][0].id;
        await activityController.reorderSlots(planId, [{slotId: slots[0].id, pos: 2}, {slotId: slots[1].id, pos: 1}]);
        expect((await activityService.getActivitySlotsFlat(planId))[0].title).toBe('First after reorder');
        expect((await activityService.getActivitySlotAssignmentById(assignmentId))?.id).toBe(assignmentId);
    });

    it('deletes a slot from the shared schedule', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await activityController.deleteSlot(slot.id);
        expect(await activityService.getActivitySlotsFlat(planId)).toEqual([]);
    });

    it('assigns a participant idempotently', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        await assignActivitySlot(slot.id, participant.id);
        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toHaveLength(1);
    });

    it('shows assignment counts and participant plans', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        expect((await activityService.getActivitySlotsFlat(planId))[0].assignedCount).toBe(1);
        expect((await activityService.getActivityPlansByParticipant(participant.id)).map((plan) => plan.id)).toContain(planId);
    });

    it('removes an activity assignment', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        const assignmentId = (await activityService.getActivitySlotAssignees(planId))[slot.id][0].id;
        await activityController.deleteAssignment(assignmentId);
        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([]);
    });

    it('adds, edits, and removes a plan information field', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const field = await activityController.createTextField(planId, {title: 'Meeting point', text: 'Main entrance'});
        await activityController.updateTextField(planId, field.id, {text: 'Side entrance', title: 'Updated point'}, {entity: new Set(['MANAGE_REQUIREMENTS'])} as never);
        expect(await activityService.getActivityPlanTextFieldById(field.id)).toMatchObject({title: 'Updated point', text: 'Side entrance'});
        await activityController.deleteTextField(planId, field.id);
        expect(await activityService.getActivityPlanTextFields(planId)).toEqual([]);
    });

    it('creates and assigns a reusable activity role', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        const plan = await activityService.getActivityPlanById(planId);
        const [role] = await activityController.addActivityRole(plan!, {name: 'Coordinator'});
        await activityController.getRoleAccessMapping().assign({itemId: slot.id, role: 'Coordinator'}, participant.id);
        const [participantRoles] = await activityService.getParticipantRolesForPlan(planId);
        expect(participantRoles.participantKey).toBe(`profile:${participant.id}`);
        expect(participantRoles.roleIds).toContain(role.id);
    });

    it('updates the plan description and header image', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        await activityController.updateDescription(planId, {description: 'Updated schedule'});
        await activityService.updateHeaderImage(planId, 'activity-header.jpg');
        expect(await activityService.getActivityPlanById(planId)).toMatchObject({description: 'Updated schedule', headerImg: 'activity-header.jpg'});
    });

    it('deletes a plan and removes it from the owner dashboard', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.deleteEntity(plan!, {} as never);
        expect((await activityService.getActivityPlansByProfileId(owner.id)).map((plan) => plan.id)).not.toContain(planId);
    });

});

describe('drivers list user stories', () => {
    it('creates an event-linked drivers list', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Drivers event');
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides', eventId);

        expect(await driverService.getDriversListById(listId)).toMatchObject({event: {id: eventId}});
    });

    it('updates list title, description, and header image', async () => {
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides');

        await driverService.updateDriversListTitle(listId, 'Updated drivers');
        await driversController.updateDescription(listId, {description: 'Updated rides'});
        await driverService.updateHeaderImage(listId, 'drivers.jpg');
        expect(await driverService.getDriversListById(listId)).toMatchObject({title: 'Updated drivers', description: 'Updated rides', headerImg: 'drivers.jpg'});
    });

    it('adds a driver-authored journey', async () => {
        const [, item] = await createDriversListWithItem(owner.id);

        expect(await driverService.getDriversItemById(item.id)).toMatchObject({title: 'Airport journey', driverName: owner.name, assignedCount: 0});
    });

    it('adds multiple journeys in display order', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        const second = createDriversItemEntity({title: 'Second journey', pos: 2});
        const list = await driverService.getDriversListById(listId);
        await driversController.quickAddItem(list!, second, {profile: owner} as never);
        expect((await driverService.getDriversItems(listId)).map((entry) => entry.title)).toEqual(['Airport journey', 'Second journey']);
    });

    it('updates journey details and capacity', async () => {
        const [, item] = await createDriversListWithItem(owner.id);

        await driversController.updateItemAttr(item.id, {field: 'title', value: 'Changed journey'});
        await driversController.updateItemDescription(item.id, {description: 'Changed pickup'});
        await driversController.updateItemAttr(item.id, {field: 'maxAssignees', value: 5});
        expect(await driverService.getDriversItemById(item.id)).toMatchObject({title: 'Changed journey', description: 'Changed pickup', maxAssignees: 5});
    });

    it('reorders journeys for the shared list', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        const second = createDriversItemEntity({title: 'First journey', pos: 2});
        const list = await driverService.getDriversListById(listId);
        await driversController.quickAddItem(list!, second, {profile: owner} as never);
        const added = (await driverService.getDriversItems(listId)).find((entry) => entry.title === 'First journey')!;
        await driversController.reorderItems(listId, [{itemId: item.id, position: 2}, {itemId: added.id, position: 1}]);
        expect((await driverService.getDriversItems(listId)).map((entry) => entry.title)).toEqual(['First journey', 'Airport journey']);
    });

    it('assigns a volunteer driver idempotently', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await assignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversAssignments(listId, participant.id)).toEqual([item.id]);
    });

    it('shows assignment counts beside journeys', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await assignDriversItem(item.id, secondParticipant.id);
        expect(await driverService.getDriversAssignmentCounts(listId)).toEqual({[item.id]: 2});
    });

    it('shows volunteer names to coordinators', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversItemAssignees(listId)).toEqual({[item.id]: [expect.objectContaining({name: participant.name})]});
    });

    it('removes a volunteer from a journey', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await unassignDriversItem(item.id, participant.id);
        expect(await driverService.getDriversAssignments(listId, participant.id)).toEqual([]);
    });

    it('finds the next journey position', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        expect(await driverService.getLastDriversItemNumber(listId)).toBe(1);
    });

    it('lists only lists owned by the requested profile', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        expect((await driverService.getDriversListByProfileId(owner.id)).map((list) => list.id)).toContain(listId);
        expect((await driverService.getDriversListByProfileId(participant.id)).map((list) => list.id)).not.toContain(listId);
    });

    it('includes a delegated list in the management dashboard', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await entityAdminController.addAdmin('drivers', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await driverService.getManagedListsForProfile(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('deletes a journey and its visible assignment', async () => {
        const [listId, item] = await createDriversListWithItem(owner.id);

        await assignDriversItem(item.id, participant.id);
        await driversController.deleteItem(item.id);
        expect(await driverService.getDriversItems(listId)).toEqual([]);
    });

    it('deletes a drivers list from the owner dashboard', async () => {
        const listId = await driverService.createDriversList(owner.id, 'Camp drivers', 'Shared rides');

        const list = await driverService.getDriversListById(listId);
        await driversController.deleteEntity(list!, {} as never);
        expect((await driverService.getDriversListByProfileId(owner.id)).map((list) => list.id)).not.toContain(listId);
    });

});

describe('packing list user stories', () => {
    it('creates a list and all shared items transactionally', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        expect(await packingService.getPackingListById(listId)).toMatchObject({title: 'Camp packing list', ownerId: owner.id});
        expect(item).toMatchObject({title: 'Group tent', assignedCount: 0});
    });

    it('rejects a packing list without a participant-visible item', async () => {
        expect(() => packingController.preprocessCreate({
            title: 'Camp packing list', description: 'Shared equipment', items: '[]',
        })).toThrow('items');
    });

    it('adds several organizer-authored items at once', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        const list = await packingService.getPackingListById(listId);
        await packingController.quickAddItem(list!, {title: 'Lantern'}, {profile: owner} as never);
        await packingController.quickAddItem(list!, {title: 'Stove'}, {profile: owner} as never);
        expect((await packingService.getPackingItems(listId)).map((entry) => entry.title)).toEqual(expect.arrayContaining(['Group tent', 'Lantern', 'Stove']));
    });

    it('updates list title, description, and header image', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        await packingService.updatePackingListTitle(listId, 'Updated packing');
        await packingController.updateDescription(listId, {description: 'Updated equipment'});
        await packingService.updateHeaderImage(listId, 'packing.jpg');
        expect(await packingService.getPackingListById(listId)).toMatchObject({title: 'Updated packing', description: 'Updated equipment', headerImg: 'packing.jpg'});
    });

    it('updates item details and capacity', async () => {
        const [, item] = await createPackingListWithItem(owner.id);

        await packingController.updateItemAttr(item.id, {field: 'title', value: 'Updated item'});
        await packingController.updateItemDescription(item.id, {description: 'Updated details'});
        await packingController.updateItemAttr(item.id, {field: 'maxAssignees', value: 4});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({title: 'Updated item', description: 'Updated details', maxAssignees: 4});
    });

    it('reorders items for participant display', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        const second = createPackingItemEntity({title: 'First item', pos: 2});
        const list = await packingService.getPackingListById(listId);
        await packingController.quickAddItem(list!, second, {profile: owner} as never);
        const added = (await packingService.getPackingItems(listId)).find((entry) => entry.title === 'First item')!;
        await packingController.reorderItems(listId, [{itemId: item.id, position: 2}, {itemId: added.id, position: 1}]);
        expect((await packingService.getPackingItems(listId)).map((entry) => entry.title)).toEqual(['First item', 'Group tent']);
    });

    it('assigns a participant idempotently', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await assignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([item.id]);
    });

    it('shows assignment counts beside items', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await assignPackingItem(item.id, secondParticipant.id);
        expect(await packingService.getPackingAssignmentCounts(listId)).toEqual({[item.id]: 2});
    });

    it('shows assignee names to organizers', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingItemAssignees(listId)).toEqual({[item.id]: [expect.objectContaining({name: participant.name})]});
    });

    it('removes a participant assignment', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await unassignPackingItem(item.id, participant.id);
        expect(await packingService.getPackingAssignments(listId, participant.id)).toEqual([]);
    });

    it('marks an item as required by everyone', async () => {
        const [, item] = await createPackingListWithItem(owner.id);

        await packingController.updateRequired(item.id, {flag: true});
        expect(Boolean((await packingService.getPackingItemById(item.id))?.requiredByAll)).toBe(true);
    });

    it('finds lists in which a participant volunteered', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        expect((await packingService.getPackingListByParticipant(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('includes a delegated list in the management dashboard', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        await entityAdminController.addAdmin('packing', listId, {profileId: participant.id, mask: PERM.ACCESS_ADMIN});
        expect((await packingService.getManagedLists(participant.id)).map((list) => list.id)).toContain(listId);
    });

    it('deletes an item and its visible assignment', async () => {
        const [listId, item] = await createPackingListWithItem(owner.id);

        await assignPackingItem(item.id, participant.id);
        await packingController.deleteItem(item.id);
        expect(await packingService.getPackingItems(listId)).toEqual([]);
    });

    it('deletes a packing list from the owner dashboard', async () => {
        const [listId] = await createPackingListWithItem(owner.id);

        const list = await packingService.getPackingListById(listId);
        await packingController.deleteEntity(list!, {} as never);
        expect((await packingService.getPackingListByProfileId(owner.id)).map((list) => list.id)).not.toContain(listId);
    });

});

describe('survey user stories', () => {
    it('creates a survey and all date choices transactionally', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({title: 'Camp date survey', ownerId: owner.id});
        expect(combinations).toHaveLength(2);
    });

    it('rejects a survey without a participant-visible date choice', async () => {
        expect(() => surveyController.preprocessCreate({
            title: 'Camp date survey', description: 'Choose dates', combinations: [],
        })).toThrow('combinations');
    });

    it('orders persisted choices predictably', async () => {
        const [, combinations] = await createSurveyWithCombinations(owner.id);

        expect(combinations.map((combination) => combination.weekday)).toEqual(['MON', 'FRI']);
    });

    it('stores a yes response from a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        const answer = 'yes';
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: answer});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer}));
    });

    it('stores a maybe response from a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        const answer = 'maybe';
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: answer});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer}));
    });

    it('defaults an empty submitted answer to no', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: '' as never});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer: 'no'}));
    });

    it('stores answers from multiple participants', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, secondParticipant, {[combinations[1].id]: 'maybe'});
        expect(Object.keys(await surveyService.getResponsesSorted(surveyId))).toEqual(expect.arrayContaining([participant.id, secondParticipant.id]));
    });

    it('groups results by participant with names and choices', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
            [participant.id]: [expect.objectContaining({name: participant.name, combinationId: combinations[0].id, answer: 'yes'})],
        });
    });

    it('lists surveys answered by a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        expect((await surveyService.getSurveysByParticipant(participant.id)).map((survey) => survey.id)).toContain(surveyId);
    });

    it('replaces a submitted ballot without stale answers', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        await submitSurveyResponses(surveyId, participant, {[combinations[1].id]: 'maybe'});
        expect((await surveyService.getResponsesSorted(surveyId))[participant.id]).toMatchObject([{combinationId: combinations[1].id, answer: 'maybe'}]);
    });

    it('keeps one participant ballot isolated from another', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, secondParticipant, {[combinations[1].id]: 'no'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
            [secondParticipant.id]: [expect.objectContaining({answer: 'no'})],
        });
    });

    it('lists only surveys owned by the requested profile', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        expect((await surveyService.getSurveysByProfileId(owner.id)).map((survey) => survey.id)).toContain(surveyId);
        expect((await surveyService.getSurveysByProfileId(participant.id)).map((survey) => survey.id)).not.toContain(surveyId);
    });

    it('updates and clears a survey header image', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        await surveyService.updateHeaderImage(surveyId, 'survey.jpg');
        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({headerImg: 'survey.jpg'});
        await surveyService.updateHeaderImage(surveyId, null);
        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({headerImg: null});
    });

    it('deletes all responses for one participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, participant, {[combinations[1].id]: 'maybe'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({});
    });

    it('deletes a survey from the owner dashboard', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        const survey = await surveyService.getSurveyById(surveyId);
        await surveyController.deleteEntity(survey!, {} as never);
        expect((await surveyService.getSurveysByProfileId(owner.id)).map((survey) => survey.id)).not.toContain(surveyId);
    });

});

describe('remaining high-value controller workflows', () => {
    it('builds an owner dashboard across all collaborative modules', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Dashboard event');
        const planId = await createActivityPlanWithSlot(owner.id);
        const [driversId] = await createDriversListWithItem(owner.id);
        const [packingId] = await createPackingListWithItem(owner.id);
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        const dashboard = await userController.getDashboardEntities(owner);

        expect(dashboard.owner.events.map((event) => event.id)).toContain(eventId);
        expect(dashboard.owner.activityPlans.map((plan) => plan.id)).toContain(planId);
        expect(dashboard.owner.driversLists.map((list) => list.id)).toContain(driversId);
        expect(dashboard.owner.packingLists.map((list) => list.id)).toContain(packingId);
        expect(dashboard.owner.surveys.map((survey) => survey.id)).toContain(surveyId);
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

        expect(dashboard.participant.events.map((event) => event.id)).toContain(eventId);
        expect(dashboard.participant.activityPlans.map((plan) => plan.id)).toContain(planId);
        expect(dashboard.participant.driversLists.map((list) => list.id)).toContain(driversId);
        expect(dashboard.participant.packingLists.map((list) => list.id)).toContain(packingId);
        expect(dashboard.participant.surveys.map((survey) => survey.id)).toContain(surveyId);
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
        await eventPoolController.updatePoolSettings(event!, poolId, {description: 'All shared meals', distribution: 'NIGHTS'});

        expect(await invoiceService.getPoolWithInvoices(poolId)).toMatchObject({
            id: poolId, name: 'Food costs', description: 'All shared meals', distributionMethod: 'NIGHTS',
        });
    });

    it('finds users through the secure administrator search controller', async () => {
        const account = await registerLocalAccount('controller-search');

        const results = await entityAdminController.searchUsers(account.username, 5);

        expect(results).toContainEqual(expect.objectContaining({id: account.id, username: account.username}));
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
