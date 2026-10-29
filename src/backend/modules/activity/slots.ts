/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {EntityManager} from 'typeorm';
import type {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../database/entities/activity/ActivitySlot';
import type {ActivityAssignment} from '../database/entities/activity/ActivityAssignment';
import type {ActivitySlotAdmission} from '../../../types/ActivityV1Types';
import type {ActivityPropertyPatch} from '../../../types/ActivityTypes';
import type {PermBundle, PermissionFieldRule, SessionLike} from '../../../types/PermissionTypes';
import type {components} from '../../../types/api/v1';
import * as activityService from '../database/services/ActivityService';
import * as eventService from '../database/services/EventService';
import {collectManualAssignmentWarnings, overlapConfirmation, requireOverlapConfirmation} from './recommendations';
import {invalidateEventContext, requireActivityDuration, requireRecommendationContext, projectActivityAssignees} from './autoAssignment';
import {invalidateGeneratedRecommendations} from '../database/services/ActivityRecommendationService';
import {APIError} from '../lib/errors';
import {ApiProblem} from '../api/problem';
import {fromISOtoLocal, generateUniqueId, sameUuid, uuidKey} from '../lib/util';

/** Check self-assignment scope and optional role eligibility before removal exits.
 * Assign requests additionally require registration when configured; existing
 * memberships and already held roles retain their capacity retry exemptions. */
export async function authorizeSelfAssignment(
    planId: string,
    slotId: string,
    profileId: string,
    operation: 'assign' | 'unassign',
    roleName?: string,
) {
    // Establish the actual plan/slot relationship before applying either role
    // selection or participant rules to these requested identities.
    const [plan, slot] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotById(slotId),
    ]);

    if (!plan || !slot || !sameUuid(slot.entityId, planId)) {
        throw new APIError('Activity slot not found in this plan', {planId, slotId}, 404);
    }

    let requestedRole: {name: string; maxQty: number} | undefined;
    if (roleName !== undefined) {
        if (typeof roleName !== 'string' || !roleName.trim()) {
            throw new APIError('Activity role is required', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_REQUIRED'});
        }
        const slotRoles = await activityService.getActivitySlotRoles(planId);
        requestedRole = slotRoles[uuidKey(slot.id)]?.find((role) => role.name === roleName);
        if (!requestedRole) {
            throw new APIError('Activity role is not available for this slot', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
    }

    // A user must always be able to remove an existing commitment, even if registration
    // or plan policy changed after it was created.
    if (operation === 'unassign') return;

    // Registration constrains assign requests only. Removal already returned
    // above so changed enrollment cannot trap a saved assignment.
    if (plan.event?.id && !plan.allowExternalAssignees) {
        const registration = await eventService.getRegistrationFor(profileId, plan.event.id);
        if (!registration) {
            throw new APIError(
                'Only registered event participants may take slots in this activity plan',
                {planId, slotId},
                403,
                {cause: 'ACTIVITY_PARTICIPANT_REQUIRED'},
            );
        }
    }

    // A current member may retry at slot capacity; taking another named role
    // still has its separate configured quota below.
    const assignees = (await activityService.getActivitySlotAssigneeRows(planId).then(projectActivityAssignees))[uuidKey(slot.id)] ?? [];
    const existingAssignee = assignees.find((assignee) => sameUuid(assignee.profileId, profileId));
    if (
        !plan.allowOverfillAfterFull
        && !existingAssignee
        && typeof slot.maxAssignees === 'number'
        && assignees.length >= slot.maxAssignees
    ) {
        throw new APIError('This activity slot is already full', {planId, slotId}, 409, {cause: 'ACTIVITY_FULL'});
    }

    if (requestedRole && requestedRole.maxQty > 0) {
        const alreadyHasRole = existingAssignee?.roles.includes(requestedRole.name);
        const roleCount = assignees.filter((assignee) => assignee.roles.includes(requestedRole!.name)).length;
        if (!alreadyHasRole) assertActivityRoleCapacity(roleCount + 1, requestedRole.maxQty, {planId, slotId, roleName});
    }
}

export async function addActivityRole(plan: ActivityPlan, body: any) {
    const {name, description, isDefault} = body;
    if (!name || name === "default") throw new APIError('Missing name', body, 400, {cause: 'ACTIVITY_ROLE_NAME_INVALID'});
    return activityService.ensureRoleId(plan.id, name, isDefault === 'on', description);
}

/** Role quotas and assignment ownership are checked before replacing any role links. */
export async function updateRoleAssignments(slotId: string, body: any) {
    const {assignments} = body;
    if (!Array.isArray(assignments)) throw new APIError('Not an array', body, 400);
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    /** Replace role links only after locked assignment membership and quota checks. */
    async function saveRoles(manager: EntityManager): Promise<void> {
        // The plan and activity locks fence concurrent role/assignment changes.
        await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [slotId]);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        const configured = await activityService.getConfiguredSlotRoles(manager, slotId);
        const byName = new Map(configured.map((entry) => [entry.role.title, entry]));
        const currentAssignments = await activityService.getLockedPlanAssignments(manager, planId, slotId);
        const assignmentIds = new Set(currentAssignments.map((assignment) => assignment.id));
        const requestedCounts = new Map<string, number>();
        const rows: {assignmentId: number; roleId: number}[] = [];
        // Validate every requested role and assignee before replacing any links.
        for (const entry of assignments) {
            const role = entry && byName.get(entry.role);
            if (!role) throw new APIError('Roles must be configured for this activity slot', body, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
            const assignmentId = entry.assignmentId === null ? null : Number.parseInt(entry.assignmentId) || null;
            if (assignmentId === null) continue;
            if (!assignmentIds.has(assignmentId)) throw new APIError('Assignment not found in this slot', body, 400, {cause: 'ACTIVITY_ASSIGNMENT_INVALID'});
            const count = (requestedCounts.get(entry.role) ?? 0) + 1;
            if (entry.role !== 'default') assertActivityRoleCapacity(count, role.maxQty ?? 0, {slotId, role: entry.role});
            requestedCounts.set(entry.role, count);
            rows.push({assignmentId, roleId: role.role.id});
        }
        await activityService.replaceActivityAssignmentRoles(manager, [...assignmentIds], rows);
    }
    await activityService.withActivityTransaction(saveRoles);
    return 'Assignments updated';
}

/**
 * Slot/role quotas are command policy. Read and validate them after the root and slot locks,
 * then pass only the selected IDs to DBAL. An existing role link is an idempotent no-op.
 */
export async function assignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', confirmation?: unknown, admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) throw new APIError('Activity slot not found', {itemId}, 404);
    const planId = current.entityId;
    /** Admit and persist one commitment under parent/plan, slot and assignment locks.
     * Existing role membership is idempotent; first commitments compare overlap
     * review, while named-role quotas remain independent of slot overfill. */
    async function assignParticipant(manager: EntityManager): Promise<void> {
        // Read each narrower scope only after its coordinating root context,
        // retaining all selected rows on this transaction's manager.
        const plan = await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [itemId]);
        if (!slot) throw new APIError('Activity slot not found', {itemId}, 404);
        // Versioned admission joins this operation's existing root/slot locks;
        // callers that omit it remain responsible for admission.
        await admit?.(manager, plan, slot);
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const existing = assignments.find((assignment) => sameUuid(assignment.profile.id, profileId));
        if (!existing && !plan.allowOverfillAfterFull && slot.maxAssignees != null && assignments.length >= slot.maxAssignees) {
            throw new APIError('This activity slot is already full', {itemId}, 409, {cause: 'ACTIVITY_FULL'});
        }
        let role = await activityService.getActivityRoleByName(manager, planId, roleName);
        if (!role && roleName !== 'default') {
            throw new APIError('Activity role is not available for this plan', {itemId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
        // A repeated role signup ends before overlap review or another insert.
        if (role && existing && assignmentHasRole(existing, role.id)) return;
        if (!existing) {
            const warnings = await collectManualAssignmentWarnings(plan, slot, profileId, manager);
            const observed = [{recommendation: {itemId, profileId, manual: true}, warnings}];
            requireOverlapConfirmation(overlapConfirmation(planId, observed), confirmation);
        }
        if (roleName !== 'default') {
            // A named role must have survived the existence check above; capture its ID
            // once so all quota comparisons use the same selected role snapshot.
            const roleId = role!.id;
            const configured = await activityService.getConfiguredSlotRoles(manager, itemId);
            const slotRole = configured.find((entry) => entry.role.id === roleId);
            if (!slotRole) throw new APIError('Activity role is not available for this slot', {itemId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
            let roleCount = 0;
            for (const assignment of assignments) {
                if (assignmentHasRole(assignment, roleId)) roleCount++;
            }
            // Slot overfill does not relax the independently configured named-role quota.
            assertActivityRoleCapacity(roleCount + 1, slotRole.maxQty, {itemId, roleName});
        }
        // Only the default role may be created here; the selected saved role
        // attaches to the existing signup when one already belongs to this profile.
        if (!role) [role] = await activityService.ensureRoleId(planId, 'default', true, undefined, manager);
        await activityService.saveActivityAssignmentRole(manager, planId, itemId, profileId, role.id, existing?.id);
    }
    await activityService.withActivityTransaction(assignParticipant);
}

/** Check the persisted role links for one assignment without inferring role membership from names. */
function assignmentHasRole(assignment: ActivityAssignment, roleId: number): boolean {
    // Only the stored role identity determines whether this signup is already present.
    return assignment.activityAssignmentRoles.some((entry) => entry.role.id === roleId);
}

/** Reject a projected named-role quantity beyond its admitted quota.
 * Callers retain role availability, default-role and retry exemptions and select
 * the quota interpretation appropriate to their existing operation. */
function assertActivityRoleCapacity(projectedCount: number, maxQty: number | null | undefined, data: object): void {
    // A missing locked quota remains unrestricted. Replacement callers explicitly
    // supply zero for their existing absent-quota rule before reaching this owner.
    if (maxQty != null && projectedCount > maxQty) {
        throw new APIError('This activity role is already full', data, 409, {cause: 'ACTIVITY_ROLE_FULL'});
    }
}

/** Removing the last role ends the signup; the shared assignment operation owns this decision. */
export async function unassignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) return;
    const planId = current.entityId;
    /** Remove the saved signup or selected role under the existing context locks.
     * Missing signups are no-ops; the default command or removal of its sole role
     * deletes the assignment, otherwise only the matching role link is deleted. */
    async function unassignParticipant(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        await activityService.getLockedActivitySlots(manager, [itemId]);
        // The optional adapter only adds its captured authority/context checks.
        // Removal of the saved commitment still belongs to this shared operation.
        if (admit) {
            const slot = await activityService.getActivitySlotById(itemId, manager);
            if (!slot) throw new ApiProblem('NOT_FOUND');
            await admit(manager, plan, slot);
        }
        // Decide from the locked persisted signup, rather than a previously
        // displayed roster or role selection that may no longer exist.
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const assignment = assignments.find((entry) => sameUuid(entry.item.id, itemId) && sameUuid(entry.profile.id, profileId));
        if (!assignment) return;
        const role = assignment.activityAssignmentRoles.find((entry) => entry.role.title === roleName);
        if (roleName === 'default' || (role && assignment.activityAssignmentRoles.length === 1)) {
            await activityService.deleteActivitySlotAssignment(assignment.id, manager);
        } else if (role) {
            await activityService.deleteActivityAssignmentRole(manager, role.id);
        }
    }
    await activityService.withActivityTransaction(unassignParticipant);
}

/** Apply admitted root properties against the caller's locked plan and manager.
 * Plan narrowing and slot writes share this range policy; context/field admission
 * and transport projection remain with the controller's existing transaction. */
export async function applyActivityProperties(planId: string, plan: ActivityPlan, patch: ActivityPropertyPatch,
    manager: EntityManager): Promise<void> {
    // Omitted bounds retain the locked dates. Narrowing a range must retain
    // every saved slot before cancellation or persistence can happen.
    const startDate = patch.startDate ?? plan.startDate;
    const endDate = patch.endDate ?? plan.endDate;
    if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400, {cause: 'ACTIVITY_DATE_RANGE_INVALID'});
    requireActivityDuration(startDate, endDate, plan);
    if (startDate !== plan.startDate || endDate !== plan.endDate) {
        if (await activityService.hasActivitySlotsOutsideRange(manager, planId, startDate, endDate)) {
            throw new APIError('The activity date range must include every saved slot', {}, 409, {cause: 'ACTIVITY_DATE_RANGE_EXCLUDES_ACTIVITIES'});
        }
        // Cancel while holding the lock: even a change back to the original dates
        // must invalidate a waiting job. Cancellation after rollback is conservative.
        invalidateEventContext(planId);
        await invalidateGeneratedRecommendations(manager, planId);
    }
    // Keep the approved sparse write on this same manager after its guards.
    await activityService.updateActivityPlanProperties(planId, patch, manager);
}

// The accepted field grants/fallbacks belong to this shared business owner.
// Slot writes and controller baseline/capability projections adopt the same rules.
const activitySlotFieldPermissions: Record<keyof components['schemas']['ActivitySlotPatch'], PermissionFieldRule> = {
    startTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    endTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    title: {permission: 'EDIT_TITLE', parent: 'ITEM_EDIT'},
    description: {permission: 'EDIT_DESC', parent: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
    maxAssignees: {permission: 'EDIT_CAPACITY', parent: 'ITEM_EDIT'},
    roles: {permission: 'MANAGE_ASSIGNMENTS', parent: 'MANAGE_ASSIGNMENTS'},
};

/** Share the existing field grants with controller capability projections.
 * Return a copy so presentation cannot mutate the feature-owned write policy. */
export function activitySlotFieldPermission(field: keyof components['schemas']['ActivitySlotPatch']): PermissionFieldRule {
    const rule = activitySlotFieldPermissions[field];
    return {...rule, ...(Array.isArray(rule.parent) ? {parent: [...rule.parent]} : {})};
}

/** Keep new and moved activities inside their current plan's inclusive date range. */
function validateSlotDate(plan: ActivityPlan, day?: string): void {
    // Callers repeat this comparison under the root lock before persistence.
    if (!day || day < plan.startDate || day > plan.endDate) {
        throw new APIError('Slot date must be within the activity plan date range', {}, 400, {cause: 'ACTIVITY_DATE_OUTSIDE_PLAN'});
    }
}

/** Serialize edits with narrowing the parent range; missing snapshots retain their business errors. */
async function saveActivitySlot(slotId: string, fields: Partial<ActivitySlot>, admit?: ActivitySlotAdmission): Promise<boolean> {
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;

    /** Revalidate this edit against the locked plan and optional current slot authority.
     * The initial lookup supplies only its plan; the transaction owns admission and the write. */
    async function saveSlot(manager: EntityManager): Promise<boolean> {
        const plan = await requireRecommendationContext(manager, planId);
        // Optional transport authority is evaluated against this locked plan and
        // current slot, independently from the old browser's presentation bundle.
        if (admit) {
            const slot = await activityService.getActivitySlotById(slotId, manager);
            if (!slot || !sameUuid(slot.entityId, plan.id)) throw new ApiProblem('NOT_FOUND');
            await admit(manager, plan, slot);
        }

        // A moved slot must fit the current range even when no transport callback is supplied.
        if (fields.day !== undefined) validateSlotDate(plan, fields.day);
        return activityService.updateActivitySlot(slotId, fields, manager);
    }
    return activityService.withActivityTransaction(saveSlot);
}

/** Validate an activity draft, then retain the existing slot/role persistence order. */
export async function quickAddSlot(plan: ActivityPlan, body: any, session: SessionLike) {
    // Reject unusable draft dates and times before preparing any persistence.
    const {date, title = '', description = '', startTime, endTime, maxAssignees = 1, roles = []} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.startDate) || d > fromISOtoLocal(plan.endDate))
        throw new APIError('Date outside range', body, 400, {cause: 'ACTIVITY_DATE_OUTSIDE_PLAN'});

    if (!title) throw new APIError('Title required', body, 400);

    const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
    if (startTime && !timePattern.test(startTime)) {
        throw new APIError('Invalid start time', body, 400);
    }
    if (endTime && !timePattern.test(endTime)) {
        throw new APIError('Invalid end time', body, 400);
    }
    if (startTime && endTime && startTime >= endTime) {
        throw new APIError('End time must be after start time', body, 400, {cause: 'ACTIVITY_TIME_ORDER_INVALID'});
    }

    // Role membership and the next saved position come from this same plan.
    const normalizedRoles = await validatePlanRoleIds(plan.id, roles, body);
    const last = Number(await activityService.getLastActivitySlotNumber(plan.id, date)) || 0;
    const slot: Partial<ActivitySlot> = {
        id: generateUniqueId(),
        day: date,
        title,
        description,
        startTime: startTime || null,
        endTime: endTime || null,
        maxAssignees: Number(maxAssignees) || 1,
        pos: last + 1
    };

    /** Recheck the current date range under the plan lock before adding the row. */
    async function saveSlot(manager: EntityManager): Promise<void> {
        // A concurrent plan edit cannot make the original unlocked range authoritative.
        const currentPlan = await requireRecommendationContext(manager, plan.id);
        validateSlotDate(currentPlan, slot.day);
        await activityService.addActivitySlots(plan.id, [slot], session.profile!.id, manager);
    }
    await activityService.withActivityTransaction(saveSlot);

    // Preserve the follow-up role write; diagnostics add no new transaction guarantee.
    if (normalizedRoles.length > 0) {
        await activityService.addActivitySlotRoles(slot.id!, normalizedRoles);
    }
    return 'Slot added';
}

/** Share description persistence while optional versioned authority runs under its existing root lock. */
export async function updateSlotDescription(slotId: string, body: any, admit?: ActivitySlotAdmission) {
    // The sparse writer retains range/context checks and its vanished-row diagnostic.
    if (!(await saveActivitySlot(slotId, {description: body.description}, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

/** Adapt a direct field/value edit through its existing grants and normalization.
 * Save scalar slot fields first; the existing role replacement follows separately,
 * retaining its own transaction and the original diagnostic order. */
export async function updateSlotAttr(slotId: string, body: any, permData?: PermBundle, admit?: ActivitySlotAdmission) {
    const {field, value} = body;
    if (field !== undefined && value !== undefined) body[field] = value;
    // Preserve diagnostic order and the existing bundle consumer while
    // sharing each field's exact permission declaration with new projections.
    function allowed(field: keyof components['schemas']['ActivitySlotPatch']): boolean {
        const rule = activitySlotFieldPermissions[field];
        return Boolean(permData?.itemAllow(slotId, rule.permission, rule.parent));
    }
    if (!permData ||
        ((body.startTime !== undefined || body.endTime !== undefined) && !allowed('startTime'))
        || (body.title !== undefined && !allowed('title'))
        || (body.description !== undefined && !allowed('description'))
        || (body.maxAssignees !== undefined && !allowed('maxAssignees'))
        || (body.roles !== undefined && !allowed('roles'))
    ) {
        throw new APIError("Not allowed", body, 403);
    }

    // Resolve supplied role IDs against the slot's actual plan before saving
    // any scalar field; an omitted role field preserves all existing mappings.
    let normalizedRoles: number[] | undefined;
    if (body.roles !== undefined) {
        const slot = await activityService.getActivitySlotById(slotId);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        normalizedRoles = await validatePlanRoleIds(slot.entityId, body.roles, body);
    }

    // Preserve each direct control's clearing/conversion behavior independently
    // of versioned numeric drafts and their different transport contract.
    const staged: Partial<ActivitySlot> = {};
    if (body.startTime !== undefined) staged.startTime = body.startTime || null;
    if (body.endTime !== undefined) staged.endTime = body.endTime || null;
    if (body.title !== undefined) staged.title = body.title;
    if (body.description !== undefined) staged.description = body.description || null;
    if (body.maxAssignees !== undefined) staged.maxAssignees = Number(body.maxAssignees) || null;

    if (!(await saveActivitySlot(slotId, staged, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }

    // Role replacement remains a later operation after the scalar save succeeds.
    if (normalizedRoles !== undefined) {
        await activityService.updateActivitySlotRoles(slotId, normalizedRoles);
    }

    return 'Slot updated';
}

/** Normalize selected role IDs and reject roles outside their activity plan. */
async function validatePlanRoleIds(planId: string, roles: unknown, body: unknown): Promise<number[]> {
    // Numeric conversion retains form values; malformed IDs never reach a query.
    if (!Array.isArray(roles)) throw new APIError('Invalid roles', {body}, 400);
    const normalized = roles.map(Number);
    if (normalized.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
        throw new APIError('Invalid roles', {body}, 400);
    }

    // Membership, rather than a posted role ID alone, authorizes this plan's selection.
    const allowed = new Set((await activityService.getAllRoles(planId)).map((role) => role.id));
    if (normalized.some((roleId) => !allowed.has(roleId))) {
        throw new APIError('Roles must belong to this activity plan', {body}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
    }
    return [...new Set(normalized)];
}
