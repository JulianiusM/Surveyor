import {getRecommendations} from '../../src/backend/modules/activity/recommendations';
import {invalidateEventContext, projectActivityAssignees} from '../../src/backend/modules/activity/autoAssignment';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import type {Request} from 'express';
import * as nativeActivity from '../../src/backend/controller/activityController';

import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {ActivityPlan} from '../../src/backend/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/backend/modules/database/entities/activity/ActivitySlot';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as recommendationService from '../../src/backend/modules/database/services/ActivityRecommendationService';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {prepareValidatedJsonVariants} from '../../src/backend/modules/api/transport';
import {handleApiProblem} from '../../src/backend/modules/api/problem';
import activityRouter from '../../src/backend/routes/api/v1/activity';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {CascadeActivityRoleDependents1792886400000} from '../../src/backend/migrations/1792886400000-CascadeActivityRoleDependents';
import {UpdateCheckSlotRoleTrigger1785689525000} from '../../src/backend/migrations/1785689525000-UpdateCheckSlotRoleTrigger';
import {ActivitySlotRole} from '../../src/backend/modules/database/entities/activity/ActivitySlotRole';
import {PERM} from '../../src/backend/modules/lib/permissions';
import type {components} from '../../src/types/api/v1';
import type {ApiActor} from '../../src/types/ApiTypes';
import type {PreparedApiJsonResponse} from '../../src/types/ApiTransportTypes';
import type {RecommendationGenerationOutcome} from '../../src/types/ActivityTypes';
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
    const {id} = await nativeActivity.createActivityPlan(creation(eventId), undefined, actor(owner));
    const slot = (await activityService.getActivitySlotsFlat(id))[0];
    return {id, slot};
}

beforeAll(async function prepareDatabase() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Activity organizer'});
    participant = await persistIntegrationProfile({name: 'Duty participant'});
    other = await persistIntegrationProfile({name: 'Other participant'});
}, 300_000);
afterAll(closeIntegrationDatabase);

