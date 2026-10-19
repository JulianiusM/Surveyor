import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import nativeActivity, * as activity from '../../src/controller/activityController';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as recommendationService from '../../src/modules/database/services/ActivityRecommendationService';
import {contractValidator} from '../../src/modules/api/contracts';
import {PERM} from '../../src/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {ApiActor} from '../../src/types/ApiTypes';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let other: Profile;

function actor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }

function creation(eventId: string | null = null): components['schemas']['ActivityCreateInput'] {
    return {title: 'Camp duties', description: 'A saved description\nwith instructions', startDate: '2027-06-01', endDate: '2027-06-03', eventId,
        defaultPermissions: {public: PERM.ACCESS_VIEW, guest: 0, authenticated: 0, participant: 0},
        slots: [{id: randomUUID(), day: '2027-06-02', position: 0, title: 'Kitchen', description: 'Clean the kitchen',
            startTime: '09:00', endTime: '10:00', maxAssignees: 2}]};
}

async function fixture(eventId: string | null = null) {
    const {id} = await activity.createActivityPlan(creation(eventId), undefined, actor(owner));
    const slot = (await activityService.getActivitySlotsFlat(id))[0];
    return {id, slot};
}

beforeAll(async function prepareDatabase() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Activity organizer'});
    participant = await persistIntegrationProfile({name: 'Duty participant'});
    other = await persistIntegrationProfile({name: 'Other participant'});
}, 120_000);
afterAll(closeIntegrationDatabase);

