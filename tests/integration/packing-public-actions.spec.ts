import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import * as packing from '../../src/backend/controller/packingController';
import {requirePackingCreation} from '../../src/backend/controller/packingController';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as packingService from '../../src/backend/modules/database/services/PackingService';
import * as userService from '../../src/backend/modules/database/services/UserService';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {PackingAssignment} from '../../src/backend/modules/database/entities/packing/PackingAssignment';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {DEFAULT_PERM, PERM} from '../../src/backend/modules/lib/permissions';
import type {ApiActor} from '../../src/types/ApiTypes';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let target: Profile;

function profileActor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }
function publicActor(kind: 'stored' | 'stateless' = 'stored'): ApiActor {
    return {context: kind === 'stored' ? randomUUID() : null};
}

/** Seed through the production creator, retaining its normal nonediting defaults.
 * Each scenario grants only the native method it actually exercises. */
async function fixture(linked = false) {
    const eventId = linked ? await createIntegrationEvent(owner.id, 'Private public-action parent') : null;
    const {id} = await packing.createPackingList({
        title: 'Private Packing title', description: 'Original root description', eventId,
        defaultPermissions: {public: DEFAULT_PERM.DEFAULT_ENTITY, guest: 0, authenticated: 0, participant: 0},
        items: [
            {title: 'Private first title', description: 'Original first description', maxAssignees: 2, requiredByAll: false},
            {title: 'Private second title', description: null, maxAssignees: 1, requiredByAll: true},
        ],
    }, undefined, profileActor(owner));
    const items = await packingService.getPackingSnapshotItems(AppDataSource.manager, id);
    return {id, items, eventId};
}