describe('versioned Activity production operations', () => {
    it('writes defaults from uppercase full settings while retaining stale and revoked-permission rejection', async () => {
        const {id} = await fixture();
        const upper = id.toUpperCase();
        const session = actor(owner);
        const full = await nativeActivity.readActivitySettings(upper, session);
        expect(full.settingsToken).toBe((await nativeActivity.readActivitySettings(id, session)).settingsToken);
        const narrow = await nativeActivity.readActivityDefaultsBaseline(id, session);
        expect((await nativeActivity.readActivityDefaultsBaseline(upper, session)).editToken).toBe(narrow.editToken);
        expect(narrow.defaultPermissions).toEqual(full.access!.defaults);

        await nativeActivity.setActivityDefaults(upper, {guest: PERM.ACCESS_VIEW}, session, full.settingsToken);
        expect(await adminService.getDefaultPerms('activity', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: PERM.ACCESS_VIEW});
        await expect(nativeActivity.setActivityDefaults(id, {guest: 0}, session, full.settingsToken)).rejects.toMatchObject({status: 412});
        const latest = await nativeActivity.readActivitySettings(upper, session);
        await expect(nativeActivity.setActivityDefaults(upper, {guest: 0}, session, latest.settingsToken.toUpperCase())).rejects.toMatchObject({status: 412});
        await expect(nativeActivity.setActivityDefaults(upper, {guest: 0}, actor(other), latest.settingsToken)).rejects.toMatchObject({status: 403});

        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_PERMISSIONS);
        const delegated = await nativeActivity.readActivitySettings(upper, actor(other));
        await adminService.updateAdminPerms('activity', id, other.id, 0);
        await expect(nativeActivity.setActivityDefaults(id, {guest: 0}, actor(other), delegated.settingsToken)).rejects.toMatchObject({status: 403});
        expect((await adminService.getDefaultPerms('activity', id)).guest).toBe(PERM.ACCESS_VIEW);
    });

    it('uses uppercase full-settings new-admin and row tokens across UUID aliases without weakening grant revisions', async () => {
        const {id} = await fixture();
        const upper = id.toUpperCase();
        const target = await persistIntegrationProfile({name: 'Activity full-settings administrator target'});
        const session = actor(owner);
        const full = await nativeActivity.readActivitySettings(upper, session);
        const absent = await nativeActivity.readActivityAdminBaseline(id, target.id, session);
        expect(absent.mask).toBeNull();
        expect((await nativeActivity.readActivityAdminBaseline(upper, target.id.toUpperCase(), session)).editToken).toBe(absent.editToken);

        await nativeActivity.setActivityAdmin(upper, target.id.toUpperCase(), PERM.ACCESS_VIEW, session, full.settingsToken);
        expect((await adminService.getAdminGrant('activity', id, target.id))?.perms).toBe(PERM.ACCESS_VIEW);
        await expect(nativeActivity.setActivityAdmin(id, target.id, 0, session, full.settingsToken)).rejects.toMatchObject({status: 412});
        const granted = await nativeActivity.readActivitySettings(upper, session);
        const row = granted.access!.admins.find(candidate => candidate.profileId === target.id)!;
        const narrow = await nativeActivity.readActivityAdminBaseline(id, target.id.toUpperCase(), session);
        expect(row.editToken).toBe(narrow.editToken);
        await nativeActivity.setActivityAdmin(id, target.id.toUpperCase(), PERM.EDIT_DESC, session, row.editToken);
        await expect(nativeActivity.setActivityAdmin(upper, target.id, 0, session, row.editToken)).rejects.toMatchObject({status: 412});
        const current = await nativeActivity.readActivitySettings(id, session);
        const currentRow = current.access!.admins.find(candidate => candidate.profileId === target.id)!;
        await expect(nativeActivity.setActivityAdmin(upper, target.id, 0, actor(other), currentRow.editToken)).rejects.toMatchObject({status: 403});
        await nativeActivity.setActivityAdmin(upper, target.id.toUpperCase(), 0, session, currentRow.editToken);
        expect((await nativeActivity.readActivityAdminBaseline(id, target.id, session)).mask).toBe(0);

        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_PERMISSIONS);
        const delegated = await nativeActivity.readActivitySettings(upper, actor(other));
        const delegatedRow = delegated.access!.admins.find(candidate => candidate.profileId === target.id)!;
        await adminService.updateAdminPerms('activity', id, other.id, 0);
        await expect(nativeActivity.setActivityAdmin(id, target.id.toUpperCase(), PERM.ACCESS_VIEW, actor(other), delegatedRow.editToken)).rejects.toMatchObject({status: 403});
        expect((await adminService.getAdminGrant('activity', id, target.id))?.perms).toBe(0);
    });

    it('keeps UUID aliases coherent with canonical storage for roles, self membership, baselines and organizer removal', async () => {
        const {id, slot} = await fixture();
        const member = await persistIntegrationProfile({name: 'Mixed identity participant'});
        await AppDataSource.getRepository(ActivityPlan).update(id, {id: id.toUpperCase()});
        await AppDataSource.getRepository(ActivitySlot).update(slot.id, {id: slot.id.toUpperCase()});
        await AppDataSource.getRepository(Profile).update(member.id, {id: member.id.toUpperCase()});
        // Native UUID columns may normalize persisted spellings. Actual returned
        // references must agree exactly, while commands still use uppercase aliases.
        const storedMember = await AppDataSource.getRepository(Profile).findOneByOrFail({id: member.id});
        await nativeActivity.createActivityRole(id, {name: 'Mixed identity coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Mixed identity coordinator')!;
        await activityService.addActivitySlotRoles(slot.id, [role.id]);
        const baseline = await nativeActivity.readActivitySlotBaseline(id, slot.id, actor(owner));
        const alias = await nativeActivity.readActivitySlotBaseline(id.toUpperCase(), slot.id.toUpperCase(), actor(owner));
        expect(alias.values.roles).toEqual([String(role.id)]);
        expect(alias.editToken).toBe(baseline.editToken);
        await nativeActivity.patchActivitySlot(id.toUpperCase(), slot.id, {description: 'Shared identity edit'}, actor(owner), baseline.editToken);
        await expect(nativeActivity.patchActivitySlot(id, slot.id.toUpperCase(), {description: 'Stale edit'}, actor(owner), baseline.editToken)).rejects.toMatchObject({status: 412});
        await nativeActivity.setActivityAssignment(id, slot.id.toUpperCase(), {assigned: true, role: role.title}, actor(member));
        const roleMap = await activityService.getParticipantRolesForPlan(id);
        expect(roleMap).toContainEqual({participantKey: 'profile:' + member.id, roleIds: [role.id]});
        const view = (await nativeActivity.readActivityPlan(id.toUpperCase(), actor(member))).data;
        expect(view.slots[0]).toMatchObject({selfAssigned: true, roles: [expect.objectContaining({id: String(role.id), self: true})]});
        await recommendationService.saveRecommendations(id, [{itemId: slot.id.toUpperCase(), profileId: member.id.toUpperCase(),
            status: 'PENDING', operation: 'ASSIGN', manual: false}]);
        const review = await nativeActivity.readActivityRecommendations(id.toUpperCase(), actor(owner));
        const option = review.participantOptions.find(candidate => candidate.profileId === storedMember.id)!;
        const committed = review.existingAssignments.find(candidate => candidate.profile.id === storedMember.id)!;
        expect(option.profileId).toBe(committed.profile.id);
        expect(review.recommendations[0].profile.id).toBe(option.profileId);
        expect(review.recommendations[0].item.id).toBe(committed.item.id);
        await nativeActivity.setActivityAssignment(id.toUpperCase(), slot.id, {assigned: false, role: role.title}, actor(member));
        expect(await activityService.getActivitySlotAssignments(id, member.id)).toEqual([]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(member));
        await nativeActivity.setActivityAssignment(id, slot.id.toUpperCase(), {assigned: false}, actor(member));
        expect(await activityService.getActivitySlotAssignments(id, member.id)).toEqual([]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(member));
        const assignment = (await activityService.getActivitySlotAssigneeRows(id))[0];
        await nativeActivity.removeActivityAssignment(id.toUpperCase(), String(assignment.id), actor(owner));
        expect(await activityService.getActivitySlotAssignments(id, member.id)).toEqual([]);
        const foreign = await fixture();
        await expect(nativeActivity.readActivitySlotBaseline(foreign.id.toUpperCase(), slot.id, actor(owner))).rejects.toMatchObject({status: 404});
        await adminService.addAdmin('activity', id, other.id, PERM.ITEM_EDIT_DESC);
        const delegated = await nativeActivity.readActivitySlotBaseline(id.toUpperCase(), slot.id, actor(other));
        await adminService.updateAdminPerms('activity', id, other.id, 0);
        await expect(nativeActivity.patchActivitySlot(id, slot.id.toUpperCase(), {description: 'Revoked'}, actor(other), delegated.editToken)).rejects.toMatchObject({status: 403});
    });

    it('resolves UUID aliases in partial Activity orders while retaining duplicate positions and foreign rejection', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.createActivitySlot(id, {day: '2027-06-03', title: 'Second duty', description: '',
            startTime: null, endTime: null, maxAssignees: 2, roles: []}, actor(owner));
        const second = (await activityService.getActivitySlotsFlat(id)).find(candidate => candidate.id !== slot.id)!;
        const baseline = await nativeActivity.readActivityOrderBaseline(id, actor(owner));
        expect((await nativeActivity.readActivityOrderBaseline(id.toUpperCase(), actor(owner))).editToken).toBe(baseline.editToken);
        await nativeActivity.setActivityOrder(id.toUpperCase(), {order: [{slotId: slot.id.toUpperCase(), position: 7}]}, actor(owner), baseline.editToken);
        expect((await activityService.getActivitySlotById(second.id))?.pos).toBe(second.pos);
        for (const refs of [[slot.id, slot.id], [slot.id.toUpperCase(), slot.id]]) {
            const current = await nativeActivity.readActivityOrderBaseline(id, actor(owner));
            await nativeActivity.setActivityOrder(id.toUpperCase(), {order: refs.map(slotId => ({slotId, position: 9}))}, actor(owner), current.editToken);
            expect((await activityService.getActivitySlotById(slot.id))?.pos).toBe(9);
        }
        const foreign = await fixture();
        const current = await nativeActivity.readActivityOrderBaseline(id, actor(owner));
        await expect(nativeActivity.setActivityOrder(id.toUpperCase(), {order: [{slotId: foreign.slot.id.toUpperCase(), position: 0}]}, actor(owner), current.editToken)).rejects.toMatchObject({status: 404});
        expect((await activityService.getActivitySlotById(foreign.slot.id))?.pos).toBe(0);
        await expect(nativeActivity.setActivityOrder(id, {order: [{slotId: slot.id, position: 10}]}, actor(owner), baseline.editToken)).rejects.toMatchObject({status: 412});
    });

    it('retains selected role mappings and quotas while allowing every slot role to be removed', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.createActivityRole(id, {name: 'Retained coordinator'}, actor(owner));
        await nativeActivity.createActivityRole(id, {name: 'Removable helper'}, actor(owner));
        const roles = (await activityService.getAllRoles(id)).filter(role => role.title !== 'default');
        const selected = roles.map(role => role.id);
        await activityService.addActivitySlotRoles(slot.id, selected);
        const repository = AppDataSource.getRepository(ActivitySlotRole);
        const mappings = await repository.find({where: {item: {id: slot.id}}});
        // Make mapping identities observably different from role identities. A
        // comparison against mapping IDs must fail this real-controller journey.
        for (const mapping of mappings) await repository.update(mapping.id, {id: mapping.id + 1_000_000, maxQty: 3});
        const original = await repository.find({where: {item: {id: slot.id}}, order: {id: 'ASC'}});
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: roles[0].title}, actor(participant));
        const assignments = await activityService.getActivitySlotAssigneeRows(id);

        async function saveRoles(values: number[]): Promise<void> {
            const baseline = await nativeActivity.readActivitySlotBaseline(id, slot.id, actor(owner));
            await nativeActivity.patchActivitySlot(id, slot.id, {roles: values.map(String)}, actor(owner), baseline.editToken);
        }
        await saveRoles(selected);
        expect(await repository.find({where: {item: {id: slot.id}}, order: {id: 'ASC'}})).toEqual(original);
        await saveRoles([selected[0]]);
        expect(await repository.find({where: {item: {id: slot.id}}})).toEqual([original.find(row => row.roleId === selected[0])]);
        await saveRoles([]);
        expect(await repository.find({where: {item: {id: slot.id}}})).toEqual([]);
        expect((await nativeActivity.readActivitySlotBaseline(id, slot.id, actor(owner))).values.roles).toEqual([]);
        // Removal is idempotent and does not delete the plan's reusable roles.
        await saveRoles([]);
        expect((await activityService.getAllRoles(id)).filter(role => role.title !== 'default').map(role => role.id)).toEqual(selected);
        // Configured role links and existing assignment links have distinct
        // lifecycles; removing every quota must not cascade through signups.
        expect(await activityService.getActivitySlotAssigneeRows(id)).toEqual(assignments);
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([slot.id]);
        expect(await activityService.updateActivitySlot(randomUUID(), {})).toBe(false);
    });

    it('uses stored UUID text scope with the original comparison token and preserves foreign-field denial', async () => {
        const {id} = await fixture();
        await nativeActivity.createActivityTextField(id, {title: 'Mixed text identity', text: 'Before'}, actor(owner));
        const field = (await nativeActivity.readActivityPlan(id, actor(owner))).data.textFields[0];
        const foreign = await fixture();
        await expect(nativeActivity.patchActivityTextField(foreign.id.toUpperCase(), field.id.toUpperCase(), {text: 'Foreign'}, actor(owner), field.editToken)).rejects.toMatchObject({status: 404});
        await nativeActivity.patchActivityTextField(id.toUpperCase(), field.id.toUpperCase(), {text: 'After'}, actor(owner), field.editToken);
        expect((await activityService.getActivityPlanTextFieldById(field.id))?.text).toBe('After');
        await expect(nativeActivity.patchActivityTextField(id, field.id, {text: 'Stale'}, actor(owner), field.editToken)).rejects.toMatchObject({status: 412});
        await nativeActivity.removeActivityTextField(id.toUpperCase(), field.id.toUpperCase(), actor(owner));
        expect(await activityService.getActivityPlanTextFieldById(field.id)).toBeNull();
    });

    it('resolves registered UUID override aliases once and keeps numeric saved IDs and duplicate-target admission', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Mixed identity requirements');
        const member = await persistIntegrationProfile({name: 'Mixed requirement member'});
        await eventService.register(eventId, '2027-06-01', '2027-06-03', member.id);
        const {id} = await fixture(eventId);
        await AppDataSource.getRepository(Profile).update(member.id, {id: member.id.toUpperCase()});
        const input: components['schemas']['ActivityRequirementsInput'] = {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'FLOOR', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false, allowArrivalDayEvening: true,
            allowDepartureDayMorning: true, roleRequirements: [],
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 1}, {stayDays: 3, requiredShifts: 2}],
            overrides: [{profileId: member.id, roleId: null, requiredShifts: 0}],
        };
        await nativeActivity.saveActivityRequirements(id.toUpperCase(), input, actor(owner));
        const loaded = await nativeActivity.readActivityRequirements(id, actor(owner));
        expect(loaded.overrides[0]).toMatchObject({id: expect.stringMatching(/^[1-9]\d*$/u), profileId: member.id, requiredShifts: 0});
        expect(loaded.participants).toContainEqual(expect.objectContaining({participantKey: 'profile:' + member.id, requiredShifts: 0, source: 'override'}));
        await nativeActivity.saveActivityRequirements(id, {...input, overrides: [{...input.overrides[0], id: loaded.overrides[0].id,
                profileId: member.id.toUpperCase()}]}, actor(owner));
        await expect(nativeActivity.saveActivityRequirements(id, {...input, overrides: [input.overrides[0],
            {...input.overrides[0], profileId: member.id.toUpperCase()}]}, actor(owner))).rejects.toMatchObject({status: 400, cause: 'ACTIVITY_OVERRIDE_DUPLICATE'});
        await expect(nativeActivity.saveActivityRequirements(id, {...input, overrides: [{...input.overrides[0], profileId: other.id}]}, actor(owner))).rejects.toMatchObject({status: 400, cause: 'ACTIVITY_OVERRIDE_PARTICIPANT_REQUIRED'});
    });

    it('shares one admitted job across UUID aliases and invalidates the same record after real configuration reads', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'UUID job admission Event');
        const {id} = await fixture(eventId);
        const foreign = await fixture();
        await nativeActivity.updateRequirements(id, {assignmentMode: 'REQUIRED', bindingDeadline: '2020-01-01T00:00:00Z',
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 0}, {stayDays: 3, requiredShifts: 1}]});
        // Admission, permission and requirements reads use the real persistence
        // boundary. Hold only scheduled draining so invalidation is deterministic.
        vi.useFakeTimers({toFake: ['setImmediate']});
        try {
            const first = await nativeActivity.generateActivityRecommendations(id, actor(owner));
            const alias = await nativeActivity.generateActivityRecommendations(id.toUpperCase(), actor(owner));
            expect(alias).toMatchObject({coalesced: true, job: {id: first.job.id}});
            const observed = await nativeActivity.readActivityRecommendationJob(id.toUpperCase(), first.job.id.toUpperCase(), actor(owner));
            expect(observed.job.id).toBe(first.job.id);
            await expect(nativeActivity.readActivityRecommendationJob(foreign.id, first.job.id.toUpperCase(), actor(owner))).rejects.toMatchObject({status: 404});
            invalidateEventContext(id);
            expect(await nativeActivity.readActivityRecommendationJob(id.toUpperCase(), first.job.id, actor(owner))).toMatchObject({job: {status: 'STALE'}});
        } finally {
            invalidateEventContext(id);
            await vi.runAllTimersAsync();
            vi.useRealTimers();
        }
    });

    it('deletes an owned plan with assignments and shared text through the HTTP adapter', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await nativeActivity.createActivityTextField(id, {title: 'Instructions', text: 'Bring water'}, actor(owner));

        await expect(nativeActivity.deleteActivityPlan(id, actor(other))).rejects.toMatchObject({status: 403});
        expect(await activityService.getActivityPlanById(id)).not.toBeNull();

        const context = 'activity-delete-context-123456789012345';
        const csrf = 'activity-delete-csrf-123456789012345678';
        const app = express();
        app.use(express.json());
        app.use(session({secret: 'activity-delete-http-fixture', resave: false, saveUninitialized: false}));
        app.post('/seed', function seedOwner(req, res) {
            req.session.profile = owner;
            req.session.auth = {user: owner.user!};
            req.session.frontendContext = context;
            req.session.frontendCsrfToken = csrf;
            res.sendStatus(204);
        });
        app.use('/api/v1/activity-plans', activityRouter);
        app.use(handleApiProblem);
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing Activity HTTP listener');
            const origin = `http://127.0.0.1:${address.port}`;
            const seed = await fetch(`${origin}/seed`, {method: 'POST'});
            const cookie = seed.headers.get('set-cookie')?.split(';', 1)[0];
            expect(cookie).toBeTruthy();
            const response = await fetch(`${origin}/api/v1/activity-plans/${id}`, {method: 'DELETE', headers: {
                    Cookie: cookie!, 'X-Surveyor-Context': context, 'X-CSRF-Token': csrf,
                    'X-Surveyor-Api-Compatibility': apiCompatibility,
                }});
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({changed: true});
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        expect(await activityService.getActivityPlanById(id)).toBeNull();
        expect(await activityService.getActivitySlotsFlat(id)).toEqual([]);
        expect(await activityService.getActivityPlanTextFields(id)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
    });

    it('migrates role-dependent cascades reversibly while retaining saved rows', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Deletion migration event');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const {id, slot} = await fixture(eventId);
        await nativeActivity.createActivityRole(id, {name: 'Coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Coordinator')!;
        await activityService.addActivitySlotRoles(slot.id, [role.id]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await nativeActivity.saveActivityRequirements(id, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'FLOOR', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false, allowArrivalDayEvening: true,
            allowDepartureDayMorning: true, roleRequirements: [{roleId: String(role.id), requiredShifts: 1}],
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 1}, {stayDays: 3, requiredShifts: 2}],
            overrides: [{profileId: participant.id, roleId: String(role.id), requiredShifts: 0}],
        }, actor(owner));
        const tables = ['activity_assignment_roles', 'activity_slot_role', 'activity_plan_requirements', 'activity_plan_requirement_overrides'];
        const migration = new CascadeActivityRoleDependents1792886400000();
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            // The old constraint reproduces the HAR failure even though every
            // row also has a cascading assignment, slot or plan parent.
            const savedRows = [];
            for (const table of tables) {
                const rows = await runner.query(`SELECT * FROM \`${table}\` WHERE role_id = ?`, [role.id]);
                expect(rows).toHaveLength(1);
                savedRows.push(rows);
            }
            await migration.down(runner);
            await migration.down(runner);
            for (const table of tables) {
                expect((await runner.getTable(table))?.foreignKeys.find(key => key.columnNames[0] === 'role_id')?.onDelete).toBe('RESTRICT');
            }
            await expect(nativeActivity.deleteActivityPlan(id, actor(owner))).rejects.toMatchObject({driverError: {code: 'ER_ROW_IS_REFERENCED_2'}});

            await migration.up(runner);
            await migration.up(runner);
            for (const [index, table] of tables.entries()) {
                expect((await runner.getTable(table))?.foreignKeys.find(key => key.columnNames[0] === 'role_id')?.onDelete).toBe('CASCADE');
                expect(await runner.query(`SELECT * FROM \`${table}\` WHERE role_id = ?`, [role.id])).toEqual(savedRows[index]);
            }
            await nativeActivity.deleteActivityPlan(id, actor(owner));
            expect(await activityService.getActivityPlanById(id)).toBeNull();
            for (const table of tables) {
                expect(await runner.query(`SELECT * FROM \`${table}\` WHERE role_id = ?`, [role.id])).toEqual([]);
            }
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    }, 120_000);

    it('projects civil weeks without changing the saved dates, assignments or native view', async () => {
        const input = creation();
        input.startDate = '2027-03-27';
        input.endDate = '2027-03-30';
        input.slots[0].day = '2027-03-28';
        const {id} = await nativeActivity.createActivityPlan(input, undefined, actor(owner));
        const slot = (await activityService.getActivitySlotsFlat(id))[0];
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));

        const view = (await nativeActivity.readActivityPlan(id, actor(owner))).data;
        const validate = contractValidator('ActivityView');
        expect(validate(view), JSON.stringify(validate.errors)).toBe(true);
        expect(view.weeks).toEqual([
            {start: '2027-03-22', days: ['2027-03-27', '2027-03-28']},
            {start: '2027-03-29', days: ['2027-03-29', '2027-03-30']},
        ]);
        expect(view).toMatchObject({startDate: input.startDate, endDate: input.endDate});
        expect(view.slots[0]).toMatchObject({id: slot.id, day: '2027-03-28', assignedCount: 1});
        const stored = (await activityService.getActivityPlanById(id))!;
        expect(stored).toMatchObject({startDate: input.startDate, endDate: input.endDate});
        expect((await activityService.getActivitySlotsFlat(id))[0].day).toBe('2027-03-28');
        expect((await activityService.getActivitySlotAssigneeRows(id).then(projectActivityAssignees))[slot.id]).toHaveLength(1);
        const native = await nativeActivity.fetchForView(stored, {session: actor(owner)} as Request);
        expect(native.plan).toMatchObject({startDate: input.startDate, endDate: input.endDate});
        expect(native).not.toHaveProperty('weeks');
        expect(native.slots['2027-03-28'][0].id).toBe(slot.id);
    });

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
        await nativeActivity.saveActivityRequirements(id, input, actor(owner));
        const data = await nativeActivity.readActivityRequirements(id, actor(owner));
        const validateRequirements = contractValidator('ActivityRequirements');
        expect(validateRequirements(data), JSON.stringify(validateRequirements.errors)).toBe(true);
        expect(data.overrides).toEqual([{id: expect.stringMatching(/^[1-9]\d*$/u), profileId: participant.id, profileName: participant.name,
            roleId: null, requiredShifts: 0}]);
        expect(data.participants).toContainEqual(expect.objectContaining({requiredShifts: 0, source: 'override'}));
        expect(data.calculationContext.participants).toContainEqual(expect.objectContaining({profileId: participant.id}));
        expect(data.overrideTargets).toContainEqual(expect.objectContaining({profileId: participant.id,
            label: participant.name, nameIsFallback: false}));
        const nativeRequirements = await nativeActivity.getRequirements(id);
        expect(data.overrides[0].id).toBe(String(nativeRequirements.overrides[0].id));
        const nativeTarget = nativeRequirements.overrideTargets.find(target => target.profileId === participant.id);
        expect(nativeTarget).toMatchObject({label: participant.name});
        expect(nativeTarget).not.toHaveProperty('nameIsFallback');
        expect(JSON.stringify(data)).not.toContain('password');
        expect(data).not.toHaveProperty('owner');
        await expect(nativeActivity.readActivityRequirements(id, actor(other))).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS);
        await expect(nativeActivity.saveActivityRequirements(id, input, actor(other))).rejects.toMatchObject({status: 403});
        expect((await nativeActivity.readActivityPlan(id, actor(other))).data.capabilities.manageRecommendations).toBe(true);
    });

    it('identifies authored participant fallbacks without changing literal names or native payloads', async () => {
        // Ordinary user creation normalizes an empty name to its username.
        // Model the legacy stored-profile condition through real ORM persistence;
        // literal identical text must still retain its user-authored origin.
        const unnamed = await persistIntegrationProfile();
        await AppDataSource.getRepository(Profile).update(unnamed.id, {name: ''});
        const literalParticipant = await persistIntegrationProfile({name: 'Participant'});
        const literalProfile = await persistIntegrationProfile({name: 'Profile #' + unnamed.id});
        const {id, slot} = await fixture();
        await activityService.updateActivitySlot(slot.id, {maxAssignees: 3});
        for (const profile of [unnamed, literalParticipant, literalProfile])
            await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(profile));

        const view = (await nativeActivity.readActivityPlan(id, actor(owner))).data;
        const recommendations = await nativeActivity.readActivityRecommendations(id, actor(owner));
        const requirements = await nativeActivity.readActivityRequirements(id, actor(owner));
        expect(contractValidator('ActivityView')(view)).toBe(true);
        expect(contractValidator('ActivityRecommendations')(recommendations)).toBe(true);
        expect(contractValidator('ActivityRequirements')(requirements)).toBe(true);
        expect(view.participants).toContainEqual(expect.objectContaining({participantKey: 'profile:' + unnamed.id,
            name: 'Participant', nameIsFallback: true}));
        expect(recommendations.participantOptions).toContainEqual(expect.objectContaining({profileId: unnamed.id,
            label: 'Profile #' + unnamed.id, nameIsFallback: true}));
        for (const profile of [literalParticipant, literalProfile]) {
            expect(view.participants).toContainEqual(expect.objectContaining({participantKey: 'profile:' + profile.id,
                name: profile.name, nameIsFallback: false}));
            expect(recommendations.participantOptions).toContainEqual(expect.objectContaining({profileId: profile.id,
                label: profile.name, nameIsFallback: false}));
        }
        // Live coverage retains the raw value; its shared presentation helper
        // can localize an absent name without guessing from an English string.
        expect(requirements.participants).toContainEqual(expect.objectContaining({participantKey: 'profile:' + unnamed.id, name: ''}));
        expect(requirements.calculationContext.participants).toContainEqual(expect.objectContaining({profileId: unnamed.id, name: ''}));

        const plan = (await activityService.getActivityPlanById(id))!;
        const nativeView = await nativeActivity.fetchForView(plan, {session: actor(owner)} as Request);
        const nativeRecommendations = await getRecommendations(id, actor(owner));
        expect(nativeView.participantList).toContainEqual(expect.objectContaining({participantKey: 'profile:' + unnamed.id, name: 'Participant'}));
        expect(nativeRecommendations.participantOptions).toContainEqual(expect.objectContaining({profileId: unnamed.id, label: 'Profile #' + unnamed.id}));
        for (const row of [...nativeView.participantList, ...nativeRecommendations.participantOptions])
            expect(row).not.toHaveProperty('nameIsFallback');
        expect((await activityService.getActivitySlotAssigneeRows(id).then(projectActivityAssignees))[slot.id]).toHaveLength(3);
    });

    it('keeps recovery snapshots read-only while explicit entry retains native recommendation maintenance', async () => {
        const {id, slot} = await fixture();
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'PENDING', operation: 'ASSIGN', manual: false}]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));

        const snapshot = await nativeActivity.readActivityRecommendations(id, actor(owner));
        expect(contractValidator('ActivityRecommendations')(snapshot)).toBe(true);
        expect(snapshot.recommendations).toMatchObject([{item: {id: slot.id}, profile: {id: participant.id}, status: 'PENDING', manual: false}]);
        expect((await recommendationService.getRecommendations(id))[0].status).toBe('PENDING');
        expect(snapshot.autoGenerationJob).toBeNull();
        expect(snapshot.recommendations[0]).not.toHaveProperty('entity');
        expect(snapshot.recommendations[0].profile).toEqual({id: participant.id, name: participant.name});

        const entered = await nativeActivity.readActivityRecommendations(id, actor(owner), true);
        expect(entered.recommendations).toEqual([]);
        expect((await recommendationService.getRecommendations(id))[0].status).toBe('APPLIED');
        await expect(nativeActivity.readActivityRecommendations(id, actor(other))).rejects.toMatchObject({status: 403});
        await expect(nativeActivity.generateActivityRecommendations(id, actor(owner))).rejects.toMatchObject({status: 409});
    });

    it('retains generated provenance and applies only the submitted reviewed manual batch', async () => {
        const {id, slot} = await fixture();
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'PENDING', operation: 'ASSIGN', manual: false}]);
        const loaded = await nativeActivity.readActivityRecommendations(id, actor(owner));
        const generated = loaded.recommendations[0];
        const review: components['schemas']['ActivityRecommendationReview'] = {recommendations: [
                {id: generated.id, itemId: slot.id, profileId: participant.id, status: 'REJECTED', operation: 'ASSIGN', manual: true},
                {itemId: slot.id, profileId: other.id, status: 'APPROVED', operation: 'ASSIGN', manual: true},
            ]};
        const preview = await nativeActivity.previewActivityRecommendations(id, review, actor(owner));
        expect(contractValidator('ActivityRecommendationPreview')(preview)).toBe(true);
        const applied = await nativeActivity.applyActivityRecommendations(id, {...review, overlapConfirmation: preview.overlapConfirmation}, actor(owner));
        expect(contractValidator('ActivityRecommendationApplyResult')(applied)).toBe(true);
        expect(applied).toMatchObject({applied: 1, skipped: 0});
        expect((await recommendationService.getRecommendations(id)).find(row => row.profileId === participant.id)).toMatchObject({manual: false, status: 'REJECTED'});
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(id, other.id)).toEqual([slot.id]);
    });

    it('rolls back assignments and applied history when completion preparation fails', async () => {
        const {id, slot} = await fixture();
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'APPROVED', operation: 'ASSIGN', manual: true}]);
        const saved = (await recommendationService.getRecommendations(id))[0];
        const input = {recommendations: [{id: saved.id, itemId: slot.id, profileId: participant.id,
                status: 'APPROVED' as const, operation: 'ASSIGN' as const, manual: true}]};
        await expect(nativeActivity.applyActivityRecommendations(id, input, actor(owner), function rejectCompletion() {
            throw new Error('Synthetic response preparation failure');
        })).rejects.toThrow('Synthetic response preparation failure');
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
        expect((await recommendationService.getRecommendations(id))[0]).toMatchObject({id: saved.id, status: 'APPROVED'});
    });

    it('returns a prepared applied success when real follow-up generation persistence fails', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Generation failure camp');
        for (const profile of [participant, other]) await eventService.register(eventId, '2027-06-01', '2027-06-03', profile.id);
        const {id, slot} = await fixture(eventId);
        await nativeActivity.updateRequirements(id, {assignmentMode: 'REQUIRED', bindingDeadline: '2020-01-01T00:00:00Z',
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 0}, {stayDays: 3, requiredShifts: 1}]});
        await recommendationService.saveRecommendations(id, [{itemId: slot.id, profileId: participant.id,
            status: 'APPROVED', operation: 'ASSIGN', manual: true}]);
        const saved = (await recommendationService.getRecommendations(id))[0];
        // The disposable schema supplies a real persistence failure only for new
        // generated work. Approved review/application writes still use production DBAL.
        const trigger = 'trg_test_activity_followup_failure';
        await AppDataSource.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON activity_assignment_recommendations
            FOR EACH ROW BEGIN IF NEW.entity_id = '${id}' AND NEW.status = 'PENDING' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic generation persistence failure'; END IF; END`);
        let prepared: Readonly<Record<RecommendationGenerationOutcome, PreparedApiJsonResponse>> | undefined;
        const request = {headers: {}, apiActor: {context: 'activity-completion-fixture'}, get: () => undefined,
            acceptsLanguages: () => ['en']} as unknown as Request;
        try {
            const result = await nativeActivity.applyActivityRecommendations(id, {recommendations: [{id: saved.id,
                    itemId: slot.id, profileId: participant.id, status: 'APPROVED', operation: 'ASSIGN', manual: true}]}, actor(owner),
                function prepareApplication(variants) {
                    prepared = prepareValidatedJsonVariants(request, 'applyActivityRecommendations', 200, variants);
                });
            expect(result).toMatchObject({applied: 1, skipped: 0, generationOutcome: 'failed'});
            expect(JSON.parse(prepared!.failed.json)).toEqual(result);
            expect(prepared!.failed.status).toBe(200);
            expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([slot.id]);
            expect((await recommendationService.getRecommendations(id)).find(row => row.id === saved.id)?.status).toBe('APPLIED');
            expect(await activityService.getActivitySlotAssignments(id, other.id)).toEqual([]);
        } finally {
            await AppDataSource.query(`DROP TRIGGER IF EXISTS ${trigger}`);
        }
    });

    it('scopes job observation to its plan and keeps read-only snapshots from dispatching work', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Job transport camp');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const {id} = await fixture(eventId);
        const second = await fixture(eventId);
        await nativeActivity.updateRequirements(id, {assignmentMode: 'REQUIRED', bindingDeadline: '2020-01-01T00:00:00Z',
            stayRequirements: [{stayDays: 1, requiredShifts: 0}, {stayDays: 2, requiredShifts: 0}, {stayDays: 3, requiredShifts: 1}]});
        expect((await nativeActivity.readActivityRecommendations(id, actor(owner))).autoGenerationJob).toBeNull();
        const queued = await nativeActivity.generateActivityRecommendations(id, actor(owner));
        expect(contractValidator('ActivityRecommendationQueued')(queued)).toBe(true);
        const observed = await nativeActivity.readActivityRecommendationJob(id, queued.job.id, actor(owner));
        expect(observed.job.id).toBe(queued.job.id);
        expect(contractValidator('ActivityRecommendationJobResult')(observed)).toBe(true);
        await expect(nativeActivity.readActivityRecommendationJob(second.id, queued.job.id, actor(owner))).rejects.toMatchObject({status: 404});
        await expect(nativeActivity.readActivityRecommendationJob(id, queued.job.id, actor(other))).rejects.toMatchObject({status: 403});
        // Wait for this fixture's existing worker before database teardown or another schema reset.
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const current = await nativeActivity.readActivityRecommendationJob(id, queued.job.id, actor(owner));
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
        await nativeActivity.removeActivitySlot(id, slot.id, actor(owner));
        const empty = (await nativeActivity.readActivityPlan(id, actor(other))).data;
        expect(empty.slots).toEqual([]);
        expect(empty.capabilities.rulesWorkspace).toBe(true);

        const standalone = await fixture();
        expect((await nativeActivity.readActivityPlan(standalone.id, actor(owner))).data.capabilities.rulesWorkspace).toBe(false);
        const itemOnly = await fixture(eventId);
        await adminService.addAdmin('activitySlot', itemOnly.slot.id, other.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await nativeActivity.readActivityPlan(itemOnly.id, actor(other))).data.capabilities.rulesWorkspace).toBe(false);
    });

    it('pauses/resumes only standalone schedules through the existing lifecycle owner', async () => {
        const {id} = await fixture();
        expect(await nativeActivity.readActivitySettings(id, actor(owner))).toMatchObject({capabilities: {manageAutomation: true}, archive: {hasAutomaticSchedule: true}});
        await nativeActivity.setActivityAutomaticArchival(id, {paused: true}, actor(owner));
        expect(await activityService.getActivityPlanById(id)).toMatchObject({autoArchivePaused: true, archivedAt: null});
        await nativeActivity.setActivityAutomaticArchival(id, {paused: false}, actor(owner));
        expect(await activityService.getActivityPlanById(id)).toMatchObject({autoArchivePaused: false, archivedAt: null});
        await expect(nativeActivity.setActivityAutomaticArchival(id, {paused: true}, actor(other))).rejects.toMatchObject({status: 403});
        const eventId = await createIntegrationEvent(owner.id, 'Parent scheduled activity');
        const linked = await fixture(eventId);
        expect(await nativeActivity.readActivitySettings(linked.id, actor(owner))).toMatchObject({capabilities: {manageAutomation: false}, archive: {hasAutomaticSchedule: false}});
        await expect(nativeActivity.setActivityAutomaticArchival(linked.id, {paused: true}, actor(owner))).rejects.toMatchObject({status: 409});
        expect((await activityService.getActivityPlanById(linked.id))?.autoArchivePaused).toBe(false);
    });

    it('projects fresh export authority and retains a date-only settings editor', async () => {
        const {id} = await fixture();
        expect((await nativeActivity.readActivitySettings(id, actor(owner))).capabilities.export).toBe(true);
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_META);
        const dateOnly = await nativeActivity.readActivitySettings(id, actor(other));
        expect(dateOnly.editableFields).toEqual(['startDate', 'endDate']);
        expect(dateOnly.capabilities.export).toBe(false);
        await adminService.updateAdminPerms('activity', id, other.id, PERM.EDIT_META | PERM.DATA_EXPORT);
        expect((await nativeActivity.readActivitySettings(id, actor(other))).capabilities.export).toBe(true);
    });

    it('projects native role-creation browser admission independently of the unchanged server method', async () => {
        const {id} = await fixture();
        await adminService.addAdmin('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS);
        expect((await nativeActivity.readActivityPlan(id, actor(other))).data.capabilities.roleCreationAdmission).toBe(false);
        // This direct method retains the existing server grant; the browser has
        // its separate presentation admission, as on the unchanged native page.
        await nativeActivity.createActivityRole(id, {name: 'Server-admitted role'}, actor(other));
        await adminService.updateAdminPerms('activity', id, other.id, PERM.MANAGE_ASSIGNMENTS | PERM.EDIT_META);
        expect((await nativeActivity.readActivityPlan(id, actor(other))).data.capabilities.roleCreationAdmission).toBe(true);
    });

    it('keeps inline title/capacity admission separate from visible fields and the broader modal fallback', async () => {
        const {id} = await fixture();
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_TITLE | PERM.EDIT_CAPACITY | PERM.ITEM_EDIT_META);
        const visible = (await nativeActivity.readActivityPlan(id, actor(other))).data.slots[0];
        expect(visible.capabilities).toMatchObject({editMeta: true, inlineMetadataAdmission: false});
        await adminService.updateAdminPerms('activity', id, other.id, PERM.ITEM_EDIT);
        expect((await nativeActivity.readActivityPlan(id, actor(other))).data.slots[0].capabilities.inlineMetadataAdmission).toBe(true);
    });

    it('creates native root/slot content, sharing and a fresh duplicate without assignments or history', async () => {
        const input = creation();
        const {id} = await nativeActivity.createActivityPlan(input, undefined, actor(owner));
        const view = (await nativeActivity.readActivityPlan(id, actor(owner))).data;
        expect(view).toMatchObject({title: input.title, description: input.description, startDate: input.startDate, endDate: input.endDate});
        expect(view.slots).toMatchObject([{title: 'Kitchen', day: '2027-06-02', position: 0, assignedCount: 0}]);
        expect(view.slots[0].id).not.toBe(input.slots[0].id);
        expect(await adminService.getDefaultPerms('activity', id)).toEqual(input.defaultPermissions);
        expect(contractValidator('ActivityView')(view)).toBe(true);
        await nativeActivity.setActivityAssignment(id, view.slots[0].id, {assigned: true}, actor(participant));
        const duplicate = await nativeActivity.readActivityDuplicate(id, actor(owner));
        expect(duplicate).toMatchObject({title: input.title, description: input.description, startDate: input.startDate, endDate: input.endDate, eventId: null});
        expect(duplicate.slots[0].id).not.toBe(view.slots[0].id);
        expect(duplicate).not.toHaveProperty('assignments');
        expect(duplicate).not.toHaveProperty('headerUrl');
        expect(contractValidator('ActivityDuplicate')(duplicate)).toBe(true);

        // Existing native slot edits permit values that cannot create a new
        // slot. Duplication must display those values for deliberate correction.
        const baseline = await nativeActivity.readActivitySlotBaseline(id, view.slots[0].id, actor(owner));
        await nativeActivity.patchActivitySlot(id, view.slots[0].id, {title: '', maxAssignees: -2}, actor(owner), baseline.editToken);
        expect(await activityService.getActivitySlotById(view.slots[0].id)).toMatchObject({title: '', maxAssignees: -2});
        const editable = await nativeActivity.readActivityDuplicate(id, actor(owner));
        expect(editable.slots[0]).toMatchObject({title: '', maxAssignees: -2});
        expect(contractValidator('ActivityDuplicate')(editable)).toBe(true);
        const copiedInput: components['schemas']['ActivityCreateInput'] = {title: editable.title, description: editable.description ?? '',
            startDate: editable.startDate, endDate: editable.endDate, eventId: editable.eventId,
            slots: editable.slots, defaultPermissions: editable.defaultPermissions};
        expect(contractValidator('ActivityCreateInput')(copiedInput)).toBe(false);
        const beforeCorrection = await AppDataSource.getRepository(ActivityPlan).count();
        await expect(nativeActivity.createActivityPlan(copiedInput, undefined, actor(owner))).rejects.toMatchObject({name: 'ValidationError'});
        expect(await AppDataSource.getRepository(ActivityPlan).count()).toBe(beforeCorrection);

        // Correcting the local copy restores normal creation; the original
        // persisted slot stays untouched until an explicit edit of that plan.
        copiedInput.slots = copiedInput.slots.map(slot => ({...slot, title: 'Corrected kitchen', maxAssignees: 1}));
        expect(contractValidator('ActivityCreateInput')(copiedInput)).toBe(true);
        const corrected = await nativeActivity.createActivityPlan(copiedInput, undefined, actor(owner));
        expect((await activityService.getActivitySlotsFlat(corrected.id))[0]).toMatchObject({title: 'Corrected kitchen', maxAssignees: 1});

        // Nullable and legacy zero capacities use the native browser's truthy
        // fallback. Real DBAL writes model both stored representations.
        for (const capacity of [null, 0]) {
            await activityService.updateActivitySlot(view.slots[0].id, {maxAssignees: capacity});
            const defaulted = await nativeActivity.readActivityDuplicate(id, actor(owner));
            expect(defaulted.slots[0]).toMatchObject({title: '', maxAssignees: 1});
            expect(contractValidator('ActivityDuplicate')(defaulted)).toBe(true);
        }
    });

    it('rejects unauthorized creation/event attachment and rolls back a failed precommit response', async () => {
        const before = await AppDataSource.getRepository(ActivityPlan).count();
        await expect(nativeActivity.createActivityPlan(creation(), undefined, {})).rejects.toMatchObject({status: 401});
        const forbidden = await createIntegrationEvent(other.id, 'Unrelated event');
        await expect(nativeActivity.createActivityPlan(creation(forbidden), undefined, actor(owner))).rejects.toMatchObject({status: 403});
        await expect(nativeActivity.createActivityPlan(creation(), undefined, actor(owner), () => {
            throw new Error('Cannot prepare the declared creation response');
        })).rejects.toThrow('Cannot prepare the declared creation response');
        expect(await AppDataSource.getRepository(ActivityPlan).count()).toBe(before);
    });

    it('omits participant names, attendance and removable handles without the corresponding grant', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await nativeActivity.createActivityRole(id, {name: 'Coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Coordinator')!;
        await activityService.addActivitySlotRoles(slot.id, [role.id]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));

        const hidden = (await nativeActivity.readActivityPlan(id, actor(other))).data;
        expect(hidden.participants).toEqual([]);
        expect(hidden.counters.participants).toBeNull();
        expect(hidden.slots[0].assignees).toEqual([]);
        expect(hidden.slots[0].roles[0]).toMatchObject({assignmentId: null, assigneeName: null});
        expect(JSON.stringify(hidden)).not.toContain(participant.name);
        expect(JSON.stringify(hidden)).not.toContain(participant.id);

        const visible = (await nativeActivity.readActivityPlan(id, actor(owner))).data;
        expect(visible.participants).toContainEqual(expect.objectContaining({name: participant.name, assignedShifts: 1}));
        expect(visible.slots[0].roles[0].assigneeName).toBe(participant.name);
        expect(visible.slots[0].roles[0].id).toBe(String(role.id));
        expect(visible.allRoles.find(candidate => candidate.title === 'Coordinator')?.id).toBe(String(role.id));
        expect(visible.participants.find(person => person.name === participant.name)?.roleIds).toContain(String(role.id));
        const baseline = await nativeActivity.readActivitySlotBaseline(id, slot.id, actor(owner));
        expect(baseline.values.roles).toContain(String(role.id));
        expect(contractValidator('ActivityView')(visible)).toBe(true);
    });

    it('keeps page admission separate from method-only metadata and slot descriptions with stale-write rejection', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Restricted camp');
        const {id, slot} = await fixture(eventId);
        await adminService.updatePerms('activity', id, {public: 0, authenticated: 0, guest: 0, participant: 0});
        await adminService.addAdmin('activity', id, other.id, PERM.EDIT_DESC | PERM.ITEM_EDIT_DESC);
        await expect(nativeActivity.readActivityPlan(id, actor(other))).rejects.toMatchObject({status: 403});
        const metadata = await nativeActivity.readActivityMetadata(id, actor(other));
        expect(metadata.data.values).toEqual({description: creation().description});
        await nativeActivity.patchActivityMetadata(id, {description: 'Delegated root instructions'}, actor(other), metadata.etag);
        await expect(nativeActivity.patchActivityMetadata(id, {description: 'Stale root instructions'}, actor(other), metadata.etag)).rejects.toMatchObject({status: 412});

        const baseline = await nativeActivity.readActivitySlotBaseline(id, slot.id, actor(other));
        expect(baseline.values).toEqual({description: 'Clean the kitchen'});
        await nativeActivity.patchActivitySlot(id, slot.id, {description: 'Delegated kitchen instructions'}, actor(other), baseline.editToken);
        await expect(nativeActivity.patchActivitySlot(id, slot.id, {description: 'Stale kitchen instructions'}, actor(other), baseline.editToken)).rejects.toMatchObject({status: 412});
        await expect(nativeActivity.patchActivitySlot(id, slot.id, {title: 'Forbidden title'}, actor(other), baseline.editToken)).rejects.toMatchObject({status: 403});
        expect(await activityService.getActivitySlotById(slot.id)).toMatchObject({title: 'Kitchen', description: 'Delegated kitchen instructions'});
    });

    it('binds public field baselines to the captured context without disclosing the full linked plan', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Public editors');
        const {id, slot} = await fixture(eventId);
        await adminService.updatePerms('activity', id, {public: 0, authenticated: 0, guest: 0, participant: 0});
        await adminService.updatePerms('activitySlot', slot.id, {public: PERM.EDIT_DESC});
        const first: ApiActor = {context: 'activity-public-a'};
        const second: ApiActor = {context: 'activity-public-b'};
        const baseline = await nativeActivity.readActivitySlotBaseline(id, slot.id, first);
        expect(baseline.values).toEqual({description: 'Clean the kitchen'});
        await expect(nativeActivity.readActivityPlan(id, first)).rejects.toMatchObject({status: 401});
        await expect(nativeActivity.patchActivitySlot(id, slot.id, {description: 'Wrong actor'}, second, baseline.editToken)).rejects.toMatchObject({status: 412});
        await nativeActivity.patchActivitySlot(id, slot.id, {description: 'Public edit'}, first, baseline.editToken);
        expect((await activityService.getActivitySlotById(slot.id))?.description).toBe('Public edit');
    });

    it('preserves named-role versus whole-slot membership and independent role quotas', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.createActivityRole(id, {name: 'Coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Coordinator')!;
        await activityService.addActivitySlotRoles(slot.id, [role.id]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await expect(nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(other))).rejects.toMatchObject({status: 409});
        // Releasing a sole named role ends membership. An ordinary signup plus a
        // named role retains the signup when only that named role is released.
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: false, role: 'Coordinator'}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: false, role: 'Coordinator'}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([slot.id]);
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: 'Coordinator'}, actor(participant));
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: false}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(id, participant.id)).toEqual([]);
    });

    it('serializes competing named-role signups and retains the separate SQL integrity constraint', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.createActivityRole(id, {name: 'Single coordinator'}, actor(owner));
        const role = (await activityService.getAllRoles(id)).find(candidate => candidate.title === 'Single coordinator')!;
        await activityService.addActivitySlotRoles(slot.id, [role.id]);
        const results = await Promise.allSettled([participant, other].map(profile =>
            nativeActivity.setActivityAssignment(id, slot.id, {assigned: true, role: role.title}, actor(profile))));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({reason: {status: 409}});

        // Synchronization fixtures do not install migrations. Install the real
        // retained trigger explicitly to prove persistence still has its backstop.
        expect(await AppDataSource.query("SHOW TRIGGERS WHERE `Trigger` = 'trg_check_slot_role_limit'")).toEqual([]);
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            await new UpdateCheckSlotRoleTrigger1785689525000().up(runner);
            const loser = results[0].status === 'rejected' ? participant : other;
            await expect(activityService.withActivityTransaction(manager =>
                activityService.saveActivityAssignmentRole(manager, id, slot.id, loser.id, role.id)))
                .rejects.toThrow('Role capacity reached for this slot');
            expect(await activityService.getActivitySlotAssignments(id, loser.id)).toEqual([]);
        } finally {
            await runner.query('DROP TRIGGER IF EXISTS trg_check_slot_role_limit');
            await runner.release();
        }
    });

    it('keeps external signup, capacity, overfill and deadline decisions with existing server owners', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant camp');
        const {id, slot} = await fixture(eventId);
        await expect(nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant))).rejects.toMatchObject({status: 403});
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        await activityService.updateActivitySlot(slot.id, {maxAssignees: 1});
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(participant));
        await AppDataSource.getRepository(ActivityPlan).update(id, {allowExternalAssignees: true});
        await expect(nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(other))).rejects.toMatchObject({status: 409});
        await AppDataSource.getRepository(ActivityPlan).update(id, {allowOverfillAfterFull: true});
        expect((await nativeActivity.previewActivityAssignment(id, slot.id, {}, actor(other))).warnings).toContainEqual({type: 'over_capacity'});
        await nativeActivity.setActivityAssignment(id, slot.id, {assigned: true}, actor(other));
        expect((await nativeActivity.readActivityPlan(id, actor(owner))).data.slots[0].assignedCount).toBe(2);
        await AppDataSource.getRepository(ActivityPlan).update(id, {bindingDeadline: new Date('2020-01-01T00:00:00Z')});
        await expect(nativeActivity.setActivityAssignment(id, slot.id, {assigned: false}, actor(participant))).rejects.toMatchObject({status: 403});
    });

    it('requires a fresh exact warning review after a sibling commitment changes and hides private sibling details', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Interlinked camp');
        await eventService.register(eventId, '2027-06-01', '2027-06-03', participant.id);
        const first = await fixture(eventId);
        const second = await fixture(eventId);
        await nativeActivity.setActivityAssignment(second.id, second.slot.id, {assigned: true}, actor(participant));
        await adminService.updatePerms('activity', second.id, {public: 0, participant: 0, authenticated: 0, guest: 0});
        const preview = await nativeActivity.previewActivityAssignment(first.id, first.slot.id, {}, actor(participant));
        expect(preview.warnings).toContainEqual(expect.objectContaining({type: 'overlap', overlapDetails: [], conflicts: []}));
        expect(preview.overlapConfirmation).toBeTruthy();
        expect(JSON.stringify(preview)).not.toContain(second.id);
        expect(JSON.stringify(preview)).not.toContain(second.slot.id);
        await activityService.updateActivitySlot(second.slot.id, {startTime: '09:15', endTime: '10:00'});
        await expect(nativeActivity.setActivityAssignment(first.id, first.slot.id, {assigned: true, overlapConfirmation: preview.overlapConfirmation}, actor(participant))).rejects.toMatchObject({status: 409});
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([]);
        const fresh = await nativeActivity.previewActivityAssignment(first.id, first.slot.id, {}, actor(participant));
        await nativeActivity.setActivityAssignment(first.id, first.slot.id, {assigned: true, overlapConfirmation: fresh.overlapConfirmation}, actor(participant));
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([first.slot.id]);
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('keeps shared text grants, sparse audience edits and ordering comparisons separate from local filters', async () => {
        const {id, slot} = await fixture();
        await nativeActivity.createActivityTextField(id, {title: 'Instructions', text: 'Bring water'}, actor(owner));
        const field = (await nativeActivity.readActivityPlan(id, actor(participant))).data.textFields[0];
        await expect(nativeActivity.patchActivityTextField(id, field.id, {title: 'Forbidden title', text: 'New text'}, actor(participant), field.editToken)).rejects.toMatchObject({status: 403});
        await nativeActivity.patchActivityTextField(id, field.id, {text: 'Bring snacks'}, actor(participant), field.editToken);
        await expect(nativeActivity.patchActivityTextField(id, field.id, {text: 'Old draft'}, actor(participant), field.editToken)).rejects.toMatchObject({status: 412});
        const defaults = await nativeActivity.readActivityDefaultsBaseline(id, actor(owner));
        await nativeActivity.setActivityDefaults(id, {guest: PERM.ACCESS_VIEW}, actor(owner), defaults.editToken);
        expect(await adminService.getDefaultPerms('activity', id)).toMatchObject({public: PERM.ACCESS_VIEW, guest: PERM.ACCESS_VIEW});
        await expect(nativeActivity.setActivityDefaults(id, {guest: 0}, actor(owner), defaults.editToken)).rejects.toMatchObject({status: 412});

        const order = await nativeActivity.readActivityOrderBaseline(id, actor(owner));
        await nativeActivity.setActivityOrder(id, {order: [{slotId: slot.id, position: 10}]}, actor(owner), order.editToken);
        await expect(nativeActivity.setActivityOrder(id, {order: [{slotId: slot.id, position: 20}]}, actor(owner), order.editToken)).rejects.toMatchObject({status: 412});
        expect((await activityService.getActivitySlotById(slot.id))?.pos).toBe(10);
    });

    it('rejects cross-plan slot/text/assignment identifiers and preserves printable schedule ownership', async () => {
        const first = await fixture();
        const second = await fixture();
        await expect(nativeActivity.removeActivitySlot(first.id, second.slot.id, actor(owner))).rejects.toMatchObject({status: 404});
        await nativeActivity.createActivityTextField(second.id, {title: 'Private notes', text: 'Second plan'}, actor(owner));
        const field = (await activityService.getActivityPlanTextFields(second.id))[0];
        await expect(nativeActivity.removeActivityTextField(first.id, field.id, actor(owner))).rejects.toMatchObject({status: 404});
        await nativeActivity.setActivityAssignment(second.id, second.slot.id, {assigned: true}, actor(participant));
        const assignment = (await activityService.getActivitySlotAssigneeRows(second.id).then(projectActivityAssignees))[second.slot.id][0];
        await expect(nativeActivity.removeActivityAssignment(first.id, String(assignment.id), actor(owner))).rejects.toMatchObject({status: 404});
        const exported = await nativeActivity.getScheduleExport((await activityService.getActivityPlanById(second.id))!);
        expect(exported.weeks.flatMap(week => week.days.flatMap(day => day.slots))).toContainEqual(expect.objectContaining({id: second.slot.id}));
        expect(exported.textFields).toContainEqual(expect.objectContaining({id: field.id, text: 'Second plan'}));
    });
});
