import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_PERM, getInitialPerms, getPresetMask, hasPerm, labelFromKey, PERM, toMask, toMaskFromBodyValue} from '../../src/modules/lib/permissions';
import {buildDateTotals, convertToSingleList, maskEmail, resolveActorLabel, sanitizeForEmail} from '../../src/modules/lib/util';
import {createExpectedEntity} from '../factories/entitiesFactory';
import {
    createActivityBody,
    createAuthBody,
    createDriversBody,
    createEventBody,
    createLoginBody,
    createPackingBody,
    createSession,
    createSurveyBody,
    ids,
} from '../factories/coreFunctionalityFactory';
import {expectApiFailure, expectExpectedFailure, expectValidationFailure} from '../keywords/coreFunctionalityKeywords';
import * as userService from '../../src/modules/database/services/UserService';
import mailer from '../../src/modules/email';
import * as oidc from '../../src/modules/oidc';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as permissionEngine from '../../src/modules/permissionEngine';
import * as userController from '../../src/controller/userController';
import surveyController from '../../src/controller/surveyController';
import eventController from '../../src/controller/eventController';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import packingController from '../../src/controller/packingController';

vi.mock('../../src/modules/database/services/UserService', () => ({
    getUserByUsername: vi.fn(), registerUser: vi.fn(), generateActivationToken: vi.fn(), verifyPassword: vi.fn(),
    generatePasswordResetToken: vi.fn(), verifyPasswordResetToken: vi.fn(), resetPassword: vi.fn(), verifyActivationToken: vi.fn(),
    activateUser: vi.fn(), getUserByEmail: vi.fn(), getGuestByToken: vi.fn(), getProfileById: vi.fn(), searchUsersSecure: vi.fn(),
}));
vi.mock('../../src/modules/email', () => ({default: {sendActivationEmail: vi.fn(), sendPasswordResetEmail: vi.fn()}}));
vi.mock('../../src/modules/lib/session', () => ({persistSession: vi.fn()}));
vi.mock('../../src/modules/oidc', () => ({startLogin: vi.fn(), callback: vi.fn(), logout: vi.fn()}));
vi.mock('../../src/modules/database/services/SurveyService', () => ({
    createSurveyTx: vi.fn(), getCombinationsBySurveyId: vi.fn(), getResponsesSorted: vi.fn(), deleteSurvey: vi.fn(), addCombination: vi.fn(),
    deleteResponsesByProfileId: vi.fn(), saveResponse: vi.fn(), updateHeaderImage: vi.fn(),
}));
vi.mock('../../src/modules/database/services/EventService', () => ({
    createEventTx: vi.fn(), getRegistrationFor: vi.fn(), getActivityPlansForEvent: vi.fn(), getPackingListsForEvent: vi.fn(), getDriverListsForEvent: vi.fn(),
    getEventParticipants: vi.fn(), isEventFull: vi.fn(), isRegisteredForEvent: vi.fn(), canBypassDeadlineWithToken: vi.fn(), registerForEvent: vi.fn(),
    updateEventSettings: vi.fn(), updateHeaderImage: vi.fn(), deleteEvent: vi.fn(),
}));
vi.mock('../../src/modules/database/services/EventInvoiceService', () => ({listPools: vi.fn(), getParticipantPools: vi.fn()}));
vi.mock('../../src/controller/eventPoolController', () => ({purgeExpiredProofs: vi.fn()}));
vi.mock('../../src/modules/database/services/ActivityService', () => ({
    createActivityPlanTx: vi.fn(), updateActivityPlanDescription: vi.fn(), getLastActivitySlotNumber: vi.fn(), addActivitySlot: vi.fn(), addActivitySlotRoles: vi.fn(),
    updateActivitySlot: vi.fn(), reorderActivitySlots: vi.fn(), deleteActivitySlot: vi.fn(), ensureRoleId: vi.fn(), updateRoleAssignments: vi.fn(),
    assignActivityAssignmentRole: vi.fn(), unassignActivityAssignmentRole: vi.fn(), updateHeaderImage: vi.fn(),
}));
vi.mock('../../src/modules/database/services/ActivityRequirementService', () => ({getRequirementsForPlan: vi.fn(), saveRequirementsForPlan: vi.fn()}));
vi.mock('../../src/modules/database/services/ActivityRecommendationService', () => ({listRecommendationsForPlan: vi.fn(), upsertRecommendations: vi.fn()}));
vi.mock('../../src/modules/database/services/DriverService', () => ({
    createDriversList: vi.fn(), getLastDriversItemNumber: vi.fn(), createDriversItem: vi.fn(), updateDriversListDescription: vi.fn(),
    updateDriversItem: vi.fn(), reorderDriversItems: vi.fn(), deleteDriversItem: vi.fn(), deleteDriversAssignment: vi.fn(),
    assignDriversItem: vi.fn(), unassignDriversItem: vi.fn(), updateHeaderImage: vi.fn(),
}));
vi.mock('../../src/modules/database/services/PackingService', () => ({
    createPackingListTx: vi.fn(), getLastPackingItemNumber: vi.fn(), addPackingItems: vi.fn(), updatePackingListDescription: vi.fn(),
    updatePackingItem: vi.fn(), reorderPackingItems: vi.fn(), deletePackingItem: vi.fn(), deletePackingAssignment: vi.fn(), togglePackingItemRequiredByAll: vi.fn(),
    assignPackingItem: vi.fn(), unassignPackingItem: vi.fn(), updateHeaderImage: vi.fn(),
}));
vi.mock('../../src/modules/permissionEngine', () => ({saveDefaultPermsFromBody: vi.fn(), can: vi.fn().mockResolvedValue(false)}));


beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.registerUser).mockResolvedValue('user-1' as never);
    vi.mocked(userService.generateActivationToken).mockResolvedValue('activation-token');
    vi.mocked(userService.generatePasswordResetToken).mockResolvedValue('reset-token');
    vi.mocked(userService.verifyPassword).mockResolvedValue(true);
    vi.mocked(userService.getUserByUsername).mockResolvedValue(null);
    vi.mocked(userService.getUserByEmail).mockResolvedValue(null);
    vi.mocked(userService.getProfileById).mockResolvedValue({id: ids.profile} as never);
    vi.mocked(userService.searchUsersSecure).mockResolvedValue([{id: ids.profile, name: 'Camp Organizer'}] as never);
    vi.mocked(surveyService.createSurveyTx).mockResolvedValue(ids.entity);
    vi.mocked(eventService.createEventTx).mockResolvedValue(ids.entity);
    vi.mocked(eventService.getEventParticipants).mockResolvedValue([] as never);
    vi.mocked(eventService.getRegistrationFor).mockResolvedValue(null as never);
    vi.mocked(eventService.getActivityPlansForEvent).mockResolvedValue([] as never);
    vi.mocked(eventService.getPackingListsForEvent).mockResolvedValue([] as never);
    vi.mocked(eventService.getDriverListsForEvent).mockResolvedValue([] as never);
    vi.mocked(eventService.isEventFull).mockResolvedValue(false);
    vi.mocked(invoiceService.listPools).mockResolvedValue([] as never);
    vi.mocked(invoiceService.getParticipantPools).mockResolvedValue([] as never);
    vi.mocked(activityService.createActivityPlanTx).mockResolvedValue(ids.entity);
    vi.mocked(activityService.getLastActivitySlotNumber).mockResolvedValue(0 as never);
    vi.mocked(activityService.updateActivitySlot).mockResolvedValue(true as never);
    vi.mocked(driverService.createDriversList).mockResolvedValue(ids.entity);
    vi.mocked(driverService.getLastDriversItemNumber).mockResolvedValue(0 as never);
    vi.mocked(driverService.updateDriversItem).mockResolvedValue(true as never);
    vi.mocked(packingService.createPackingListTx).mockResolvedValue(ids.entity);
    vi.mocked(packingService.getLastPackingItemNumber).mockResolvedValue(0 as never);
    vi.mocked(packingService.updatePackingItem).mockResolvedValue(true as never);
});

