import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as packing from '../../src/backend/controller/packingController';
import * as drivers from '../../src/backend/controller/driversController';
import * as events from '../../src/backend/controller/eventController';
import * as activity from '../../src/backend/controller/activityController';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {PackingList} from '../../src/backend/modules/database/entities/packing/PackingList';
import {PackingItem} from '../../src/backend/modules/database/entities/packing/PackingItem';
import {PackingAssignment} from '../../src/backend/modules/database/entities/packing/PackingAssignment';
import {DriversList} from '../../src/backend/modules/database/entities/drivers/DriversList';
import {DriversItem} from '../../src/backend/modules/database/entities/drivers/DriversItem';
import {DriversAssignment} from '../../src/backend/modules/database/entities/drivers/DriversAssignment';
import {buildPermBundle, evaluateEntities, entityPermissionKey} from '../../src/backend/modules/permissionEngine';
import {PERM} from '../../src/backend/modules/lib/permissions';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import type {components} from '../../src/types/api/v1';
import type {SessionLike} from '../../src/types/PermissionTypes';
import type {EntityType} from '../../src/types/UtilTypes';
import {createActivityPlanWithSlot, createDriversListWithItem, createIntegrationEvent,
    createPackingListWithItem, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

type PermissionFeature = Exclude<EntityType, 'survey'>;
const features: PermissionFeature[] = ['packing', 'drivers', 'event', 'activity'];
let owner: Profile;
let target: Profile;

function actor(profile: Profile): SessionLike {
    return {profile, auth: {user: profile.user!}};
}

/** Each fixture uses the production feature creator and real ORM metadata. */
async function fixture(type: PermissionFeature): Promise<string> {
    switch (type) {
        case 'packing': return (await createPackingListWithItem(owner.id))[0];
        case 'drivers': return (await createDriversListWithItem(owner.id))[0];
        case 'event': return createIntegrationEvent(owner.id, 'Shared administration');
        case 'activity': return createActivityPlanWithSlot(owner.id);
    }
}

function readDefaults(type: PermissionFeature, id: string, session: SessionLike) {
    switch (type) {
        case 'packing': return packing.readPackingDefaultsBaseline(id, session);
        case 'drivers': return drivers.readDriversDefaultsBaseline(id, session);
        case 'event': return events.readEventDefaultsBaseline(id, session);
        case 'activity': return activity.readActivityDefaultsBaseline(id, session);
    }
}

function readSettings(type: PermissionFeature, id: string, session: SessionLike) {
    switch (type) {
        case 'packing': return packing.readPackingSettings(id, session);
        case 'drivers': return drivers.readDriversSettings(id, session);
        case 'event': return events.readEventSettings(id, session);
        case 'activity': return activity.readActivitySettings(id, session);
    }
}

function clearHeader(type: PermissionFeature, id: string, session: SessionLike, token: string) {
    switch (type) {
        case 'packing': return packing.setPackingHeader(id, undefined, session, token);
        case 'drivers': return drivers.setDriversHeader(id, undefined, session, token);
        case 'event': return events.setEventHeader(id, undefined, session, token);
        case 'activity': return activity.setActivityHeader(id, undefined, session, token);
    }
}

function updateDefaults(type: PermissionFeature, id: string, body: components['schemas']['PermissionDefaultsPatch'],
    session: SessionLike, token: string) {
    switch (type) {
        case 'packing': return packing.updatePackingDefaults(id, body, session, token);
        case 'drivers': return drivers.updateDriversDefaults(id, body, session, token);
        case 'event': return events.updateEventDefaults(id, body, session, token);
        case 'activity': return activity.setActivityDefaults(id, body, session, token);
    }
}

function readAdmin(type: PermissionFeature, id: string, profileId: string, session: SessionLike) {
    switch (type) {
        case 'packing': return packing.readPackingAdminBaseline(id, profileId, session);
        case 'drivers': return drivers.readDriversAdminBaseline(id, profileId, session);
        case 'event': return events.readEventAdminBaseline(id, profileId, session);
        case 'activity': return activity.readActivityAdminBaseline(id, profileId, session);
    }
}

function setAdmin(type: PermissionFeature, id: string, profileId: string, mask: number | null,
    session: SessionLike, token?: string) {
    switch (type) {
        case 'packing': return packing.setPackingAdmin(id, profileId, mask, session, token);
        case 'drivers': return drivers.setDriversAdmin(id, profileId, mask, session, token);
        case 'event': return events.setEventAdmin(id, profileId, mask, session, token);
        case 'activity': return activity.setActivityAdmin(id, profileId, mask, session, token);
    }
}

// Rebuilding the complete disposable schema can exceed two minutes during local
// MariaDB DDL. Only fixture initialization gets this bounded five-minute budget;
// individual tests and production operation deadlines retain their normal limits.
beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Shared permission owner'});
    target = await persistIntegrationProfile({name: 'Shared permission target'});
}, 300_000);
afterAll(closeIntegrationDatabase);

