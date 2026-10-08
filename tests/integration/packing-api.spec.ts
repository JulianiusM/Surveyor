import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import packingController from '../../src/controller/packingController';
import {archiveEntity, archiveExpiredEntities, changeEntityEvent, restoreEntity} from '../../src/controller/entityAdminController';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingAssignment} from '../../src/modules/database/entities/packing/PackingAssignment';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as userService from '../../src/modules/database/services/UserService';
import {PERM} from '../../src/modules/lib/permissions';
import {patchPackingMetadata, readPackingList, readPackingMetadata, setPackingSelfAssignment} from '../../src/modules/packing/api';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, createPackingListWithItem as createPackingFixture, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let editor: Profile;
let participant: Profile;

function sessionFor(profile: Profile): SessionLike {
    return {profile, auth: {user: profile.user!}};
}

/** Reproduce the submitted permission fields as well as createEntity's persistence hook. */
async function createPackingListWithItem(ownerId: string) {
    const fixture = await createPackingFixture(ownerId);
    // The general fixture omits afterCreateItems because older controller tests exercise the
    // assignment operation directly. API admission needs the real persisted audience grant.
    await packingController.afterCreateItems(fixture[0], {_body: {defaultPerms: {public: ['ACCESS_VIEW']}}});
    return fixture;
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Packing owner'});
    editor = await persistIntegrationProfile({name: 'Packing editor'});
    participant = await persistIntegrationProfile({name: 'Packing participant'});
}, 120_000);

afterAll(closeIntegrationDatabase);