/** Inspect the wire token only for private-field leakage, not its hash algorithm. */
function tokenFields(token: string): string[] {
    const decoded = JSON.parse(Buffer.from(token.slice(6, -1), 'base64url').toString('utf8'));
    return Object.keys(decoded.fields);
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Public Packing owner'});
    target = await persistIntegrationProfile({name: 'Public Packing target'});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('native-granted public Packing actions through versioned operations', () => {
    it.each(['stored', 'stateless'] as const)('denies editing and administration with normal defaults for %s public requests', async kind => {
        const {id, items} = await fixture();
        const actor = publicActor(kind);
        await packingService.assignPackingItem(items[0].id, target.id);
        const assignment = await AppDataSource.getRepository(PackingAssignment).findOneByOrFail({item: {id: items[0].id}});

        await expect(packing.readPackingItemEditBaseline(id, items[0].id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.updatePackingItem(id, items[0].id, {title: 'Denied'}, undefined, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingItemOrderBaseline(id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.reorderPackingItems(id, {itemIds: items.map(item => item.id)}, undefined, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.deletePackingItem(id, items[0].id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.deletePackingAssignment(id, String(assignment.id), actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingDefaultsBaseline(id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.updatePackingDefaults(id, {guest: 0}, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingAdminBaseline(id, target.id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.setPackingAdmin(id, target.id, PERM.EDIT_TITLE, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.searchPackingProfiles(id, 'Public Packing', actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingHeaderBaseline(id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.setPackingHeader(id, undefined, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingDescription(id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.patchPackingDescription(id, {description: 'Denied'}, undefined, actor)).rejects.toMatchObject({status: 403});
        expect(await packingService.getPackingItemById(items[0].id)).toMatchObject({title: 'Private first title'});
        expect(await packingService.getPackingAssignmentById(assignment.id)).not.toBeNull();
    });

    it.each(['stored', 'stateless'] as const)('keeps private reads and personal commands profile-only despite broad grants for %s requests', async kind => {
        const {id, items} = await fixture(true);
        const actor = publicActor(kind);
        await adminService.updatePerms('packing', id, {public: DEFAULT_PERM.ADMIN});

        await expect(packing.readPackingList(id, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.readPackingMetadata(id, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.readPackingSettings(id, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.readPackingHeaderPath(id, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.patchPackingMetadata(id, {title: 'Denied properties'}, undefined, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.createPackingItem(id, {title: 'Denied Quick Add', description: null, maxAssignees: 1, requiredByAll: false}, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.setPackingSelfAssignment(id, items[0].id, true, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.changePackingEvent(id, {eventId: null, expectedEventId: null}, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.setPackingArchived(id, true, actor)).rejects.toMatchObject({status: 401});
        await expect(packing.deletePackingList(id, actor)).rejects.toMatchObject({status: 401});
        expect(() => requirePackingCreation(actor)).toThrowError(expect.objectContaining({status: 401}));
    });

    it('allows only independently granted item fields and binds baselines to the actual public context', async () => {
        const {id, items, eventId} = await fixture(true);
        const foreign = await fixture();
        const actor = publicActor();
        const other = publicActor();
        await adminService.updatePerms('packing', id, {public: 0});
        await adminService.updatePerms('packingItem', items[0].id, {public: PERM.EDIT_DESC});

        const baseline = await packing.readPackingItemEditBaseline(id, items[0].id, actor);
        expect(baseline).toEqual({id: items[0].id, values: {description: 'Original first description'},
            editableFields: ['description'], editToken: expect.any(String)});
        expect(tokenFields(baseline.editToken)).toEqual(['description']);
        expect(contractValidator('PackingItemEditBaseline')(baseline)).toBe(true);
        expect(JSON.stringify(baseline)).not.toContain(eventId!);
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Borrowed token'}, baseline.editToken, other)).rejects.toMatchObject({status: 412});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Borrowed profile token'},
            (await packing.readPackingItemEditBaseline(id, items[0].id, profileActor(owner))).editToken, actor)).rejects.toMatchObject({status: 412});
        await expect(packing.updatePackingItem(id, items[0].id, {title: 'Private field'}, baseline.editToken, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.updatePackingItem(foreign.id, items[0].id, {description: 'Wrong root'}, baseline.editToken, actor)).rejects.toMatchObject({status: 404});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Different public scope'}, baseline.editToken, {})).rejects.toMatchObject({status: 412});
        await packing.updatePackingItem(id, items[0].id, {description: 'Publicly reviewed'}, baseline.editToken, actor);
        expect(await packingService.getPackingItemById(items[0].id)).toMatchObject({title: 'Private first title', description: 'Publicly reviewed', maxAssignees: 2});

        const latest = await packing.readPackingItemEditBaseline(id, items[0].id, actor);
        await adminService.updatePerms('packingItem', items[0].id, {public: 0});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Revoked'}, latest.editToken, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingItemEditBaseline(id, items[0].id, actor)).rejects.toMatchObject({status: 403});
    });

    it('reviews stateless public fields without a principal and never treats its token as permission', async () => {
        const {id, items} = await fixture(true);
        const foreign = await fixture();
        const actor = publicActor('stateless');
        await adminService.updatePerms('packing', id, {public: 0});
        await adminService.updatePerms('packingItem', items[0].id, {public: PERM.EDIT_DESC});
        await adminService.updatePerms('packingItem', items[1].id, {public: PERM.EDIT_DESC});

        // A public projection has no visitor identity. Its available values and
        // comparison scope agree for plain anonymous and explicitly null actors.
        const baseline = await packing.readPackingItemEditBaseline(id, items[0].id, {});
        expect(baseline).toMatchObject({values: {description: 'Original first description'}, editableFields: ['description']});
        expect((await packing.readPackingItemEditBaseline(id, items[0].id, actor)).editToken).toBe(baseline.editToken);
        expect(contractValidator('PackingItemEditBaseline')(baseline)).toBe(true);
        expect(tokenFields(baseline.editToken)).toEqual(['description']);

        // Stored/profile comparisons cannot substitute for this public baseline;
        // another resource or an ungranted field still fails its own current check.
        const stored = await packing.readPackingItemEditBaseline(id, items[0].id, publicActor());
        const personal = await packing.readPackingItemEditBaseline(id, items[0].id, profileActor(owner));
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Stored scope'}, stored.editToken, actor)).rejects.toMatchObject({status: 412});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Profile scope'}, personal.editToken, actor)).rejects.toMatchObject({status: 412});
        await expect(packing.updatePackingItem(id, items[1].id, {description: 'Other item'}, baseline.editToken, actor)).rejects.toMatchObject({status: 412});
        await expect(packing.updatePackingItem(foreign.id, items[0].id, {description: 'Other root'}, baseline.editToken, actor)).rejects.toMatchObject({status: 404});
        await expect(packing.updatePackingItem(id, items[0].id, {title: 'Ungrantable field'}, baseline.editToken, actor)).rejects.toMatchObject({status: 403});

        // Changing the available public fields retires that projection's token.
        // A fresh matching token permits only the current grant, without a profile.
        await adminService.updatePerms('packingItem', items[0].id, {public: PERM.EDIT_DESC | PERM.EDIT_META});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Old projection'}, baseline.editToken, actor)).rejects.toMatchObject({status: 412});
        const latest = await packing.readPackingItemEditBaseline(id, items[0].id, actor);
        await packing.updatePackingItem(id, items[0].id, {description: 'Stateless public edit'}, latest.editToken, {});
        expect(await packingService.getPackingItemById(items[0].id)).toMatchObject({title: 'Private first title', description: 'Stateless public edit'});
        const reviewed = await packing.readPackingItemEditBaseline(id, items[0].id, actor);
        await adminService.updatePerms('packingItem', items[0].id, {public: 0});
        await expect(packing.updatePackingItem(id, items[0].id, {description: 'Revoked'}, reviewed.editToken, actor)).rejects.toMatchObject({status: 403});
    });

    it('retains item counts without a personal profile and independently reviews the public order', async () => {
        const {id, items} = await fixture(true);
        const actor = publicActor();
        await adminService.updatePerms('packing', id, {public: PERM.ITEM_EDIT});
        await packingService.assignPackingItem(items[0].id, owner.id);
        await packingService.assignPackingItem(items[0].id, target.id);
        const baseline = await packing.readPackingItemEditBaseline(id, items[0].id, actor);
        const order = await packing.readPackingItemOrderBaseline(id, actor);
        expect(order).toEqual({items: items.map(item => ({id: item.id, position: item.pos})), orderToken: expect.any(String)});
        expect(contractValidator('PackingOrderEditBaseline')(order)).toBe(true);
        await packing.updatePackingItem(id, items[0].id, {title: 'Reviewed title', maxAssignees: 1, requiredByAll: true}, baseline.editToken, actor);
        expect(await AppDataSource.getRepository(PackingAssignment).countBy({item: {id: items[0].id}})).toBe(2);
        const reversed = order.items.map(item => item.id).reverse();
        await expect(packing.reorderPackingItems(id, {itemIds: reversed}, order.orderToken, publicActor())).rejects.toMatchObject({status: 412});
        await packing.reorderPackingItems(id, {itemIds: reversed}, order.orderToken, actor);
        expect((await packingService.getPackingSnapshotItems(AppDataSource.manager, id)).map(item => item.id)).toEqual(reversed);
        await expect(packing.reorderPackingItems(id, {itemIds: reversed}, order.orderToken, actor)).rejects.toMatchObject({status: 412});
        await adminService.updatePerms('packing', id, {public: 0});
        await expect(packing.readPackingItemOrderBaseline(id, actor)).rejects.toMatchObject({status: 403});
    });

    it('removes only a method-authorized assignment or item within the requested root', async () => {
        const {id, items} = await fixture();
        const foreign = await fixture();
        const actor = publicActor();
        await packingService.assignPackingItem(items[0].id, target.id);
        const assignment = await AppDataSource.getRepository(PackingAssignment).findOneByOrFail({item: {id: items[0].id}});
        await adminService.updatePerms('packing', id, {public: PERM.MANAGE_ASSIGNMENTS});
        await expect(packing.deletePackingAssignment(foreign.id, String(assignment.id), actor)).rejects.toMatchObject({status: 404});
        await expect(packing.deletePackingItem(id, items[0].id, actor)).rejects.toMatchObject({status: 403});
        await packing.deletePackingAssignment(id, String(assignment.id), actor);
        expect(await packingService.getPackingAssignmentById(assignment.id)).toBeNull();
        await adminService.updatePerms('packing', id, {public: PERM.ITEM_DELETE});
        await packingService.assignPackingItem(items[0].id, target.id);
        await packing.deletePackingItem(id, items[0].id, actor);
        expect(await packingService.getPackingItemById(items[0].id)).toBeNull();
        expect(await AppDataSource.getRepository(PackingAssignment).countBy({item: {id: items[0].id}})).toBe(0);
    });

    it.each(['stored', 'stateless'] as const)('exposes audience masks and compares independent public defaults for %s requests', async kind => {
        const {id} = await fixture(true);
        const actor = publicActor(kind);
        await adminService.updatePerms('packing', id, {public: PERM.MANAGE_PERMISSIONS});
        const baseline = await packing.readPackingDefaultsBaseline(id, actor);
        expect(Object.keys(baseline)).toEqual(['defaultPermissions', 'editToken']);
        expect(tokenFields(baseline.editToken).sort()).toEqual(['default:authenticated', 'default:guest', 'default:participant', 'default:public']);
        expect(contractValidator('PackingDefaultsBaseline')(baseline)).toBe(true);
        await expect(packing.updatePackingDefaults(id, {guest: PERM.ITEM_EDIT}, publicActor(), baseline.editToken)).rejects.toMatchObject({status: 412});
        await packing.updatePackingDefaults(id, {guest: PERM.ITEM_EDIT}, actor, baseline.editToken);
        await packing.updatePackingDefaults(id, {participant: PERM.ACCESS_VIEW}, actor, baseline.editToken);
        await expect(packing.updatePackingDefaults(id, {guest: 0}, actor, baseline.editToken)).rejects.toMatchObject({status: 412});
        expect(await adminService.getDefaultPerms('packing', id)).toMatchObject({public: PERM.MANAGE_PERMISSIONS, guest: PERM.ITEM_EDIT, participant: PERM.ACCESS_VIEW});
        await adminService.updatePerms('packing', id, {public: 0});
        await expect(packing.updatePackingDefaults(id, {participant: 0}, actor, baseline.editToken)).rejects.toMatchObject({status: 403});
    });

    it('reviews one administrator without roster disclosure and preserves zero, add, remove and regrant semantics', async () => {
        const {id} = await fixture(true);
        const actor = publicActor();
        await adminService.updatePerms('packing', id, {public: PERM.MANAGE_PERMISSIONS});
        const empty = await packing.readPackingAdminBaseline(id, target.id, actor);
        expect(empty).toEqual({mask: null, editToken: expect.any(String)});
        expect(tokenFields(empty.editToken)).toEqual(['newAdmin']);
        expect(contractValidator('PackingAdminBaseline')(empty)).toBe(true);
        await expect(packing.setPackingAdmin(id, randomUUID(), 0, actor)).rejects.toMatchObject({status: 404});
        await expect(packing.setPackingAdmin(id, target.id, 0, publicActor(), empty.editToken)).rejects.toMatchObject({status: 412});
        await packing.setPackingAdmin(id, target.id, 0, actor, empty.editToken);
        expect(await adminService.getAdminGrant('packing', id, target.id)).toMatchObject({perms: 0});
        await expect(packing.setPackingAdmin(id, target.id, 0, actor, empty.editToken)).rejects.toMatchObject({status: 412});
        const zero = await packing.readPackingAdminBaseline(id, target.id, actor);
        expect(zero.mask).toBe(0);
        expect(tokenFields(zero.editToken)).toEqual(['mask']);
        await packing.setPackingAdmin(id, target.id, PERM.EDIT_DESC, actor, zero.editToken);
        await expect(packing.setPackingAdmin(id, target.id, null, actor, zero.editToken)).rejects.toMatchObject({status: 412});
        const updated = await packing.readPackingAdminBaseline(id, target.id, actor);
        await packing.setPackingAdmin(id, target.id, null, actor, updated.editToken);
        expect(await adminService.getAdminGrant('packing', id, target.id)).toBeNull();
        const removed = await packing.readPackingAdminBaseline(id, target.id, actor);
        await expect(packing.setPackingAdmin(id, target.id, null, actor, removed.editToken)).resolves.toEqual({changed: false});
        await packing.setPackingAdmin(id, target.id, PERM.EDIT_TITLE, actor, removed.editToken);
        expect(await adminService.getAdminGrant('packing', id, target.id)).toMatchObject({perms: PERM.EDIT_TITLE});
        await adminService.updatePerms('packing', id, {public: 0});
        await expect(packing.readPackingAdminBaseline(id, target.id, actor)).rejects.toMatchObject({status: 403});
        await expect(packing.setPackingAdmin(id, target.id, null, actor, removed.editToken)).rejects.toMatchObject({status: 403});
    });

    it('supplies only header hashes to public writers and retains committed replacement cleanup', async () => {
        const {id} = await fixture(true);
        const actor = publicActor();
        await adminService.updatePerms('packing', id, {public: PERM.EDIT_META});
        const oldPath = 'uploads/private-public-action-header.png';
        const newPath = 'uploads/reviewed-public-action-header.png';
        await packingService.updateHeaderImage(id, oldPath);
        const baseline = await packing.readPackingHeaderBaseline(id, actor);
        expect(baseline).toEqual({editToken: expect.any(String)});
        expect(tokenFields(baseline.editToken)).toEqual(['header']);
        expect(JSON.stringify(baseline)).not.toContain(oldPath);
        expect(contractValidator('PackingHeaderBaseline')(baseline)).toBe(true);

        // Filesystem unlink is the external side effect; authorization, locking,
        // comparison and persisted replacement all use the production operation.
        const unlink = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
        try {
            await expect(packing.setPackingHeader(id, undefined, publicActor(), baseline.editToken)).rejects.toMatchObject({status: 412});
            expect(unlink).not.toHaveBeenCalled();
            await packing.setPackingHeader(id, {path: newPath, mimetype: 'image/png'} as Express.Multer.File, actor, baseline.editToken);
            expect(await packingService.getPackingListById(id)).toMatchObject({headerImg: newPath});
            expect(unlink).toHaveBeenCalledWith(oldPath);
            const latest = await packing.readPackingHeaderBaseline(id, actor);
            await packing.setPackingHeader(id, undefined, actor, latest.editToken);
            expect(await packingService.getPackingListById(id)).toMatchObject({headerImg: null});
            expect(unlink).toHaveBeenCalledWith(newPath);
            const empty = await packing.readPackingHeaderBaseline(id, actor);
            await expect(packing.setPackingHeader(id, undefined, actor, empty.editToken)).resolves.toEqual({changed: false});
            await adminService.updatePerms('packing', id, {public: 0});
            await expect(packing.setPackingHeader(id, undefined, actor, empty.editToken)).rejects.toMatchObject({status: 403});
        } finally {
            unlink.mockRestore();
        }
    });

    it.each(['stored', 'stateless'] as const)('shares native description behavior without exposing mixed properties for %s requests', async kind => {
        const {id, eventId} = await fixture(true);
        const actor = publicActor(kind);
        await adminService.updatePerms('packing', id, {public: PERM.EDIT_DESC});
        const baseline = await packing.readPackingDescription(id, actor);
        expect(baseline).toEqual({description: 'Original root description', editToken: expect.any(String)});
        expect(tokenFields(baseline.editToken)).toEqual(['description']);
        expect(contractValidator('PackingDescriptionBaseline')(baseline)).toBe(true);
        await expect(packing.patchPackingDescription(id, {description: 'Borrowed'}, baseline.editToken, publicActor())).rejects.toMatchObject({status: 412});
        const updated = await packing.patchPackingDescription(id, {description: 'Reviewed public description'}, baseline.editToken, actor);
        expect(updated.description).toBe('Reviewed public description');
        await expect(packing.patchPackingDescription(id, {description: 'Stale'}, baseline.editToken, actor)).rejects.toMatchObject({status: 412});
        const normalized = packing.normalizePackingMetadataPatch({description: ''}) as {description: null};
        await packing.patchPackingDescription(id, normalized, updated.editToken, actor);
        expect(await packingService.getPackingListById(id)).toMatchObject({title: 'Private Packing title', description: null, eventId, archivedAt: null});
        await adminService.updatePerms('packing', id, {public: PERM.EDIT_META});
        await expect(packing.readPackingDescription(id, actor)).rejects.toMatchObject({status: 403});
    });

    it('keeps scoped administrator discovery grant-bounded and account-only', async () => {
        const {id} = await fixture(true);
        const actor = publicActor();
        const guest = await userService.createGuest('Public Packing guest must remain undiscoverable');
        await adminService.updatePerms('packing', id, {public: PERM.MANAGE_PERMISSIONS});
        const options = await packing.searchPackingProfiles(id, 'Public Packing', actor);
        expect(options.some(option => option.profileId === target.id)).toBe(true);
        expect(options.some(option => option.profileId === guest.profile.id)).toBe(false);
        expect(options.every(option => Object.keys(option).sort().join(',') === 'isGuest,name,profileId,username')).toBe(true);
        expect(JSON.stringify(options)).not.toContain('email');
        await adminService.updatePerms('packing', id, {public: 0});
        await expect(packing.searchPackingProfiles(id, 'Public Packing', actor)).rejects.toMatchObject({status: 403});
    });
});