describe('versioned Activity production operations', () => {
    it('projects private requirements and preserves zero overrides through the shared settings owner', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Requirement transport camp');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const {id} = await fixture(eventId);
        const input: components['schemas']['ActivityRequirementsInput'] = {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'FLOOR', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false, allowArrivalDayEvening: true,
            allowDepartureDayMorning: true, roleRequirements: [],
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 1}, {stayDays: 3, requiredShifts: 2}],
            overrides: [{profileId: participant.id, roleId: null, requiredShifts: 0}],
        };
        await activity.saveActivityRequirements(id, input, actor(owner));
        const data = await activity.readActivityRequirements(id, actor(owner));
        const validateRequirements = contractValidator('ActivityRequirements');
        expect(validateRequirements(data), JSON.stringify(validateRequirements.errors)).toBe(true);
        expect(data.overrides).toEqual([{id: expect.any(Number), profileId: participant.id, profileName: participant.name,
            roleId: null, requiredShifts: 0}]);
        expect(data.participants).toContainEqual(expect.objectContaining({requiredShifts: 0, source: 'override'}));
        expect(data.calculationContext.participants).toContainEqual(expect.objectContaining({profileId: participant.id}));
        expect(JSON.stringify(data)).not.toContain('password');
        expect(data).not.toHaveProperty('owner');
        await expect(activity.readActivityRequirements(id, actor(other))).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS);
        await expect(activity.saveActivityRequirements(id, input, actor(other))).rejects.toMatchObject({status: 403});
        expect((await activity.readActivityPlan(id, actor(other))).data.capabilities.manageRecommendations).toBe(true);
    });

    it('keeps recovery snapshots read-only while explicit entry retains native recommendation maintenance', async () => {
        const {id, slot} = await fixture();
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'PENDING', operation: 'ASSIGN', manual: false}]);
        await activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));

        const snapshot = await activity.readActivityRecommendations(id, actor(owner));
        expect(contractValidator('ActivityRecommendations')(snapshot)).toBe(true);
        expect(snapshot.recommendations).toMatchObject([{item: {id: slot.id}, profile: {id: participant.id}, status: 'PENDING', manual: false}]);
        expect((await recommendationService.getRecommendations(id))[0].status).toBe('PENDING');
        expect(snapshot.autoGenerationJob).toBeNull();
        expect(snapshot.recommendations[0]).not.toHaveProperty('entity');
        expect(snapshot.recommendations[0].profile).toEqual({id: participant.id, name: participant.name});

        const entered = await activity.readActivityRecommendations(id, actor(owner), true);
        expect(entered.recommendations).toEqual([]);
        expect((await recommendationService.getRecommendations(id))[0].status).toBe('APPLIED');
        await expect(activity.readActivityRecommendations(id, actor(other))).rejects.toMatchObject({status: 403});
        await expect(activity.generateActivityRecommendations(id, actor(owner))).rejects.toMatchObject({status: 409});
    });

    it('retains generated provenance and applies only the submitted reviewed manual batch', async () => {
        const {id, slot} = await fixture();
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'PENDING', operation: 'ASSIGN', manual: false}]);
        const loaded = await activity.readActivityRecommendations(id, actor(owner));
        const generated = loaded.recommendations[0];
        const review: components['schemas']['ActivityRecommendationReview'] = {recommendations: [
            {id: generated.id, itemId: slot.id, profileId: participant.id, status: 'REJECTED', operation: 'ASSIGN', manual: true},
            {itemId: slot.id, profileId: other.id, status: 'APPROVED', operation: 'ASSIGN', manual: true},
        ]};
        const preview = await activity.previewActivityRecommendations(id, review, actor(owner));
        expect(contractValidator('ActivityRecommendationPreview')(preview)).toBe(true);
        const applied = await activity.applyActivityRecommendations(id, {...review, overlapConfirmation: preview.overlapConfirmation}, actor(owner));
        expect(contractValidator('ActivityRecommendationApplyResult')(applied)).toBe(true);
        expect(applied).toMatchObject({applied: 1, skipped: 0});
        expect((await recommendationService.getRecommendations(id)).find(row => row.profileId === participant.id)).toMatchObject({manual: false, status: 'REJECTED'});
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(id, other.id)).toEqual([slot.id]);
    });

    it('scopes job observation to its plan and keeps read-only snapshots from dispatching work', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Job transport camp');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const {id} = await fixture(eventId);
        const second = await fixture(eventId);
        await nativeActivity.updateRequirements(id, {assignmentMode: 'REQUIRED', bindingDeadline: '2020-01-01T00:00:00Z',
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 0}, {stayDays: 3, requiredShifts: 1}]});
        expect((await activity.readActivityRecommendations(id, actor(owner))).autoGenerationJob).toBeNull();
        const queued = await activity.generateActivityRecommendations(id, actor(owner));
        expect(contractValidator('ActivityRecommendationQueued')(queued)).toBe(true);
        const observed = await activity.readActivityRecommendationJob(id, queued.job.id, actor(owner));
        expect(observed.job.id).toBe(queued.job.id);
        expect(contractValidator('ActivityRecommendationJobResult')(observed)).toBe(true);
        await expect(activity.readActivityRecommendationJob(second.id, queued.job.id, actor(owner))).rejects.toMatchObject({status: 404});
        await expect(activity.readActivityRecommendationJob(id, queued.job.id, actor(other))).rejects.toMatchObject({status: 403});
        // Wait for this fixture's existing worker before database teardown or another schema reset.
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const current = await activity.readActivityRecommendationJob(id, queued.job.id, actor(owner));
            if (!['QUEUED', 'RUNNING'].includes(current.job.status)) {
                expect(current.job.status).toBe('COMPLETE');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Recommendation job did not finish before teardown');
    });

    it('retains the native linked Rules destination for assignment managers with no slots', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Empty linked schedule');
        const {id, slot} = await fixture(eventId);
        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS);
        await eventService.register(eventId, '2027-06-01', '2027-06-03', other.id);
        await activity.removeActivitySlot(id, slot.id, actor(owner));
        const empty = (await activity.readActivityPlan(id, actor(other))).data;
        expect(empty.slots).toEqual([]);
        expect(empty.capabilities.rulesWorkspace).toBe(true);

        const standalone = await fixture();
        expect((await activity.readActivityPlan(standalone.id, actor(owner))).data.capabilities.rulesWorkspace).toBe(false);
        const itemOnly = await fixture(eventId);
        await adminService.addAdmin('activitySlot', itemOnly.slot.id, other.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await activity.readActivityPlan(itemOnly.id, actor(other))).data.capabilities.rulesWorkspace).toBe(false);
    });

    it('pauses/resumes only standalone schedules through the existing lifecycle owner', async () => {
        const {id} = await fixture();
        expect(await activity.readActivitySettings(id, actor(owner))).toMatchObject({capabilities: {manageAutomation: true}, archive: {hasAutomaticSchedule: true}});
        await activity.setActivityAutomaticArchival(id, {paused: true}, actor(owner));
        expect(await activityService.getActivityPlanById(id)).toMatchObject({autoArchivePaused: true, archivedAt: null});
        await activity.setActivityAutomaticArchival(id, {paused: false}, actor(owner));
        expect(await activityService.getActivityPlanById(id)).toMatchObject({autoArchivePaused: false, archivedAt: null});
        await expect(activity.setActivityAutomaticArchival(id, {paused: true}, actor(other))).rejects.toMatchObject({status: 403});
        const eventId = await createIntegrationEvent(owner.id, 'Parent scheduled activity');
        const linked = await fixture(eventId);
        expect(await activity.readActivitySettings(linked.id, actor(owner))).toMatchObject({capabilities: {manageAutomation: false}, archive: {hasAutomaticSchedule: false}});
        await expect(activity.setActivityAutomaticArchival(linked.id, {paused: true}, actor(owner))).rejects.toMatchObject({status: 409});
        expect((await activityService.getActivityPlanById(linked.id))?.autoArchivePaused).toBe(false);
    });

    it('projects fresh export authority and retains a date-only settings editor', async () => {
        const {id} = await fixture();
        expect((await activity.readActivitySettings(id, actor(owner))).capabilities.export).toBe(true);
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_META);
        const dateOnly = await activity.readActivitySettings(id, actor(other));
        expect(dateOnly.editableFields).toEqual(['startDate', 'endDate']);
        expect(dateOnly.capabilities.export).toBe(false);
        await adminService.updateAdminPerms('activity', id, other.id, PERM.EDIT_META | PERM.DATA_EXPORT);
        expect((await activity.readActivitySettings(id, actor(other))).capabilities.export).toBe(true);
    });

    it('projects native role-creation browser admission independently of the unchanged server method', async () => {
        const {id} = await fixture();
        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await activity.readActivityPlan(id, actor(other))).data.capabilities.roleCreationAdmission).toBe(false);
        // This direct method retains the existing server grant; the browser has
        // its separate presentation admission, as on the unchanged native page.
        await activity.createActivityRole(id, {name: 'Server-admitted role'}, actor(other));
        await adminService.updateAdminPerms('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS | PERM.EDIT_META);
        expect((await activity.readActivityPlan(id, actor(other))).data.capabilities.roleCreationAdmission).toBe(true);
    });

    it('keeps inline title/capacity admission separate from visible fields and the broader modal fallback', async () => {
        const {id} = await fixture();
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY | PERM.ITEM_EDIT_META);
        const visible = (await activity.readActivityPlan(id, actor(other))).data.slots[0];
        expect(visible.capabilities).toMatchObject({editMeta: true, inlineMetadataAdmission: false});
        await adminService.updateAdminPerms('activity', id, other.id, PERM.ITEM_EDIT);
        expect((await activity.readActivityPlan(id, actor(other))).data.slots[0].capabilities.inlineMetadataAdmission).toBe(true);
    });

    it('creates native root/slot content, sharing and a fresh duplicate without assignments or history', async () => {
        const input = creation();
        const {id} = await activity.createActivityPlan(input, undefined, actor(owner));
        const view = (await activity.readActivityPlan(id, actor(owner))).data;
        expect(view).toMatchObject({title: input.title, description: input.description, startDate: input.startDate, endDate: input.endDate});
        expect(view.slots).toMatchObject([{title: 'Kitchen', day: '2027-06-02', position: 0, assignedCount: 0}]);
        expect(view.slots[0].id).not.toBe(input.slots[0].id);
        expect(await adminService.getDefaultPerms('activity', id)).toEqual(input.defaultPermissions);
        expect(contractValidator('ActivityView')(view)).toBe(true);
        await activity.setActivityAssignment(id, view.slots[0].id, {assigned: true}, actor(participant));
        const duplicate = await activity.readActivityDuplicate(id, actor(owner));
        expect(duplicate).toMatchObject({title: input.title, description: input.description, startDate: input.startDate, endDate: input.endDate, eventId: null});
        expect(duplicate.slots[0].id).not.toBe(view.slots[0].id);
        expect(duplicate).not.toHaveProperty('assignments');
        expect(duplicate).not.toHaveProperty('headerUrl');
        expect(contractValidator('ActivityDuplicate')(duplicate)).toBe(true);

        // Existing native slot edits permit values that cannot create a new
        // slot. Duplication must display those values for deliberate correction.
        const baseline = await activity.readActivitySlotBaseline(id, view.slots[0].id, actor(owner));
        await activity.patchActivitySlot(id, view.slots[0].id, {title: '', maxAssignees: -2}, actor(owner), baseline.editToken);
        expect(await activityService.getActivitySlotById(view.slots[0].id)).toMatchObject({title: '', maxAssignees: -2});
        const editable = await activity.readActivityDuplicate(id, actor(owner));
        expect(editable.slots[0]).toMatchObject({title: '', maxAssignees: -2});
        expect(contractValidator('ActivityDuplicate')(editable)).toBe(true);
        const copiedInput: components['schemas']['ActivityCreateInput'] = {title: editable.title, description: editable.description ?? '',
            startDate: editable.startDate, endDate: editable.endDate, eventId: editable.eventId,
            slots: editable.slots, defaultPermissions: editable.defaultPermissions};
        expect(contractValidator('ActivityCreateInput')(copiedInput)).toBe(false);
        const beforeCorrection = await AppDataSource.getRepository(ActivityPlan).count();
        await expect(activity.createActivityPlan(copiedInput, undefined, actor(owner))).rejects.toMatchObject({name: 'ValidationError'});
        expect(await AppDataSource.getRepository(ActivityPlan).count()).toBe(beforeCorrection);

        // Correcting the local copy restores normal creation; the original
        // persisted slot stays untouched until an explicit edit of that plan.
        copiedInput.slots = copiedInput.slots.map(slot => ({...slot, title: 'Corrected kitchen', maxAssignees: 1}));
        expect(contractValidator('ActivityCreateInput')(copiedInput)).toBe(true);
        const corrected = await activity.createActivityPlan(copiedInput, undefined, actor(owner));
        expect((await activityService.getActivitySlotsFlat(corrected.id))[0]).toMatchObject({title: 'Corrected kitchen', maxAssignees: 1});

        // Nullable and legacy zero capacities use the native browser's truthy
        // fallback. Real DBAL writes model both stored representations.
        for (const capacity of [null, 0]) {
            await activityService.updateActivitySlot(view.slots[0].id, {maxAssignees: capacity});
            const defaulted = await activity.readActivityDuplicate(id, actor(owner));
            expect(defaulted.slots[0]).toMatchObject({title: '', maxAssignees: 1});
            expect(contractValidator('ActivityDuplicate')(defaulted)).toBe(true);
        }
    });

    it('rejects unauthorized creation/event attachment and rolls back a failed precommit response', async () => {
        const before = await AppDataSource.getRepository(ActivityPlan).count();
        await expect(activity.createActivityPlan(creation(), undefined, {})).rejects.toMatchObject({status: 401});
        const forbidden = await createIntegrationEvent(other.id, 'Unrelated event');
        await expect(activity.createActivityPlan(creation(forbidden), undefined, actor(owner))).rejects.toMatchObject({status: 403});
        await expect(activity.createActivityPlan(creation(), undefined, actor(owner), () => {
            throw new Error('Cannot prepare the declared creation response');
        })).rejects.toThrow('Cannot prepare the declared creation response');
        expect(await AppDataSource.getRepository(ActivityPlan).count()).toBe(before);
    });

    it('omits participant names, attendance and removable handles without the corresponding grant', async () => {
        const {id, slot} = await fixture();
        await activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await activity.createActivityRole(id, {name: 'Coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Coordinator')!;
        await nativeActivity.addSlotRole(slot.id, {roles: [role.id]});
        await activity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));

        const hidden = (await activity.readActivityPlan(id, actor(other))).data;
        expect(hidden.participants).toEqual([]);
        expect(hidden.counters.participants).toBeNull();
        expect(hidden.slots[0].assignees).toEqual([]);
        expect(hidden.slots[0].roles[0]).toMatchObject({assignmentId: null, assigneeName: null});
        expect(JSON.stringify(hidden)).not.toContain(participant.name);
        expect(JSON.stringify(hidden)).not.toContain(participant.id);

        const visible = (await activity.readActivityPlan(id, actor(owner))).data;
        expect(visible.participants).toContainEqual(expect.objectContaining({name: participant.name, assignedShifts: 1}));
        expect(visible.slots[0].roles[0].assigneeName).toBe(participant.name);
        expect(contractValidator('ActivityView')(visible)).toBe(true);
    });

    it('keeps page admission separate from method-only metadata and slot descriptions with stale-write rejection', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Restricted camp');
        const {id, slot} = await fixture(eventId);
        await adminService.updatePerms('activity', id, {public: 0, authenticated: 0, guest: 0, participant: 0});
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_DESC | PERM.ITEM_EDIT_DESC);
        await expect(activity.readActivityPlan(id, actor(other))).rejects.toMatchObject({status: 403});
        const metadata = await activity.readActivityMetadata(id, actor(other));
        expect(metadata.data.values).toEqual({description: creation().description});
        await activity.patchActivityMetadata(id, {description: 'Delegated root instructions'}, actor(other), metadata.etag);
        await expect(activity.patchActivityMetadata(id, {description: 'Stale root instructions'}, actor(other), metadata.etag)).rejects.toMatchObject({status: 412});

        const baseline = await activity.readActivitySlotBaseline(id, slot.id, actor(other));
        expect(baseline.values).toEqual({description: 'Clean the kitchen'});
        await activity.patchActivitySlot(id, slot.id, {description: 'Delegated kitchen instructions'}, actor(other), baseline.editToken);
        await expect(activity.patchActivitySlot(id, slot.id, {description: 'Stale kitchen instructions'}, actor(other), baseline.editToken)).rejects.toMatchObject({status: 412});
        await expect(activity.patchActivitySlot(id, slot.id, {title: 'Forbidden title'}, actor(other), baseline.editToken)).rejects.toMatchObject({status: 403});
        expect(await activityService.getActivitySlotById(slot.id)).toMatchObject({title: 'Kitchen', description: 'Delegated kitchen instructions'});
    });

    it('binds public field baselines to the captured context without disclosing the full linked plan', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Public editors');
        const {id, slot} = await fixture(eventId);
        await adminService.updatePerms('activity', id, {public: 0, authenticated: 0, guest: 0, participant: 0});
        await adminService.updatePerms('activitySlot', slot.id, {public: PERM.EDIT_DESC});
        const first: ApiActor = {context: 'activity-public-a'};
        const second: ApiActor = {context: 'activity-public-b'};
        const baseline = await activity.readActivitySlotBaseline(id, slot.id, first);
        expect(baseline.values).toEqual({description: 'Clean the kitchen'});
        await expect(activity.readActivityPlan(id, first)).rejects.toMatchObject({status: 401});
        await expect(activity.patchActivitySlot(id, slot.id, {description: 'Wrong actor'}, second, baseline.editToken)).rejects.toMatchObject({status: 412});
        await activity.patchActivitySlot(id, slot.id, {description: 'Public edit'}, first, baseline.editToken);
        expect((await activityService.getActivitySlotById(slot.id))?.description).toBe('Public edit');
    });

    it('preserves named-role versus whole-slot membership and independent role quotas', async () => {
        const {id, slot} = await fixture();
        await activity.createActivityRole(id, {name: 'Coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Coordinator')!;
        await nativeActivity.addSlotRole(slot.id, {roles: [role.id]});
        await activity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await expect(activity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(other))).rejects.toMatchObject({status: 409});
        // Releasing a sole named role ends membership. An ordinary signup plus a
        // named role retains the signup when only that named role is released.
        await activity.setActivityAssignment(id, slot.id, {assigned: false, role: 'Coordinator'}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
        await activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await activity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await activity.setActivityAssignment(id, slot.id, {assigned: false, role: 'Coordinator'}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([slot.id]);
        await activity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await activity.setActivityAssignment(id, slot.id, {assigned: false}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
    });

    it('keeps external signup, capacity, overfill and deadline decisions with existing server owners', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant camp');
        const {id, slot} = await fixture(eventId);
        await expect(activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant))).rejects.toMatchObject({status: 403});
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        await activityService.updateActivitySlot(slot.id, {maxAssignees: 1});
        await activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await AppDataSource.getRepository(ActivityPlan).update(id, {allowExternalAssignees: true});
        await expect(activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(other))).rejects.toMatchObject({status: 409});
        await AppDataSource.getRepository(ActivityPlan).update(id, {allowOverfillAfterFull: true});
        expect((await activity.previewActivityAssignment(id, slot.id, {}, actor(other))).warnings).toContainEqual({type: 'over_capacity'});
        await activity.setActivityAssignment(id, slot.id, {assigned: true}, actor(other));
        expect((await activity.readActivityPlan(id, actor(owner))).data.slots[0].assignedCount).toBe(2);
        await AppDataSource.getRepository(ActivityPlan).update(id, {bindingDeadline: new Date('2020-01-01T00:00:00Z')});
        await expect(activity.setActivityAssignment(id, slot.id, {assigned: false}, actor(participant))).rejects.toMatchObject({status: 403});
    });

    it('requires a fresh exact warning review after a sibling commitment changes and hides private sibling details', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Interlinked camp');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const first = await fixture(eventId);
        const second = await fixture(eventId);
        await activity.setActivityAssignment(second.id, second.slot.id, {assigned: true}, actor(participant));
        await adminService.updatePerms('activity', second.id, {public: 0, participant: 0, authenticated: 0, guest: 0});
        const preview = await activity.previewActivityAssignment(first.id, first.slot.id, {}, actor(participant));
        expect(preview.warnings).toContainEqual(expect.objectContaining({type: 'overlap', overlapDetails: [], conflicts: []}));
        expect(preview.overlapConfirmation).toBeTruthy();
        expect(JSON.stringify(preview)).not.toContain(second.id);
        expect(JSON.stringify(preview)).not.toContain(second.slot.id);
        await activityService.updateActivitySlot(second.slot.id, {startTime: '09:15', endTime: '10:00'});
        await expect(activity.setActivityAssignment(first.id, first.slot.id, {assigned: true, overlapConfirmation: preview.overlapConfirmation}, actor(participant))).rejects.toMatchObject({status: 409});
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([]);
        const fresh = await activity.previewActivityAssignment(first.id, first.slot.id, {}, actor(participant));
        await activity.setActivityAssignment(first.id, first.slot.id, {assigned: true, overlapConfirmation: fresh.overlapConfirmation}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([first.slot.id]);
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('keeps shared text grants, sparse audience edits and ordering comparisons separate from local filters', async () => {
        const {id, slot} = await fixture();
        await activity.createActivityTextField(id, {title: 'Instructions', text: 'Bring water'}, actor(owner));
        const field = (await activity.readActivityPlan(id, actor(participant))).data.textFields[0];
        await expect(activity.patchActivityTextField(id, field.id, {title: 'Forbidden title', text: 'New text'}, actor(participant), field.editToken)).rejects.toMatchObject({status: 403});
        await activity.patchActivityTextField(id, field.id, {text: 'Bring snacks'}, actor(participant), field.editToken);
        await expect(activity.patchActivityTextField(id, field.id, {text: 'Old draft'}, actor(participant), field.editToken)).rejects.toMatchObject({status: 412});
        const defaults = await activity.readActivityDefaultsBaseline(id, actor(owner));
        await activity.setActivityDefaults(id, {guest: PERM.ACCESS_VIEW}, actor(owner), defaults.editToken);
        expect(await adminService.getDefaultPerms('activity', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: PERM.ACCESS_VIEW});
        await expect(activity.setActivityDefaults(id, {guest: 0}, actor(owner), defaults.editToken)).rejects.toMatchObject({status: 412});

        const order = await activity.readActivityOrderBaseline(id, actor(owner));
        await activity.setActivityOrder(id, {order: [{slotId: slot.id, position: 10}]}, actor(owner), order.editToken);
        await expect(activity.setActivityOrder(id, {order: [{slotId: slot.id, position: 20}]}, actor(owner), order.editToken)).rejects.toMatchObject({status: 412});
        expect((await activityService.getActivitySlotById(slot.id))?.pos).toBe(10);
    });

    it('rejects cross-plan slot/text/assignment identifiers and preserves printable schedule ownership', async () => {
        const first = await fixture();
        const second = await fixture();
        await expect(activity.removeActivitySlot(first.id, second.slot.id, actor(owner))).rejects.toMatchObject({status: 404});
        await activity.createActivityTextField(second.id, {title: 'Private notes', text: 'Second plan'}, actor(owner));
        const field = (await activityService.getActivityPlanTextFields(second.id))[0];
        await expect(activity.removeActivityTextField(first.id, field.id, actor(owner))).rejects.toMatchObject({status: 404});
        await activity.setActivityAssignment(second.id, second.slot.id, {assigned: true}, actor(participant));
        const assignment = (await activityService.getActivitySlotAssignees(second.id))[second.slot.id][0];
        await expect(activity.removeActivityAssignment(first.id, String(assignment.id), actor(owner))).rejects.toMatchObject({status: 404});
        const exported = await nativeActivity.getScheduleExport((await activityService.getActivityPlanById(second.id))!);
        expect(exported.weeks.flatMap(week => week.days.flatMap(day => day.slots))).toContainEqual(expect.objectContaining({id: second.slot.id}));
        expect(exported.textFields).toContainEqual(expect.objectContaining({id: field.id, text: 'Second plan'}));
    });
});
