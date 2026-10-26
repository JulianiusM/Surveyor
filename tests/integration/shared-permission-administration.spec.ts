import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as packing from '../../src/backend/controller/packingController';
import * as drivers from '../../src/backend/controller/driversController';
import * as events from '../../src/backend/controller/eventController';
import * as activity from '../../src/backend/controller/activityController';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
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

    it.each(features)('%s preserves its existing identifier scope across settings and defaults commands', async type => {
        const id = await fixture(type);
        const session = actor(owner);
        const baseline = await readDefaults(type, id, session);
        const upperId = id.toUpperCase();
        const upper = await readDefaults(type, upperId, session);
        // Packing, Drivers and Event compare their loaded row identity. Activity
        // retains its original requested-ID scope rather than silently changing it.
        if (type === 'activity') expect(upper.editToken).not.toBe(baseline.editToken);
        else expect(upper.editToken).toBe(baseline.editToken);
        if (type === 'event') {
            expect(baseline.editToken).toBe((await events.readEventSettings(id, session)).settingsToken);
        }
        const guest = baseline.defaultPermissions.guest === 0 ? PERM.ACCESS_VIEW : 0;
        await updateDefaults(type, upperId, {guest}, session, upper.editToken);
        expect((await adminService.getDefaultPerms(type, id)).guest).toBe(guest);
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

    it.each(features)('%s preserves root and profile spelling through absent, zero and removal administrator commands', async type => {
        const id = await fixture(type);
        const upperId = id.toUpperCase();
        const upperProfileId = target.id.toUpperCase();
        const session = actor(owner);
        const absent = await readAdmin(type, id, target.id, session);
        const upperAbsent = await readAdmin(type, upperId, upperProfileId, session);

        // The root scope and persistence lookup are separate contracts. New-grant
        // evidence contains no target ID, but keeps the feature's original root spelling.
        const canonicalRoot = type === 'packing' || type === 'drivers';
        expect(upperAbsent.editToken === absent.editToken).toBe(canonicalRoot || upperId === id);
        await setAdmin(type, upperId, upperProfileId, 0, session, upperAbsent.editToken);
        expect((await adminService.getAdminGrant(type, id, target.id))?.perms).toBe(0);

        const zeroUpperProfile = await readAdmin(type, upperId, upperProfileId, session);
        const zeroOriginalRoot = await readAdmin(type, id, upperProfileId, session);
        expect(zeroUpperProfile.editToken === zeroOriginalRoot.editToken).toBe(canonicalRoot || upperId === id);
        const zeroOriginalProfile = await readAdmin(type, upperId, target.id, session);
        if (upperProfileId !== target.id) {
            // Existing-grant evidence retains the requested profile spelling even
            // when the database lookup resolved the same canonical profile row.
            expect(zeroUpperProfile.editToken).not.toBe(zeroOriginalProfile.editToken);
            await expect(setAdmin(type, upperId, upperProfileId, null, session, zeroOriginalProfile.editToken))
                .rejects.toMatchObject({status: 412});
        }
        await setAdmin(type, upperId, upperProfileId, null, session, zeroUpperProfile.editToken);
        expect(await adminService.getAdminGrant(type, id, target.id)).toBeNull();
    });
});
