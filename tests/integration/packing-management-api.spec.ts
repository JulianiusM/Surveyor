import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingAssignment} from '../../src/modules/database/entities/packing/PackingAssignment';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as userService from '../../src/modules/database/services/UserService';
import * as packing from '../../src/modules/packing/api';
import {readOverview, setOverviewVisibility} from '../../src/modules/overview/api';
import packingController from '../../src/controller/packingController';
import {archiveEntity} from '../../src/controller/entityAdminController';
import {readEventLinkSelection} from '../../src/controller/eventController';
import {randomUUID} from 'node:crypto';
import {contractValidator} from '../../src/modules/api/contracts';
import {DEFAULT_PERM, PERM} from '../../src/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createEventActivityPlan, createIntegrationEvent, createPackingListWithItem, createSurveyWithCombinations, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let editor: Profile;
function actor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }
function creation(eventId: string | null = null): components['schemas']['PackingCreateInput'] {
    return {title: 'Complete packing', description: null, eventId,
        defaultPermissions: {public: PERM.ACCESS_VIEW, guest: 0, authenticated: 0, participant: 0},
        items: [{title: 'Tent', description: 'Shared shelter', maxAssignees: 2, requiredByAll: false},
            {title: 'Water', description: null, maxAssignees: 1, requiredByAll: true}]};
}
async function fixture() { return (await packing.createPackingList(creation(), undefined, actor(owner))).id; }

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Complete packing owner'});
    editor = await persistIntegrationProfile({name: 'Complete packing editor'});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('complete versioned packing management', () => {
    it('shares native initial event admission for create and duplicate while rechecking grants after revocation', async () => {
        const allowed = await createIntegrationEvent(owner.id, 'Allowed initial selection');
        const forbidden = await createIntegrationEvent(editor.id, 'Private initial selection');
        const id = await fixture();
        const currentActor = actor(owner);

        for (const eventId of [undefined, '', 'invalid-initial-selection', randomUUID(), forbidden, allowed]) {
            const native = await readEventLinkSelection(eventId, currentActor);
            const entry = await packing.readPackingCreateEntry(currentActor, undefined, eventId);
            const duplicate = await packing.readPackingDuplicate(id, currentActor, eventId);
            const expectedId = eventId === allowed ? allowed : null;
            expect(native?.id ?? null).toBe(expectedId);
            expect(entry.selectedEvent?.id ?? null).toBe(expectedId);
            expect(duplicate.selectedEvent?.id ?? null).toBe(expectedId);
            expect(duplicate.eventId).toBeNull();
            expect(contractValidator('PackingCreateEntry')(entry)).toBe(true);
            expect(contractValidator('PackingDuplicate')(duplicate)).toBe(true);
            expect(Object.hasOwn(entry, 'selectedEvent')).toBe(eventId !== undefined);
            expect(Object.hasOwn(duplicate, 'selectedEvent')).toBe(eventId !== undefined);
        }

        // Discovery/admission is a current read, never a lasting attachment grant.
        // A later revocation removes the new URL seed without changing the source.
        await adminService.addAdmin('event', forbidden, owner.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await packing.readPackingCreateEntry(currentActor, undefined, forbidden)).selectedEvent?.id).toBe(forbidden);
        await adminService.removeAdmin('event', forbidden, owner.id);
        expect((await packing.readPackingDuplicate(id, currentActor, forbidden)).selectedEvent).toBeNull();
        expect((await packing.readPackingCreateEntry({}, undefined, allowed)).selectedEvent).toBeNull();
    });

    it('preserves cleared item titles through detail and duplicate reads without weakening creation or root metadata', async () => {
        const id = await fixture();
        const original = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.updatePackingItem(id, original.id, {title: ''}, original.editToken, actor(owner));
        expect((await packingService.getPackingItemById(original.id))!.title).toBe('');
        const view = (await packing.readPackingList(id, actor(owner))).data;
        expect(view.items.find(item => item.id === original.id)?.title).toBe('');
        expect(contractValidator('PackingListView')(view)).toBe(true);
        const duplicate = await packing.readPackingDuplicate(id, actor(owner));
        expect(duplicate.items[0].title).toBe('');
        expect(contractValidator('PackingDuplicate')(duplicate)).toBe(true);
        expect(contractValidator('PackingCreateInput')({...creation(), items: duplicate.items})).toBe(false);
        const metadata = await packing.readPackingMetadata(id, actor(owner));
        await expect(packing.patchPackingMetadata(id, {title: ''}, metadata.etag, actor(owner)))
            .rejects.toMatchObject({status: 400});
        expect((await packingService.getPackingListById(id))!.title).toBe(creation().title);
    });

    it('commits creation order and audience defaults together and denies an unauthorized parent without partial rows', async () => {
        const before = await AppDataSource.getRepository(PackingList).count();
        const forbiddenEvent = await createIntegrationEvent(editor.id, 'Private target');
        await expect(packing.createPackingList(creation(forbiddenEvent), undefined, actor(owner))).rejects.toMatchObject({status: 403});
        expect(await AppDataSource.getRepository(PackingList).count()).toBe(before);
        const id = await fixture();
        const view = await packing.readPackingList(id, actor(owner));
        expect(view.data.items.map(item => [item.title, item.position])).toEqual([['Tent', 0], ['Water', 1]]);
        expect(await adminService.getDefaultPerms('packing', id)).toEqual(creation().defaultPermissions);
        expect(contractValidator('PackingListView')(view.data)).toBe(true);
        expect(contractValidator('PackingSettings')(await packing.readPackingSettings(id, actor(owner)))).toBe(true);
    });

    it('preserves independent child fields and the packing ITEM_EDIT_META exception', async () => {
        const id = await fixture();
        const first = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await adminService.addAdmin('packing', id, editor.id, PERM.ITEM_EDIT_META);
        let view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[0].capabilities).toEqual({editTitle: false, editDescription: false, editCapacity: false, editRequired: false, removeItem: false, removeAssignments: false});
        await adminService.addAdmin('packingItem', first.id, editor.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY);
        view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[0].capabilities).toMatchObject({editTitle: true, editCapacity: true, editDescription: false, editRequired: false});
        await expect(packing.updatePackingItem(id, first.id, {title: 'Must not save', description: 'Forbidden'}, view.items[0].editToken, actor(editor))).rejects.toMatchObject({status: 403});
        await packing.updatePackingItem(id, first.id, {title: 'My title', maxAssignees: 3}, view.items[0].editToken, actor(editor));
        await expect(packing.updatePackingItem(id, first.id, {title: 'Stale'}, view.items[0].editToken, actor(editor))).rejects.toMatchObject({status: 412});
        expect((await packingService.getPackingItemById(first.id))!.title).toBe('My title');
        await adminService.updateAdminPerms('packing', id, editor.id, PERM.ITEM_EDIT_DESC);
        view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[1].capabilities).toMatchObject({editTitle: false, editDescription: true, editRequired: false});
    });

    it('preserves quick-add creator ownership, validates root scope, and rejects stale ordering after additions', async () => {
        const id = await fixture();
        const foreign = await fixture();
        await adminService.addAdmin('packing', id, editor.id, PERM.ITEM_ADD);
        const baseline = (await packing.readPackingList(id, actor(owner))).data;
        const created = await packing.createPackingItem(id, {title: 'Added by participant', description: null, maxAssignees: 2, requiredByAll: false}, actor(editor));
        const added = (await packing.readPackingList(id, actor(editor))).data.items.find(item => item.id === created.id)!;
        expect(added.position).toBe(2);
        expect(Object.values(added.capabilities).every(Boolean)).toBe(true);
        await expect(packing.updatePackingItem(foreign, created.id, {title: 'Foreign'}, added.editToken, actor(owner))).rejects.toMatchObject({status: 404});
        await expect(packing.reorderPackingItems(id, {itemIds: baseline.items.map(item => item.id).reverse()}, baseline.orderToken, actor(owner))).rejects.toMatchObject({status: 412});
        const current = (await packing.readPackingList(id, actor(owner))).data;
        const order = current.items.map(item => item.id).reverse();
        await packing.reorderPackingItems(id, {itemIds: order}, current.orderToken, actor(owner));
        expect((await packing.readPackingList(id, actor(owner))).data.items.map(item => item.id)).toEqual(order);
    });

    it('rechecks native reorder authority and the complete current item set before any order write', async () => {
        const id = await fixture();
        await adminService.addAdmin('packing', id, editor.id, PERM.ITEM_EDIT);
        const original = (await packing.readPackingList(id, actor(owner))).data;
        const nativeOrder = original.items.map((item, position) => ({itemId: item.id, position: original.items.length - position - 1}));
        await packingController.reorderItems(id, nativeOrder, actor(editor));
        expect((await packing.readPackingList(id, actor(owner))).data.items.map(item => item.id)).toEqual(original.items.map(item => item.id).reverse());
        await adminService.removeAdmin('packing', id, editor.id);
        await expect(packingController.reorderItems(id, nativeOrder, actor(editor))).rejects.toMatchObject({status: 403});

        await packing.createPackingItem(id, {title: 'Added while native tab was open', description: null, maxAssignees: 1, requiredByAll: false}, actor(owner));
        const current = (await packing.readPackingList(id, actor(owner))).data;
        await expect(packingController.reorderItems(id, nativeOrder, actor(owner))).rejects.toMatchObject({status: 409});
        const duplicates = current.items.map((item, position) => ({itemId: position === 1 ? current.items[0].id : item.id, position}));
        await expect(packingController.reorderItems(id, duplicates, actor(owner))).rejects.toMatchObject({status: 409});
        expect((await packing.readPackingList(id, actor(owner))).data.items.map(item => item.id)).toEqual(current.items.map(item => item.id));
    });

    it('does not replay native permission defaults after atomic runtime creation', async () => {
        const form = {title: 'Atomic native creation', description: '', event_id: '',
            items: JSON.stringify(creation().items.map(item => ({...item, description: item.description ?? ''}))),
            defaultPerms: {public: ['ACCESS_VIEW'], guest: []}};
        const data = Object.assign(packingController.preprocessCreate(form), {_body: form});
        const id = await packingController.createEntity(owner.id, data, actor(owner));
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: 0});
        // A later authorized write must survive the generic post-create hook. Runtime creation
        // already committed defaults, whereas actor-free fixture hooks still initialize them.
        await adminService.updatePerms('packing', id, {public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT, guest: PERM.ITEM_ADD});
        await packingController.afterCreateItems(id, data, actor(owner));
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT, guest: PERM.ITEM_ADD});
        await packingController.afterCreateItems(id, data);
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: 0});
    });

    it('reveals assignment handles only for allowed removal, rejects foreign handles, and cascades item deletion', async () => {
        const id = await fixture();
        const foreign = await fixture();
        const item = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.setPackingSelfAssignment(id, item.id, true, actor(editor));
        expect((await packing.readPackingList(id, actor(editor))).data.items[0].assignees).toEqual([{name: editor.name, assignmentId: null}]);
        const assignment = (await packing.readPackingList(id, actor(owner))).data.items[0].assignees[0].assignmentId!;
        await expect(packing.deletePackingAssignment(foreign, assignment, actor(owner))).rejects.toMatchObject({status: 404});
        await expect(packing.deletePackingAssignment(id, assignment, actor(editor))).rejects.toMatchObject({status: 403});
        await packing.deletePackingAssignment(id, assignment, actor(owner));
        await packing.setPackingSelfAssignment(id, item.id, true, actor(editor));
        await packing.deletePackingItem(id, item.id, actor(owner));
        expect(await packingService.getPackingAssignmentCounts(id)).not.toHaveProperty(item.id);
        expect(await packingService.getPackingItemById(item.id)).toBeNull();
    });

    it('keeps private access settings absent and refuses ACL drafts invalidated by a legacy writer', async () => {
        const id = await fixture();
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE);
        expect((await packing.readPackingSettings(id, actor(editor))).access).toBeNull();
        const initial = await packing.readPackingSettings(id, actor(owner));
        await expect(packing.updatePackingDefaults(id, creation().defaultPermissions, actor(owner))).rejects.toMatchObject({status: 428});
        await adminService.updatePerms('packing', id, {guest: PERM.ITEM_ADD});
        await expect(packing.updatePackingDefaults(id, creation().defaultPermissions, actor(owner), initial.settingsToken)).rejects.toMatchObject({status: 412});
        const current = await packing.readPackingSettings(id, actor(owner));
        await packing.setPackingAdmin(id, editor.id, PERM.MANAGE_PERMISSIONS, actor(owner), current.access!.admins.find(admin => admin.profileId === editor.id)!.editToken);
        await expect(packing.setPackingAdmin(id, editor.id, 0, actor(owner), current.settingsToken)).rejects.toMatchObject({status: 412});
        const fresh = await packing.readPackingSettings(id, actor(owner));
        await packing.setPackingAdmin(id, editor.id, null, actor(owner), fresh.access!.admins.find(admin => admin.profileId === editor.id)!.editToken);
        expect(await adminService.isAdmin('packing', id, editor.id)).toBe(false);
    });

    it('lets disjoint item and setup edits complete while rejecting changed touched fields', async () => {
        const id = await fixture();
        const initial = (await packing.readPackingList(id, actor(owner))).data;
        const item = initial.items[0];
        await packing.updatePackingItem(id, item.id, {description: 'Another client description'}, item.editToken, actor(owner));
        await packing.updatePackingItem(id, item.id, {title: 'Independent title'}, item.editToken, actor(owner));
        await expect(packing.updatePackingItem(id, item.id, {description: 'Stale overwrite'}, item.editToken, actor(owner)))
            .rejects.toMatchObject({status: 412});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({title: 'Independent title', description: 'Another client description'});

        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.updatePackingDefaults(id, {guest: PERM.ITEM_ADD}, actor(owner), settings.settingsToken);
        await packing.updatePackingDefaults(id, {participant: PERM.ACCESS_VIEW}, actor(owner), settings.settingsToken);
        await expect(packing.updatePackingDefaults(id, {guest: 0}, actor(owner), settings.settingsToken)).rejects.toMatchObject({status: 412});
        // An independent ACL edit never invalidates a header or another administrator's mask.
        await packing.setPackingHeader(id, undefined, actor(owner), settings.settingsToken);
        await packing.setPackingAdmin(id, editor.id, PERM.EDIT_TITLE, actor(owner), settings.settingsToken);
        const adminBaseline = (await packing.readPackingSettings(id, actor(owner))).access!.admins.find(admin => admin.profileId === editor.id)!;
        await packing.updatePackingDefaults(id, {public: PERM.ACCESS_VIEW | PERM.ITEM_ADD}, actor(owner),
            (await packing.readPackingSettings(id, actor(owner))).settingsToken);
        await packing.setPackingAdmin(id, editor.id, PERM.EDIT_DESC, actor(owner), adminBaseline.editToken);
        await expect(packing.setPackingAdmin(id, editor.id, PERM.EDIT_TITLE, actor(owner), adminBaseline.editToken)).rejects.toMatchObject({status: 412});
        // A stale add cannot silently replace an independently added grant, even if desired masks match.
        await expect(packing.setPackingAdmin(id, editor.id, PERM.EDIT_DESC, actor(owner), settings.settingsToken)).rejects.toMatchObject({status: 412});
    });

    it('serializes public description edits and retains assignments when reducing a capacity', async () => {
        const id = await fixture();
        await adminService.updatePerms('packing', id, {public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT_DESC});
        const first = (await packing.readPackingList(id, actor(editor))).data.items[0];
        const second = (await packing.readPackingList(id, actor(owner))).data.items[0];
        const edits = await Promise.allSettled([
            packing.updatePackingItem(id, first.id, {description: 'Public edit'}, first.editToken, actor(editor)),
            packing.updatePackingItem(id, second.id, {description: 'Organizer edit'}, second.editToken, actor(owner)),
        ]);
        expect(edits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(edits.filter(result => result.status === 'rejected')).toEqual([
            expect.objectContaining({reason: expect.objectContaining({status: 412})}),
        ]);
        await packing.setPackingSelfAssignment(id, first.id, true, actor(editor));
        await packing.setPackingSelfAssignment(id, first.id, true, actor(owner));
        const capacityBaseline = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.updatePackingItem(id, first.id, {maxAssignees: 1}, capacityBaseline.editToken, actor(owner));
        expect((await packing.readPackingList(id, actor(owner))).data.items[0]).toMatchObject({assignedCount: 2, maxAssignees: 1});
        expect(await packing.setPackingSelfAssignment(id, first.id, true, actor(owner))).toMatchObject({assignedCount: 2});
        const another = await persistIntegrationProfile({name: 'Capacity competitor'});
        await expect(packing.setPackingSelfAssignment(id, first.id, true, actor(another))).rejects.toMatchObject({status: 409});
    });

    it('rejects stale native and pilot field edits in both directions under the same item lock', async () => {
        const id = await fixture();
        await adminService.updatePerms('packing', id, {public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT_DESC});
        const pilotBaseline = (await packing.readPackingList(id, actor(editor))).data.items[0];
        await packingController.updateItemDescription(pilotBaseline.id,
            {description: 'Native edit', expectedValue: pilotBaseline.description}, id, actor(editor));
        await expect(packing.updatePackingItem(id, pilotBaseline.id, {description: 'Stale pilot edit'}, pilotBaseline.editToken, actor(editor)))
            .rejects.toMatchObject({status: 412});
        const current = (await packing.readPackingList(id, actor(editor))).data.items[0];
        await packing.updatePackingItem(id, current.id, {description: 'Pilot edit'}, current.editToken, actor(editor));
        await expect(packingController.updateItemDescription(current.id,
            {description: 'Stale native edit', expectedValue: current.description}, id, actor(editor))).rejects.toMatchObject({status: 412});
        expect((await packingService.getPackingItemById(current.id))!.description).toBe('Pilot edit');

        const entity = (await packingService.getPackingListById(id))!;
        const metadata = await packing.readPackingMetadata(id, actor(owner));
        await packing.patchPackingMetadata(id, {title: 'Pilot setup edit'}, metadata.etag, actor(owner));
        await expect(packingController.updateProperties(entity, {title: 'Stale native setup', expectedValues: {title: entity.title}}, actor(owner)))
            .rejects.toMatchObject({status: 412});
        await packingController.updateProperties(entity, {description: 'Independent native setup', expectedValues: {description: entity.description ?? ''}}, actor(owner));
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Pilot setup edit', description: 'Independent native setup'});

        // A relink after native route discovery supersedes that route's permission
        // context. Both adapters reject it under the shared parent/root transaction;
        // the independent literal also protects the original native conflict wording.
        const eventId = await createIntegrationEvent(owner.id, 'Relinked metadata parent');
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        const conflict = {status: 409, message: 'The linked event changed. Reload and try again.'};
        await expect(packingController.updateProperties(entity, {title: 'Retired native context'}, actor(owner))).rejects.toMatchObject(conflict);
        await expect(packing.patchPackingMetadata(id, {title: 'Retired pilot context'}, undefined, actor(owner), false, null)).rejects.toMatchObject(conflict);
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Pilot setup edit', eventId});
    });

    it('retains native field-only write grants independently of linked-page admission', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Private native mutation parent');
        const id = await fixture();
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        await adminService.updatePerms('packing', id, {public: 0, guest: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE | PERM.ITEM_ADD | PERM.EDIT_META);
        const item = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await adminService.addAdmin('packingItem', item.id, editor.id, PERM.EDIT_DESC);
        await expect(packing.readPackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
        const entity = (await packingService.getPackingListById(id))!;
        await packingController.updateProperties(entity, {title: 'Native title-only grant', expectedValues: {title: entity.title}}, actor(editor));
        await packingController.updateItemDescription(item.id, {description: 'Native child grant', expectedValue: item.description}, id, actor(editor));
        await packingController.quickAddItem(entity, {title: 'Native add-only grant'}, actor(editor));
        await packingController.deleteHeaderImg(entity, actor(editor));
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Native title-only grant'});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({description: 'Native child grant'});
        await adminService.updateAdminPerms('packing', id, editor.id, PERM.ITEM_ADD);
        await expect(packingController.updateProperties(entity, {title: 'Revoked grant'}, actor(editor))).rejects.toMatchObject({status: 403});
    });

    it('preserves guest administration and duplicate GET but prohibits account-only creation and owner-only root deletion', async () => {
        const id = await fixture();
        const guest = await userService.createGuest('Packing guest administrator');
        const session: SessionLike = {auth: {guest}, profile: guest.profile};
        await adminService.addAdmin('packing', id, guest.profile.id, DEFAULT_PERM.ADMIN);
        const settings = await packing.readPackingSettings(id, session);
        expect(settings.capabilities).toMatchObject({duplicate: false, remove: false, managePermissions: true, editHeader: true});
        await expect(packing.createPackingList(creation(), undefined, session)).rejects.toMatchObject({status: 403});
        const duplicate = await packing.readPackingDuplicate(id, session);
        expect(duplicate).toMatchObject({title: 'Complete packing', formContext: {permissions: expect.any(Array)}});
        expect(contractValidator('PackingDuplicate')(duplicate)).toBe(true);
        await expect(packing.deletePackingList(id, session)).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('packing', id, editor.id, DEFAULT_PERM.ADMIN);
        await expect(packing.deletePackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
    });

    it.each(['account', 'guest'] as const)('permits a persisted %s profile owner to delete without granting that authority to administrators', async identity => {
        let session = actor(owner);
        if (identity === 'guest') {
            const guest = await userService.createGuest('Packing guest owner');
            session = {auth: {guest}, profile: guest.profile};
        }

        // The trusted domain fixture establishes existing profile ownership, including a
        // guest-owned record. It must not grant guests permission to create new lists today.
        const [id, item] = await createPackingListWithItem(session.profile!.id);
        const settings = await packing.readPackingSettings(id, session);
        expect(settings.capabilities).toMatchObject({remove: true, duplicate: identity === 'account'});
        expect(contractValidator('PackingSettings')(settings)).toBe(true);
        expect((await packing.readPackingList(id, session)).data.capabilities.manageSettings).toBe(true);
        if (identity === 'guest') {
            await expect(packing.createPackingList(creation(), undefined, session)).rejects.toMatchObject({status: 403});
        }

        // Full administrative grants deliberately do not imply ownership, for either
        // account or guest profiles. Denied deletions leave the persisted root intact.
        const administrator = await userService.createGuest('Packing guest nonowner');
        const administratorSession: SessionLike = {auth: {guest: administrator}, profile: administrator.profile};
        await adminService.addAdmin('packing', id, administrator.profile.id, DEFAULT_PERM.ADMIN);
        await adminService.addAdmin('packing', id, editor.id, DEFAULT_PERM.ADMIN);
        expect((await packing.readPackingSettings(id, administratorSession)).capabilities.remove).toBe(false);
        expect((await packing.readPackingSettings(id, actor(editor))).capabilities.remove).toBe(false);
        await expect(packing.deletePackingList(id, administratorSession)).rejects.toMatchObject({status: 403});
        await expect(packing.deletePackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
        expect(await packingService.getPackingListById(id)).toMatchObject({ownerId: session.profile!.id});

        // Exercise the real repository deletion and foreign-key cascades, rather than
        // replacing the persistence boundary or treating deletion as archival.
        await packing.setPackingSelfAssignment(id, item.id, true, session);
        expect(await AppDataSource.getRepository(PackingAssignment).countBy({entity: {id}})).toBe(1);
        expect(await packing.deletePackingList(id, session)).toEqual({changed: true});
        expect(await packingService.getPackingListById(id)).toBeNull();
        expect(await AppDataSource.getRepository(PackingItem).countBy({entity: {id}})).toBe(0);
        expect(await AppDataSource.getRepository(PackingAssignment).countBy({entity: {id}})).toBe(0);
    });

    it('duplicates content and defaults without assignments, files, or lifecycle; retains historical nullable capacity in the draft', async () => {
        const id = await fixture();
        const item = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.setPackingSelfAssignment(id, item.id, true, actor(editor));
        await packingService.updatePackingItem(item.id, {maxAssignees: null});
        await packing.setPackingArchived(id, true, actor(owner));
        const duplicate = await packing.readPackingDuplicate(id, actor(owner));
        expect(duplicate).toMatchObject({title: 'Complete packing', eventId: null, defaultPermissions: creation().defaultPermissions});
        expect(duplicate.items[0].maxAssignees).toBeNull();
        expect(contractValidator('PackingDuplicate')(duplicate)).toBe(true);
        expect(JSON.stringify(duplicate)).not.toMatch(/header|archive|assigned|profile/);
        duplicate.items[0].maxAssignees = 1;
        const copied = await packing.createPackingList(duplicate as components['schemas']['PackingCreateInput'], undefined, actor(owner));
        const view = (await packing.readPackingList(copied.id, actor(owner))).data;
        expect(view).toMatchObject({headerUrl: null, archived: false, inheritedArchived: false});
        expect(view.items.every(row => row.assignedCount === 0)).toBe(true);
    });

    it('checks event relink drafts under the shared lock and retains inherited archive management without a restore action', async () => {
        const id = await fixture();
        const eventId = await createIntegrationEvent(owner.id, 'Packing lifecycle parent');
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        await expect(packing.changePackingEvent(id, {eventId: null, expectedEventId: eventId}, actor(owner), settings.settingsToken)).rejects.toMatchObject({status: 412});
        await archiveEntity({type: 'event', id: eventId}, {}, actor(owner));
        const inherited = await packing.readPackingSettings(id, actor(owner));
        expect(inherited.capabilities).toMatchObject({manageArchive: true, restore: false});
        expect(inherited.archive.inherited).toBe(true);
        await expect(packing.setPackingArchived(id, false, actor(owner))).rejects.toMatchObject({status: 409, code: 'ARCHIVE_INHERITED'});
        const item = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.updatePackingItem(id, item.id, {description: 'Archival does not freeze packing'}, item.editToken, actor(owner));
        await packing.deletePackingList(id, actor(owner));
        expect(await AppDataSource.getRepository(PackingItem).countBy({entity: {id}})).toBe(0);
    });
});

describe('pilot mixed overview projection', () => {
    it.each(['account', 'guest'] as const)('keeps native owner-card actions for a persisted %s profile while administrators remain nonowners', async identity => {
        let session: SessionLike;
        if (identity === 'guest') {
            const guest = await userService.createGuest('Overview guest owner');
            session = {auth: {guest}, profile: guest.profile};
        } else {
            session = actor(await persistIntegrationProfile({name: 'Overview account owner'}));
        }

        // Existing guest-owned content is a legitimate persistence fixture, independently
        // of today's account-only creation POST. Keep Overview and Settings' intentionally
        // different duplicate controls separate while sharing the actual ownership rule.
        const [id] = await createPackingListWithItem(session.profile!.id);
        const title = `Native ${identity} overview ownership`;
        await packingService.updatePackingListTitle(id, title);
        const overview = await readOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('OverviewRegion')(overview)).toBe(true);
        expect(overview.items).toHaveLength(1);
        expect(overview.items[0]).toMatchObject({id, capabilities: {duplicate: true, remove: true}});
        expect((await packing.readPackingSettings(id, session)).capabilities)
            .toMatchObject({duplicate: identity === 'account', remove: true});

        // Delegated administration includes the card in the owner's collection but does
        // not transfer the profile ownership that native Duplicate/Delete controls require.
        const administrator = actor(await persistIntegrationProfile({name: 'Overview nonowner administrator'}));
        await adminService.addAdmin('packing', id, administrator.profile!.id, DEFAULT_PERM.ADMIN);
        const delegated = await readOverview({collection: 'owner', region: 'main', q: title}, administrator);
        expect(delegated.items).toHaveLength(1);
        expect(delegated.items[0]).toMatchObject({id, capabilities: {duplicate: false, remove: false}});

        await setOverviewVisibility('packing', id, {visibility: 'hidden'}, session);
        const hidden = await readOverview({collection: 'owner', region: 'hidden'}, session);
        expect(hidden.items[0]).toMatchObject({id, capabilities: {duplicate: true, remove: true}});
    });

    it('keeps event containers, private placement and actor membership in the shared overview path', async () => {
        const isolatedOwner = await persistIntegrationProfile({name: 'Scoped overview owner'});
        const isolatedParticipant = await persistIntegrationProfile({name: 'Scoped overview participant'});
        const session = actor(isolatedOwner);
        const participantSession = actor(isolatedParticipant);
        const eventId = await createIntegrationEvent(isolatedOwner.id, 'Container for packing');
        const id = (await packing.createPackingList({...creation(eventId), title: 'Scoped packing overview'}, undefined, session)).id;
        const overview = await readOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('OverviewRegion')(overview)).toBe(true);
        expect(overview.items.map(card => [card.type, card.id])).toEqual([['event', eventId]]);
        const children = await readOverview({collection: 'owner', region: 'main', eventId}, session);
        // The selected event encloses the child collection as a complete card. Its native
        // feature link and personal visibility survive without exposing event commands here.
        expect(contractValidator('OverviewRegion')(children)).toBe(true);
        expect(children.parent).toMatchObject({id: eventId, type: 'event', title: 'Container for packing',
            description: 'A production-shaped integration workflow', url: `/event/${eventId}`,
            visibility: 'default', overviewHidden: false, children: {total: 1, matching: 1},
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}});
        expect(children).toMatchObject({totalChildren: 1, childPage: 1, hasPrevious: false, hasNext: false});
        await setOverviewVisibility('event', eventId, {visibility: 'shown'}, session);
        expect((await readOverview({collection: 'owner', region: 'main', eventId}, session)).parent)
            .toMatchObject({id: eventId, visibility: 'shown', overviewHidden: false});
        expect(children.items.map(card => card.id)).toEqual([id]);
        expect(children.items[0].url).toBe(`/frontend-pilot/packing/${id}`);
        expect(children.items[0].capabilities).toEqual({archive: true, restore: false, duplicate: true, remove: true});
        const item = (await packing.readPackingList(id, session)).data.items[0];
        await packing.setPackingSelfAssignment(id, item.id, true, participantSession);
        const participantView = await readOverview({collection: 'participant', region: 'main'}, participantSession);
        expect(participantView.items.map(card => card.id)).toEqual([id]);
        expect(participantView.items[0].eventContext).toBeNull();
        expect(participantView.parent).toBeNull();
        expect((await readOverview({collection: 'owner', region: 'main'}, participantSession)).items).toEqual([]);
        await expect(setOverviewVisibility('event', eventId, {visibility: 'hidden'}, participantSession)).rejects.toMatchObject({status: 403});
        for (let retry = 0; retry < 2; retry++) expect(await setOverviewVisibility('packing', id, {visibility: 'hidden'}, participantSession))
            .toEqual({visibility: 'hidden', overviewHidden: true, archived: false});
        expect((await readOverview({collection: 'participant', region: 'main'}, participantSession)).items).toEqual([]);
        expect((await readOverview({collection: 'participant', region: 'hidden'}, participantSession)).items.map(card => card.id)).toEqual([id]);
        expect((await readOverview({collection: 'owner', region: 'hidden'}, participantSession)).items).toEqual([]);
        expect((await readOverview({collection: 'owner', region: 'main', eventId}, session)).items.map(card => card.id)).toEqual([id]);
        expect((await packing.readPackingList(id, session)).data.archived).toBe(false);
        await setOverviewVisibility('packing', id, {visibility: 'default'}, participantSession);
        const search = await readOverview({collection: 'participant', region: 'main', q: 'missing', page: '999'}, participantSession);
        expect(search).toMatchObject({page: 1, items: [], matchingEntities: 0, hasNext: false, hasPrevious: false});
        // "Shown" is an explicit preference even for an active card. Later shared archival
        // must keep that card in this profile's main region without pretending it was restored.
        expect(await setOverviewVisibility('packing', id, {visibility: 'shown'}, participantSession))
            .toEqual({visibility: 'shown', overviewHidden: false, archived: false});
        await packing.setPackingArchived(id, true, session);
        const shownArchived = await readOverview({collection: 'participant', region: 'main'}, participantSession);
        expect(shownArchived.items).toHaveLength(1);
        expect(shownArchived.items[0]).toMatchObject({id, visibility: 'shown', overviewHidden: false, archived: true});
        await setOverviewVisibility('packing', id, {visibility: 'default'}, participantSession);
        expect((await readOverview({collection: 'participant', region: 'main'}, participantSession)).items).toEqual([]);
        expect((await readOverview({collection: 'participant', region: 'hidden'}, participantSession)).items[0])
            .toMatchObject({id, visibility: 'default', overviewHidden: true, archived: true});
        const serialized = JSON.stringify([participantView, children, shownArchived]);
        for (const privateKey of ['ownerId', 'profileId', 'email', 'headerImg']) expect(serialized).not.toContain(`"${privateKey}"`);
    });

    it('shows non-packing membership without a filter and includes every eligible event child', async () => {
        const isolatedOwner = await persistIntegrationProfile({name: 'Mixed overview owner'});
        const session = actor(isolatedOwner);
        const [surveyId] = await createSurveyWithCombinations(isolatedOwner.id);
        const surveyOnly = await readOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('OverviewRegion')(surveyOnly)).toBe(true);
        expect(surveyOnly).toMatchObject({type: 'all', availableTypes: ['survey'], totalEntities: 1,
            matchingEntities: 1, totalCards: 1});
        expect(surveyOnly.items).toMatchObject([{id: surveyId, type: 'survey', url: `/survey/${surveyId}`}]);

        const eventId = await createIntegrationEvent(isolatedOwner.id, 'Mixed trip');
        const activityId = await createEventActivityPlan(isolatedOwner.id, eventId);
        const packingId = (await packing.createPackingList(creation(eventId), undefined, session)).id;
        const overview = await readOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('OverviewRegion')(overview)).toBe(true);
        expect(overview).toMatchObject({type: 'all', totalEntities: 4, matchingEntities: 4, totalCards: 2});
        expect(new Set(overview.availableTypes)).toEqual(new Set(['event', 'activity', 'packing', 'survey']));
        expect(overview.items.find(card => card.id === eventId)?.children).toEqual({total: 2, matching: 2});
        const children = await readOverview({collection: 'owner', region: 'main', eventId}, session);
        expect(children.parent?.children).toEqual({total: 2, matching: 2});
        expect(new Set(children.items.map(card => card.id))).toEqual(new Set([activityId, packingId]));
        expect(children.items.find(card => card.id === activityId)?.url).toBe(`/activity/${activityId}`);
        expect(children.items.find(card => card.id === packingId)?.url).toBe(`/frontend-pilot/packing/${packingId}`);

        const filtered = await readOverview({collection: 'owner', region: 'main', type: 'activity'}, session);
        expect(filtered).toMatchObject({type: 'activity', totalEntities: 4, matchingEntities: 1, totalCards: 1});
        expect(filtered.items).toMatchObject([{id: eventId, type: 'event', children: {total: 2, matching: 1}}]);
        const filteredChildren = await readOverview({collection: 'owner', region: 'main', type: 'activity', eventId}, session);
        expect(filteredChildren.items.map(card => card.id)).toEqual([activityId]);

        await setOverviewVisibility('survey', surveyId, {visibility: 'hidden'}, session);
        const hidden = await readOverview({collection: 'owner', region: 'hidden'}, session);
        expect(hidden).toMatchObject({type: 'all', totalEntities: 4, hiddenEntities: 1, matchingEntities: 1});
        expect(hidden.items).toMatchObject([{id: surveyId, type: 'survey', visibility: 'hidden'}]);
        const missing = await readOverview({collection: 'owner', region: 'main', q: 'no such title'}, session);
        expect(missing).toMatchObject({type: 'all', totalEntities: 4, matchingEntities: 0, items: []});
    });
});