describe('versioned packing projections and metadata preconditions', () => {
    it('projects safe list fields and only the metadata fields the actor can edit', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        await packingService.updateHeaderImage(id, 'uploads/private-storage-name.jpg');
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE);
        await setPackingSelfAssignment(id, item.id, true, sessionFor(participant));

        const view = await readPackingList(id, sessionFor(editor));
        expect(view.data).toMatchObject({id, headerUrl: `/api/v1/packing-lists/${id}/header`,
            counters: {participants: 1, open: 0, empty: 0},
            capabilities: {editTitle: true, editDescription: false, selfAssign: true}});
        expect(view.data.items[0]).toMatchObject({selfAssigned: false, assignedCount: 1,
            assignees: [{name: participant.name}]});
        const serialized = JSON.stringify(view.data);
        for (const hidden of ['ownerId', 'profileId', 'metadataRevision', 'email', 'private-storage-name', participant.id]) {
            expect(serialized).not.toContain(hidden);
        }
        const metadata = await readPackingMetadata(id, sessionFor(editor));
        expect(metadata.data.values).toEqual({title: 'Camp packing list'});
        expect(metadata.data.editableFields).toEqual(['title']);
        await expect(patchPackingMetadata(id, {title: 'Must not save', description: 'Forged'}, metadata.etag, sessionFor(editor)))
            .rejects.toMatchObject({status: 403});
        expect((await packingService.getPackingListById(id))!.title).toBe('Camp packing list');
    });

    it('admits registered event participants separately from assignment permission', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const eventId = await createIntegrationEvent(owner.id, 'Packing admission');
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!,
            {eventId, expectedEventId: null}, sessionFor(owner));
        await adminService.updatePerms('packing', id, {public: 0, authenticated: 0, participant: 0});
        await expect(readPackingList(id, sessionFor(editor))).rejects.toMatchObject({status: 403});
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        expect((await readPackingList(id, sessionFor(participant))).data.capabilities.selfAssign).toBe(false);
        await expect(setPackingSelfAssignment(id, item.id, true, sessionFor(participant))).rejects.toMatchObject({status: 403});
        await expect(readPackingList(id, {})).rejects.toMatchObject({status: 401});
    });

    it('projects the event link only with independent parent view permission', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const eventId = await createIntegrationEvent(owner.id, 'Private packing parent');
        const guest = await userService.createGuest('Packing-only guest');
        const guestSession: SessionLike = {auth: {guest}, profile: guest.profile};
        await adminService.updatePerms('packing', id, {public: 0, authenticated: 0, participant: 0});
        await adminService.updatePerms('event', eventId, {public: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin('packing', id, guest.profile.id, PERM.ACCESS_VIEW);
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!,
            {eventId, expectedEventId: null}, sessionFor(owner));

        expect((await readPackingList(id, sessionFor(owner))).data.currentEventUrl).toBe(`/event/${eventId}`);
        const childOnly = await readPackingList(id, guestSession);
        expect(childOnly.data).toMatchObject({currentEventId: eventId, currentEventUrl: null});
        // Assignment-management metadata exposure remains distinct from page-navigation authority.
        await adminService.addAdmin('event', eventId, guest.profile.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await readPackingList(id, guestSession)).data.currentEventUrl).toBeNull();
        await adminService.updateAdminPerms('event', eventId, guest.profile.id, PERM.ACCESS_VIEW);
        const parentView = await readPackingList(id, guestSession);
        expect(parentView.data.currentEventUrl).toBe(`/event/${eventId}`);
        expect(parentView.etag).not.toBe(childOnly.etag);
        await adminService.removeAdmin('event', eventId, guest.profile.id);
        expect((await readPackingList(id, guestSession)).data.currentEventUrl).toBeNull();
    });

    it('requires the reviewed strong actor token and preserves omitted metadata', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const baseline = await readPackingMetadata(id, sessionFor(owner));
        await expect(patchPackingMetadata(id, {title: 'No token'}, undefined, sessionFor(owner))).rejects.toMatchObject({status: 428});
        await expect(patchPackingMetadata(id, {title: 'Weak token'}, `W/${baseline.etag}`, sessionFor(owner))).rejects.toMatchObject({status: 412});
        const saved = await patchPackingMetadata(id, {title: '  Trimmed title  '}, baseline.etag, sessionFor(owner));
        expect(saved.data.values).toEqual({title: 'Trimmed title', description: 'Shared equipment'});
        expect(saved.etag).not.toBe(baseline.etag);
        // Title and description have independent baselines. A title edit must not reject an
        // untouched description, but a second edit to that same title remains a real conflict.
        await expect(patchPackingMetadata(id, {title: 'Lost update'}, baseline.etag, sessionFor(owner))).rejects.toMatchObject({status: 412});
        const independent = await patchPackingMetadata(id, {description: 'Independent description'}, baseline.etag, sessionFor(owner));
        const cleared = await patchPackingMetadata(id, {description: ''}, independent.etag, sessionFor(owner));
        expect(cleared.data.values).toEqual({title: 'Trimmed title', description: null});
    });

    it('rejects malformed patches atomically before changing any field', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const baseline = await readPackingMetadata(id, sessionFor(owner));
        const invalidBodies = [{}, {description: undefined}, {title: null}, {title: false}, {title: '   '}, {description: false},
            {ownerId: editor.id}, {title: 'Must not save', description: 'x'.repeat(16001)}];
        for (const body of invalidBodies) {
            await expect(patchPackingMetadata(id, body, baseline.etag, sessionFor(owner))).rejects.toMatchObject({status: 400});
        }
        expect(await readPackingMetadata(id, sessionFor(owner))).toEqual(baseline);
    });

    it('compares current values from every legacy writer without tracking historical round trips', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const original = await readPackingMetadata(id, sessionFor(owner));
        await packingService.updatePackingListTitle(id, 'Intermediate title');
        await packingService.updatePackingListTitle(id, original.data.values.title!);
        expect((await readPackingMetadata(id, sessionFor(owner))).data).toEqual(original.data);
        await patchPackingMetadata(id, {title: 'Current value still matches'}, original.etag, sessionFor(owner));
        const writers = [
            {field: 'description', run: () => packingService.updatePackingListDescription(id, 'Service description')},
            {field: 'description', run: () => packingController.updateDescription(id, {description: 'Legacy description'})},
            {field: 'title', run: async () => packingController.updateProperties((await packingService.getPackingListById(id))!, {title: 'Legacy form title'})},
        ];
        for (const write of writers) {
            const before = await readPackingMetadata(id, sessionFor(owner));
            await write.run();
            await expect(patchPackingMetadata(id, {[write.field]: 'Stale'}, before.etag, sessionFor(owner))).rejects.toMatchObject({status: 412});
        }
    });

    it('rechecks grants and binds an edit token to the admitted profile', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE);
        await adminService.addAdmin('packing', id, participant.id, PERM.EDIT_TITLE);
        const editorBaseline = await readPackingMetadata(id, sessionFor(editor));
        await expect(patchPackingMetadata(id, {title: 'Other actor'}, editorBaseline.etag, sessionFor(participant))).rejects.toMatchObject({status: 412});
        await adminService.updateAdminPerms('packing', id, editor.id, PERM.EDIT_TITLE | PERM.EDIT_DESC);
        await patchPackingMetadata(id, {title: 'Still authorized'}, editorBaseline.etag, sessionFor(editor));
        const beforeRevocation = await readPackingMetadata(id, sessionFor(editor));
        await adminService.removeAdmin('packing', id, editor.id);
        await expect(patchPackingMetadata(id, {title: 'Revoked'}, beforeRevocation.etag, sessionFor(editor))).rejects.toMatchObject({status: 403});
        expect((await readPackingMetadata(id, sessionFor(editor))).data.values).toEqual({});
    });

    it('allows unchanged setup values after parent and lifecycle round trips with fresh authorization', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const eventId = await createIntegrationEvent(owner.id, 'Packing parent context');
        const baseline = await readPackingMetadata(id, sessionFor(owner));
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!, {eventId, expectedEventId: null}, sessionFor(owner));
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!, {eventId: null, expectedEventId: eventId}, sessionFor(owner));
        expect((await readPackingMetadata(id, sessionFor(owner))).data).toEqual(baseline.data);
        await patchPackingMetadata(id, {title: 'After relink'}, baseline.etag, sessionFor(owner));
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!, {eventId, expectedEventId: null}, sessionFor(owner));
        for (const reference of [{type: 'packing' as const, id}, {type: 'event' as const, id: eventId}]) {
            const before = await readPackingMetadata(id, sessionFor(owner));
            await archiveEntity(reference, {}, sessionFor(owner));
            await restoreEntity(reference, {}, sessionFor(owner));
            expect((await readPackingMetadata(id, sessionFor(owner))).data).toEqual(before.data);
            await patchPackingMetadata(id, {title: `${before.data.values.title} revised`}, before.etag, sessionFor(owner));
        }
    });

    it('refreshes inherited archive presentation without conflicting with unchanged text fields', async () => {
        const [id] = await createPackingListWithItem(owner.id);
        const eventId = await createIntegrationEvent(owner.id, 'Automatic packing archive');
        await eventService.updateEventDates(eventId, '2000-01-01', '2000-01-02');
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!, {eventId, expectedEventId: null}, sessionFor(owner));
        const before = await readPackingMetadata(id, sessionFor(owner));
        await archiveExpiredEntities(0, new Date('2000-02-01T00:00:00Z'));
        expect((await readPackingMetadata(id, sessionFor(owner))).data.inheritedArchived).toBe(true);
        const archived = await readPackingMetadata(id, sessionFor(owner));
        expect(archived.etag).not.toBe(before.etag);
        await archiveExpiredEntities(0, new Date('2000-02-01T00:00:00Z'));
        expect(await readPackingMetadata(id, sessionFor(owner))).toEqual(archived);
        await patchPackingMetadata(id, {title: 'After sweep'}, before.etag, sessionFor(owner));
    });
});

