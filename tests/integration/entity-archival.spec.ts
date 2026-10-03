import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import eventController from '../../src/controller/eventController';
import * as userController from '../../src/controller/userController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import {archiveKey} from '../../src/modules/archive/policy';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {EntityVisibilityPreference} from '../../src/modules/database/entities/archive/EntityVisibilityPreference';
import {Event} from '../../src/modules/database/entities/event/Event';
import {EventInvoice} from '../../src/modules/database/entities/event/EventInvoice';
import {EventInvoicePool} from '../../src/modules/database/entities/event/EventInvoicePool';
import {EventInvoiceShare} from '../../src/modules/database/entities/event/EventInvoiceShare';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {PERM} from '../../src/modules/lib/permissions';
import type {ArchiveReference, PersonalVisibility} from '../../src/types/ArchiveTypes';
import {createActivitySlotEntity, createPackingItemEntity, createProfileEntity} from '../factories/integrationEntityFactory';
import {persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let temporaryDirectory: string;

/** Exercise controller policy with real DBAL operations and the fixture owner's identity. */
function archiveAsOwner(reference: ArchiveReference, now?: Date) {
    return entityAdminController.archiveEntity(reference, {}, {profile: owner, auth: {user: owner.user!}}, now);
}

function restoreAsOwner(reference: ArchiveReference) {
    return entityAdminController.restoreEntity(reference, {}, {profile: owner, auth: {user: owner.user!}});
}

function pauseAsOwner(reference: ArchiveReference, paused: boolean) {
    return entityAdminController.setAutomaticArchival(reference, {paused}, {profile: owner, auth: {user: owner.user!}});
}

/** Membership/deletion rejections belong to the controller, never the persistence writer. */
async function setVisibility(profileId: string, reference: ArchiveReference, visibility: PersonalVisibility) {
    const profile = (await userService.getProfileById(profileId))!;
    const auth = profile.userId ? {user: {id: profile.userId}} : {guest: {id: profile.guestId!}};
    return userController.setPersonalVisibility(reference.type, reference.id, {visibility}, {profile, auth});
}

// Create through the existing domain service so IDs, defaults, and ownership match
// real application entities. Tests choose an explicit clock rather than today's date.
async function createEvent(title: string, endDate = '2027-06-03'): Promise<ArchiveReference> {
    return {type: 'event', id: await eventService.createEventTx(owner.id, {
        title, startDate: '2027-06-01', endDate, timezone: 'UTC',
    })};
}

async function state(ref: ArchiveReference) {
    const states = await entityAdminController.getArchiveStates([ref]);
    expect(states.has(archiveKey(ref))).toBe(true);
    return states.get(archiveKey(ref))!;
}

// Inspect the actual controller projection, including membership and private placement.
// A preference row by itself must never be enough for this helper to find a card.
async function card(profile: Profile, ref: ArchiveReference, collection: 'owner' | 'participant' = 'owner') {
    const states = await entityAdminController.getArchiveStates([ref]);
    const parentId = states.get(archiveKey(ref))?.eventId;
    const auth = profile.userId ? {user: {id: profile.userId}} : {guest: {id: profile.guestId!}};
    // Follow the same paged navigation as the UI. Children may be in an event sub-view or
    // ordinary fallback cards when the parent belongs to another region or is not a member.
    for (const region of ['main', 'hidden'] as const) {
        const prefix = `${collection}_${region}_`;
        let page = 1;
        let lastPage = 1;
        do {
            const view = await userController.getOverviewRegion({profile, auth}, {
                collection, region, [`${prefix}type`]: ref.type,
                [`${prefix}page`]: String(page), [`${prefix}childPage`]: String(page),
                ...(parentId ? {[`${prefix}event`]: parentId} : {}),
            });
            const found = [...view.items, ...(view.parent ? [view.parent] : [])]
                .find(item => item.type === ref.type && item.id === ref.id);
            if (found) return found;
            const count = view.parent ? view.parent.overview?.matching ?? 0 : view.totalCards;
            lastPage = Math.ceil(count / view.pageSize);
            page++;
        } while (page <= lastPage);
    }
    return undefined;
}

beforeAll(async () => {
    // The shared initializer verifies the dedicated disposable schema before rebuilding it.
    // File-preservation fixtures have their own OS-created directory, never the real uploads.
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Archive organizer'});
    participant = await persistIntegrationProfile({name: 'Archive participant'});
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-archival-test-'));
}, 120_000);

afterAll(async () => {
    // Remove only the directory allocated by this suite, then release all DB connections.
    if (temporaryDirectory) await fs.rm(temporaryDirectory, {recursive: true, force: true});
    await closeIntegrationDatabase();
});

describe('authoritative archival and personal overview visibility', () => {
    it('archives every event attachment immediately and restores only inherited state', async () => {
        const event = await createEvent('Archive inheritance');
        const activity: ArchiveReference = {type: 'activity', id: await activityService.createActivityPlanTx(
            owner.id, 'Longer linked plan', '', '2027-06-01', '2028-01-01', [createActivitySlotEntity()], event.id,
        )};
        const packing: ArchiveReference = {type: 'packing', id: await packingService.createPackingListTx(
            owner.id, 'Independent archive', '', [createPackingItemEntity()], event.id,
        )};
        const drivers: ArchiveReference = {type: 'drivers', id: await driverService.createDriversList(owner.id, 'Linked rides', '', event.id)};
        const refs = [event, activity, packing, drivers];
        // Give one child independent state before archiving the event. Restoration must
        // release inheritance for the other children while preserving that separate choice.
        await archiveAsOwner(packing);
        await archiveAsOwner(event);
        const archived = await entityAdminController.getArchiveStates(refs);
        for (const ref of refs) expect(archived.get(archiveKey(ref))?.archived).toBe(true);
        expect(archived.get(archiveKey(activity))).toMatchObject({directArchived: false, inheritedFromEventId: event.id});
        expect(archived.get(archiveKey(packing))).toMatchObject({directArchived: true, inheritedFromEventId: event.id});
        await expect(restoreAsOwner(activity)).rejects.toThrow();

        // Inheritance also applies to children created after archival; no copied flag
        // or one-off cascade update may be required to make the new child archived.
        const newChild: ArchiveReference = {type: 'drivers', id: await driverService.createDriversList(owner.id, 'Added after archive', '', event.id)};
        expect(await state(newChild)).toMatchObject({archived: true, directArchived: false, inheritedFromEventId: event.id});
        await restoreAsOwner(event);
        expect(await state(event)).toMatchObject({archived: false, autoArchivePaused: true});
        for (const ref of [activity, drivers, newChild]) expect((await state(ref)).archived).toBe(false);
        expect(await state(packing)).toMatchObject({archived: true, directArchived: true, inheritedFromEventId: null});
        await restoreAsOwner(packing);
        expect((await state(packing)).archived).toBe(false);
        await archiveAsOwner(activity);
        expect(await restoreAsOwner(activity)).toMatchObject({
            archived: false, directArchived: false, autoArchivePaused: false, hasAutomaticSchedule: false,
        });
        expect(await state(activity)).toMatchObject({autoArchivePaused: false});
        expect(await activityService.getActivitySlotsFlat(activity.id)).toHaveLength(1);
        expect(await packingService.getPackingItems(packing.id)).toHaveLength(1);
    });

    it('uses inclusive date deadlines, skips linked plans, and preserves manual restoration across later jobs', async () => {
        const event = await createEvent('Automatic boundary');
        const standalone: ArchiveReference = {type: 'activity', id: await activityService.createActivityPlanTx(owner.id, 'Independent dates', '', '2027-06-01', '2027-06-03', [])};
        const laterEvent = await createEvent('Later parent', '2027-12-31');
        const linked: ArchiveReference = {type: 'activity', id: await activityService.createActivityPlanTx(owner.id, 'Earlier child', '', '2027-06-01', '2027-06-03', [], laterEvent.id)};

        // Check both sides of the inclusive end-day plus complete-day delay boundary.
        // The linked plan remains governed by its later event despite its earlier dates.
        await entityAdminController.archiveExpiredEntities(30, new Date('2027-07-03T23:59:59Z'));
        for (const ref of [event, standalone, linked]) expect((await state(ref)).archived).toBe(false);
        await entityAdminController.archiveExpiredEntities(30, new Date('2027-07-04T00:00:00Z'));
        expect((await state(event)).archived).toBe(true);
        expect((await state(standalone)).archived).toBe(true);
        expect((await state(linked)).archived).toBe(false);
        const timestamp = (await eventService.getEventById(event.id))!.archivedAt;
        await archiveAsOwner(event, new Date('2027-07-05T00:00:00Z'));
        expect((await eventService.getEventById(event.id))!.archivedAt).toEqual(timestamp);

        // A manual restoration pauses the independent schedule until explicitly resumed.
        await restoreAsOwner(event);
        await restoreAsOwner(standalone);
        await entityAdminController.archiveExpiredEntities(0, new Date('2027-08-01T12:00:00Z'));
        for (const ref of [event, standalone]) expect(await state(ref)).toMatchObject({archived: false, autoArchivePaused: true});
        await pauseAsOwner(event, false);
        await entityAdminController.archiveExpiredEntities(0, new Date('2027-08-01T12:00:00Z'));
        expect((await state(event)).archived).toBe(true);
        await expect(pauseAsOwner(linked, true)).rejects.toThrow();
    });

    it('keeps persisted show/hide overrides independent for profiles and shared between their two collections', async () => {
        const event = await createEvent('Private precedence');
        await registerEventAttendance(event.id, owner, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(event.id, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await setVisibility(owner.id, event, 'shown');
        await setVisibility(participant.id, event, 'hidden');
        await archiveAsOwner(event);
        // The owner participates too: both appearances consume one saved preference.
        // The second profile's explicit hiding remains independent of that choice.
        for (const collection of ['owner', 'participant'] as const) {
            expect(await card(owner, event, collection)).toMatchObject({overviewHidden: false, visibility: 'shown', archive: {archived: true}});
        }
        expect(await card(participant, event, 'participant')).toMatchObject({overviewHidden: true, visibility: 'hidden'});
        await restoreAsOwner(event);
        expect(await card(participant, event, 'participant')).toMatchObject({overviewHidden: true, visibility: 'hidden', archive: {archived: false}});
        await setVisibility(participant.id, event, 'default');
        expect(await card(participant, event, 'participant')).toMatchObject({overviewHidden: false, visibility: 'default'});
        await archiveAsOwner(event);
        await setVisibility(owner.id, event, 'default');
        expect(await card(owner, event)).toMatchObject({overviewHidden: true, visibility: 'default'});
    });

    it('does not propagate personal event hiding to children and isolates profiles of the same account', async () => {
        const event = await createEvent('Private event only');
        const child: ArchiveReference = {type: 'drivers', id: await driverService.createDriversList(owner.id, 'Visible child', '', event.id)};
        const otherProfile = await AppDataSource.getRepository(Profile).save(createProfileEntity(owner.user!));
        await adminService.addAdmin('event', event.id, otherProfile.id, PERM.ACCESS_ADMIN);
        await setVisibility(owner.id, event, 'hidden');
        expect(await card(owner, event)).toMatchObject({overviewHidden: true});
        expect(await card(owner, child)).toMatchObject({overviewHidden: false});
        expect(await card(otherProfile, event)).toMatchObject({overviewHidden: false, visibility: 'default'});
    });

    it('normalizes uppercase UUIDs at the visibility controller boundary before saving and presenting state', async () => {
        const event: ArchiveReference = {type: 'event', id: 'a103fc16-052d-4269-8abc-432853059a6c'};
        await AppDataSource.getRepository(Event).save({
            id: event.id, owner, title: 'Canonical visibility identity', startDate: '2027-06-01', endDate: '2027-06-03',
        });
        await archiveAsOwner(event);
        const session = {profile: owner, auth: {user: owner.user!}};

        const response = await userController.setPersonalVisibility('event', event.id.toUpperCase(), {visibility: 'shown'}, session);
        expect(response).toMatchObject({archive: {archived: true}, visibility: 'shown', overviewHidden: false});
        const saved = await AppDataSource.getRepository(EntityVisibilityPreference).findOneByOrFail({
            profile: {id: owner.id}, entityType: 'event', entityId: event.id,
        });
        expect(saved.entityId).toBe(event.id);
        expect(await card(owner, event)).toMatchObject({visibility: 'shown', overviewHidden: false, archive: {archived: true}});

        await userController.setPersonalVisibility('event', event.id.toUpperCase(), {visibility: 'default'}, session);
        expect(await userService.getVisibilityPreferences(owner.id, [event])).toEqual(new Map());
        expect(await card(owner, event)).toMatchObject({visibility: 'default', overviewHidden: true});
    });

    it('retains guest preferences when their profile transfers to a registered account', async () => {
        const guest = await userService.createGuest('Archive guest');
        const event = await createEvent('Guest transfer');
        await registerEventAttendance(event.id, guest.profile, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await setVisibility(guest.profile.id, event, 'hidden');
        expect(await card(guest.profile, event, 'participant')).toMatchObject({overviewHidden: true});
        await userService.moveProfileToUserTx(guest.profile.id, participant.user!.id);
        const transferred = (await userService.getProfileById(guest.profile.id))!;
        expect(await card(transferred, event, 'participant')).toMatchObject({overviewHidden: true, visibility: 'hidden'});
        await userService.removeProfileFromOwner(transferred.id);
        expect(await card(transferred, event, 'participant')).toMatchObject({visibility: 'hidden'});
    });

    it('keeps historical delegated events discoverable but never lets a preference retain revoked membership', async () => {
        const event = await createEvent('Historical administration', '2027-06-03');
        await eventService.updateEventDates(event.id, '2000-01-01', '2000-01-02');
        await adminService.addAdmin('event', event.id, participant.id, PERM.ACCESS_ADMIN);
        await archiveAsOwner(event);
        expect(await card(participant, event)).toMatchObject({overviewHidden: true});
        await setVisibility(participant.id, event, 'shown');
        expect(await card(participant, event)).toMatchObject({overviewHidden: false});
        await adminService.removeAdmin('event', event.id, participant.id);
        expect(await card(participant, event)).toBeUndefined();
        await expect(setVisibility(participant.id, event, 'hidden')).rejects.toThrow();
        await adminService.addAdmin('event', event.id, participant.id, PERM.ACCESS_ADMIN);
        expect(await card(participant, event)).toMatchObject({visibility: 'shown'});
        expect((await eventService.getActiveManagedEvents(participant.id)).some(item => item.id === event.id)).toBe(false);
    });

    it('leaves registrations, financial records, header images and proof bytes untouched', async () => {
        const event = await createEvent('Retained event data');
        await registerEventAttendance(event.id, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const registration = (await eventService.getRegistrationFor(participant.id, event.id))!;
        await adminService.addAdmin('event', event.id, participant.id, PERM.ACCESS_ADMIN | PERM.EDIT_META);
        const permissions = await adminService.getProfilePerms('event', event.id, participant.id);
        const proofPath = path.join(temporaryDirectory, 'invoice-proof.pdf');
        const headerPath = path.join(temporaryDirectory, 'event-header.png');
        await fs.writeFile(proofPath, '%PDF-1.4 archival proof');
        await fs.writeFile(headerPath, 'archival header fixture');
        await eventService.updateHeaderImage(event.id, headerPath);
        const pool = await AppDataSource.getRepository(EventInvoicePool).save({
            event: {id: event.id}, name: 'Closed shared costs', status: 'CLOSED', totalAmount: 25, invoiceAmount: 25,
        });
        const invoice = await AppDataSource.getRepository(EventInvoice).save({
            pool: {id: pool.id}, registration: {id: registration.id}, amount: '25.00', status: 'CLOSED', proofPath,
        });
        const share = await AppDataSource.getRepository(EventInvoiceShare).save({
            pool: {id: pool.id}, registration: {id: registration.id}, baseShareAmount: 25, shareAmount: 25, isPaid: true,
        });
        const before = {
            pool: await AppDataSource.getRepository(EventInvoicePool).findOneByOrFail({id: pool.id}),
            invoice: await AppDataSource.getRepository(EventInvoice).findOneByOrFail({id: invoice.id}),
            share: await AppDataSource.getRepository(EventInvoiceShare).findOneByOrFail({id: share.id}),
        };
        await archiveAsOwner(event);
        await restoreAsOwner(event);
        await pauseAsOwner(event, false);
        await entityAdminController.archiveExpiredEntities(0, new Date('2027-07-01T00:00:00Z'));
        expect((await state(event)).archived).toBe(true);
        await restoreAsOwner(event);
        await setVisibility(participant.id, event, 'hidden');
        expect(await AppDataSource.getRepository(EventInvoicePool).findOneByOrFail({id: pool.id})).toEqual(before.pool);
        expect(await AppDataSource.getRepository(EventInvoice).findOneByOrFail({id: invoice.id})).toEqual(before.invoice);
        expect(await AppDataSource.getRepository(EventInvoiceShare).findOneByOrFail({id: share.id})).toEqual(before.share);
        expect((await eventService.getEventById(event.id))!.headerImg).toBe(headerPath);
        expect((await eventService.getRegistrationFor(participant.id, event.id))!.id).toBe(registration.id);
        expect(await adminService.getProfilePerms('event', event.id, participant.id)).toBe(permissions);
        expect(await fs.readFile(proofPath, 'utf8')).toBe('%PDF-1.4 archival proof');
        expect(await fs.readFile(headerPath, 'utf8')).toBe('archival header fixture');
    });

    it('creates a duplicate with fresh lifecycle and visibility defaults', async () => {
        const original = await createEvent('Original archived event');
        await archiveAsOwner(original);
        await pauseAsOwner(original, true);
        await setVisibility(owner.id, original, 'hidden');
        const loaded = (await eventService.getEventById(original.id))!;
        // Duplication is the existing prefilled-create flow, so exercise its input normalization.
        const input = {title: 'Duplicated event', startDate: loaded.startDate, endDate: loaded.endDate};
        const normalized = eventController.preprocessCreate({...input, archivedAt: loaded.archivedAt, autoArchivePaused: loaded.autoArchivePaused});
        const duplicate = {type: 'event' as const, id: await eventController.createEntity(owner.id, {...input, ...normalized})};
        expect(await state(duplicate)).toMatchObject({archived: false, autoArchivePaused: false});
        expect(await card(owner, duplicate)).toMatchObject({visibility: 'default', overviewHidden: false});
        expect((await state(original)).archived).toBe(true);
    });

    it('rechecks dates after an automatic candidate waits for a concurrent organizer edit', async () => {
        const event = await createEvent('Concurrent date extension');
        const editor = AppDataSource.createQueryRunner();
        await editor.connect();
        await editor.startTransaction();
        await editor.manager.getRepository(Event).findOneOrFail({where: {id: event.id}, lock: {mode: 'pessimistic_write'}});
        const sweep = entityAdminController.archiveExpiredEntities(0, new Date('2027-07-01T00:00:00Z'));
        // Observe the real MariaDB connection waiting on our row lock: the candidate
        // has been read, but its conditional write cannot yet see the new dates.
        try {
            await expect.poll(async () => {
                const processes: {Info: string | null}[] = await AppDataSource.query('SHOW FULL PROCESSLIST');
                return processes.some(row => row.Info?.startsWith('UPDATE') && row.Info.includes(event.id));
            }, {timeout: 5000}).toBe(true);
            await editor.manager.getRepository(Event).update(event.id, {endDate: '2027-12-31'});
            await editor.commitTransaction();
        } finally {
            if (editor.isTransactionActive) await editor.rollbackTransaction();
            await editor.release();
            await sweep;
        }
        expect(await state(event)).toMatchObject({archived: false, autoArchivePaused: false});
    });

    it('serializes restoration with concurrent automatic jobs and keeps repeated sweeps harmless', async () => {
        const event = await createEvent('Concurrent restore');
        const blocker = AppDataSource.createQueryRunner();
        await blocker.connect();
        await blocker.startTransaction();
        await blocker.manager.getRepository(Event).findOneOrFail({where: {id: event.id}, lock: {mode: 'pessimistic_write'}});
        const restore = restoreAsOwner(event);
        let sweep: Promise<number> | undefined;
        try {
            // Queue restoration first, then wait for the automatic UPDATE to reach the
            // same locked row. Releasing it tests the real database ordering: the sweep
            // must recheck the newly committed pause instead of using stale eligibility.
            await expect.poll(async () => {
                const processes: {Info: string | null}[] = await AppDataSource.query('SHOW FULL PROCESSLIST');
                return processes.some(row => row.Info?.includes('FOR UPDATE') && row.Info.includes(event.id));
            }, {timeout: 5000}).toBe(true);
            sweep = entityAdminController.archiveExpiredEntities(0, new Date('2027-07-01T00:00:00Z'));
            await expect.poll(async () => {
                const processes: {Info: string | null}[] = await AppDataSource.query('SHOW FULL PROCESSLIST');
                return processes.some(row => row.Info?.startsWith('UPDATE') && row.Info.includes(event.id));
            }, {timeout: 5000}).toBe(true);
            await blocker.commitTransaction();
        } finally {
            if (blocker.isTransactionActive) await blocker.rollbackTransaction();
            await blocker.release();
            await Promise.all([restore, sweep]);
        }
        expect(await state(event)).toMatchObject({archived: false, autoArchivePaused: true});
        await pauseAsOwner(event, false);
        const counts = await Promise.all([
            entityAdminController.archiveExpiredEntities(0, new Date('2027-07-01T00:00:00Z')),
            entityAdminController.archiveExpiredEntities(0, new Date('2027-07-01T00:00:00Z')),
        ]);
        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
        expect((await state(event)).archived).toBe(true);
    });

    it('deletes archived events with their children and keeps profile preference cleanup independent', async () => {
        const event = await createEvent('Actual deletion');
        const child: ArchiveReference = {type: 'packing', id: await packingService.createPackingListTx(owner.id, 'Deleted child', '', [], event.id)};
        await setVisibility(owner.id, event, 'hidden');
        await setVisibility(owner.id, child, 'shown');
        await archiveAsOwner(event);
        expect(await eventService.getEventById(event.id)).not.toBeNull();
        expect(await packingService.getPackingListById(child.id)).not.toBeNull();
        await eventService.deleteEvent(event.id);
        expect(await eventService.getEventById(event.id)).toBeNull();
        expect(await card(owner, event)).toBeUndefined();
        expect(await packingService.getPackingListById(child.id)).toBeNull();
        expect(await card(owner, child)).toBeUndefined();
        // Stored preferences are not an entity inventory. They cannot restore a deleted
        // root, grant access to it, or make an event-cascaded child reappear as a card.
        expect(await entityAdminController.getArchiveStates([event, child])).toEqual(new Map());
        await expect(setVisibility(owner.id, child, 'shown')).rejects.toMatchObject({status: 404});
        await expect(restoreAsOwner(event)).rejects.toMatchObject({status: 404});
        await expect(eventService.deleteEvent(event.id)).resolves.toBeUndefined();

        // Normal creation generates a fresh identity; it never reuses a deleted root's
        // preference key. Use a surviving root to verify the separate profile FK below.
        const newChild: ArchiveReference = {
            type: 'packing',
            id: await packingService.createPackingListTx(owner.id, 'Fresh target', '', []),
        };
        expect(await card(owner, newChild)).toMatchObject({visibility: 'default'});

        const transient = await AppDataSource.getRepository(Profile).save(createProfileEntity(owner.user!));
        // Unlike the polymorphic entity reference, profile_id is a real cascading FK.
        // Recreating only the profile proves that the database removed its preferences.
        await adminService.addAdmin('packing', newChild.id, transient.id, PERM.ACCESS_ADMIN);
        await setVisibility(transient.id, newChild, 'hidden');
        await AppDataSource.getRepository(Profile).delete(transient.id);
        await AppDataSource.getRepository(Profile).save(createProfileEntity(owner.user!, {id: transient.id}));
        await adminService.addAdmin('packing', newChild.id, transient.id, PERM.ACCESS_ADMIN);
        expect(await card(transient, newChild)).toMatchObject({visibility: 'default'});
    });

    it('preserves standalone roots during archive and restore but permanently removes them through existing delete operations', async () => {
        const activityId = await activityService.createActivityPlanTx(owner.id, 'Delete plan', '', '2027-06-01', '2027-06-03', []);
        const packingId = await packingService.createPackingListTx(owner.id, 'Delete packing', '', []);
        const driversId = await driverService.createDriversList(owner.id, 'Delete drivers', '');
        const surveyId = await surveyService.createSurveyTx(owner.id, 'Delete survey', '', []);
        const cases = [
            {ref: {type: 'activity', id: activityId}, load: activityService.getActivityPlanById, remove: activityService.deleteActivityPlan},
            {ref: {type: 'packing', id: packingId}, load: packingService.getPackingListById, remove: packingService.deletePackingList},
            {ref: {type: 'drivers', id: driversId}, load: driverService.getDriversListById, remove: driverService.deleteDriversList},
            {ref: {type: 'survey', id: surveyId}, load: surveyService.getSurveyById, remove: surveyService.deleteSurvey},
        ] as const;

        for (const {ref, load, remove} of cases) {
            await setVisibility(owner.id, ref, 'hidden');
            await archiveAsOwner(ref);
            expect(await load(ref.id)).not.toBeNull();
            await restoreAsOwner(ref);
            expect(await load(ref.id)).not.toBeNull();
            expect(await userService.getVisibilityPreferences(owner.id, [ref])).toEqual(new Map([[archiveKey(ref), 'hidden']]));

            await remove(ref.id);
            expect(await load(ref.id)).toBeNull();
            expect(await entityAdminController.getArchiveStates([ref])).toEqual(new Map());
            expect(await card(owner, ref)).toBeUndefined();
            await expect(setVisibility(owner.id, ref, 'shown')).rejects.toMatchObject({status: 404});
            // Preserve the original repository.delete semantics for a missing row too.
            await expect(remove(ref.id)).resolves.toBeUndefined();
        }
    });

    it('rejects a visibility write queued behind direct event deletion', async () => {
        const event = await createEvent('Concurrent deletion');
        const child: ArchiveReference = {type: 'drivers', id: await driverService.createDriversList(owner.id, 'Concurrent preference', '', event.id)};
        const blocker = AppDataSource.createQueryRunner();
        await blocker.connect();
        await blocker.startTransaction();
        await blocker.manager.getRepository(Event).findOneOrFail({where: {id: event.id}, lock: {mode: 'pessimistic_write'}});
        const deletion = eventService.deleteEvent(event.id);
        let preference: Promise<void> | undefined;

        // Hold the parent row until both real database operations have arrived.
        // The feature service issues an ordinary DELETE, while the visibility writer
        // takes its own FOR UPDATE lock before checking that the target still exists.
        async function deletionIsWaiting(): Promise<boolean> {
            const processes: {Info: string | null}[] = await AppDataSource.query('SHOW FULL PROCESSLIST');
            return processes.some(row => row.Info?.startsWith('DELETE') && row.Info.includes(event.id));
        }

        async function preferenceIsWaiting(): Promise<boolean> {
            const processes: {Info: string | null}[] = await AppDataSource.query('SHOW FULL PROCESSLIST');
            return processes.some(row => row.Info?.includes('FOR UPDATE') && row.Info.includes(event.id));
        }

        try {
            await expect.poll(deletionIsWaiting, {timeout: 5000}).toBe(true);
            preference = expect(setVisibility(owner.id, child, 'hidden')).rejects.toMatchObject({status: 404});
            await expect.poll(preferenceIsWaiting, {timeout: 5000}).toBe(true);
            await blocker.commitTransaction();
        } finally {
            if (blocker.isTransactionActive) await blocker.rollbackTransaction();
            await blocker.release();
            await Promise.all([deletion, preference]);
        }
        expect(await userService.getVisibilityPreferences(owner.id, [event, child])).toEqual(new Map());
        expect(await driverService.getDriversListById(child.id)).toBeNull();
        expect(await card(owner, child)).toBeUndefined();
    });

    it('archives and restores an undated survey without altering answers or creating an automatic deadline', async () => {
        const survey: ArchiveReference = {type: 'survey', id: await surveyService.createSurveyTx(owner.id, 'Archived survey', '', [{weekday: 'MON', week: '1'}])};
        const [choice] = await surveyService.getCombinationsBySurveyId(survey.id);
        await surveyService.saveResponse(survey.id, participant.id, choice.id, 'yes');
        await archiveAsOwner(survey);
        expect(await state(survey)).toMatchObject({archived: true, hasAutomaticSchedule: false});
        await restoreAsOwner(survey);
        expect(await state(survey)).toMatchObject({archived: false, hasAutomaticSchedule: false});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: survey.id, answer: 'yes'}));
        await expect(pauseAsOwner(survey, false)).rejects.toThrow();
    });
});