describe('shared permission administration through actual feature controllers', () => {
    it.each(['packing', 'drivers'] as const)('%s resolves UUID aliases across item reads, commands and actual membership removal', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        const read = type === 'packing' ? packing.readPackingList : drivers.readDriversList;
        const first = (await read(id, session)).data.items[0]!;
        const upperRoot = id.toUpperCase();
        const upperItem = first.id.toUpperCase();
        const roots = AppDataSource.getRepository<PackingList | DriversList>(type === 'packing' ? PackingList : DriversList);
        const items = AppDataSource.getRepository<PackingItem | DriversItem>(type === 'packing' ? PackingItem : DriversItem);
        const assignments = AppDataSource.getRepository<PackingAssignment | DriversAssignment>(type === 'packing' ? PackingAssignment : DriversAssignment);

        // The real native UUID columns return their canonical stored identity;
        // alternate request spellings must resolve to those same persisted rows.
        const storedRoot = (await roots.findOneByOrFail({id: upperRoot})).id;
        const storedItem = (await items.findOneByOrFail({id: upperItem})).id;
        expect(storedRoot).toBe(id);
        expect(storedItem).toBe(first.id);
        const baseline = type === 'packing' ? packing.readPackingItemEditBaseline : drivers.readDriversItemEditBaseline;
        const patch = type === 'packing' ? packing.updatePackingItem : drivers.updateDriversItem;
        const remove = type === 'packing' ? packing.deletePackingItem : drivers.deleteDriversItem;
        const membership = type === 'packing' ? packing.setPackingSelfAssignment : drivers.setDriversSelfAssignment;
        const removeAssignment = type === 'packing' ? packing.deletePackingAssignment : drivers.deleteDriversAssignment;
        const review = await baseline(upperRoot, upperItem, session);
        expect(review.id).toBe(storedItem);
        await patch(upperRoot, upperItem, {description: 'Reviewed through UUID aliases'}, review.editToken, session);
        expect((await items.findOneByOrFail({id: first.id})).description).toBe('Reviewed through UUID aliases');
        await expect(patch(id, first.id, {description: 'Stale'}, review.editToken, session)).rejects.toMatchObject({status: 412});

        await adminService.updatePerms(type, id, {public: 0, guest: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin(type, id, target.id, PERM.ACCESS_VIEW);
        await membership(upperRoot, upperItem, true, actor(target));
        expect(await assignments.findOneBy({item: {id: storedItem}, profile: {id: target.id}})).not.toBeNull();
        await membership(id, upperItem, false, actor(target));
        expect(await assignments.findOneBy({item: {id: storedItem}, profile: {id: target.id}})).toBeNull();
        await membership(upperRoot, storedItem, true, actor(target));
        const saved = await assignments.findOneByOrFail({item: {id: storedItem}, profile: {id: target.id}});
        await removeAssignment(upperRoot, String(saved.id), session);
        expect(await assignments.findOneBy({id: saved.id})).toBeNull();

        const foreign = await fixture(type);
        await expect(baseline(foreign.toUpperCase(), storedItem, session)).rejects.toMatchObject({status: 404});
        await expect(baseline(id, randomUUID(), session)).rejects.toMatchObject({status: 404});
        await expect(baseline(id, storedItem, actor(target))).rejects.toMatchObject({status: 403});
        await expect(remove(id, storedItem, actor(target))).rejects.toMatchObject({status: 403});
        expect(await items.findOneBy({id: storedItem})).not.toBeNull();
        await remove(upperRoot, upperItem, session);
        expect(await items.findOneBy({id: storedItem})).toBeNull();
    });

    it('locks one logical parent once and treats an aliased existing Event selection as an unchanged choice', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'UUID parent coordination');
        const [id] = await createPackingListWithItem(owner.id);
        await AppDataSource.getRepository(PackingList).update(id, {event: {id: eventId}});
        const before = await AppDataSource.getRepository(PackingList).findOneByOrFail({id});
        const queries = vi.spyOn(AppDataSource.logger, 'logQuery');
        try {
            // Unchanged parent choices retain their existing no-op before stale
            // expected-parent/token checks; the real DBAL still holds its locks.
            const result = await packing.changePackingEvent(id.toUpperCase(),
                {eventId: eventId.toUpperCase(), expectedEventId: randomUUID()}, actor(owner));
            expect(result.changed).toBe(false);
            expect(await AppDataSource.getRepository(PackingList).findOneByOrFail({id})).toEqual(before);
            const parentLocks = queries.mock.calls.filter(([query]) => query.includes('`events`') && query.includes('FOR UPDATE'));
            expect(parentLocks).toHaveLength(1);
        } finally {
            queries.mockRestore();
        }
    });

    it.each(['packing', 'drivers'] as const)('%s complete ordering resolves actual IDs and still rejects semantic duplicates', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        if (type === 'packing') await packing.createPackingItem(id, {title: 'Second', description: null, maxAssignees: 2, requiredByAll: false}, session);
        else await drivers.createDriversItem(id, {title: 'Second', description: 'Second ride', maxAssignees: 2}, session);
        const baseline = type === 'packing' ? packing.readPackingItemOrderBaseline : drivers.readDriversItemOrderBaseline;
        const reorder = type === 'packing' ? packing.reorderPackingItems : drivers.reorderDriversItems;
        const current = await baseline(id, session);
        const [first, second] = current.items;
        expect((await reorder(id.toUpperCase(), {itemIds: current.items.map(item => item.id.toUpperCase())}, current.orderToken, session)).changed).toBe(false);
        await expect(reorder(id.toUpperCase(), {itemIds: [first!.id, first!.id.toUpperCase()]}, current.orderToken, session))
            .rejects.toMatchObject({status: 409});
        expect((await baseline(id, session)).items).toEqual(current.items);
        await reorder(id.toUpperCase(), {itemIds: [second!.id.toUpperCase(), first!.id.toUpperCase()]}, current.orderToken, session);
        expect((await baseline(id, session)).items.map(item => item.id)).toEqual([second!.id, first!.id]);
    });

    it('retains an individually granted item across UUID aliases without copying its grant to another item', async () => {
        const [id, item] = await createPackingListWithItem(owner.id);
        const itemId = item.id;
        await adminService.updatePerms('packing', id, {public: 0, guest: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin('packingItem', itemId.toUpperCase(), target.id.toUpperCase(), PERM.EDIT_DESC);
        const bundle = await buildPermBundle({entityType: 'packing', entityId: id, ownerId: owner.id},
            [{entityType: 'packingItem', entityId: itemId, ownerId: owner.id}], actor(target));
        expect(bundle.item(itemId.toUpperCase()).has('EDIT_DESC')).toBe(true);
        expect(bundle.item(randomUUID()).has('EDIT_DESC')).toBe(false);
        expect(bundle.entity.has('EDIT_DESC')).toBe(false);
        const views = await evaluateEntities([{entityType: 'packing', entityId: id.toUpperCase(), ownerId: owner.id}], actor(target));
        expect(views.get(entityPermissionKey('packing', id))).toBeDefined();
    });

    it.each(['packing', 'drivers'] as const)('%s full settings administrator tokens use the same stored root as narrow commands', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        const upperId = id.toUpperCase();
        await adminService.addAdmin(type, id, target.id, PERM.EDIT_DESC);
        const readSettings = type === 'packing' ? packing.readPackingSettings : drivers.readDriversSettings;
        const canonical = await readSettings(id, session);
        const alternate = await readSettings(upperId, session);
        const canonicalToken = canonical.access!.admins.find(admin => admin.profileId === target.id)!.editToken;
        const alternateToken = alternate.access!.admins.find(admin => admin.profileId === target.id)!.editToken;
        expect(alternateToken).toBe(canonicalToken);
        expect((await readAdmin(type, upperId, target.id, session)).editToken).toBe(canonicalToken);

        await setAdmin(type, upperId, target.id, PERM.EDIT_TITLE, session, alternateToken);
        expect((await adminService.getAdminGrant(type, id, target.id))?.perms).toBe(PERM.EDIT_TITLE);
        await expect(setAdmin(type, id, target.id, 0, session, canonicalToken)).rejects.toMatchObject({status: 412});
    });

    it.each(features)('%s checks authority before evidence and retains public sparse-audience management', async type => {
        const id = await fixture(type);
        const missingProfile = randomUUID();
        await adminService.updatePerms(type, id, {public: 0, guest: 0, authenticated: 0, participant: 0});

        // Neither an absent profile nor absent comparison evidence may disclose
        // private grants to an actor lacking the method's own public permission.
        await expect(readDefaults(type, id, {})).rejects.toMatchObject({status: 403});
        await expect(readAdmin(type, id, missingProfile, {})).rejects.toMatchObject({status: 403});
        await expect(setAdmin(type, id, missingProfile, 0, {})).rejects.toMatchObject({status: 403});

        // Page/profile admission stays independent from the existing public
        // manage-permissions grant. Omitted audiences retain their saved values.
        await adminService.updatePerms(type, id, {public: PERM.MANAGE_PERMISSIONS, authenticated: PERM.EDIT_DESC});
        const baseline = await readDefaults(type, id, {});
        await updateDefaults(type, id, {guest: PERM.ACCESS_VIEW}, {}, baseline.editToken);
        expect(await adminService.getDefaultPerms(type, id)).toMatchObject({
            public: PERM.MANAGE_PERMISSIONS, authenticated: PERM.EDIT_DESC, guest: PERM.ACCESS_VIEW, participant: 0,
        });
        await expect(updateDefaults(type, id, {guest: 0}, {}, baseline.editToken)).rejects.toMatchObject({status: 412});
        expect((await adminService.getDefaultPerms(type, id)).guest).toBe(PERM.ACCESS_VIEW);
    });

    it.each(features)('%s keeps zero grants distinct from absence and rejects stale administrator reviews', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        const absent = await readAdmin(type, id, target.id, session);
        expect(absent.mask).toBeNull();
        await setAdmin(type, id, target.id, 0, session, absent.editToken);
        expect((await adminService.getAdminGrant(type, id, target.id))?.perms).toBe(0);

        // A saved zero grant uses the existing-grant scope; an old absent-row
        // review cannot overwrite it, even though both values look empty in a UI.
        await expect(setAdmin(type, id, target.id, PERM.EDIT_DESC, session, absent.editToken))
            .rejects.toMatchObject({status: 412});
        const zero = await readAdmin(type, id, target.id, session);
        expect(zero.mask).toBe(0);
        await setAdmin(type, id, target.id, PERM.EDIT_DESC, session, zero.editToken);
        expect((await adminService.getAdminGrant(type, id, target.id))?.perms).toBe(PERM.EDIT_DESC);
        const saved = await readAdmin(type, id, target.id, session);
        await setAdmin(type, id, target.id, null, session, saved.editToken);
        expect(await adminService.getAdminGrant(type, id, target.id)).toBeNull();
    });

    it('retains feature-specific missing-profile diagnostics before adding any administrator', async () => {
        const missingProfile = randomUUID();
        for (const type of features) {
            const id = await fixture(type);
            const session = actor(owner);
            await expect(readAdmin(type, id, missingProfile, session)).rejects.toMatchObject({status: 404});
            // Activity's inherited command compares first; the other features
            // validate the target profile before asking for comparison evidence.
            await expect(setAdmin(type, id, missingProfile, 0, session))
                .rejects.toMatchObject({status: type === 'activity' ? 428 : 404});
            expect(await adminService.getAdminGrant(type, id, missingProfile)).toBeNull();
        }
    });

    it.each(features)('%s shares UUID identity across full settings, audience writes and header writes', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        const baseline = await readDefaults(type, id, session);
        const upperId = id.toUpperCase();
        const upper = await readDefaults(type, upperId, session);
        // R6 aligns typed resource components across full/narrow producers and writes;
        // unrelated field changes still do not invalidate a sparse header comparison.
        expect(upper.editToken).toBe(baseline.editToken);
        const full = await readSettings(type, upperId, session);
        expect(full.settingsToken).toBe((await readSettings(type, id, session)).settingsToken);
        if (type === 'event') {
            expect(baseline.editToken).toBe((await events.readEventSettings(id, session)).settingsToken);
        }
        const guest = baseline.defaultPermissions.guest === 0 ? PERM.ACCESS_VIEW : 0;
        await updateDefaults(type, upperId, {guest}, session, full.settingsToken);
        expect((await adminService.getDefaultPerms(type, id)).guest).toBe(guest);
        await expect(updateDefaults(type, id, {guest: baseline.defaultPermissions.guest}, session, full.settingsToken))
            .rejects.toMatchObject({status: 412});
        await clearHeader(type, upperId, session, full.settingsToken);
    });

    it('keeps Drivers receipt preparation inside both existing administration transactions', async () => {
        const id = await fixture('drivers');
        const session = actor(owner);
        const failure = new Error('Fixture receipt unavailable');
        function rejectReceipt(): never { throw failure; }
        const admin = await drivers.readDriversAdminBaseline(id, target.id, session);
        await expect(drivers.setDriversAdmin(id, target.id, 0, session, admin.editToken, rejectReceipt)).rejects.toBe(failure);
        expect(await adminService.getAdminGrant('drivers', id, target.id)).toBeNull();

        // Persistence may omit audience rows which the read DTO projects as zero.
        // Rollback must restore those exact saved rows, including their absence.
        const savedDefaults = await adminService.getDefaultPerms('drivers', id);
        const defaults = await drivers.readDriversDefaultsBaseline(id, session);
        const nextGuest = defaults.defaultPermissions.guest === 0 ? PERM.ACCESS_VIEW : 0;
        await expect(drivers.updateDriversDefaults(id, {guest: nextGuest}, session, defaults.editToken, rejectReceipt))
            .rejects.toBe(failure);
        expect(await adminService.getDefaultPerms('drivers', id)).toEqual(savedDefaults);
    });

    it.each(features)('%s resolves full-settings administrator evidence across UUID aliases while distinguishing absent and zero grants', async type => {
        const id = await fixture(type);
        const upperId = id.toUpperCase();
        const upperProfileId = target.id.toUpperCase();
        const session = actor(owner);
        const absent = await readAdmin(type, id, target.id, session);
        const upperAbsent = await readAdmin(type, upperId, upperProfileId, session);

        // Typed UUID components share identity; absent/new-grant evidence remains
        // distinct from an existing zero mask and does not acquire target authority.
        expect(upperAbsent.editToken).toBe(absent.editToken);
        const full = await readSettings(type, upperId, session);
        await setAdmin(type, upperId, upperProfileId, 0, session, full.settingsToken);
        expect((await adminService.getAdminGrant(type, id, target.id))?.perms).toBe(0);
        await expect(setAdmin(type, id, target.id, PERM.EDIT_DESC, session, full.settingsToken))
            .rejects.toMatchObject({status: 412});

        const zeroUpperProfile = await readAdmin(type, upperId, upperProfileId, session);
        const zeroOriginalRoot = await readAdmin(type, id, upperProfileId, session);
        expect(zeroUpperProfile.editToken).toBe(zeroOriginalRoot.editToken);
        const zeroOriginalProfile = await readAdmin(type, upperId, target.id, session);
        expect(zeroUpperProfile.editToken).toBe(zeroOriginalProfile.editToken);
        const row = (await readSettings(type, upperId, session)).access!.admins.find(admin => admin.profileId === target.id)!;
        expect(row.editToken).toBe(zeroUpperProfile.editToken);
        await setAdmin(type, id, upperProfileId, PERM.EDIT_DESC, session, row.editToken);
        await expect(setAdmin(type, upperId, upperProfileId, null, session, zeroUpperProfile.editToken))
            .rejects.toMatchObject({status: 412});
        await setAdmin(type, upperId, upperProfileId, null, session, (await readAdmin(type, id, target.id, session)).editToken);
        expect(await adminService.getAdminGrant(type, id, target.id)).toBeNull();
    });
});