describe('versioned packing self-assignment commands', () => {
    it('retries desired membership idempotently without staling a metadata editor', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const metadata = await readPackingMetadata(id, sessionFor(owner));
        const view = await readPackingList(id, sessionFor(participant));
        for (let retry = 0; retry < 2; retry++) {
            expect(await setPackingSelfAssignment(id, item.id, true, sessionFor(participant)))
                .toEqual({listId: id, itemId: item.id, selfAssigned: true, assignedCount: 1, maxAssignees: 1});
        }
        expect(await readPackingMetadata(id, sessionFor(owner))).toEqual(metadata);
        expect((await readPackingList(id, sessionFor(participant))).etag).not.toBe(view.etag);
        await expect(setPackingSelfAssignment(id, item.id, true, sessionFor(editor))).rejects.toMatchObject({status: 409});
        for (let retry = 0; retry < 2; retry++) {
            expect(await setPackingSelfAssignment(id, item.id, false, sessionFor(participant)))
                .toMatchObject({selfAssigned: false, assignedCount: 0});
        }
        expect(await packingService.getPackingAssignments(id, participant.id)).toEqual([]);
    });

    it('serializes two actors competing for the final place', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const results = await Promise.allSettled([editor, participant].map(profile =>
            setPackingSelfAssignment(id, item.id, true, sessionFor(profile))));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toEqual([
            expect.objectContaining({reason: expect.objectContaining({status: 409})}),
        ]);
        expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[item.id]: 1});
    });

    it('rejects a foreign item and uses current parent admission after relinking', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const [otherId] = await createPackingListWithItem(owner.id);
        await expect(setPackingSelfAssignment(otherId, item.id, true, sessionFor(participant))).rejects.toMatchObject({status: 404});
        const eventId = await createIntegrationEvent(owner.id, 'Restricted packing parent');
        await adminService.updatePerms('packing', id, {public: 0, authenticated: 0, participant: PERM.ACCESS_VIEW});
        await changeEntityEvent('packing', (await packingService.getPackingListById(id))!, {eventId, expectedEventId: null}, sessionFor(owner));
        await expect(setPackingSelfAssignment(id, item.id, true, sessionFor(participant))).rejects.toMatchObject({status: 403});
        expect(await packingService.getPackingAssignments(id, participant.id)).toEqual([]);
    });

    it('preserves everyone-item counter rules and removes all historical duplicate self rows', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        await packingService.togglePackingItemRequiredByAll(item.id, true);
        // Old installations can contain duplicate assignments; the current command removes all
        // matching rows and must report the actual resulting count rather than subtracting one.
        await AppDataSource.getRepository(PackingAssignment).save([1, 2].map(() => ({
            entity: {id}, item: {id: item.id}, profile: {id: participant.id},
        })));
        expect((await readPackingList(id, sessionFor(participant))).data.counters).toEqual({participants: 0, open: 0, empty: 0});
        expect(await setPackingSelfAssignment(id, item.id, false, sessionFor(participant))).toMatchObject({selfAssigned: false, assignedCount: 0});
    });
});
