import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as eventApi from '../../src/backend/controller/eventController';
import {eventFlow} from '../../src/backend/routes/eventFlow';

import {getEntityPropertyPresentation} from '../../src/backend/controller/entityAdminController';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {classifyApiError, validatedProblemBody} from '../../src/backend/modules/api/problem';
import {prepareValidatedJson} from '../../src/backend/modules/api/transport';
import type {Request} from 'express';
import type {components} from '../../src/types/api/v1';
import {PERM} from '../../src/backend/modules/lib/permissions';
import {randomUUID} from 'node:crypto';
import {registerAttendance, canBypassDeadlineWithToken, isEventFull,
    cancelRegistration} from '../../src/backend/modules/event/registration';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as driverService from '../../src/backend/modules/database/services/DriverService';
import * as packingService from '../../src/backend/modules/database/services/PackingService';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let other: Profile;
let editor: Profile;

function sessionFor(profile: Profile): SessionLike {
    return {profile, auth: {user: profile.user!}};
}

async function createEvent(title: string, capacity: number | null = 20): Promise<string> {
    const id = await createIntegrationEvent(owner.id, title, capacity);
    await eventApi.afterCreateItems(id, {_body: {defaultPerms: {authenticated: ['ACCESS_REGISTRATION']}}});
    return id;
}

/** These actors also remain isolated when a reviewed local run reuses an already
 * prepared disposable schema. Production account constraints still apply; neither
 * shared seed accounts nor the surrounding test rows need to be deleted. */
function persistEventActor(name: string): Promise<Profile> {
    const identity = randomUUID();
    return persistIntegrationProfile({name, username: `event-${identity}`, email: `${identity}@example.invalid`});
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistEventActor('Event owner');
    participant = await persistEventActor('Event participant');
    other = await persistEventActor('Other participant');
    editor = await persistEventActor('Event editor');
}, 120_000);

afterAll(closeIntegrationDatabase);

