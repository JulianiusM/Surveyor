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
import type {ActivitySlotAdmission} from '../../../types/ActivityV1Types';
import type {PermBundle, PermissionFieldRule, SessionLike} from '../../../types/PermissionTypes';
import type {components} from '../../../types/api/v1';
import * as activityService from '../database/services/ActivityService';
import {requireRecommendationContext} from './autoAssignment';
import {APIError} from '../lib/errors';
import {ApiProblem} from '../api/problem';
import {fromISOtoLocal, generateUniqueId, sameUuid} from '../lib/util';

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
