import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import eventController, {authorizeEventLink, getEventLinkOptions} from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import {archiveEntity, canAccessEntityView, changeEntityEvent, getEntityPropertyPresentation, requireEntityPropertyUpdate} from '../../src/controller/entityAdminController';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Event} from '../../src/modules/database/entities/event/Event';
import {EventRegistration} from '../../src/modules/database/entities/event/EventRegistration';
import {EntityAdminAssignment} from '../../src/modules/database/entities/permissions/EntityAdminAssignment';
import {EntityPermissions} from '../../src/modules/database/entities/permissions/EntityPermissions';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import {PERM} from '../../src/modules/lib/permissions';
import {buildPermBundle} from '../../src/modules/permissionEngine';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, createPackingListWithItem, createSurveyWithCombinations, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let editor: Profile;
let outsider: Profile;

function sessionFor(profile: Profile): SessionLike {
    return {profile, auth: {user: profile.user!}};
}

async function eventPermissions(event: Event, profile: Profile) {
    return buildPermBundle({entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id}, [], sessionFor(profile));
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Property owner'});
    editor = await persistIntegrationProfile({name: 'Property editor'});
    outsider = await persistIntegrationProfile({name: 'Other property owner'});
}, 120_000);

afterAll(closeIntegrationDatabase);

describe('entity property permissions and atomic persistence', () => {
    it('projects only title data for a title-only editor and rejects forged metadata', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE);
        const list = (await packingService.getPackingListById(id))!;
        const projection = await getEntityPropertyPresentation('packing', list, sessionFor(editor));
        expect(projection.editableFields).toEqual(['title']);
        expect(projection.values).toEqual({title: list.title});
        expect(projection).toMatchObject({canLinkEvent: false, canEditHeader: false, canDelete: false});
        await expect(requireEntityPropertyUpdate('packing', list, {title: 'Allowed', description: 'Forbidden'}, sessionFor(editor)))
            .rejects.toMatchObject({status: 403});
        await requireEntityPropertyUpdate('packing', list, {title: 'Saved title'}, sessionFor(editor));
        await packingController.updateProperties(list, {title: 'Saved title'});
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Saved title', description: list.description});
    });

    it('validates the entire basic property update before saving either field', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const list = (await packingService.getPackingListById(id))!;
        await expect(packingController.updateProperties(list, {title: 'Must not save', description: 'x'.repeat(16001)})).rejects.toMatchObject({status: 400});
        expect(await packingService.getPackingListById(id)).toMatchObject({title: list.title, description: list.description});
        await packingController.updateDescription(id, {description: ''});
        expect((await packingService.getPackingListById(id))!.description).toBeNull();
    });

    it('keeps survey property writes owner-only despite general permission rows', async () => {
        const [id] = await createSurveyWithCombinations(owner.id);
        const survey = (await surveyService.getSurveyById(id))!;
        await adminService.addAdmin('survey', id, editor.id, PERM.EDIT_TITLE | PERM.EDIT_DESC);
        expect((await getEntityPropertyPresentation('survey', survey, sessionFor(editor))).editableFields).toEqual([]);
        await expect(requireEntityPropertyUpdate('survey', survey, {title: 'Forbidden'}, sessionFor(editor))).rejects.toMatchObject({status: 403});
        await requireEntityPropertyUpdate('survey', survey, {title: 'Owner title'}, sessionFor(owner));
        await surveyController.updateProperties(survey, {title: 'Owner title'});
        expect((await surveyService.getSurveyById(id))!.title).toBe('Owner title');
    });

    it('checks canonical event flag permissions and allows a requirements-only editor', async () => {
        const id = await createIntegrationEvent(owner.id, 'Canonical property permissions');
        const event = (await eventService.getEventById(id))!;
        await adminService.addAdmin('event', id, editor.id, PERM.MANAGE_REQUIREMENTS);
        const permissions = await eventPermissions(event, editor);
        await expect(eventController.updateEventSettings(event, {allowRegDateUpdatesAfterDeadline: 'on'}, permissions)).rejects.toMatchObject({status: 403});
        await expect(eventController.updateEventSettings(event, {allowRegCancelationAfterDeadline: 'on'}, permissions)).rejects.toMatchObject({status: 403});
        await eventController.updateEventSettings(event, {allowRegDietUpdateAfterDeadline: 'on', requireDietaryInfo: false}, permissions);
        const saved = (await eventService.getEventById(id))!;
        expect(Boolean(saved.allowRegDietUpdateAfterDeadline)).toBe(true);
        expect(Boolean(saved.requireDietaryInfo)).toBe(false);
    });

    it('keeps dates and zoned deadline untouched on title-only saves and rejects invalid combined dates atomically', async () => {
        const id = await createIntegrationEvent(owner.id, 'Atomic event properties');
        await eventService.updateEventProperties(id, {bindingDeadline: '2027-06-01T10:30:00Z', timezone: 'Europe/Berlin'});
        const event = (await eventService.getEventById(id))!;
        const projection = await getEntityPropertyPresentation('event', event, sessionFor(owner));
        expect(projection.values.bindingDeadline).toBe('2027-06-01T12:30:00');
        const permissions = await eventPermissions(event, owner);
        await expect(eventController.updateEventSettings(event, {title: 'Must not save', startDate: '2027-08-01'}, permissions)).rejects.toMatchObject({status: 400});
        expect((await eventService.getEventById(id))!.title).toBe(event.title);
        await eventController.updateEventSettings(event, {title: 'Only title'}, permissions);
        const saved = (await eventService.getEventById(id))!;
        expect(saved.startDate).toBe(event.startDate);
        expect(saved.bindingDeadline).toEqual(event.bindingDeadline);
        expect(saved.timezone).toBe('Europe/Berlin');
    });
});

