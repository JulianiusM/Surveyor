import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as userService from '../../src/modules/database/services/UserService';
import * as packing from '../../src/modules/packing/api';
import {archiveEntity} from '../../src/controller/entityAdminController';
import {contractValidator} from '../../src/modules/api/contracts';
import {DEFAULT_PERM, PERM} from '../../src/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createEventActivityPlan, createIntegrationEvent, createSurveyWithCombinations, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
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
        await packing.setPackingAdmin(id, editor.id, PERM.MANAGE_PERMISSIONS, actor(owner), current.settingsToken);
        await expect(packing.setPackingAdmin(id, editor.id, 0, actor(owner), current.settingsToken)).rejects.toMatchObject({status: 412});
        const fresh = await packing.readPackingSettings(id, actor(owner));
        await packing.setPackingAdmin(id, editor.id, null, actor(owner), fresh.settingsToken);
        expect(await adminService.isAdmin('packing', id, editor.id)).toBe(false);
    });

    it('preserves guest administration but prohibits account-only create/duplicate and owner-only root deletion', async () => {
        const id = await fixture();
        const guest = await userService.createGuest('Packing guest administrator');
        const session: SessionLike = {auth: {guest}, profile: guest.profile};
        await adminService.addAdmin('packing', id, guest.profile.id, DEFAULT_PERM.ADMIN);
        const settings = await packing.readPackingSettings(id, session);
        expect(settings.capabilities).toMatchObject({duplicate: false, remove: false, managePermissions: true, editHeader: true});
        await expect(packing.createPackingList(creation(), undefined, session)).rejects.toMatchObject({status: 403});
        await expect(packing.readPackingDuplicate(id, session)).rejects.toMatchObject({status: 403});
        await expect(packing.deletePackingList(id, session)).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('packing', id, editor.id, DEFAULT_PERM.ADMIN);
        await expect(packing.deletePackingList(id, actor(editor))).rejects.toMatchObject({status: 403});
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
    it('keeps event containers, private placement and actor membership in the shared overview path', async () => {
        const isolatedOwner = await persistIntegrationProfile({name: 'Scoped overview owner'});
        const isolatedParticipant = await persistIntegrationProfile({name: 'Scoped overview participant'});
        const session = actor(isolatedOwner);
        const participantSession = actor(isolatedParticipant);
        const eventId = await createIntegrationEvent(isolatedOwner.id, 'Container for packing');
        const id = (await packing.createPackingList({...creation(eventId), title: 'Scoped packing overview'}, undefined, session)).id;
        const overview = await packing.readPackingOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('PackingOverviewRegion')(overview)).toBe(true);
        expect(overview.items.map(card => [card.type, card.id])).toEqual([['event', eventId]]);
        const children = await packing.readPackingOverview({collection: 'owner', region: 'main', eventId}, session);
        // The selected event encloses the child collection as a complete card. Its native
        // feature link and personal visibility survive without exposing event commands here.
        expect(contractValidator('PackingOverviewRegion')(children)).toBe(true);
        expect(children.parent).toMatchObject({id: eventId, type: 'event', title: 'Container for packing',
            description: 'A production-shaped integration workflow', url: `/event/${eventId}`,
            visibility: 'default', overviewHidden: false, children: {total: 1, matching: 1},
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}});
        expect(children).toMatchObject({totalChildren: 1, childPage: 1, hasPrevious: false, hasNext: false});
        await packing.setPackingVisibility('event', eventId, {visibility: 'shown'}, session);
        expect((await packing.readPackingOverview({collection: 'owner', region: 'main', eventId}, session)).parent)
            .toMatchObject({id: eventId, visibility: 'shown', overviewHidden: false});
        expect(children.items.map(card => card.id)).toEqual([id]);
        expect(children.items[0].url).toBe(`/frontend-pilot/packing/${id}`);
        expect(children.items[0].capabilities).toEqual({archive: true, restore: false, duplicate: true, remove: true});
        const item = (await packing.readPackingList(id, session)).data.items[0];
        await packing.setPackingSelfAssignment(id, item.id, true, participantSession);
        const participantView = await packing.readPackingOverview({collection: 'participant', region: 'main'}, participantSession);
        expect(participantView.items.map(card => card.id)).toEqual([id]);
        expect(participantView.items[0].eventContext).toBeNull();
        expect(participantView.parent).toBeNull();
        expect((await packing.readPackingOverview({collection: 'owner', region: 'main'}, participantSession)).items).toEqual([]);
        await expect(packing.setPackingVisibility('event', eventId, {visibility: 'hidden'}, participantSession)).rejects.toMatchObject({status: 403});
        for (let retry = 0; retry < 2; retry++) expect(await packing.setPackingVisibility('packing', id, {visibility: 'hidden'}, participantSession))
            .toEqual({visibility: 'hidden', overviewHidden: true, archived: false});
        expect((await packing.readPackingOverview({collection: 'participant', region: 'main'}, participantSession)).items).toEqual([]);
        expect((await packing.readPackingOverview({collection: 'participant', region: 'hidden'}, participantSession)).items.map(card => card.id)).toEqual([id]);
        expect((await packing.readPackingOverview({collection: 'owner', region: 'hidden'}, participantSession)).items).toEqual([]);
        expect((await packing.readPackingOverview({collection: 'owner', region: 'main', eventId}, session)).items.map(card => card.id)).toEqual([id]);
        expect((await packing.readPackingList(id, session)).data.archived).toBe(false);
        await packing.setPackingVisibility('packing', id, {visibility: 'default'}, participantSession);
        const search = await packing.readPackingOverview({collection: 'participant', region: 'main', q: 'missing', page: '999'}, participantSession);
        expect(search).toMatchObject({page: 1, items: [], matchingEntities: 0, hasNext: false, hasPrevious: false});
        // "Shown" is an explicit preference even for an active card. Later shared archival
        // must keep that card in this profile's main region without pretending it was restored.
        expect(await packing.setPackingVisibility('packing', id, {visibility: 'shown'}, participantSession))
            .toEqual({visibility: 'shown', overviewHidden: false, archived: false});
        await packing.setPackingArchived(id, true, session);
        const shownArchived = await packing.readPackingOverview({collection: 'participant', region: 'main'}, participantSession);
        expect(shownArchived.items).toHaveLength(1);
        expect(shownArchived.items[0]).toMatchObject({id, visibility: 'shown', overviewHidden: false, archived: true});
        await packing.setPackingVisibility('packing', id, {visibility: 'default'}, participantSession);
        expect((await packing.readPackingOverview({collection: 'participant', region: 'main'}, participantSession)).items).toEqual([]);
        expect((await packing.readPackingOverview({collection: 'participant', region: 'hidden'}, participantSession)).items[0])
            .toMatchObject({id, visibility: 'default', overviewHidden: true, archived: true});
        const serialized = JSON.stringify([participantView, children, shownArchived]);
        for (const privateKey of ['ownerId', 'profileId', 'email', 'headerImg']) expect(serialized).not.toContain(`"${privateKey}"`);
    });

    it('shows non-packing membership without a filter and includes every eligible event child', async () => {
        const isolatedOwner = await persistIntegrationProfile({name: 'Mixed overview owner'});
        const session = actor(isolatedOwner);
        const [surveyId] = await createSurveyWithCombinations(isolatedOwner.id);
        const surveyOnly = await packing.readPackingOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('PackingOverviewRegion')(surveyOnly)).toBe(true);
        expect(surveyOnly).toMatchObject({type: 'all', availableTypes: ['survey'], totalEntities: 1,
            matchingEntities: 1, totalCards: 1});
        expect(surveyOnly.items).toMatchObject([{id: surveyId, type: 'survey', url: `/survey/${surveyId}`}]);

        const eventId = await createIntegrationEvent(isolatedOwner.id, 'Mixed trip');
        const activityId = await createEventActivityPlan(isolatedOwner.id, eventId);
        const packingId = (await packing.createPackingList(creation(eventId), undefined, session)).id;
        const overview = await packing.readPackingOverview({collection: 'owner', region: 'main'}, session);
        expect(contractValidator('PackingOverviewRegion')(overview)).toBe(true);
        expect(overview).toMatchObject({type: 'all', totalEntities: 4, matchingEntities: 4, totalCards: 2});
        expect(new Set(overview.availableTypes)).toEqual(new Set(['event', 'activity', 'packing', 'survey']));
        expect(overview.items.find(card => card.id === eventId)?.children).toEqual({total: 2, matching: 2});
        const children = await packing.readPackingOverview({collection: 'owner', region: 'main', eventId}, session);
        expect(children.parent?.children).toEqual({total: 2, matching: 2});
        expect(new Set(children.items.map(card => card.id))).toEqual(new Set([activityId, packingId]));
        expect(children.items.find(card => card.id === activityId)?.url).toBe(`/activity/${activityId}`);
        expect(children.items.find(card => card.id === packingId)?.url).toBe(`/frontend-pilot/packing/${packingId}`);

        const filtered = await packing.readPackingOverview({collection: 'owner', region: 'main', type: 'activity'}, session);
        expect(filtered).toMatchObject({type: 'activity', totalEntities: 4, matchingEntities: 1, totalCards: 1});
        expect(filtered.items).toMatchObject([{id: eventId, type: 'event', children: {total: 2, matching: 1}}]);
        const filteredChildren = await packing.readPackingOverview({collection: 'owner', region: 'main', type: 'activity', eventId}, session);
        expect(filteredChildren.items.map(card => card.id)).toEqual([activityId]);

        await packing.setPackingVisibility('survey', surveyId, {visibility: 'hidden'}, session);
        const hidden = await packing.readPackingOverview({collection: 'owner', region: 'hidden'}, session);
        expect(hidden).toMatchObject({type: 'all', totalEntities: 4, hiddenEntities: 1, matchingEntities: 1});
        expect(hidden.items).toMatchObject([{id: surveyId, type: 'survey', visibility: 'hidden'}]);
        const missing = await packing.readPackingOverview({collection: 'owner', region: 'main', q: 'no such title'}, session);
        expect(missing).toMatchObject({type: 'all', totalEntities: 4, matchingEntities: 0, items: []});
    });
});
