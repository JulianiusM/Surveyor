import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingAssignment} from '../../src/modules/database/entities/packing/PackingAssignment';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as userService from '../../src/modules/database/services/UserService';
import * as packing from '../../src/controller/packingController';
import {readOverview, setOverviewVisibility} from '../../src/modules/overview/api';
import packingController from '../../src/controller/packingController';
import {archiveEntity, changeEntityEvent, getEntityViewAdmission, restoreEntity} from '../../src/controller/entityAdminController';
import {readEventLinkSelection} from '../../src/controller/eventController';
import {randomUUID} from 'node:crypto';
import {QueryFailedError, type EntityManager} from 'typeorm';
import {contractValidator} from '../../src/modules/api/contracts';
import {DEFAULT_PERM, PERM} from '../../src/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {SessionLike} from '../../src/types/PermissionTypes';
import type {EntityMutationOutcome} from '../../src/types/EntityPropertyTypes';
import {createApiRequest} from '../factories/apiActionFactory';
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
        expect((await packingService.getPackingListById(id))!.title).toBe(creation().title);
    });

    it('commits creation order and audience defaults together and denies an unauthorized parent without partial rows', async () => {
        const before = await AppDataSource.getRepository(PackingList).count();
        const forbiddenEvent = await createIntegrationEvent(editor.id, 'Private target');
        await expect(packing.createPackingList(creation(forbiddenEvent), undefined, actor(owner))).rejects.toMatchObject({status: 403});
        expect(await AppDataSource.getRepository(PackingList).count()).toBe(before);
        const id = await fixture();
        expect(await packingService.getPackingListById(id)).toMatchObject({ownerId: owner.id});
        const view = await packing.readPackingList(id, actor(owner));
        expect(view.data.items.map(item => [item.title, item.position])).toEqual([['Tent', 0], ['Water', 1]]);
        expect(view.data.items.every(item => item.assignedCount === 0)).toBe(true);
        expect(await adminService.getDefaultPerms('packing', id)).toEqual(creation().defaultPermissions);
        expect(contractValidator('PackingListView')(view.data)).toBe(true);
        expect(contractValidator('PackingSettings')(await packing.readPackingSettings(id, actor(owner)))).toBe(true);
    });

    it('preserves independent child fields and the packing ITEM_EDIT_META exception', async () => {
        const id = await fixture();
        const first = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await adminService.addAdmin('packing', id, editor.id, PERM.ITEM_EDIT_META);
        let view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[0].capabilities).toEqual({showTitleEdit: false, showCapacityEdit: false,
            editTitle: false, editDescription: false, editCapacity: false, editRequired: false, removeItem: false, removeAssignments: false});
        await adminService.addAdmin('packingItem', first.id, editor.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY);
        view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[0].capabilities).toMatchObject({showTitleEdit: true, showCapacityEdit: true,
            editTitle: false, editCapacity: false, editDescription: false, editRequired: false});
        // Native attr POST has always required EDIT_META, independently of the
        // visible title/capacity controls. The API must preserve both contracts.
        await expect(packing.updatePackingItem(id, first.id, {title: 'Display grant only'}, view.items[0].editToken, actor(editor)))
            .rejects.toMatchObject({status: 403});
        await adminService.updateAdminPerms('packingItem', first.id, editor.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY | PERM.EDIT_META);
        view = (await packing.readPackingList(id, actor(editor))).data;
        expect(view.items[0].capabilities).toMatchObject({showTitleEdit: true, showCapacityEdit: true, editTitle: true, editCapacity: true});
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

    it('preserves all authored numeric default-mask bits without changing the native permission-key decoder', async () => {
        const mask = PERM.ACCESS_VIEW | (1 << 24);
        const body = creation();
        body.defaultPermissions.public = mask;
        const id = (await packing.createPackingList(body, undefined, actor(owner))).id;
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: mask});
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.updatePackingDefaults(id, {guest: mask}, actor(owner), settings.settingsToken);
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: mask, guest: mask});

        // Native matrix fields have always carried named keys. A raw numeric
        // scalar remains an unknown key and clears only its submitted audience.
        await packingController.updateSettings(id, {defaultPerms: {guest: mask}});
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: mask, guest: 0});
    });

    it('retains native sparse positions and partial failures while versioned ordering requires current authority and a complete set', async () => {
        const id = await fixture();
        const original = (await packing.readPackingList(id, actor(owner))).data;
        const first = original.items[0];
        const second = original.items[1];
        const foreign = await fixture();
        const foreignItem = (await packing.readPackingList(foreign, actor(owner))).data.items[0];

        // Original native ordering accepts explicit, sparse positions and ignores
        // rows outside its root. It has never required a complete rendered table.
        await packingController.reorderItems(id, [{itemId: first.id, position: 7}, {itemId: foreignItem.id, position: 9}]);
        expect(await packingService.getPackingItemById(first.id)).toMatchObject({pos: 7});
        expect(await packingService.getPackingItemById(second.id)).toMatchObject({pos: 1});
        expect(await packingService.getPackingItemById(foreignItem.id)).toMatchObject({pos: 0});
        await packingController.reorderItems(id, [{itemId: first.id, position: 8}, {itemId: first.id, position: 9}]);
        expect(await packingService.getPackingItemById(first.id)).toMatchObject({pos: 9});

        // A later malformed SQL scalar must not retroactively roll back a native
        // row already saved. Only the versioned command owns an atomic full order.
        await expect(packingController.reorderItems(id, [{itemId: first.id, position: 11},
            {itemId: second.id, position: 'not-a-number'}])).rejects.toBeInstanceOf(QueryFailedError);
        expect(await packingService.getPackingItemById(first.id)).toMatchObject({pos: 11});
        expect(await packingService.getPackingItemById(second.id)).toMatchObject({pos: 1});

        await adminService.addAdmin('packing', id, editor.id, PERM.ITEM_EDIT);
        const reviewed = (await packing.readPackingList(id, actor(editor))).data;
        await adminService.removeAdmin('packing', id, editor.id);
        await expect(packing.reorderPackingItems(id, {itemIds: reviewed.items.map(item => item.id)}, reviewed.orderToken, actor(editor)))
            .rejects.toMatchObject({status: 403});
        const ownerReview = (await packing.readPackingList(id, actor(owner))).data;
        await expect(packing.reorderPackingItems(id, {itemIds: [first.id]}, ownerReview.orderToken, actor(owner)))
            .rejects.toMatchObject({status: 409});
        await expect(packing.reorderPackingItems(id, {itemIds: [first.id, first.id]}, ownerReview.orderToken, actor(owner)))
            .rejects.toMatchObject({status: 409});
        expect((await packing.readPackingList(id, actor(owner))).data.items.map(item => item.id)).toEqual(reviewed.items.map(item => item.id));
    });

    it('retains native creation, permission initialization, and targeted deletion hooks', async () => {
        const form = {title: 'Original native creation', description: '', event_id: '',
            items: JSON.stringify(creation().items.map(item => ({...item, description: item.description ?? ''}))),
            defaultPerms: {public: ['ACCESS_VIEW'], guest: []}};
        const data = Object.assign(packingController.preprocessCreate(form), {_body: form});
        const id = await packingController.createEntity(owner.id, data);
        expect(await packingService.getPackingListById(id)).toMatchObject({eventId: null});
        expect(await adminService.getDefaultPerms('packing', id)).toEqual({});
        // Preserve the original position/pos adapter behavior; API creation's
        // independently tested ordered transaction must not rewrite native creation.
        const items = await packingService.getPackingItems(id);
        expect(items.map(item => item.pos)).toEqual([0, 0]);
        await packingController.afterCreateItems(id, data);
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: 0});
        await adminService.updatePerms('packing', id, {public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT, guest: PERM.ITEM_ADD});
        await packingController.afterCreateItems(id, data);
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: 0});

        // Observe native hook delegation and target selection against the real
        // repositories. Route/session authorization belongs to its HTTP boundary;
        // the established request factory supplies this unused hook parameter.
        const [unrelatedId, unrelatedItem] = await createPackingListWithItem(owner.id);
        await packingController.deleteItem(items[0].id);
        expect(await packingService.getPackingItemById(items[0].id)).toBeNull();
        expect(await packingService.getPackingItemById(items[1].id)).toMatchObject({entityId: id});
        expect(await packingService.getPackingItemById(unrelatedItem.id)).toMatchObject({entityId: unrelatedId});

        const list = (await packingService.getPackingListById(id))!;
        await packingController.deleteEntity(list, createApiRequest({profileId: owner.id}).session);
        expect(await packingService.getPackingListById(id)).toBeNull();
        expect(await packingService.getPackingItemById(items[1].id)).toBeNull();
        expect(await packingService.getPackingListById(unrelatedId)).toMatchObject({ownerId: owner.id});
        expect(await packingService.getPackingItemById(unrelatedItem.id)).toMatchObject({entityId: unrelatedId});
    });

    it('retains raw native Everyone persistence and its omitted-flag and vanished-row outcomes', async () => {
        const id = await fixture();
        const item = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await expect(packingController.updateRequired(item.id, {})).resolves.toBe('Requirement updated');
        expect(Boolean((await packingService.getPackingItemById(item.id))!.requiredByAll)).toBe(false);
        // The native writer forwards raw values to a tinyint column. Textual
        // booleans are not JSON booleans and retain MariaDB's scalar rejection.
        await expect(packingController.updateRequired(item.id, {flag: 'false'})).rejects.toBeInstanceOf(QueryFailedError);
        await expect(packingController.updateRequired(item.id, {flag: '1'})).resolves.toBe('Requirement updated');
        expect(Boolean((await packingService.getPackingItemById(item.id))!.requiredByAll)).toBe(true);
        const current = (await packing.readPackingList(id, actor(owner))).data.items.find(row => row.id === item.id)!;
        await packing.updatePackingItem(id, item.id, {requiredByAll: false}, current.editToken, actor(owner));
        expect(Boolean((await packingService.getPackingItemById(item.id))!.requiredByAll)).toBe(false);
        await expect(packingController.updateRequired(randomUUID(), {flag: true})).resolves.toBe('Requirement updated');
        await expect(packingController.updateItemDescription(randomUUID(), {description: 'Vanished row'}))
            .rejects.toMatchObject({status: 500, message: 'Unknown error while saving'});
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

    it('shares native image replacement policy while v1 cleans only failed uploads and unlinks the old image after commit', async () => {
        const id = await fixture();
        const oldPath = 'uploads/existing-packing-header.jpg';
        const newPath = 'uploads/approved-packing-header.png';
        const rejectedPath = 'uploads/rejected-packing-header.png';
        await packingService.updateHeaderImage(id, oldPath);
        const baseline = await packing.readPackingSettings(id, actor(owner));
        const removals: {path: string; persisted: string | null | undefined}[] = [];
        const observations: Promise<void>[] = [];

        // File unlink is the true external side effect. Keep the controller,
        // TypeORM metadata, locked transaction and committed image column real.
        const unlink = vi.spyOn(fs.promises, 'unlink').mockImplementation(function observeUnlink(path) {
            const observation = packingService.getPackingListById(id).then(function recordPersistedHeader(list) {
                removals.push({path: String(path), persisted: list?.headerImg});
            });
            observations.push(observation);
            return observation;
        });
        try {
            await expect(packing.setPackingHeader(id,
                {path: rejectedPath, mimetype: 'image/png'} as Express.Multer.File, actor(owner), 'stale-token'))
                .rejects.toMatchObject({status: 412});
            await Promise.all(observations);
            expect(removals).toEqual([{path: rejectedPath, persisted: oldPath}]);
            expect(await packingService.getPackingListById(id)).toMatchObject({headerImg: oldPath});

            await expect(packing.setPackingHeader(id,
                {path: newPath, mimetype: 'image/png'} as Express.Multer.File, actor(owner), baseline.settingsToken))
                .resolves.toEqual({changed: true});
            await Promise.all(observations);
            expect(removals).toEqual([
                {path: rejectedPath, persisted: oldPath}, {path: oldPath, persisted: newPath},
            ]);
            expect(await packingService.getPackingListById(id)).toMatchObject({headerImg: newPath});

            const nativeEntity = (await packingService.getPackingListById(id))!;
            await expect(packingController.deleteHeaderImg(nativeEntity)).resolves.toBe('Image deleted');
            await Promise.all(observations);
            expect(removals.at(-1)).toEqual({path: newPath, persisted: null});
        } finally {
            unlink.mockRestore();
        }
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
        expect(await packingService.getPackingAssignmentCounts(id)).toEqual({[first.id]: 2});
        const capacityBaseline = (await packing.readPackingList(id, actor(owner))).data.items[0];
        await packing.updatePackingItem(id, first.id, {maxAssignees: 1}, capacityBaseline.editToken, actor(owner));
        expect((await packing.readPackingList(id, actor(owner))).data.items[0]).toMatchObject({assignedCount: 2, maxAssignees: 1});
        expect(await packing.setPackingSelfAssignment(id, first.id, true, actor(owner))).toMatchObject({assignedCount: 2});
        const another = await persistIntegrationProfile({name: 'Capacity competitor'});
        await expect(packing.setPackingSelfAssignment(id, first.id, true, actor(another))).rejects.toMatchObject({status: 409});
    });

    it('preserves the native and versioned capacity inputs through actual MariaDB rounding and rollback', async () => {
        const id = await fixture();
        const cases: {value: number | string | null; saved?: number | null}[] = [
            {value: '0', saved: 0}, {value: '-1', saved: -1}, {value: null, saved: null},
            {value: ''}, {value: 'not-a-number'},
            {value: '1.5', saved: 2}, {value: '-1.5', saved: -2},
            {value: '2.499', saved: 2}, {value: '2.5', saved: 3},
            {value: '-2147483648', saved: -2147483648}, {value: '2147483647', saved: 2147483647},
            {value: '-2147483648.4', saved: -2147483648}, {value: '2147483647.4', saved: 2147483647},
            {value: '-2147483649'}, {value: '2147483648'},
            {value: 0, saved: 0}, {value: -1.5, saved: -2},
        ];
        // Two independent rows expose shared JS coercion mistakes as literal SQL outcomes.
        // Native persistence and the v1 transaction remain real; no SQL boundary is mocked.
        for (const scenario of cases) {
            const before = (await packing.readPackingList(id, actor(owner))).data.items;
            const native = before[0];
            const versioned = before[1];
            const nativeWrite = packingController.updateItemAttr(native.id,
                {field: 'maxAssignees', value: scenario.value});
            if (Object.hasOwn(scenario, 'saved')) await nativeWrite;
            else await expect(nativeWrite).rejects.toBeInstanceOf(QueryFailedError);
            const versionedWrite = packing.updatePackingItem(id, versioned.id, {maxAssignees: scenario.value}, versioned.editToken, actor(owner));
            if (Object.hasOwn(scenario, 'saved')) await versionedWrite;
            else await expect(versionedWrite).rejects.toBeInstanceOf(QueryFailedError);

            const after = (await packing.readPackingList(id, actor(owner))).data.items;
            expect(after[0]).toMatchObject({maxAssignees: Object.hasOwn(scenario, 'saved') ? scenario.saved : native.maxAssignees, assignedCount: 0});
            expect(after[1]).toMatchObject({maxAssignees: Object.hasOwn(scenario, 'saved') ? scenario.saved : versioned.maxAssignees, assignedCount: 0});
        }
    });

    it('rejects stale versioned edits after native writes while retaining original native overwrite and property-context behavior', async () => {
        const id = await fixture();
        await adminService.updatePerms('packing', id, {public: PERM.ACCESS_VIEW | PERM.ITEM_EDIT_DESC});
        const pilotBaseline = (await packing.readPackingList(id, actor(editor))).data.items[0];
        await packingController.updateItemDescription(pilotBaseline.id, {description: 'Native edit'});
        await expect(packing.updatePackingItem(id, pilotBaseline.id, {description: 'Stale pilot edit'}, pilotBaseline.editToken, actor(editor)))
            .rejects.toMatchObject({status: 412});
        const current = (await packing.readPackingList(id, actor(editor))).data.items[0];
        await packing.updatePackingItem(id, current.id, {description: 'Pilot edit'}, current.editToken, actor(editor));
        // Legacy item endpoints ignore extra expectedValue fields. A versioned
        // token must protect the API without silently adding native preconditions.
        await packingController.updateItemDescription(current.id, {description: 'Stale native edit', expectedValue: current.description});
        expect((await packingService.getPackingItemById(current.id))!.description).toBe('Stale native edit');
        await expect(packing.updatePackingItem(id, current.id, {description: 'Stale pilot edit'}, current.editToken, actor(editor)))
            .rejects.toMatchObject({status: 412});
        await packingController.updateItemAttr(current.id, {field: 'title', value: 'Updated item'});
        expect((await packingService.getPackingItemById(current.id))!.title).toBe('Updated item');

        const entity = (await packingService.getPackingListById(id))!;
        const metadata = await packing.readPackingMetadata(id, actor(owner));
        await packing.patchPackingMetadata(id, {title: 'Pilot setup edit'}, metadata.etag, actor(owner));
        // Unlike item endpoints, original native properties reject unsupported
        // body keys through Joi. Their unchanged error is validation, not a new412.
        await expect(packingController.updateProperties(entity, {title: 'Stale native setup', expectedValues: {title: entity.title}}))
            .rejects.toMatchObject({status: 400});
        await packingController.updateProperties(entity, {description: 'Independent native setup'});
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Pilot setup edit', description: 'Independent native setup'});

        // A relink after native route discovery supersedes that route's permission
        // context. The original native root transaction rejects that stale captured
        // entity; the literal protects its unchanged native conflict wording.
        const eventId = await createIntegrationEvent(owner.id, 'Relinked metadata parent');
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        const conflict = {status: 409, message: 'The linked event changed. Reload and try again.'};
        await expect(packingController.updateProperties(entity, {title: 'Retired native context'})).rejects.toMatchObject(conflict);
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Pilot setup edit', eventId});
    });

    it('keeps native persistence hooks independent of versioned linked-page admission', async () => {
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
        // Native route middleware owns field grants; these original controller
        // hooks must not add the v1 detail-page admission check as a second policy.
        await packingController.updateProperties(entity, {title: 'Native title-only grant'});
        await packingController.updateItemDescription(item.id, {description: 'Native child grant'});
        await packingController.quickAddItem(entity, {title: 'Native add-only grant'}, actor(editor));
        await packingController.quickAddItem(entity, {title: 'Another native addition'}, actor(editor));
        const items = await packingService.getPackingItems(id);
        expect(items.map(entry => entry.title)).toEqual(expect.arrayContaining(['Tent', 'Water', 'Native add-only grant', 'Another native addition']));
        expect(items).toHaveLength(4);
        expect(items.filter(entry => entry.profileId === editor.id)).toEqual([
            expect.objectContaining({pos: 0}), expect.objectContaining({pos: 0}),
        ]);
        await packingController.deleteHeaderImg(entity);
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Native title-only grant'});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({description: 'Native child grant'});
        await adminService.updateAdminPerms('packing', id, editor.id, PERM.ITEM_ADD);
        await expect(packing.readPackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
        const created = await packing.createPackingItem(id,
            {title: 'Versioned add-only grant', description: null, maxAssignees: 1, requiredByAll: false}, actor(editor));
        expect(await packingService.getPackingItemById(created.id)).toMatchObject({profileId: editor.id, pos: 2});
        await expect(packing.readPackingSettings(id, actor(editor))).rejects.toMatchObject({status: 403});
    });

    it('shares independently granted metadata, item and access actions while keeping private projections bounded', async () => {
        const id = await fixture();
        const eventId = await createIntegrationEvent(owner.id, 'Action-only linked parent');
        const ownerSettings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), ownerSettings.settingsToken);
        await adminService.updatePerms('packing', id, {public: 0, guest: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_TITLE);
        const item = (await packingService.getPackingItems(id))[0];
        await adminService.addAdmin('packingItem', item.id, editor.id, PERM.EDIT_DESC);

        // Child actions do not imply access to the linked page or its assignment rows.
        await expect(packing.readPackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
        const metadata = await packing.readPackingMetadata(id, actor(editor));
        expect(metadata.data.values).toEqual({title: creation().title});
        await packing.patchPackingMetadata(id, {title: 'Independent versioned title'}, metadata.etag, actor(editor));
        const entity = (await packingService.getPackingListById(id))!;
        await packingController.updateProperties(entity, {title: 'Independent native title'});
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Independent native title'});

        // Obtain only this action's permitted current values. The actor never had
        // ACCESS_VIEW and cannot borrow a token from a previously visible full page.
        const itemBaseline = await packing.readPackingItemEditBaseline(id, item.id, actor(editor));
        expect(itemBaseline.values).toEqual({description: 'Shared shelter'});
        expect(itemBaseline.editableFields).toEqual(['description']);
        await packing.updatePackingItem(id, item.id, {description: 'Independent versioned description'}, itemBaseline.editToken, actor(editor));
        await packingController.updateItemDescription(item.id, {description: 'Independent native description'});
        expect(await packingService.getPackingItemById(item.id)).toMatchObject({description: 'Independent native description'});
        const titleOnly = await packing.readPackingSettings(id, actor(editor));
        expect(titleOnly.access).toBeNull();
        expect(titleOnly.editableFields).toEqual(['title']);

        await adminService.updateAdminPerms('packing', id, editor.id, PERM.MANAGE_PERMISSIONS);
        const management = await packing.readPackingSettings(id, actor(editor));
        expect(management.editableFields).toEqual([]);
        expect(management.access).not.toBeNull();
        await packing.updatePackingDefaults(id, {guest: PERM.ITEM_ADD}, actor(editor), management.settingsToken);
        await packingController.updateSettings(id, {defaultPerms: {guest: ['ITEM_EDIT']}});
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({guest: PERM.ITEM_EDIT});
        await expect(packing.readPackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingMetadata(id, actor(editor))).rejects.toMatchObject({status: 403});
    });

    it.each(['account', 'guest'] as const)('supplies minimal item and order baselines to a grant-only linked %s actor', async identity => {
        let session = actor(editor);
        if (identity === 'guest') {
            const guest = await userService.createGuest('Grant-only Packing editor');
            session = {auth: {guest}, profile: guest.profile};
        }
        const id = await fixture();
        const foreign = await fixture();
        const eventId = await createIntegrationEvent(owner.id, 'Private edit-baseline parent');
        const settings = await packing.readPackingSettings(id, actor(owner));
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        await adminService.updatePerms('packing', id, {public: 0, guest: 0, authenticated: 0, participant: 0});
        const [first, second] = await packingService.getPackingSnapshotItems(AppDataSource.manager, id);
        await adminService.addAdmin('packingItem', first.id, session.profile!.id, PERM.EDIT_DESC);

        // The actor has never read the linked page. The baseline discloses no other
        // item values, assignment identities/counts, parent context or list metadata.
        await expect(packing.readPackingList(id, session)).rejects.toMatchObject({status: 403});
        const baseline = await packing.readPackingItemEditBaseline(id, first.id, session);
        expect(baseline).toEqual({id: first.id, values: {description: 'Shared shelter'},
            editableFields: ['description'], editToken: expect.any(String)});
        expect(contractValidator('PackingItemEditBaseline')(baseline)).toBe(true);
        // Hashing a hidden, guessable field would disclose evidence even without its
        // raw value. Assert the actual public token payload contains only visible hashes.
        const payload = JSON.parse(Buffer.from(baseline.editToken.slice(6, -1), 'base64url').toString('utf8'));
        expect(Object.keys(payload.fields)).toEqual(['description']);
        await expect(packing.readPackingItemEditBaseline(id, second.id, session)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingItemEditBaseline(foreign, first.id, session)).rejects.toMatchObject({status: 404});
        await expect(packing.readPackingItemEditBaseline(id, first.id, {})).rejects.toMatchObject({status: 401});
        await expect(packing.readPackingItemOrderBaseline(id, session)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingItemOrderBaseline(id, {})).rejects.toMatchObject({status: 401});
        await expect(packing.updatePackingItem(id, first.id, {title: 'Hidden title edit'}, baseline.editToken, session))
            .rejects.toMatchObject({status: 403});

        // A visible field's token remains useful after an independent hidden-field
        // edit. Cross-actor evidence and stale writes to that same field still fail.
        const ownerBaseline = await packing.readPackingItemEditBaseline(id, first.id, actor(owner));
        await expect(packing.updatePackingItem(id, first.id, {description: 'Wrong actor evidence'}, ownerBaseline.editToken, session))
            .rejects.toMatchObject({status: 412});
        await packing.updatePackingItem(id, first.id, {title: 'Independent owner title'}, ownerBaseline.editToken, actor(owner));
        await packing.updatePackingItem(id, first.id, {description: 'Grant-only description'}, baseline.editToken, session);
        await expect(packing.updatePackingItem(id, first.id, {description: 'Stale description'}, baseline.editToken, session))
            .rejects.toMatchObject({status: 412});
        expect(await packingService.getPackingItemById(first.id)).toMatchObject({
            title: 'Independent owner title', description: 'Grant-only description',
        });

        // Display controls and command grants retain the native asymmetry. Removing
        // the method grant revokes baseline admission and invalidates old edit authority.
        await adminService.updateAdminPerms('packingItem', first.id, session.profile!.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY);
        await expect(packing.readPackingItemEditBaseline(id, first.id, session)).rejects.toMatchObject({status: 403});
        await expect(packing.updatePackingItem(id, first.id, {description: 'Revoked field'}, baseline.editToken, session))
            .rejects.toMatchObject({status: 403});

        // ITEM_EDIT alone authorizes order review/action while linked detail and
        // parent information stay private. The same ordered query/token owns both reads.
        await adminService.addAdmin('packing', id, session.profile!.id, PERM.ITEM_EDIT);
        await expect(packing.readPackingList(id, session)).rejects.toMatchObject({status: 403});
        const order = await packing.readPackingItemOrderBaseline(id, session);
        expect(order).toEqual({items: [{id: first.id, position: 0}, {id: second.id, position: 1}], orderToken: expect.any(String)});
        expect(contractValidator('PackingOrderEditBaseline')(order)).toBe(true);
        await expect(packing.readPackingItemOrderBaseline(foreign, session)).rejects.toMatchObject({status: 403});
        const currentOwnerBaseline = await packing.readPackingItemEditBaseline(id, first.id, actor(owner));
        await packing.updatePackingItem(id, first.id, {description: 'Independent of order'}, currentOwnerBaseline.editToken, actor(owner));
        await packing.reorderPackingItems(id, {itemIds: [second.id, first.id]}, order.orderToken, session);
        await expect(packing.reorderPackingItems(id, {itemIds: [first.id, second.id]}, order.orderToken, session))
            .rejects.toMatchObject({status: 412});
        expect((await packing.readPackingItemOrderBaseline(id, session)).items).toEqual([
            {id: second.id, position: 0}, {id: first.id, position: 1},
        ]);
    });

    it('preserves guest administration and duplicate GET but prohibits account-only creation', async () => {
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
        expect((await packingService.getPackingListByProfileId(session.profile!.id)).map(list => list.id)).not.toContain(id);
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

    it('rolls back a relink when preparing its resulting admission receipt fails', async function rejectedRelinkCompletion() {
        const id = await fixture();
        const eventId = await createIntegrationEvent(owner.id, 'Packing completion rollback parent');
        const session = actor(owner);
        const before = (await packingService.getPackingListById(id))!;
        const failure = new Error('Controlled completion failure');

        // Use the public feature-completion boundary with real reads on the supplied
        // ORM manager. The association is visible here, but must never escape a rejection.
        async function rejectPreparedAdmission(manager: EntityManager, outcome: EntityMutationOutcome): Promise<never> {
            expect(manager.queryRunner?.isTransactionActive).toBe(true);
            expect(outcome).toMatchObject({changed: true, root: {id, eventId}});
            expect((await packingService.getPackingSnapshotRoot(manager, id))?.eventId).toBe(eventId);
            expect(await getEntityViewAdmission('packing', outcome.root, session, manager)).toBe('render');
            throw failure;
        }
        await expect(changeEntityEvent('packing', before, {eventId, expectedEventId: null}, session,
            undefined, undefined, {prepare: rejectPreparedAdmission})).rejects.toBe(failure);
        expect(await packingService.getPackingListById(id)).toEqual(before);
    });

    it('prepares the Packing relink receipt for the resulting association and retains authorized no-op order', async function resultingRelinkReceipt() {
        const session = actor(editor);
        const eventId = await createIntegrationEvent(owner.id, 'Packing receipt without event membership');
        const input = creation();
        input.defaultPermissions.public = 0;
        const id = (await packing.createPackingList(input, undefined, actor(owner))).id;
        await adminService.addAdmin('packing', id, editor.id, PERM.EDIT_META);
        await adminService.addAdmin('event', eventId, editor.id, PERM.MANAGE_ASSIGNMENTS);
        const settings = await packing.readPackingSettings(id, session);

        // EDIT_META permits relinking without granting the resulting attached page's
        // ACCESS_VIEW. The reply describes the new association, not the old standalone one.
        const changed = await packing.changePackingEvent(id, {eventId, expectedEventId: null}, session, settings.settingsToken);
        expect(changed).toEqual({changed: true, canView: false});
        expect(contractValidator('PackingEventChanged')(changed)).toBe(true);
        expect((await packingService.getPackingListById(id))?.eventId).toBe(eventId);

        // Same-target acknowledgement still precedes stale/absent comparison evidence.
        const beforeNoOp = (await packingService.getPackingListById(id))!;
        await expect(packing.changePackingEvent(id, {eventId, expectedEventId: null}, session))
            .resolves.toEqual({changed: false, canView: false});
        expect(await packingService.getPackingListById(id)).toEqual(beforeNoOp);

        // Unlinking restores the existing standalone admission rule on the same receipt path.
        const linkedSettings = await packing.readPackingSettings(id, session);
        await expect(packing.changePackingEvent(id, {eventId: null, expectedEventId: eventId}, session, linkedSettings.settingsToken))
            .resolves.toEqual({changed: true, canView: true});
    });

    it('rolls back archive and restore completion failures and preserves repeated command acknowledgements', async function lifecycleCompletionFinality() {
        const id = await fixture();
        const reference = {type: 'packing' as const, id};
        const session = actor(owner);
        const failure = new Error('Controlled lifecycle completion failure');
        const archivedAt = new Date('2026-10-13T12:00:00.000Z');
        const before = (await packingService.getPackingListById(id))!;

        // A receipt failure occurs after the real direct-marker write on this manager.
        // The transaction must roll back that marker and its timestamp completely.
        async function rejectPreparedArchive(manager: EntityManager, outcome: EntityMutationOutcome): Promise<never> {
            expect(manager.queryRunner?.isTransactionActive).toBe(true);
            expect(outcome).toMatchObject({changed: true, root: {id, archivedAt}});
            expect((await packingService.getPackingSnapshotRoot(manager, id))?.archivedAt).toEqual(archivedAt);
            throw failure;
        }
        await expect(archiveEntity(reference, {}, session, archivedAt, {prepare: rejectPreparedArchive})).rejects.toBe(failure);
        expect(await packingService.getPackingListById(id)).toEqual(before);

        // The native overload retains its archive DTO. Packing's receipt remains the
        // established acknowledgement even when retrying an already archived root.
        expect(await archiveEntity(reference, {}, session, archivedAt)).toMatchObject({archived: true, directArchived: true});
        const archived = (await packingService.getPackingListById(id))!;
        await expect(packing.setPackingArchived(id, true, session)).resolves.toEqual({changed: true});
        expect(await packingService.getPackingListById(id)).toEqual(archived);

        // Restoration also prepares before commit; a rejection must retain the
        // previously committed direct marker rather than falsely reporting a rollback.
        async function rejectPreparedRestore(manager: EntityManager, outcome: EntityMutationOutcome): Promise<never> {
            expect(manager.queryRunner?.isTransactionActive).toBe(true);
            expect(outcome).toMatchObject({changed: true, root: {id, archivedAt: null}});
            expect((await packingService.getPackingSnapshotRoot(manager, id))?.archivedAt).toBeNull();
            throw failure;
        }
        await expect(restoreEntity(reference, {}, session, {prepare: rejectPreparedRestore})).rejects.toBe(failure);
        expect(await packingService.getPackingListById(id)).toEqual(archived);
        await expect(packing.setPackingArchived(id, false, session)).resolves.toEqual({changed: true});
        expect((await packingService.getPackingListById(id))?.archivedAt).toBeNull();
        expect(await restoreEntity(reference, {}, session)).toMatchObject({archived: false, directArchived: false});
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
        expect((await packingService.getManagedLists(administrator.profile!.id)).map(list => list.id)).toContain(id);
        const delegated = await readOverview({collection: 'owner', region: 'main', q: title}, administrator);
        expect(delegated.items).toHaveLength(1);
        expect(delegated.items[0]).toMatchObject({id, capabilities: {duplicate: false, remove: false}});

        await setOverviewVisibility('packing', id, {visibility: 'hidden'}, session);
        const hidden = await readOverview({collection: 'owner', region: 'hidden'}, session);
        expect(hidden.items[0]).toMatchObject({id, capabilities: {duplicate: true, remove: true}});
    });

    it('accepts production metadata and settings tokens through the shared authored comparison contract', async function emittedComparisonTokens() {
        const id = await fixture();
        const session = actor(owner);
        const metadata = await packing.readPackingMetadata(id, session);
        const settings = await packing.readPackingSettings(id, session);

        // Exercise actual controller projections, including private access-field
        // hashes. These usable baselines exceed the retired request-only limit.
        expect(metadata.etag.length).toBeGreaterThan(512);
        expect(settings.settingsToken.length).toBeGreaterThan(512);
        expect(contractValidator('ComparisonToken')(metadata.etag)).toBe(true);
        expect(contractValidator('FieldComparisonToken')(settings.settingsToken)).toBe(true);
        await expect(packing.patchPackingMetadata(id, {title: 'Shared token accepted'}, metadata.etag, session)).resolves.toBeDefined();
        await expect(packing.updatePackingDefaults(id, {guest: PERM.ACCESS_VIEW}, session, settings.settingsToken)).resolves.toEqual({changed: true});

        // Oversized comparison evidence remains a 412 after authorization, with
        // no persisted change. Missing evidence retains its separate 428 outcome.
        await expect(packing.patchPackingMetadata(id, {title: 'Must not save'}, 'x'.repeat(4097), session)).rejects.toMatchObject({status: 412});
        await expect(packing.patchPackingMetadata(id, {title: 'Must not save'}, undefined, session)).rejects.toMatchObject({status: 428});
        expect((await packingService.getPackingListById(id))!.title).toBe('Shared token accepted');
    });

    it('preserves authorized native and versioned same-event no-ops without comparing or writing', async function unchangedEventCommands() {
        const id = await fixture();
        const eventId = await createIntegrationEvent(owner.id, 'Unchanged Packing parent');
        const session = actor(owner);
        const settings = await packing.readPackingSettings(id, session);
        await packing.changePackingEvent(id, {eventId, expectedEventId: null}, session, settings.settingsToken);
        const before = (await packingService.getPackingListById(id))!;

        // A repeated desired relationship is harmless even if the reviewed
        // old-parent/token is absent or stale. The real owner still authorizes
        // both the source and selected target before acknowledging the no-op.
        for (const token of [undefined, settings.settingsToken, '*', `W/${settings.settingsToken}`]) {
            await expect(packing.changePackingEvent(id, {eventId, expectedEventId: null}, session, token)).resolves.toEqual({changed: false, canView: true});
        }
        const native = await changeEntityEvent('packing', before, {eventId, expectedEventId: null}, session);
        expect(native.changed).toBe(false);
        expect(await packingService.getPackingListById(id)).toEqual(before);

        // The no-op is never an authorization bypass; an ungranted profile
        // remains denied, while an actual changed relationship needs review.
        await expect(packing.changePackingEvent(id, {eventId, expectedEventId: null}, actor(editor))).rejects.toMatchObject({status: 403});
        await expect(packing.changePackingEvent(id, {eventId: null, expectedEventId: eventId}, session)).rejects.toMatchObject({status: 428});
        await expect(packing.changePackingEvent(id, {eventId: null, expectedEventId: eventId}, session, settings.settingsToken)).rejects.toMatchObject({status: 412});
        expect(await packingService.getPackingListById(id)).toEqual(before);
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