describe('authorized event discovery and reassociation', () => {
    it('treats search wildcard characters as literal title text', async () => {
        const exact = await createIntegrationEvent(editor.id, 'Picker literal 100%_done!');
        await createIntegrationEvent(editor.id, 'Picker literal 100-percent-done!');
        const result = await getEventLinkOptions({q: '100%_done!'}, sessionFor(editor));
        expect(result.items.map(item => item.id)).toEqual([exact]);
    });

    it('includes archived ended destinations and participant-derived attachment grants', async () => {
        const id = await createIntegrationEvent(owner.id, 'Historical picker destination');
        await eventService.updateEventDates(id, '2000-01-01', '2000-01-02');
        await archiveEntity({type: 'event', id}, {}, sessionFor(owner));
        await adminService.updatePerms('event', id, {participant: PERM.MANAGE_ASSIGNMENTS});
        await eventService.register(id, '2000-01-01', '2000-01-02', editor.id);
        const result = await getEventLinkOptions({q: 'Historical picker destination', period: 'ended', archive: 'archived'}, sessionFor(editor));
        expect(result.items).toEqual([expect.objectContaining({id, archived: true})]);
        expect((await authorizeEventLink(id, sessionFor(editor)))!.id).toBe(id);
        await expect(authorizeEventLink(id, sessionFor(outsider))).rejects.toMatchObject({status: 403});
    });

    it('filters denied events before pagination and does not expose private titles', async () => {
        const privateRows = [];
        for (let index = 0; index < 301; index++) {
            privateRows.push({id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, owner: outsider,
                title: `Sparse picker private ${index}`, startDate: '2000-01-01', endDate: '2000-01-02'});
        }
        const allowedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        await AppDataSource.getRepository(Event).save(privateRows);
        await AppDataSource.getRepository(Event).save({id: allowedId, owner: editor, title: 'Sparse picker authorized', startDate: '2000-01-01', endDate: '2000-01-02'});
        const first = await getEventLinkOptions({q: 'Sparse picker'}, sessionFor(editor));
        expect(first.items.map(item => item.id)).toEqual([allowedId]);
        expect(first.nextCursor).toBeNull();
        expect(JSON.stringify(first)).not.toContain('Sparse picker private');
        expect(JSON.stringify(first)).not.toContain(privateRows[299].id);
        // A search matching only private rows has no authorized continuation to display.
        const terminal = await getEventLinkOptions({q: 'Sparse picker private 1'}, sessionFor(editor));
        expect(terminal).toMatchObject({items: [], nextCursor: null});
    });

    it('pages thousands of matches through every grant source without exposing denied events', async () => {
        const events: Array<Partial<Event>> = [];
        const assignments: Array<Partial<EntityAdminAssignment>> = [];
        const defaults: Array<Partial<EntityPermissions>> = [];
        const registrations: Array<Partial<EventRegistration>> = [];
        const expectedIds: string[] = [];
        // Deliberately place 2,280 denied matches before any authorized row. Loading raw
        // batches and filtering in application memory would produce empty pages or scans;
        // the production query must apply the engine's eligibility inputs before LIMIT.
        for (let index = 0; index < 2400; index++) {
            const id = `eac00000-0000-4000-8000-${String(index).padStart(12, '0')}`;
            const grant = index < 2280 ? -1 : index % 10;
            const allowed = grant >= 0 && grant < 6;
            events.push({id, owner: grant === 0 ? editor : outsider,
                title: `Scale picker ${allowed ? 'allowed' : 'private'} ${index}`,
                startDate: '2000-01-01', endDate: '2000-01-02'});
            if (allowed) expectedIds.push(id);
            if (grant === 1 || grant === 7) assignments.push({entityType: 'event', entityId: id,
                profile: editor, perms: grant === 1 ? PERM.MANAGE_ASSIGNMENTS : PERM.ACCESS_VIEW});
            if (grant >= 2 && grant <= 6) {
                const audiences = {2: 'public', 3: 'authenticated', 4: 'guest', 5: 'participant', 6: 'participant'} as const;
                defaults.push({entityType: 'event', entityId: id, audience: audiences[grant as keyof typeof audiences], perms: PERM.MANAGE_ASSIGNMENTS});
            }
            // Participant defaults alone do not qualify: the adjacent grant=6 rows have
            // the same bit but no registration. This catches an overly broad SQL prefilter.
            if (grant === 5) registrations.push({event: {id} as Event, profile: editor,
                arrivalDate: '2000-01-01', departureDate: '2000-01-02'});
        }
        // Chunk fixture inserts so this regression exercises the real database metadata
        // without thousands of independent setup transactions or oversized SQL packets.
        for (let start = 0; start < events.length; start += 300) {
            await AppDataSource.getRepository(Event).insert(events.slice(start, start + 300));
        }
        await AppDataSource.getRepository(EntityAdminAssignment).insert(assignments);
        await AppDataSource.getRepository(EntityPermissions).insert(defaults);
        await AppDataSource.getRepository(EventRegistration).insert(registrations);

        const received: string[] = [];
        let cursor: string | undefined;
        const pageSizes: number[] = [];
        do {
            const page = await getEventLinkOptions({q: 'Scale picker', cursor}, sessionFor(editor));
            expect(JSON.stringify(page)).not.toContain('Scale picker private');
            pageSizes.push(page.items.length);
            received.push(...page.items.map(item => item.id));
            if (!cursor && page.nextCursor) {
                // Tokens bind navigation to the original filter/profile and disclose no
                // plaintext candidate identity, including when a private ID shares its date.
                expect(page.nextCursor).not.toContain(expectedIds[24]);
                await expect(getEventLinkOptions({q: 'Other filter', cursor: page.nextCursor}, sessionFor(editor))).rejects.toMatchObject({status: 400});
                await expect(getEventLinkOptions({q: 'Scale picker', cursor: page.nextCursor}, sessionFor(owner))).rejects.toMatchObject({status: 400});
            }
            cursor = page.nextCursor ?? undefined;
            expect(pageSizes.length).toBeLessThanOrEqual(3);
        } while (cursor);
        expect(pageSizes).toEqual([25, 25, 22]);
        expect(received).toEqual(expectedIds);
        expect(new Set(received).size).toBe(received.length);
    });

    it('requires destination authority even for a child owner and preserves committed items', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const targetId = await createIntegrationEvent(outsider.id, 'Other owner destination');
        const list = (await packingService.getPackingListById(id))!;
        await expect(changeEntityEvent('packing', list, {eventId: targetId, expectedEventId: null}, sessionFor(owner))).rejects.toMatchObject({status: 403});
        await adminService.updatePerms('event', targetId, {authenticated: PERM.MANAGE_ASSIGNMENTS});
        await archiveEntity({type: 'event', id: targetId}, {}, sessionFor(outsider));
        const result = await changeEntityEvent('packing', list, {eventId: targetId, expectedEventId: null}, sessionFor(owner));
        expect(result.archive).toMatchObject({archived: true, directArchived: false});
        expect((await packingService.getPackingListById(id))!.eventId).toBe(targetId);
        expect((await packingService.getPackingItems(id)).map(row => row.id)).toContain(item.id);
        await archiveEntity({type: 'packing', id}, {}, sessionFor(owner));
        const unlink = await changeEntityEvent('packing', list, {eventId: null, expectedEventId: targetId}, sessionFor(owner));
        expect(unlink.archive).toMatchObject({archived: true, directArchived: true});
        expect((await packingService.getPackingListById(id))!.eventId).toBeNull();
    });

    it('checks child grants against the old event and blocks stale relationship/property writes', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const sourceId = await createIntegrationEvent(owner.id, 'Source event');
        const targetId = await createIntegrationEvent(owner.id, 'Target event');
        const list = (await packingService.getPackingListById(id))!;
        await adminService.updatePerms('packing', id, {participant: PERM.EDIT_META | PERM.EDIT_TITLE});
        await adminService.updatePerms('event', targetId, {participant: PERM.MANAGE_ASSIGNMENTS});
        await eventService.register(targetId, '2027-06-01', '2027-06-03', editor.id);
        await expect(changeEntityEvent('packing', list, {eventId: targetId, expectedEventId: null}, sessionFor(editor))).rejects.toMatchObject({status: 403});
        await changeEntityEvent('packing', list, {eventId: sourceId, expectedEventId: null}, sessionFor(owner));
        const oldSnapshot = (await packingService.getPackingListById(id))!;
        await changeEntityEvent('packing', oldSnapshot, {eventId: targetId, expectedEventId: sourceId}, sessionFor(owner));
        await expect(changeEntityEvent('packing', oldSnapshot, {eventId: null, expectedEventId: sourceId}, sessionFor(owner))).rejects.toMatchObject({status: 409});
        await expect(packingController.updateProperties(oldSnapshot, {title: 'Stale participant edit'})).rejects.toMatchObject({status: 409});
        expect((await packingService.getPackingListById(id))!.title).toBe(list.title);
    });

    it('does not reveal an unviewable parent in projected edit data', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const targetId = await createIntegrationEvent(outsider.id, 'Private parent title');
        await adminService.addAdmin('event', targetId, owner.id, PERM.MANAGE_ASSIGNMENTS);
        const list = (await packingService.getPackingListById(id))!;
        await changeEntityEvent('packing', list, {eventId: targetId, expectedEventId: null}, sessionFor(owner));
        await adminService.removeAdmin('event', targetId, owner.id);
        const projection = await getEntityPropertyPresentation('packing', (await packingService.getPackingListById(id))!, sessionFor(owner));
        expect(projection.currentEvent).toEqual({id: targetId});
        await expect(changeEntityEvent('packing', list, {eventId: randomUUID(), expectedEventId: targetId}, sessionFor(owner))).rejects.toMatchObject({status: 404});
    });

    it('uses the page admission rule after linking and unlinking with changed participant grants', async () => {
        const sourceId = await createIntegrationEvent(owner.id, 'Admission source');
        const targetId = await createIntegrationEvent(outsider.id, 'Admission destination');
        const id = await packingService.createPackingListTx(owner.id, 'Admission child', '', [], sourceId);
        await eventService.register(sourceId, '2027-06-01', '2027-06-03', editor.id);
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_META);
        await adminService.updatePerms('packing', id, {participant: PERM.ACCESS_VIEW});
        await adminService.addAdmin('event', targetId, editor.id, PERM.MANAGE_ASSIGNMENTS);
        const list = (await packingService.getPackingListById(id))!;
        expect(await canAccessEntityView('packing', list, sessionFor(editor))).toBe(true);

        // Source membership does not survive moving the child. The successful mutation
        // redirects before reloading a destination page which would reject this profile.
        const linked = await changeEntityEvent('packing', list, {eventId: targetId, expectedEventId: sourceId}, sessionFor(editor));
        expect(linked.redirectUrl).toBe('/users/dashboard');
        const moved = (await packingService.getPackingListById(id))!;
        expect(await canAccessEntityView('packing', moved, sessionFor(editor))).toBe(false);

        // Standalone roots retain the app's existing active-profile admission rule.
        // Losing participant-derived ACCESS_VIEW must not invent a new standalone gate.
        const unlinked = await changeEntityEvent('packing', moved, {eventId: null, expectedEventId: targetId}, sessionFor(editor));
        expect(unlinked.redirectUrl).toBeUndefined();
        expect(await canAccessEntityView('packing', (await packingService.getPackingListById(id))!, sessionFor(editor))).toBe(true);
    });

    it('keeps batched participant grants equivalent for an event owner without registration', async () => {
        const eventId = await createIntegrationEvent(editor.id, 'Owner membership parity');
        const id = await packingService.createPackingListTx(owner.id, 'Other owner child', '', [], eventId);
        await adminService.updatePerms('packing', id, {participant: PERM.EDIT_META});
        const list = (await packingService.getPackingListById(id))!;
        const ordinary = await buildPermBundle({entityType: 'packing', entityId: id, ownerId: owner.id, eventId}, [], sessionFor(editor));
        expect(ordinary.entity.has('EDIT_META')).toBe(true);
        expect((await getEntityPropertyPresentation('packing', list, sessionFor(editor))).canLinkEvent).toBe(true);
        // The write evaluates the same authority in its transaction's batched evaluator.
        // Without the ownership input, the modal would offer a change which its API denies.
        expect(await changeEntityEvent('packing', list, {eventId: null, expectedEventId: eventId}, sessionFor(editor)))
            .toMatchObject({changed: true});
    });
});