describe('authentication smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('registers a new local user and sends an activation email', async () => { await userController.registerUser(createAuthBody()); expect(mailer.sendActivationEmail).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects incomplete registration forms', async () => { await expectValidationFailure(() => userController.registerUser(createAuthBody({email: ''}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects mismatched registration passwords', async () => { await expectValidationFailure(() => userController.registerUser(createAuthBody({password_repeat: 'different'}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects duplicate usernames during registration', async () => { vi.mocked(userService.getUserByUsername).mockResolvedValue({id: 'existing'} as never); await expectValidationFailure(() => userController.registerUser(createAuthBody())); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('logs in active users and stores the selected profile in the session', async () => { vi.mocked(userService.getUserByUsername).mockResolvedValue({id: 'user-1', isActive: true, profiles: [{id: ids.profile}]} as never); const session = createSession({profile: undefined}); await userController.loginUser(createLoginBody(), session as never); expect(session.profile).toEqual({id: ids.profile}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects login when credentials are missing', async () => { await expectValidationFailure(() => userController.loginUser(createLoginBody({password: ''}), createSession() as never)); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects login for unknown users', async () => { await expectValidationFailure(() => userController.loginUser(createLoginBody(), createSession() as never)); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects login when password verification fails', async () => { vi.mocked(userService.getUserByUsername).mockResolvedValue({id: 'user-1'} as never); vi.mocked(userService.verifyPassword).mockResolvedValue(false); await expectValidationFailure(() => userController.loginUser(createLoginBody(), createSession() as never)); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('resends activation mail for inactive users with expired activation tokens', async () => { vi.mocked(userService.getUserByUsername).mockResolvedValue({id: 'user-1', email: 'o@example.com', isActive: false, activationTokenExpiration: new Date(0)} as never); await expectValidationFailure(() => userController.loginUser(createLoginBody(), createSession() as never)); expect(mailer.sendActivationEmail).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('sends password reset mail for known usernames', async () => { vi.mocked(userService.getUserByUsername).mockResolvedValue({username: 'organizer', email: 'o@example.com'} as never); await userController.sendPasswordForgotMail('organizer'); expect(mailer.sendPasswordResetEmail).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('does not reveal unknown users during password reset requests', async () => { await userController.sendPasswordForgotMail('missing'); expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects invalid password reset tokens', async () => { vi.mocked(userService.verifyPasswordResetToken).mockResolvedValue(null as never); await expectExpectedFailure(() => userController.checkPasswordForgotToken('bad'), 401); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('resets passwords for valid reset tokens', async () => { vi.mocked(userService.verifyPasswordResetToken).mockResolvedValue({username: 'organizer'} as never); await userController.resetPassword('token', {password: 'new', confirmPassword: 'new'}); expect(userService.resetPassword).toHaveBeenCalledWith('organizer', 'new'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('activates accounts with valid activation tokens', async () => { vi.mocked(userService.verifyActivationToken).mockResolvedValue({id: 'user-1'} as never); await userController.activateAccount('token'); expect(userService.activateUser).toHaveBeenCalledWith('user-1'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('delegates OIDC login startup to the OIDC module', async () => { vi.mocked(oidc.startLogin).mockResolvedValue('https://idp.example/login'); await expect(userController.loginUserWithOidc(createSession() as never)).resolves.toContain('https://'); });
});

describe('permissions smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each([
        () => expect(getInitialPerms('event').public).toBe(DEFAULT_PERM.DEFAULT_ENTITY),
        () => expect(getInitialPerms('event').participant).toBe(PERM.ACCESS_PARTICIPANTS),
        () => expect(getInitialPerms('survey').participant).toBeUndefined(),
        () => expect(hasPerm(DEFAULT_PERM.ADMIN, PERM.ACCESS_ADMIN)).toBe(true),
        () => expect(hasPerm(DEFAULT_PERM.ADMIN, PERM.MANAGE_PERMISSIONS)).toBe(true),
        () => expect(getPresetMask('FULL_ACCESS')).toBe(DEFAULT_PERM.FULL_ACCESS),
        () => expect(labelFromKey('MANAGE_PERMISSIONS')).toBe('Manage Permissions'),
        () => expect(toMask(['ACCESS_VIEW', 'ITEM_ADD'])).toBe(PERM.ACCESS_VIEW | PERM.ITEM_ADD),
        () => expect(toMask(undefined)).toBe(0),
        () => expect(toMaskFromBodyValue(undefined, PERM)).toBeUndefined(),
        () => expect(toMaskFromBodyValue('', PERM)).toBe(0),
        () => expect(toMaskFromBodyValue(['ACCESS_CREATE', 'ITEM_DELETE'], PERM)).toBe(PERM.ACCESS_CREATE | PERM.ITEM_DELETE),
        () => expect(permissionEngine.saveDefaultPermsFromBody).toBeDefined(),
        () => expect(maskEmail('organizer@example.com')).toContain('@'),
        () => expect(sanitizeForEmail('Hi\nBCC: bad@example.com')).not.toContain('\n'),
    ])('keeps permission behavior stable for smoke path %#', (assertion) => { assertion(); });
});

describe('surveys smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes survey creation data', () => { expect(surveyController.preprocessCreate(createSurveyBody())).toMatchObject({title: 'Camp Survey', combinations: [{weekday: 'MON', nthWeek: '1'}]}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes numeric-key combination objects from forms', () => { expect(surveyController.preprocessCreate(createSurveyBody({combinations: {0: {weekday: 'FRI', week: 'LAST'}}}))).toMatchObject({combinations: [{weekday: 'FRI', nthWeek: 'LAST'}]}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('stores blank survey descriptions as null', () => { expect(surveyController.preprocessCreate(createSurveyBody({description: ''})).description).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects surveys without date combinations', async () => { await expectValidationFailure(() => surveyController.preprocessCreate(createSurveyBody({combinations: []}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects invalid survey weekdays', async () => { await expectValidationFailure(() => surveyController.preprocessCreate(createSurveyBody({combinations: [{weekday: 'NOPE' as never, week: 1}]}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects invalid survey week choices', async () => { await expectValidationFailure(() => surveyController.preprocessCreate(createSurveyBody({combinations: [{weekday: 'MON', week: 9}]}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('creates surveys through the survey service', async () => { await surveyController.createEntity(ids.owner, surveyController.preprocessCreate(createSurveyBody())); expect(surveyService.createSurveyTx).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('adds valid combinations to existing surveys', async () => { await surveyController.addCombination({id: ids.entity} as never, 'TUE', '2'); expect(surveyService.addCombination).toHaveBeenCalledWith(ids.entity, 'TUE', '2'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects incomplete combination additions', async () => { await expectExpectedFailure(() => surveyController.addCombination({id: ids.entity} as never, '' as never, '2')); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('loads survey combinations for detail views', async () => { vi.mocked(surveyService.getCombinationsBySurveyId).mockResolvedValue([{id: 1}] as never); await surveyController.fetchForView({id: ids.entity} as never, {} as never); expect(surveyService.getCombinationsBySurveyId).toHaveBeenCalledWith(ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('loads survey responses for detail views', async () => { await surveyController.fetchForView({id: ids.entity} as never, {} as never); expect(surveyService.getResponsesSorted).toHaveBeenCalledWith(ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('duplicates surveys from existing combinations', async () => { await surveyController.fetchForDuplicate({id: ids.entity} as never, createSession() as never); expect(surveyService.getCombinationsBySurveyId).toHaveBeenCalledWith(ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('deletes surveys through the survey service', async () => { await surveyController.deleteEntity({id: ids.entity} as never, createSession() as never); expect(surveyService.deleteSurvey).toHaveBeenCalledWith(ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('clears previous survey responses before saving new ones', async () => { await surveyController.submitResponses({id: ids.entity} as never, createSession() as never, {'1': 'YES'}); expect(surveyService.deleteResponsesByProfileId).toHaveBeenCalledWith(ids.profile, ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('saves submitted survey answers for the current profile', async () => { await surveyController.submitResponses({id: ids.entity} as never, createSession() as never, {'1': 'YES'}); expect(surveyService.saveResponse).toHaveBeenCalledWith(ids.entity, ids.profile, 1, 'YES'); });
});

describe('events smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes event creation data', () => { expect(eventController.preprocessCreate(createEventBody())).toMatchObject({title: 'Summer Camp', requireDietaryInfo: true, allowDietComment: true}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('stores blank optional event fields as null', () => { expect(eventController.preprocessCreate(createEventBody({location: '', description: '', maxParticipants: ''}))).toMatchObject({location: null, description: null, maxParticipants: null}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects events where the start is after the end', async () => { await expectValidationFailure(() => eventController.preprocessCreate(createEventBody({startDate: '2026-08-10', endDate: '2026-08-05'}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects malformed event dates', async () => { await expectValidationFailure(() => eventController.preprocessCreate(createEventBody({startDate: 'soon'}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('creates events through the event service', async () => { await eventController.createEntity(ids.owner, eventController.preprocessCreate(createEventBody())); expect(eventService.createEventTx).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('saves default permissions after event creation', async () => { await eventController.afterCreateItems(ids.entity, {_body: {publicPerms: ['ACCESS_VIEW']}}); expect(permissionEngine.saveDefaultPermsFromBody).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('loads registrations for event detail views', async () => { await eventController.fetchForView({id: ids.entity, ownerId: ids.owner, maxParticipants: 10} as never, {session: createSession()} as never); expect(eventService.getRegistrationFor).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('marks events as full when participant count reaches capacity', async () => { vi.mocked(eventService.getEventParticipants).mockResolvedValue([{id: 1}] as never); const view = await eventController.fetchForView({id: ids.entity, ownerId: ids.owner, maxParticipants: 1} as never, {session: createSession()} as never); expect(view.isFull).toBe(true); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('returns related event module cards for owners or registered participants', async () => { vi.mocked(eventService.getRegistrationFor).mockResolvedValue({id: 'reg-1'} as never); vi.mocked(eventService.getActivityPlansForEvent).mockResolvedValue([{id: 'act-1', title: 'Activities', ownerId: ids.owner}] as never); const view = await eventController.fetchForView({id: ids.entity, ownerId: ids.owner} as never, {session: createSession()} as never); expect(view.relatedEntities).toEqual(convertToSingleList({activityPlans: [{id: 'act-1', title: 'Activities', ownerId: ids.owner}] as never})); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects event registration without authentication', async () => { await expectApiFailure(() => eventController.registerAttendance({id: ids.entity} as never, {}, {session: {}} as never), 401); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects event registration when the event is full', async () => { vi.mocked(eventService.isEventFull).mockResolvedValue(true); vi.mocked(eventService.isRegisteredForEvent).mockResolvedValue(false); await expectApiFailure(() => eventController.registerAttendance({id: ids.entity} as never, {}, {session: createSession()} as never), 403); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('calculates event date totals for participants', () => { expect(buildDateTotals('2026-08-05', '2026-08-07', [{arrivalDate: '2026-08-05', departureDate: '2026-08-06'}])).toMatchObject({'2026-08-05': 1}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('returns duplicate data from the source event', async () => { await expect(eventController.fetchForDuplicate({id: ids.entity} as never, createSession() as never)).resolves.toMatchObject({id: ids.entity}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('deletes events through the event service', async () => { await eventController.deleteEntity({id: ids.entity} as never, createSession() as never); expect(eventService.deleteEvent).toHaveBeenCalledWith(ids.entity); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates event header images through the controller contract', async () => { await expect(eventController.updateHeaderImg({id: ids.entity, headerImg: null} as never)).resolves.toBe('Image updated'); });
});

describe('activity plans smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes activity plan creation data and slots', () => { expect(activityController.preprocessCreate(createActivityBody())).toMatchObject({title: 'Camp Activities', slots: [{title: 'Breakfast'}]}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('stores blank activity descriptions as null', () => { expect(activityController.preprocessCreate(createActivityBody({description: ''})).description).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects invalid activity slot JSON', async () => { await expectValidationFailure(() => activityController.preprocessCreate(createActivityBody({slots: 'not-json'}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects activity plans without slots', async () => { await expectValidationFailure(() => activityController.preprocessCreate(createActivityBody({slots: JSON.stringify({})}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects activity slots outside the plan range', async () => { const body = createActivityBody({slots: JSON.stringify({'2026-09-01': [{id: ids.item, day: '2026-09-01', pos: 0, title: 'Late', startTime: '08:00', endTime: '09:00', maxAssignees: 1}]})}); await expectValidationFailure(() => activityController.preprocessCreate(body)); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('creates activity plans through the service', async () => { await activityController.createEntity(ids.owner, activityController.preprocessCreate(createActivityBody())); expect(activityService.createActivityPlanTx).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('saves default permissions after activity plan creation', async () => { await activityController.afterCreateItems(ids.entity, {_body: {publicPerms: ['ACCESS_VIEW']}}); expect(permissionEngine.saveDefaultPermsFromBody).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates activity descriptions through the API contract', async () => { await expect(activityController.updateDescription(ids.entity, {description: 'Updated'})).resolves.toBe('Description updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects too-long activity descriptions', async () => { await expectApiFailure(() => activityController.updateDescription(ids.entity, {description: 'x'.repeat(2001)}), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('quick-adds activity slots for authenticated users', async () => { await activityController.quickAddSlot({id: ids.entity, startDate: '2026-08-05', endDate: '2026-08-07'} as never, {date: '2026-08-05', title: 'Cleanup'}, createSession() as never); expect(activityService.addActivitySlot).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects quick-added activity slots without a title', async () => { await expectApiFailure(() => activityController.quickAddSlot({id: ids.entity, startDate: '2026-08-05', endDate: '2026-08-07'} as never, {date: '2026-08-05', title: ''}, createSession() as never), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates allowed activity slot fields', async () => { await expect(activityController.updateSlotAttr(ids.item, {field: 'title', value: 'Prep'}, {itemAllow: () => true} as never)).resolves.toBe('Slot updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects activity slot updates without item edit permission', async () => { await expectApiFailure(() => activityController.updateSlotAttr(ids.item, {field: 'title', value: 'Denied'}, {itemAllow: () => false} as never), 403); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('exposes assignment access mapping for slot assignment flows', () => { expect(Object.keys(activityController.getAssignmentAccessMapping())).toEqual(['assign', 'unassign']); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('exposes role access mapping for role-aware assignment flows', () => { expect(Object.keys(activityController.getRoleAccessMapping())).toEqual(['assign', 'unassign']); });
});

describe('drivers lists smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes driver list creation data', () => { expect(driversController.preprocessCreate(createDriversBody())).toMatchObject({title: 'Camp Drivers', eventId: ids.entity}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('stores blank driver descriptions as null', () => { expect(driversController.preprocessCreate(createDriversBody({description: ''})).description).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('allows standalone driver lists without an event', () => { expect(driversController.preprocessCreate(createDriversBody({event_id: ''})).eventId).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects driver lists without a title', async () => { await expectValidationFailure(() => driversController.preprocessCreate(createDriversBody({title: ''}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('creates driver lists through the service', async () => { await driversController.createEntity(ids.owner, driversController.preprocessCreate(createDriversBody())); expect(driverService.createDriversList).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('saves default permissions after driver list creation', async () => { await driversController.afterCreateItems(ids.entity, {_body: {publicPerms: ['ACCESS_VIEW']}}); expect(permissionEngine.saveDefaultPermsFromBody).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates driver list descriptions', async () => { await expect(driversController.updateDescription(ids.entity, {description: 'Updated'})).resolves.toBe('Description updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects too-long driver list descriptions', async () => { await expectApiFailure(() => driversController.updateDescription(ids.entity, {description: 'x'.repeat(2001)}), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('quick-adds driver seats for authenticated users', async () => { await driversController.quickAddItem({id: ids.entity} as never, {title: 'Airport pickup'}, createSession() as never); expect(driverService.createDriversItem).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects quick-added driver seats without a title', async () => { await expectApiFailure(() => driversController.quickAddItem({id: ids.entity} as never, {title: ''}, createSession() as never), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects driver quick-add when no profile is logged in', async () => { await expectApiFailure(() => driversController.quickAddItem({id: ids.entity} as never, {title: 'Pickup'}, {} as never), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates allowed driver item fields', async () => { await expect(driversController.updateItemAttr(ids.item, {field: 'title', value: 'Pickup'})).resolves.toBe('Item updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects unsupported driver item fields', async () => { await expectApiFailure(() => driversController.updateItemAttr(ids.item, {field: 'ownerId', value: 'bad'}), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('exposes driver assignment mappings', () => { expect(Object.keys(driversController.getAssignmentAccessMapping())).toEqual(['assign', 'unassign']); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('deletes driver items through the service', async () => { await driversController.deleteItem(ids.item); expect(driverService.deleteDriversItem).toHaveBeenCalledWith(ids.item); });
});

describe('packing lists smoke suite', () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('normalizes packing list creation data and items', () => { expect(packingController.preprocessCreate(createPackingBody())).toMatchObject({title: 'Camp Packing', items: [{title: 'Tent'}]}); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('stores blank packing descriptions as null', () => { expect(packingController.preprocessCreate(createPackingBody({description: ''})).description).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('allows standalone packing lists without an event', () => { expect(packingController.preprocessCreate(createPackingBody({event_id: ''})).eventId).toBeNull(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects invalid packing item JSON', async () => { await expectValidationFailure(() => packingController.preprocessCreate(createPackingBody({items: 'not-json'}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects packing lists without items', async () => { await expectValidationFailure(() => packingController.preprocessCreate(createPackingBody({items: JSON.stringify([])}))); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('creates packing lists through the service', async () => { await packingController.createEntity(ids.owner, packingController.preprocessCreate(createPackingBody())); expect(packingService.createPackingListTx).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('saves default permissions after packing list creation', async () => { await packingController.afterCreateItems(ids.entity, {_body: {publicPerms: ['ACCESS_VIEW']}}); expect(permissionEngine.saveDefaultPermsFromBody).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates packing list descriptions', async () => { await expect(packingController.updateDescription(ids.entity, {description: 'Updated'})).resolves.toBe('Description updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects too-long packing list descriptions', async () => { await expectApiFailure(() => packingController.updateDescription(ids.entity, {description: 'x'.repeat(2001)}), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('quick-adds packing items for authenticated users', async () => { await packingController.quickAddItem({id: ids.entity} as never, {title: 'Stove'}, createSession() as never); expect(packingService.addPackingItems).toHaveBeenCalled(); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects quick-added packing items without a title', async () => { await expectApiFailure(() => packingController.quickAddItem({id: ids.entity} as never, {title: ''}, createSession() as never), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates allowed packing item fields', async () => { await expect(packingController.updateItemAttr(ids.item, {field: 'title', value: 'Stove'})).resolves.toBe('Item updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('rejects unsupported packing item fields', async () => { await expectApiFailure(() => packingController.updateItemAttr(ids.item, {field: 'ownerId', value: 'bad'}), 400); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('updates required-by-all packing item state', async () => { await expect(packingController.updateRequired(ids.item, {flag: true})).resolves.toBe('Requirement updated'); });
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it('exposes packing assignment mappings', () => { expect(Object.keys(packingController.getAssignmentAccessMapping())).toEqual(['assign', 'unassign']); });
});
