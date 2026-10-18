import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as drivers from '../../src/controller/driversController';
import driversController from '../../src/controller/driversController';
import {archiveEntity} from '../../src/controller/entityAdminController';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {DriversAssignment} from '../../src/modules/database/entities/drivers/DriversAssignment';
import {DriversList} from '../../src/modules/database/entities/drivers/DriversList';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import {contractValidator} from '../../src/modules/api/contracts';
import {PERM} from '../../src/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {ApiActor} from '../../src/types/ApiTypes';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createApiRequest} from '../factories/apiActionFactory';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let passenger: Profile;
let other: Profile;

function actor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }

function creation(eventId: string | null = null): components['schemas']['DriversCreateInput'] {
    return {title: 'Shared journeys', description: 'Airport and station', eventId,
        defaultPermissions: {public: PERM.ACCESS_VIEW | PERM.ITEM_ADD, guest: 0, authenticated: 0, participant: 0}};
}

async function fixture(eventId: string | null = null): Promise<string> {
    return (await drivers.createDriversList(creation(eventId), undefined, actor(owner))).id;
}

async function offer(id: string, profile: Profile = owner, description = 'Airport pickup', capacity = 2): Promise<string> {
    return (await drivers.createDriversItem(id, {title: profile.name, description, maxAssignees: capacity}, actor(profile))).id;
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Journey owner'});
    passenger = await persistIntegrationProfile({name: 'Journey passenger'});
    other = await persistIntegrationProfile({name: 'Second passenger'});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('versioned Drivers production operations', () => {
    it('creates with native sharing defaults and rejects unauthorized event selection before persistence', async () => {
        const before = await AppDataSource.getRepository(DriversList).count();
        const forbidden = await createIntegrationEvent(other.id, 'Private destination');
        await expect(drivers.createDriversList(creation(forbidden), undefined, actor(owner))).rejects.toMatchObject({status: 403});
        expect(await AppDataSource.getRepository(DriversList).count()).toBe(before);
        await expect(drivers.createDriversList(creation(), undefined, {})).rejects.toMatchObject({status: 401});

        const id = await fixture();
        expect(await driverService.getDriversListById(id)).toMatchObject({ownerId: owner.id, title: 'Shared journeys'});
        expect(await adminService.getDefaultPerms('drivers', id)).toEqual(creation().defaultPermissions);
        expect((await drivers.readDriversList(id, actor(owner))).data.items).toEqual([]);
    });

    it('rolls back new adapter creation and assignment when declared response preparation fails', async () => {
        const before = await AppDataSource.getRepository(DriversList).count();
        let createdId: string | undefined;
        await expect(drivers.createDriversList(creation(), undefined, actor(owner), result => {
            // This is the adapter's real completion seam. A failed generated
            // response check must still be able to roll back its shared writes.
            createdId = result.id;
            throw new Error('Creation response cannot be prepared');
        })).rejects.toThrow('Creation response cannot be prepared');
        expect(createdId).toBeTruthy();
        expect(await AppDataSource.getRepository(DriversList).count()).toBe(before);
        expect(await adminService.getDefaultPerms('drivers', createdId!)).toEqual({});

        const id = await fixture();
        const itemId = await offer(id);
        await expect(drivers.setDriversSelfAssignment(id, itemId, true, actor(passenger), () => {
            throw new Error('Assignment response cannot be prepared');
        })).rejects.toThrow('Assignment response cannot be prepared');
        expect(await driverService.getDriversAssignments(id, passenger.id)).toEqual([]);
        expect((await drivers.readDriversList(id, actor(owner))).data.items[0].assignedCount).toBe(0);
    });

    it('keeps offering profiles, passenger places and distinct summary counts separate across multiple rides', async () => {
        const id = await fixture();
        const first = await offer(id);
        const second = await offer(id, owner, 'Station pickup');
        let view = (await drivers.readDriversList(id, actor(owner))).data;
        expect(view.items.map(item => item.driverName)).toEqual([owner.name, owner.name]);
        expect(view.items.map(item => item.assignedCount)).toEqual([0, 0]);
        expect(view.counters).toEqual({participants: 0, open: 2, empty: 2});

        await drivers.setDriversSelfAssignment(id, first, true, actor(passenger));
        await drivers.setDriversSelfAssignment(id, second, true, actor(passenger));
        view = (await drivers.readDriversList(id, actor(passenger))).data;
        expect(view.items.every(item => item.selfAssigned)).toBe(true);
        expect(view.counters).toEqual({participants: 1, open: 2, empty: 0});
        await drivers.setDriversSelfAssignment(id, first, true, actor(other));
        view = (await drivers.readDriversList(id, actor(owner))).data;
        expect(view.counters).toEqual({participants: 2, open: 1, empty: 0});
        expect(view.items.find(item => item.id === first)?.assignedCount).toBe(2);
        expect(contractValidator('DriversListView')(view)).toBe(true);

        // The native controller is the counter oracle, using the same persisted
        // rows and actor rather than a second formula in the migration tests.
        const native = await driversController.fetchForView((await driverService.getDriversListById(id))!,
            createApiRequest({profileId: owner.id}));
        expect(view.counters).toEqual(native.counters);
        expect(view.items.map(item => item.id)).toEqual(native.items.map(item => item.id));
        for (const hidden of ['ownerId', 'profileId', 'email', 'password', owner.id, passenger.id]) {
            expect(JSON.stringify(view)).not.toContain(hidden);
        }
        expect(JSON.stringify(view)).not.toMatch(/requiredByAll|packed/iu);
    });

    it('keeps idempotent assignment before capacity and serializes the final passenger place', async () => {
        const id = await fixture();
        const itemId = await offer(id, owner, 'One passenger place', 1);
        const outcomes = await Promise.allSettled([
            drivers.setDriversSelfAssignment(id, itemId, true, actor(passenger)),
            drivers.setDriversSelfAssignment(id, itemId, true, actor(other)),
        ]);
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({status: 409});
        const assignments = await AppDataSource.getRepository(DriversAssignment).findBy({item: {id: itemId}});
        expect(assignments).toHaveLength(1);
        const winner = assignments[0].profileId === passenger.id ? passenger : other;
        await expect(drivers.setDriversSelfAssignment(id, itemId, true, actor(winner))).resolves.toBeDefined();
        expect(await AppDataSource.getRepository(DriversAssignment).countBy({item: {id: itemId}})).toBe(1);
        await drivers.setDriversSelfAssignment(id, itemId, false, actor(winner));
        expect(await AppDataSource.getRepository(DriversAssignment).countBy({item: {id: itemId}})).toBe(0);
    });

    it('separates event page admission from passenger and independently granted edit methods', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Registered passengers');
        const id = await fixture(eventId);
        const itemId = await offer(id);
        await adminService.updatePerms('drivers', id, {public: 0, authenticated: 0, participant: 0});
        await expect(drivers.readDriversList(id, actor(passenger))).rejects.toMatchObject({status: 403});
        await eventService.register(eventId, '2027-06-01', '2027-06-03', passenger.id);
        expect((await drivers.readDriversList(id, actor(passenger))).data.capabilities.selfAssign).toBe(false);
        await expect(drivers.setDriversSelfAssignment(id, itemId, true, actor(passenger))).rejects.toMatchObject({status: 403});

        await adminService.addAdmin('drivers', id, other.id, PERM.ITEM_EDIT_DESC);
        await expect(drivers.readDriversList(id, actor(other))).rejects.toMatchObject({status: 403});
        const baseline = await drivers.readDriversItemEditBaseline(id, itemId, actor(other));
        expect(baseline.values).toEqual({description: 'Airport pickup'});
        expect(JSON.stringify(baseline)).not.toContain(owner.name);
        await drivers.updateDriversItem(id, itemId, {description: 'Delegated pickup'}, baseline.editToken, actor(other));
        await expect(drivers.updateDriversItem(id, itemId, {maxAssignees: 3}, baseline.editToken, actor(other)))
            .rejects.toMatchObject({status: 403});
        expect(await driverService.getDriversItemById(itemId)).toMatchObject({description: 'Delegated pickup', maxAssignees: 2});
    });

    it('emits item comparison hashes only for fields the current actor may edit', async () => {
        const id = await fixture();
        const itemId = await offer(id);
        const readOnly = (await drivers.readDriversList(id, actor(passenger))).data.items[0];
        expect(Object.keys(JSON.parse(Buffer.from(readOnly.editToken.slice(6, -1), 'base64url').toString('utf8')).fields)).toEqual([]);
        expect(readOnly).not.toHaveProperty('title');

        await adminService.addAdmin('drivers', id, passenger.id, PERM.ITEM_EDIT_DESC);
        const descriptionOnly = (await drivers.readDriversList(id, actor(passenger))).data.items[0];
        const fields = Object.keys(JSON.parse(Buffer.from(descriptionOnly.editToken.slice(6, -1), 'base64url').toString('utf8')).fields);
        expect(fields).toEqual(['description']);
        expect(descriptionOnly).not.toHaveProperty('title');
        expect((await driverService.getDriversItemById(itemId)).title).toBe(owner.name);

        // A public item grant admits its method baseline, never the protected
        // detail page. Its reviewed token belongs to that exact public context.
        await adminService.updatePerms('driversItem', itemId, {public: PERM.EDIT_DESC});
        const publicActor: ApiActor = {context: 'drivers-public-a'};
        const baseline = await drivers.readDriversItemEditBaseline(id, itemId, publicActor);
        expect(baseline.values).toEqual({description: 'Airport pickup'});
        await expect(drivers.readDriversList(id, publicActor)).rejects.toMatchObject({status: 401});
        await expect(drivers.updateDriversItem(id, itemId, {description: 'Wrong public context'}, baseline.editToken,
            {context: 'drivers-public-b'} as ApiActor)).rejects.toMatchObject({status: 412});
        await drivers.updateDriversItem(id, itemId, {description: 'Publicly delegated pickup'}, baseline.editToken, publicActor);
        expect((await driverService.getDriversItemById(itemId)).description).toBe('Publicly delegated pickup');
    });

    it('reviews only changed ride fields and denies foreign roots or a removed grant', async () => {
        const id = await fixture();
        const itemId = await offer(id);
        const original = (await drivers.readDriversList(id, actor(owner))).data.items[0];
        await drivers.updateDriversItem(id, itemId, {description: 'Current pickup'}, original.editToken, actor(owner));
        await drivers.updateDriversItem(id, itemId, {maxAssignees: 4}, original.editToken, actor(owner));
        await expect(drivers.updateDriversItem(id, itemId, {description: 'Obsolete pickup'}, original.editToken, actor(owner)))
            .rejects.toMatchObject({status: 412});
        await expect(drivers.updateDriversItem(id, itemId, {description: 'Missing review'}, undefined, actor(owner)))
            .rejects.toMatchObject({status: 428});
        const foreign = await fixture();
        await expect(drivers.updateDriversItem(foreign, itemId, {description: 'Wrong root'}, original.editToken, actor(owner)))
            .rejects.toMatchObject({status: 404});
        await expect(drivers.setDriversSelfAssignment(foreign, itemId, true, actor(owner))).rejects.toMatchObject({status: 404});

        await adminService.addAdmin('drivers', id, other.id, PERM.ITEM_EDIT_DESC);
        const delegated = await drivers.readDriversItemEditBaseline(id, itemId, actor(other));
        await adminService.removeAdmin('drivers', id, other.id);
        await expect(drivers.updateDriversItem(id, itemId, {description: 'Revoked pickup'}, delegated.editToken, actor(other)))
            .rejects.toMatchObject({status: 403});
        expect(await driverService.getDriversItemById(itemId)).toMatchObject({description: 'Current pickup', maxAssignees: 4});
    });

    it('retains assignments when inherited native capacity behavior lowers the displayed maximum', async () => {
        const id = await fixture();
        const itemId = await offer(id);
        await drivers.setDriversSelfAssignment(id, itemId, true, actor(passenger));
        await drivers.setDriversSelfAssignment(id, itemId, true, actor(other));
        const item = (await drivers.readDriversList(id, actor(owner))).data.items[0];
        // IMP-026 remains excluded: the adapter must neither silently discard
        // passengers nor introduce an unauthorized legacy capacity repair.
        await drivers.updateDriversItem(id, itemId, {maxAssignees: 1}, item.editToken, actor(owner));
        expect((await drivers.readDriversList(id, actor(owner))).data.items[0]).toMatchObject({maxAssignees: 1, assignedCount: 2});
        expect(await AppDataSource.getRepository(DriversAssignment).countBy({item: {id: itemId}})).toBe(2);
    });

    it('reorders the complete reviewed set and rejects a changed set without partial persistence', async () => {
        const id = await fixture();
        const first = await offer(id);
        const second = await offer(id, owner, 'Station pickup');
        const original = (await drivers.readDriversList(id, actor(owner))).data;
        await drivers.reorderDriversItems(id, {itemIds: [second, first]}, original.orderToken, actor(owner));
        expect((await driverService.getDriversItems(id)).map(item => item.id)).toEqual([second, first]);
        await expect(drivers.reorderDriversItems(id, {itemIds: [first, second]}, original.orderToken, actor(owner)))
            .rejects.toMatchObject({status: 412});
        const current = (await drivers.readDriversList(id, actor(owner))).data;
        await expect(drivers.reorderDriversItems(id, {itemIds: [first]}, current.orderToken, actor(owner)))
            .rejects.toMatchObject({status: 409});
        expect((await driverService.getDriversItems(id)).map(item => item.id)).toEqual([second, first]);
    });

    it('removes passengers and rides only through their scoped existing operations', async () => {
        const id = await fixture();
        const itemId = await offer(id, passenger);
        await drivers.setDriversSelfAssignment(id, itemId, true, actor(other));
        const assignment = (await drivers.readDriversList(id, actor(owner))).data.items[0].assignees[0];
        expect(assignment.assignmentId).toBeTruthy();
        const foreign = await fixture();
        await expect(drivers.deleteDriversAssignment(foreign, String(assignment.assignmentId), actor(owner)))
            .rejects.toMatchObject({status: 404});
        await expect(drivers.deleteDriversAssignment(id, String(assignment.assignmentId), actor(other)))
            .rejects.toMatchObject({status: 403});
        await drivers.deleteDriversAssignment(id, String(assignment.assignmentId), actor(owner));
        expect(await driverService.getDriversAssignments(id, other.id)).toEqual([]);
        await drivers.setDriversSelfAssignment(id, itemId, true, actor(other));
        await drivers.deleteDriversItem(id, itemId, actor(passenger));
        expect(await driverService.getDriversItems(id)).toEqual([]);
        expect(await AppDataSource.getRepository(DriversAssignment).countBy({entity: {id}})).toBe(0);
    });

    it('duplicates the native form surface while excluding rides, assignments, image, event and lifecycle', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Original parent');
        const id = await fixture(eventId);
        const itemId = await offer(id);
        await drivers.setDriversSelfAssignment(id, itemId, true, actor(passenger));
        await driverService.updateHeaderImage(id, 'private-original.png');
        await archiveEntity({type: 'drivers', id}, {}, actor(owner));
        const duplicate = await drivers.readDriversDuplicate(id, actor(owner));
        expect(contractValidator('DriversDuplicate')(duplicate)).toBe(true);
        expect(duplicate).toMatchObject({title: 'Shared journeys', description: 'Airport and station', eventId: null});
        expect(JSON.stringify(duplicate)).not.toMatch(/private-original|assignedCount|driverName|archivedAt/u);
        const copy = await drivers.createDriversList({...creation(), ...duplicate, title: 'Copied journeys'}, undefined, actor(owner));
        expect(await driverService.getDriversListById(copy.id)).toMatchObject({title: 'Copied journeys', eventId: null, headerImg: null});
        expect((await drivers.readDriversList(copy.id, actor(owner))).data).toMatchObject({items: [], archived: false, inheritedArchived: false});
    });

    it('shares independent metadata, settings, event links and archive operations without disclosing private parent links', async () => {
        const id = await fixture();
        await offer(id);
        await adminService.addAdmin('drivers', id, other.id, PERM.EDIT_TITLE);
        const metadata = await drivers.readDriversMetadata(id, actor(other));
        expect(metadata.data.values).toEqual({title: 'Shared journeys'});
        await drivers.patchDriversMetadata(id, {title: 'Updated journeys'}, metadata.etag, actor(other));
        await expect(drivers.patchDriversMetadata(id, {description: 'Forbidden'}, metadata.etag, actor(other)))
            .rejects.toMatchObject({status: 403});
        const restricted = await drivers.readDriversSettings(id, actor(other));
        expect(restricted.access).toBeNull();
        const eventId = await createIntegrationEvent(owner.id, 'Private parent');
        await adminService.updatePerms('event', eventId, {public: 0, authenticated: 0, participant: 0});
        const settings = await drivers.readDriversSettings(id, actor(owner));
        await drivers.changeDriversEvent(id, {eventId, expectedEventId: null}, actor(owner), settings.settingsToken);
        await adminService.updateAdminPerms('drivers', id, other.id, PERM.EDIT_TITLE | PERM.ACCESS_VIEW);
        expect((await drivers.readDriversList(id, actor(other))).data.currentEventUrl).toBeNull();
        await drivers.setDriversArchived(id, true, actor(owner));
        expect((await drivers.readDriversList(id, actor(owner))).data.archived).toBe(true);
        await drivers.setDriversArchived(id, false, actor(owner));
        expect((await drivers.readDriversList(id, actor(owner))).data.archived).toBe(false);
        expect((await driverService.getDriversItems(id))).toHaveLength(1);
        await expect(drivers.deleteDriversList(id, actor(other))).rejects.toMatchObject({status: 403});
        await drivers.deleteDriversList(id, actor(owner));
        expect(await driverService.getDriversListById(id)).toBeNull();
    });

    it('shares sparse audience defaults and selected administrator add, zero and removal operations', async () => {
        const id = await fixture();
        const baseline = await drivers.readDriversDefaultsBaseline(id, actor(owner));
        await drivers.updateDriversDefaults(id, {authenticated: PERM.ACCESS_VIEW}, actor(owner), baseline.editToken);
        expect(await adminService.getDefaultPerms('drivers', id)).toEqual({...creation().defaultPermissions, authenticated: PERM.ACCESS_VIEW});
        await expect(drivers.updateDriversDefaults(id, {authenticated: 0}, actor(owner), baseline.editToken))
            .rejects.toMatchObject({status: 412});
        await expect(drivers.readDriversDefaultsBaseline(id, actor(passenger))).rejects.toMatchObject({status: 403});

        const absent = await drivers.readDriversAdminBaseline(id, other.id, actor(owner));
        expect(absent.mask).toBeNull();
        await drivers.setDriversAdmin(id, other.id, PERM.EDIT_TITLE, actor(owner), absent.editToken);
        const granted = await drivers.readDriversAdminBaseline(id, other.id, actor(owner));
        expect(granted.mask).toBe(PERM.EDIT_TITLE);
        await drivers.setDriversAdmin(id, other.id, 0, actor(owner), granted.editToken);
        const zero = await drivers.readDriversAdminBaseline(id, other.id, actor(owner));
        expect(zero.mask).toBe(0);
        await expect(drivers.setDriversAdmin(id, other.id, PERM.ACCESS_VIEW, actor(owner), granted.editToken))
            .rejects.toMatchObject({status: 412});
        await expect(drivers.readDriversAdminBaseline(id, other.id, actor(passenger))).rejects.toMatchObject({status: 403});
        await drivers.setDriversAdmin(id, other.id, null, actor(owner), zero.editToken);
        expect((await drivers.readDriversAdminBaseline(id, other.id, actor(owner))).mask).toBeNull();
    });

    it('keeps header write baselines independent from private image reads and requires current comparison', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Private header parent');
        const id = await fixture(eventId);
        await adminService.updatePerms('drivers', id, {public: 0, authenticated: 0, participant: 0});
        await adminService.addAdmin('drivers', id, other.id, PERM.EDIT_META);
        const baseline = await drivers.readDriversHeaderBaseline(id, actor(other));
        expect(Object.keys(baseline)).toEqual(['editToken']);
        await expect(drivers.readDriversHeaderPath(id, actor(other))).rejects.toMatchObject({status: 403});
        await expect(drivers.readDriversHeaderBaseline(id, actor(passenger))).rejects.toMatchObject({status: 403});
        expect(await drivers.setDriversHeader(id, undefined, actor(other), baseline.editToken)).toEqual({changed: false});

        // No bytes exist at this task-owned path. Change only its stored reference
        // to test stale review without opening or deleting any unrelated file.
        await driverService.updateHeaderImage(id, 'artifacts/p3/uncreated-header.png');
        await expect(drivers.setDriversHeader(id, undefined, actor(other), baseline.editToken)).rejects.toMatchObject({status: 412});
        expect((await driverService.getDriversListById(id))!.headerImg).toBe('artifacts/p3/uncreated-header.png');
        await driverService.updateHeaderImage(id, null);
    });
});