describe('versioned Event projections and native operation adoption', () => {
    it('admits participant export settings through the native combined grant without granting admin or edit access', async () => {
        const id = await createEvent('Independent participant export');
        const session = sessionFor(editor);
        await adminService.addAdmin('event', id, editor.id, PERM.ACCESS_VIEW | PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS);
        const event = (await eventService.getEventById(id))!;
        const native = await getEntityPropertyPresentation('event', event, session);
        expect(native.exportUrl).toBe(`/event/${id}/export/participants`);

        const view = await eventApi.readEvent(id, session);
        expect(view.capabilities).toMatchObject({settings: true, exportParticipants: true, admin: false});
        const settings = await eventApi.readEventSettings(id, session);
        expect(settings.capabilities).toMatchObject({export: true, editHeader: false, managePermissions: false, duplicate: false, remove: false});
        expect(settings.editableFields).toEqual([]);
        expect(settings.access).toBeNull();
        expect(contractValidator('EventSettings')(settings)).toBe(true);
        await expect(eventApi.readEvent(id, session, 'admin')).rejects.toMatchObject({status: 403});

        // Neither half of the native combined method grant admits an export or
        // an otherwise empty settings dialog. No private ACL projection leaks.
        for (const remaining of [PERM.DATA_EXPORT, PERM.ACCESS_PARTICIPANTS, 0]) {
            await adminService.updateAdminPerms('event', id, editor.id, PERM.ACCESS_VIEW | remaining);
            expect((await getEntityPropertyPresentation('event', event, session)).exportUrl).toBeUndefined();
            expect((await eventApi.readEvent(id, session)).capabilities).toMatchObject({settings: false, exportParticipants: false, admin: false});
            await expect(eventApi.readEventSettings(id, session)).rejects.toMatchObject({status: 403});
        }
    });

    it('creates and duplicates through the shared native validation, creator and ordered defaults owners', async () => {
        const values: components['schemas']['EventCreateInput'] = {title: 'Generated Event creator',
            startDate: '2027-06-01', endDate: '2027-06-03', maxParticipants: '24',
            bindingDeadline: '2027-05-20T12:30', deadlineTz: 'Europe/Berlin', requireDietaryInfo: true,
            allowDietComment: true, defaultPermissions: {public: 0, authenticated: PERM.ACCESS_REGISTRATION,
                guest: PERM.ACCESS_REGISTRATION, participant: PERM.ACCESS_ITEMS}};
        const result = await eventApi.createEvent(values, undefined, sessionFor(owner));
        expect(contractValidator('EventCreated')(result)).toBe(true);
        // Native tinyint columns retain numeric flags; the bounded wire copy
        // below independently projects those same true and false values.
        expect(await eventService.getEventById(result.id)).toMatchObject({title: values.title, ownerId: owner.id,
            maxParticipants: 24, requireDietaryInfo: 1, allowDietComment: 1,
            allowRegDietUpdateAfterDeadline: 0, timezone: 'Europe/Berlin'});
        expect(await adminService.getDefaultPerms('event', result.id)).toMatchObject(values.defaultPermissions);

        // A real saved attendee makes exclusion observable. An empty source
        // cannot detect accidental copying or destructive movement of attendance.
        await eventApi.saveEventRegistration(result.id, {arrivalDate: values.startDate, departureDate: values.endDate,
            dietary: ['MEAT']}, sessionFor(participant));
        const sourceAttendance = await eventService.getRegistrationsForEvent(result.id);
        expect(sourceAttendance).toHaveLength(1);
        expect(sourceAttendance[0]).toMatchObject({profileId: participant.id,
            arrivalDate: values.startDate, departureDate: values.endDate});

        const duplicate = await eventApi.readEventDuplicate(result.id, sessionFor(owner));
        expect(duplicate.values).toMatchObject({requireDietaryInfo: true, allowDietComment: true, allowRegDietUpdateAfterDeadline: false});
        const second = await eventApi.createEvent(duplicate.values, undefined, sessionFor(owner));
        expect(second.id).not.toBe(result.id);
        expect(await eventService.getEventById(second.id)).toMatchObject({title: values.title, headerImg: null});
        expect(await adminService.getDefaultPerms('event', second.id)).toMatchObject(values.defaultPermissions);
        expect(await eventService.getRegistrationsForEvent(second.id)).toEqual([]);
        expect(await eventService.getRegistrationsForEvent(result.id)).toEqual(sourceAttendance);

        // Native cross-field rejection finishes before the creator is entered;
        // this outcome is confirmed validation rather than uncertain completion.
        await expect(eventApi.createEvent({...values, startDate: '2027-06-05'}, undefined, sessionFor(owner)))
            .rejects.toMatchObject({name: 'ValidationError'});
        await expect(eventApi.createEvent(values, undefined, {})).rejects.toMatchObject({status: 401});
    });

    it('hard-deletes only currently linked owned children through their existing feature operations', async () => {
        const id = await createEvent('Scoped hard deletion');
        const foreignId = await createEvent('Foreign deletion host');
        const activityId = randomUUID();
        const packingId = randomUUID();
        await activityService.createActivityPlan(activityId, owner.id, 'Delete Activity child', '', '2027-06-01', '2027-06-03', id);
        await packingService.createPackingList(packingId, owner.id, 'Delete Packing child', '', id);
        const driversId = await driverService.createDriversList(owner.id, 'Delete Drivers child', '', id);
        await expect(eventApi.deleteEventChild(foreignId, 'activity', activityId, sessionFor(owner), 'admin'))
            .rejects.toMatchObject({status: 404});
        expect(await activityService.getActivityPlanById(activityId)).not.toBeNull();

        // Event ownership or administration does not confer ownership of a child.
        const otherChild = randomUUID();
        await activityService.createActivityPlan(otherChild, participant.id, 'Other profile child', '', '2027-06-01', '2027-06-03', id);
        await expect(eventApi.deleteEventChild(id, 'activity', otherChild, sessionFor(owner), 'admin'))
            .rejects.toMatchObject({status: 403});
        expect(await activityService.getActivityPlanById(otherChild)).not.toBeNull();

        for (const [type, childId] of [['activity', activityId], ['packing', packingId], ['drivers', driversId]] as const) {
            expect(await eventApi.deleteEventChild(id, type, childId, sessionFor(owner), 'admin')).toEqual({changed: true});
        }
        expect(await activityService.getActivityPlanById(activityId)).toBeNull();
        expect(await packingService.getPackingListById(packingId)).toBeNull();
        expect(await driverService.getDriversListById(driversId)).toBeNull();
        expect(await eventService.getEventById(id)).not.toBeNull();
    });

    it('keeps native detail, versioned detail and registration capacity policy aligned for absent, zero and reached limits', async () => {
        const id = await createEvent('Shared Event capacity policy');
        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);

        // Persist the edge limits directly: creation still independently requires
        // positive capacity, while existing stored zero and NULL retain their meaning.
        for (const {limit, full} of [{limit: null, full: false}, {limit: 0, full: true},
        {limit: 1, full: true}, {limit: 2, full: false}]) {
            await eventService.updateEventProperties(id, {maxParticipants: limit});
            const current = (await eventService.getEventById(id))!;

            // Exercise the actual three production consumers with real persistence,
            // preserving each projection's normal data acquisition and actor scope.
            const native = await eventApi.fetchForView(current, {session: sessionFor(owner)} as Request);
            const versioned = await eventApi.readEvent(id, sessionFor(owner));
            expect(native.isFull).toBe(full);
            expect(versioned.isFull).toBe(full);
            expect(versioned.registrationCount).toBe(1);
            expect(await isEventFull(id)).toBe(full);
        }
    });

    it('shares related-content membership without letting administration or item admission substitute for attendance', async () => {
        const id = await createEvent('Shared Event child admission');
        const activityId = randomUUID();
        await activityService.createActivityPlan(activityId, owner.id, 'Related activity', '', '2027-06-01', '2027-06-03', id);
        await adminService.addAdmin('event', id, editor.id, PERM.ACCESS_ADMIN | PERM.ACCESS_ITEMS);
        const event = (await eventService.getEventById(id))!;

        /** Native and versioned consumers retain their own page/method admission. */
        async function expectRelatedContent(expected: number): Promise<void> {
            const native = await eventApi.fetchForView(event, {session: sessionFor(editor)} as Request);
            expect(native.relatedEntities).toHaveLength(expected);
            expect((await eventApi.readEventThingsToDo(id, sessionFor(editor), 'detail')).items).toHaveLength(expected);
            expect((await eventApi.readEventThingsToDo(id, sessionFor(editor), 'admin')).items).toHaveLength(expected);
        }

        // Detail/admin method grants alone do not supply the separate related-content
        // membership. Either own attendance or assignment-management authority does.
        await expectRelatedContent(0);
        await eventService.register(id, '2027-06-01', '2027-06-03', editor.id);
        await expectRelatedContent(1);
        await eventService.deleteRegistrationFor(id, editor.id);
        await adminService.updateAdminPerms('event', id, editor.id, PERM.ACCESS_ADMIN | PERM.ACCESS_ITEMS | PERM.MANAGE_ASSIGNMENTS);
        await expectRelatedContent(1);
    });

    it('projects only own attendance and counts without roster, invoice, account or storage details', async () => {
        const id = await createEvent('Private Event projections');
        await eventService.updateHeaderImage(id, 'uploads/private-event-storage.png');
        // Native header delivery precedes page admission. Its controller can
        // resolve this public method while full Event details remain profile-only.
        expect(await eventApi.readEventHeaderPath(id, {})).toBe('uploads/private-event-storage.png');
        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id, ['VEGAN']);
        await eventService.register(id, '2027-06-02', '2027-06-02', other.id, ['MEAT', 'ALLERGIES'], 'Private allergy');

        const view = await eventApi.readEvent(id, sessionFor(participant));
        expect(contractValidator('EventView')(view)).toBe(true);
        expect(view).toMatchObject({id, registrationCount: 2, isFull: false, hasInvoicePools: false,
            registration: {arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: ['VEGAN']},
            capabilities: {participants: false, manageRegistrations: false, admin: false}});
        const serialized = JSON.stringify(view);
        for (const hidden of ['ownerId', 'participants', 'invoicePools', 'Private allergy', other.id,
            other.user!.email, 'private-event-storage']) {
            // The participants capability key is expected; a roster collection is forbidden.
            if (hidden !== 'participants') expect(serialized).not.toContain(hidden);
        }
        expect(view).not.toHaveProperty('participants');
        await invoiceService.createPool(id, 'Private pool name', undefined, 'EQUAL', false, false, false);
        const withFinanceDestination = await eventApi.readEvent(id, sessionFor(participant));
        expect(withFinanceDestination.hasInvoicePools).toBe(true);
        expect(JSON.stringify(withFinanceDestination)).not.toContain('Private pool name');
        expect((await eventApi.readEvent(id, sessionFor(owner))).hasInvoicePools).toBe(false);
        await expect(eventApi.readEventParticipants(id, sessionFor(participant))).rejects.toMatchObject({status: 403});
        await expect(eventApi.readEvent(id, {})).rejects.toMatchObject({status: 401});
    });

    it('keeps page, administration, roster and registration-management grants independent', async () => {
        const id = await createEvent('Independent Event grants');
        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);
        await adminService.addAdmin('event', id, editor.id, PERM.ACCESS_ADMIN);
        expect((await eventFlow.readResourceEntry(id, 'admin', sessionFor(editor))).entry.kind).toBe('render');
        await expect(eventApi.readEventParticipants(id, sessionFor(editor))).rejects.toMatchObject({status: 403});

        await adminService.updateAdminPerms('event', id, editor.id, PERM.ACCESS_PARTICIPANTS);
        expect((await eventFlow.readResourceEntry(id, 'admin', sessionFor(editor))).entry)
            .toMatchObject({kind: 'denied', status: 403});
        const roster = await eventApi.readEventParticipants(id, sessionFor(editor));
        expect(contractValidator('EventParticipants')(roster)).toBe(true);
        expect(roster.participants).toHaveLength(1);
        await expect(eventApi.removeEventRegistration(id, roster.participants[0].id, sessionFor(editor)))
            .rejects.toMatchObject({status: 403});
        expect((await eventFlow.readResourceEntry(id, 'detail', sessionFor(editor))).entry.kind).toBe('render');
    });

    it('preserves local deadline meaning and omitted metadata through a title-only locked update', async () => {
        const id = await createEvent('Zoned Event metadata');
        await eventService.updateEventProperties(id, {bindingDeadline: '2027-06-01T10:20:30Z', timezone: 'Europe/Berlin',
            allowRegDietUpdateAfterDeadline: true});
        await adminService.addAdmin('event', id, editor.id, PERM.EDIT_TITLE);
        const limited = await eventApi.readEventMetadata(id, sessionFor(editor));
        expect(limited.values).toEqual({title: 'Zoned Event metadata'});
        expect(limited.editableFields).toEqual(['title']);
        await expect(eventApi.patchEventMetadata(id, {location: 'Hidden update'}, limited.editToken, sessionFor(editor)))
            .rejects.toMatchObject({status: 403});

        const baseline = await eventApi.readEventMetadata(id, sessionFor(owner));
        expect(contractValidator('EventMetadata')(baseline)).toBe(true);
        expect(baseline.values).toMatchObject({bindingDeadline: '2027-06-01T12:20:30', deadlineTz: 'Europe/Berlin',
            allowRegDietUpdateAfterDeadline: true});
        await eventApi.patchEventMetadata(id, {title: 'Changed Event title'}, baseline.editToken, sessionFor(owner));
        const saved = (await eventService.getEventById(id))!;
        expect(new Date(saved.bindingDeadline!).toISOString()).toBe('2027-06-01T10:20:30.000Z');
        expect(saved.timezone).toBe('Europe/Berlin');
        expect(Boolean(saved.allowRegDietUpdateAfterDeadline)).toBe(true);
        await expect(eventApi.patchEventMetadata(id, {title: 'Stale title'}, baseline.editToken, sessionFor(owner)))
            .rejects.toMatchObject({status: 412});
    });

    it('explains structurally valid metadata rejections after real admission without changing saved Event properties', async () => {
        const id = await createEvent('Saved Event before invalid metadata');
        const session = sessionFor(owner);
        const baseline = await eventApi.readEventMetadata(id, session);
        const original = (await eventService.getEventById(id))!;
        for (const {body, code} of [
            {body: {maxParticipants: 0}, code: 'EVENT_PARTICIPANT_LIMIT_INVALID'},
            {body: {startDate: '2030-02-30'}, code: 'EVENT_CALENDAR_DATE_INVALID'},
            {body: {title: '   '}, code: 'EVENT_TITLE_INVALID'},
            {body: {description: '😀'.repeat(8001)}, code: 'EVENT_DESCRIPTION_TOO_LONG'},
        ]) {
            expect(contractValidator('EventMetadataPatch')(body)).toBe(true);
            const error = await eventApi.patchEventMetadata(id, body, baseline.editToken, session).catch(failure => failure);
            expect(error).toMatchObject({name: 'APIError', status: 400, cause: code, data: {}});
            const problem = classifyApiError(error);
            for (const locale of ['en', 'de']) {
                const response = validatedProblemBody(problem, locale, 'persisted-event-metadata');
                expect(contractValidator('Problem')(response)).toBe(true);
                expect(response).toMatchObject({code, status: 400, params: {}});
                expect(response.detail).not.toContain('submitted values');
                expect(response.detail).not.toBe(error.message);
            }
            expect(await eventService.getEventById(id)).toMatchObject({title: original.title, description: original.description,
                maxParticipants: original.maxParticipants, startDate: original.startDate, endDate: original.endDate});
        }
    });

    it('updates existing attendance at capacity without duplicate registrations and replaces dietary choices', async () => {
        const id = await createEvent('Full Event update', 1);
        await eventApi.saveEventRegistration(id, {arrivalDate: '2027-06-01', departureDate: '2027-06-03',
            dietary: ['MEAT', 'MEAT']}, sessionFor(participant));
        await eventApi.saveEventRegistration(id, {arrivalDate: '2027-06-02', departureDate: '2027-06-03',
            dietary: ['VEGAN', 'ALLERGIES'], allergyNotes: 'Peanuts'}, sessionFor(participant));
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(1);
        expect((await eventService.getRegistrationFor(participant.id, id))?.dietaryChoices)
            .toMatchObject([{choice: 'VEGAN'}, {choice: 'ALLERGIES', additionalInfo: 'Peanuts'}]);
        await expect(eventApi.saveEventRegistration(id, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'}, sessionFor(other)))
            .rejects.toMatchObject({status: 403});
    });

    it('serializes two new registrations for the final place and preserves the winner’s updates', async () => {
        const id = await createEvent('One remaining Event place', 1);
        const body = {arrivalDate: '2027-06-01', departureDate: '2027-06-03'};
        const results = await Promise.allSettled([
            eventApi.saveEventRegistration(id, body, sessionFor(participant)),
            eventApi.saveEventRegistration(id, body, sessionFor(other)),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toEqual([
            expect.objectContaining({reason: expect.objectContaining({status: 403, cause: 'EVENT_FULL'})}),
        ]);
        const rows = await eventService.getRegistrationsForEvent(id);
        expect(rows).toHaveLength(1);
        const winner = rows[0].profileId === participant.id ? participant : other;
        await eventApi.saveEventRegistration(id, {...body, departureDate: '2027-06-02'}, sessionFor(winner));
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(1);
        expect(await eventService.getRegistrationFor(winner.id, id)).toMatchObject({departureDate: '2027-06-02'});
    });

    it('uses locked current capacity instead of an earlier Event snapshot', async () => {
        const id = await createEvent('Changed Event capacity', 20);
        const before = (await eventService.getEventById(id))!;
        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);
        await eventService.updateEventProperties(id, {maxParticipants: 1});
        await expect(eventApi.registerAttendance(before,
            {arrivalDate: '2027-06-01', departureDate: '2027-06-03'}, {session: sessionFor(other)}))
            .rejects.toMatchObject({status: 403, cause: 'EVENT_FULL'});
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(1);
    });

    it('accepts absent or blank unchanged dietary notes after the deadline without allowing real dietary edits', async () => {
        const id = await createEvent('Dietary note equivalence');
        const body = {arrivalDate: '2027-06-01', departureDate: '2027-06-03', dietary: ['MEAT'] as const};
        await eventApi.saveEventRegistration(id, {...body, dietary: [...body.dietary]}, sessionFor(participant));
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z',
            allowRegDateUpdatesAfterDeadline: true, allowRegDietUpdateAfterDeadline: false});
        for (const notes of [{}, {allergyNotes: '', dietComment: ''}, {allergyNotes: '  ', dietComment: '  '}]) {
            await eventApi.saveEventRegistration(id, {...body, dietary: [...body.dietary], ...notes,
                departureDate: '2027-06-02'}, sessionFor(participant));
        }
        expect(await eventService.getRegistrationFor(participant.id, id)).toMatchObject({departureDate: '2027-06-02',
            dietaryChoices: [{choice: 'MEAT', additionalInfo: null}]});
        await expect(eventApi.saveEventRegistration(id, {...body, dietary: ['MEAT', 'COMMENT'], dietComment: 'A real change'},
            sessionFor(participant))).rejects.toMatchObject({status: 403, cause: 'EVENT_DIET_UPDATES_CLOSED'});
    });

    it('preserves native own-profile cancellation no-ops and checks the deadline before deleting attendance', async () => {
        const id = await createEvent('Cancellation parity');
        const event = (await eventService.getEventById(id))!;
        // An admitted profile without attendance is a successful native no-op,
        // including a second cancellation after another tab removed its row.
        await expect(cancelRegistration(event, sessionFor(participant))).resolves.toBe('Registration cancelled');
        await expect(eventApi.cancelEventRegistration(id, sessionFor(participant))).resolves.toEqual({changed: true});
        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);
        await expect(eventApi.cancelEventRegistration(id, sessionFor(participant))).resolves.toEqual({changed: true});
        await expect(eventApi.cancelEventRegistration(id, sessionFor(participant))).resolves.toEqual({changed: true});
        expect(await eventService.getRegistrationFor(participant.id, id)).toBeNull();

        await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z', allowRegCancelationAfterDeadline: false});
        const closed = (await eventService.getEventById(id))!;
        for (const profile of [participant, other]) {
            await expect(cancelRegistration(closed, sessionFor(profile)))
                .rejects.toMatchObject({status: 403, cause: 'EVENT_CANCELLATION_CLOSED'});
            await expect(eventApi.cancelEventRegistration(id, sessionFor(profile)))
                .rejects.toMatchObject({status: 403, cause: 'EVENT_CANCELLATION_CLOSED'});
        }
        expect(await eventService.getRegistrationFor(participant.id, id)).not.toBeNull();
        await expect(eventApi.cancelEventRegistration(id, {})).rejects.toMatchObject({status: 401});
    });

    it('preserves anonymously granted metadata methods without disclosing detail or unrelated fields', async () => {
        const id = await createEvent('Public Event description method');
        await adminService.updatePerms('event', id, {public: PERM.EDIT_DESC, authenticated: 0, guest: 0, participant: 0});
        const baseline = await eventApi.readEventMetadata(id, {});
        expect(baseline.editableFields).toEqual(['description']);
        expect(baseline.values).toEqual({description: 'A production-shaped integration workflow'});
        await expect(eventApi.readEvent(id, {})).rejects.toMatchObject({status: 401});
        await expect(eventApi.patchEventMetadata(id, {title: 'Forbidden title'}, baseline.editToken, {}))
            .rejects.toMatchObject({status: 403});
        await eventApi.patchEventMetadata(id, {description: 'Publicly edited description'}, baseline.editToken, {});
        expect((await eventService.getEventById(id))!.description).toBe('Publicly edited description');

        await adminService.updatePerms('event', id, {public: 0});
        await expect(eventApi.readEventMetadata(id, {})).rejects.toMatchObject({status: 403});
        await expect(eventApi.patchEventMetadata(id, {description: 'Revoked write'}, baseline.editToken, {}))
            .rejects.toMatchObject({status: 403});
    });

    it('rolls back a metadata write when its actual generated response preparation rejects', async () => {
        const id = await createEvent('Event before failed delivery preparation');
        const baseline = await eventApi.readEventMetadata(id, sessionFor(owner));
        await expect(eventApi.patchEventMetadata(id, {title: 'Must roll back'}, baseline.editToken, sessionFor(owner), saved => {
            // Deliberately malformed output reaches the production generated validator,
            // exercising its failure while the actual metadata transaction is still open.
            const malformed = {...saved, values: {...saved.values, title: 42}} as unknown as components['schemas']['EventMetadata'];
            return prepareValidatedJson({} as Request, 'updateEventMetadata', 200, malformed);
        })).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        expect((await eventService.getEventById(id))!.title).toBe('Event before failed delivery preparation');
    });

    it('carries a bypass token through entry reads without consumption and spends it only on submission', async () => {
        const id = await createEvent('Token continuity');
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z'});
        const link = await eventApi.addEventRegistrationLink(id, {maxUses: 1}, sessionFor(owner));
        expect((await eventFlow.readResourceEntry(id, 'detail', {}, link.token)).entry)
            .toMatchObject({kind: 'redirect', url: `/event/${id}/guest?regToken=${link.token}`});
        expect((await eventFlow.readResourceEntry(id, 'guest', {}, link.token)).guest).toEqual({id, title: 'Token continuity'});
        expect(await canBypassDeadlineWithToken(id, link.token)).toEqual({ok: true, linkId: link.id});
        const storedLink = (await eventService.listDeadlineBypassLinks(id))[0];
        expect(storedLink.usedCount).toBe(0);
        expect(storedLink.maxUses).toBe(1);

        await eventApi.saveEventRegistration(id, {arrivalDate: '2027-06-01', departureDate: '2027-06-03', regToken: link.token}, sessionFor(participant));
        expect(await canBypassDeadlineWithToken(id, link.token)).toEqual({ok: false});
        expect((await eventApi.readEventRegistrationLinks(id, sessionFor(owner))).items[0]).toMatchObject({status: 'consumed', used: true});
    });

    it('honors requested link uses and admits only one contender for its final use', async () => {
        const id = await createEvent('Two-use Event link');
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z'});
        const link = await eventApi.addEventRegistrationLink(id, {maxUses: 2}, sessionFor(owner));
        const body = {arrivalDate: '2027-06-01', departureDate: '2027-06-03', regToken: link.token};
        await eventApi.saveEventRegistration(id, body, sessionFor(participant));
        expect((await eventService.listDeadlineBypassLinks(id))[0]).toMatchObject({maxUses: 2, usedCount: 1});
        expect(await canBypassDeadlineWithToken(id, link.token)).toMatchObject({ok: true});
        const results = await Promise.allSettled([
            eventApi.saveEventRegistration(id, body, sessionFor(other)),
            eventApi.saveEventRegistration(id, body, sessionFor(editor)),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(2);
        expect((await eventService.listDeadlineBypassLinks(id))[0]).toMatchObject({maxUses: 2, usedCount: 2});
        expect(await canBypassDeadlineWithToken(id, link.token)).toEqual({ok: false});
    });

    it('preserves default single-use issuance, expiry and revocation and rolls back consumption on a failed attendance write', async () => {
        const id = await createEvent('Event link boundaries');
        const ordinary = await eventApi.addEventRegistrationLink(id, {}, sessionFor(owner));
        const expired = await eventApi.addEventRegistrationLink(id, {maxUses: 2, expiresAt: '2000-01-01T00:00:00Z'}, sessionFor(owner));
        const revoked = await eventApi.addEventRegistrationLink(id, {maxUses: 2}, sessionFor(owner));
        await eventApi.revokeEventRegistrationLink(id, revoked.id, sessionFor(owner));
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z'});
        for (const link of [expired, revoked]) {
            await expect(eventApi.saveEventRegistration(id,
                {arrivalDate: '2027-06-01', departureDate: '2027-06-03', regToken: link.token}, sessionFor(participant)))
                .rejects.toMatchObject({status: 403, cause: 'EVENT_DEADLINE_PASSED'});
        }
        const event = (await eventService.getEventById(id))!;
        const vanished = {...participant, id: randomUUID()};
        await expect(registerAttendance(event, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'},
            sessionFor(vanished), ordinary.token)).rejects.toBeTruthy();
        const stored = (await eventService.listDeadlineBypassLinks(id)).find(link => link.id === ordinary.id)!;
        expect(stored).toMatchObject({maxUses: 1, usedCount: 0, usedAt: null});
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(0);
    });

    it('retains the existing final-use token lock across concurrent registrations', async () => {
        const id = await createEvent('Concurrent token use');
        await eventService.updateEventProperties(id, {bindingDeadline: '2000-01-01T00:00:00Z'});
        const link = await eventApi.addEventRegistrationLink(id, {}, sessionFor(owner));
        const body = {arrivalDate: '2027-06-01', departureDate: '2027-06-03', regToken: link.token};
        const results = await Promise.allSettled([
            eventApi.saveEventRegistration(id, body, sessionFor(participant)),
            eventApi.saveEventRegistration(id, body, sessionFor(other)),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(await eventService.getRegistrationsForEvent(id)).toHaveLength(1);
        expect((await eventService.listDeadlineBypassLinks(id))[0].usedCount).toBe(1);
    });

    it('rejects foreign-event organizer edits and removals without changing the actual registration', async () => {
        const id = await createEvent('Organizer target');
        const foreignId = await createEvent('Other Event');
        await eventService.register(foreignId, '2027-06-01', '2027-06-03', participant.id);
        const registration = (await eventService.getRegistrationFor(participant.id, foreignId))!;
        await expect(eventApi.editEventRegistration(id, String(registration.id),
            {arrivalDate: '2027-06-02', departureDate: '2027-06-03'}, sessionFor(owner))).rejects.toMatchObject({status: 404});
        await expect(eventApi.removeEventRegistration(id, String(registration.id), sessionFor(owner))).rejects.toMatchObject({status: 404});
        expect((await eventService.getRegistrationFor(participant.id, foreignId))?.arrivalDate).toBe('2027-06-01');
    });

    it('reuses shared audience and administrator owners with independent reviewed comparisons', async () => {
        const id = await createEvent('Shared Event access');
        const defaults = await eventApi.readEventDefaultsBaseline(id, sessionFor(owner));
        await eventApi.updateEventDefaults(id, {public: PERM.ACCESS_PARTICIPANTS}, sessionFor(owner), defaults.editToken);
        expect((await eventApi.readEventParticipants(id, {})).participants).toEqual([]);
        const administrator = await eventApi.readEventAdminBaseline(id, editor.id, sessionFor(owner));
        await eventApi.setEventAdmin(id, editor.id, PERM.ACCESS_ADMIN, sessionFor(owner), administrator.editToken);
        expect((await eventFlow.readResourceEntry(id, 'admin', sessionFor(editor))).entry.kind).toBe('render');
        const saved = await eventApi.readEventAdminBaseline(id, editor.id, sessionFor(owner));
        await eventApi.setEventAdmin(id, editor.id, null, sessionFor(owner), saved.editToken);
        expect((await eventFlow.readResourceEntry(id, 'admin', sessionFor(editor))).entry.kind).toBe('denied');
    });

    it('retains organizer owner actions for Activity and Drivers children independently of participant cards', async () => {
        const id = await createEvent('Mixed Event children');
        const activityId = randomUUID();
        await activityService.createActivityPlan(activityId, owner.id, 'Event activity', '', '2027-06-01', '2027-06-03', id);
        const driversId = await driverService.createDriversList(owner.id, 'Event drivers', '', id);
        await eventService.register(id, '2027-06-01', '2027-06-03', owner.id);

        const admin = await eventApi.readEventThingsToDo(id, sessionFor(owner), 'admin');
        expect(contractValidator('EventThingsToDo')(admin)).toBe(true);
        expect(admin.items.map(card => card.id)).toEqual(expect.arrayContaining([activityId, driversId]));
        for (const card of admin.items) expect(card.capabilities).toMatchObject({duplicate: true, remove: true});
        const detail = await eventApi.readEventThingsToDo(id, sessionFor(owner), 'detail');
        for (const card of detail.items) expect(card.capabilities).toMatchObject({duplicate: false, remove: false});

        // A scoped URL cannot archive a card belonging to another Event.
        const foreignEvent = await createEvent('Foreign child scope');
        await expect(eventApi.setEventChildArchived(foreignEvent, 'activity', activityId, true, sessionFor(owner), 'admin'))
            .rejects.toMatchObject({status: 404});
        expect((await activityService.getActivityPlanById(activityId))!.archivedAt).toBeNull();
    });
});
