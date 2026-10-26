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

import {defaultPermissionValues as activityDefaultValues, readEntityDefaultsBaseline, updateEntityDefaults, readEntityAdministratorBaseline, updateEntityAdministrator} from './entityAdminController';
import {getRequirements, updateRequirements} from '../modules/activity/requirementOperations';
import {presentActivitySchedule} from '../modules/activity/schedulePresentation';
import {getRecommendations, getRecommendationWarningPreview, applyRecommendations} from '../modules/activity/recommendationOperations';
import {invalidateEventContext, queueAutoGenerateRecommendations, getAutoRecommendationJob} from '../modules/activity/recommendationExecution';

import {overlapConfirmation, requireOverlapConfirmation, getAssignmentWarningPreview, collectManualAssignmentWarnings} from '../modules/activity/warningOperations';

import {authorizeEventLink, getEventLinkOptions, readEventLinkSelection} from '../modules/event/linkage';
import {requireRequirementConfiguration, requireRecommendationContext} from '../modules/activity/context';
import type {RecommendationJobView} from '../../types/ActivityTypes';


// controllers/activityController.js
import {hasAccountProfile} from './userController';
import {getInitialPerms} from '../modules/lib/permissions';
import {Request} from "express";

import type {EntityManager} from "typeorm";
import type {ActivityAssignment} from "../modules/database/entities/activity/ActivityAssignment";
import {searchEntityProfiles, archiveEntity, assertEntityPropertyContext, comparisonToken, completeDefaults, entityMethodPermission, entityPropertyPermission, entityTag, getArchivePresentations, getAuthorizedEventUrl, getEntityPropertyPresentation, getEntityViewAdmission, permissionDefinitions, requireFieldComparison, restoreEntity, changeEntityEvent, setAutomaticArchival} from './entityAdminController';

import {ApiProblem} from '../modules/api/problem';
import {checkNewImage, removeImage} from '../modules/lib/fileCommons';
import * as adminService from '../modules/database/services/EntityAdminService';
import {getHeaderImageVersion} from '../modules/lib/util';
import {civilDateWeeks} from '../../common/lib/civilDate';
import type {components} from '../../types/api/v1';
import type {ActivityCommandPreparation, ActivityPropertyTransportContext, ActivitySlotAdmission} from '../../types/ActivityV1Types';
// Business logic for the Activity routes
import Joi from 'joi';


import {calculateParticipantRequirement} from '../../common/activity/requirements';

import {ActivityPlan} from "../modules/database/entities/activity/ActivityPlan";
import {ActivitySlot} from "../modules/database/entities/activity/ActivitySlot";
import * as recommendationService from "../modules/database/services/ActivityRecommendationService";


import * as activityService from "../modules/database/services/ActivityService";
import * as eventService from "../modules/database/services/EventService";

import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap} from "../modules/lib/fileCommons";

import {ENTITIES, fromISOtoLocal, generateUniqueId} from '../modules/lib/util';
import {buildPermBundle, evaluateEntities, evaluateSubject, isOwner, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {ActivityCreationCompletion, ActivityPropertyPatch, AssignmentWarningPreview, RecommendationWarningResult} from '../../types/ActivityTypes';
import type {PermBundle, PermView, PermType, PermissionFieldRule, SessionLike} from "../../types/PermissionTypes";
import type {EntityBase} from "../../types/UserTypes";


// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

// The accepted shared field grants/fallbacks have one controller-owned
// declaration. Direct writes and the new baseline/capability projections adopt it.
const activitySlotFieldPermissions: Record<keyof components['schemas']['ActivitySlotPatch'], PermissionFieldRule> = {
    startTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    endTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    title: {permission: 'EDIT_TITLE', parent: 'ITEM_EDIT'},
    description: {permission: 'EDIT_DESC', parent: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
    maxAssignees: {permission: 'EDIT_CAPACITY', parent: 'ITEM_EDIT'},
    roles: {permission: 'MANAGE_ASSIGNMENTS', parent: 'MANAGE_ASSIGNMENTS'},
};

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */

function preprocessCreate(body: any): Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] } {
    // Parse JSON slots object
    let slotsByDate = {};
    try {
        slotsByDate = JSON.parse(body.slots || '{}');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid slots JSON', {body});
    }

    // Define Joi schema for body & slots
    const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;

    const slotSchema = Joi.object({
        id: Joi.string().guid({version: ['uuidv4', 'uuidv5']}).required(),
        day: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        pos: Joi.number().integer().required(),
        title: Joi.string().max(255).required(),
        description: Joi.string().allow(''),
        startTime: Joi.string().pattern(timePattern).allow(null),
        endTime: Joi.string().pattern(timePattern).allow(null),
        maxAssignees: Joi.number().integer().min(1).required()
    }).custom((value, helpers) => {
        // Supplied start/end times must form a positive interval; absent times retain their form meaning.
        if (value.startTime && value.endTime && value.startTime >= value.endTime) {
            return helpers.error('any.custom', {message: 'Slot end time must be after start time'});
        }
        return value;
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        description: Joi.string().max(16000).allow('').required(),
        slots: Joi.object().pattern(
            /^\d{4}-\d{2}-\d{2}$/, Joi.array().items(slotSchema)
        ).min(1).required(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    // Validate combined payload
    const {error, value} = schema.validate(
        {...body, slots: slotsByDate},
        {abortEarly: false, allowUnknown: true}
    );
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // Flatten slots arrays and return sanitized data
    const flattenedSlots: Partial<ActivitySlot>[] = Object.values(value.slots).flat().map((slot: any) => ({
        id: slot.id,
        day: slot.day,
        pos: slot.pos,
        title: slot.title,
        description: slot.description ?? null,
        maxAssignees: slot.maxAssignees,
        startTime: slot.startTime ?? null,
        endTime: slot.endTime ?? null,
    }));

    // Ensure each slot date is within the start/end range
    const startDate = fromISOtoLocal(value.startDate);
    const endDate = fromISOtoLocal(value.endDate);
    for (const slot of flattenedSlots) {
        const slotDate = fromISOtoLocal(slot.day!);
        if (slotDate < startDate || slotDate > endDate) {
            throw new ValidationError(CREATE_TEMPLATE, `Slot date ${slot.day} outside range`, {body});
        }
    }

    return {
        title: value.title,
        description: value.description || null,
        startDate: value.startDate,
        endDate: value.endDate,
        slots: flattenedSlots,
        eventId: value.event_id || null,
    };
}


/**
 * Create activity plan and slots in a transaction.
 * @returns {Promise<string>} plan ID
 */

async function createEntity(
    ownerId: string,
    planData: Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] },
    complete?: ActivityCreationCompletion,
): Promise<string> {
    return await activityService.createActivityPlanTx(
        ownerId,
        planData.title!,
        planData.description!,
        planData.startDate!,
        planData.endDate!,
        planData.slots,
        planData.eventId,
        planData.headerImg,
        complete,
    );
}

// No-op since slots handled in transaction
const afterCreateItems = async (id: string, data: any) => {
    await saveDefaultPermsFromBody(ENTITIES.ACTIVITY, id, data._body);
};

/**
 * Assemble the shared saved schedule and participant analysis. Versioned callers
 * may request presentation provenance; standard projections keep their
 * established fields and English fallbacks without additional reads or effects.
 */

async function fetchForView(plan: ActivityPlan, req: Request, includeNameProvenance = false) {
    // Load the same schedule and independent participant/configuration inputs for
    // both renderers; name provenance never changes authority or membership.
    const slotsByDate = await activityService.getActivitySlots(plan.id);
    const session = req.session;

    const slotList = Object.values(slotsByDate).flat();

    const [
        assignments,
        assigneeLists,
        allRoles,
        slotRoles,
        requirementConfig,
        eventParticipants,
        participantRoles,
    ] = await Promise.all([
        activityService.getActivitySlotAssignments(plan.id, session.profile!.id),
        activityService.getActivitySlotAssignees(plan.id),
        activityService.getAllRoles(plan.id),
        activityService.getActivitySlotRoles(plan.id),
        requireRequirementConfiguration(plan.id),
        plan.event?.id ? eventService.getEventParticipants(plan.event.id) : Promise.resolve([]),
        activityService.getParticipantRolesForPlan(plan.id),
    ]);
    const textFields = await activityService.getActivityPlanTextFields(plan.id);

    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (!slot) continue;
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    const currentProfileId = session.profile!.id;
    const registration = eventParticipants.find((participant) => participant.profileId === currentProfileId);
    const canSelfAssign = !plan.event?.id || Boolean(registration) || Boolean(plan.allowExternalAssignees);
    const currentRoleIds = participantRoles.find(
        (participant) => participant.participantKey === `profile:${currentProfileId}`,
    )?.roleIds;
    const shouldShowRequirementProgress = canSelfAssign && (
        requirementConfig.plan.assignmentMode === "REQUIRED" || assignments.length > 0
    );

    const requirementProgress = shouldShowRequirementProgress
        ? (() => {
            const requirement = calculateParticipantRequirement(
                requirementConfig.plan,
                {
                    profileId: currentProfileId,
                    arrivalDate: registration?.arrivalDate ?? undefined,
                    departureDate: registration?.departureDate ?? undefined,
                    roleIds: currentRoleIds,
                    name: registration?.name,
                },
                requirementConfig.roleRequirements,
                requirementConfig.overrides,
                requirementConfig.stayRequirements,
            );
            const assignedShifts = assignments.length;
            const remainingShifts = Math.max(requirement.requiredShifts - assignedShifts, 0);
            return {
                assignedShifts,
                requiredShifts: requirement.requiredShifts,
                remainingShifts,
                complete: remainingShifts === 0,
            };
        })()
        : undefined;

    interface ParticipantStatusAccumulator {
        participantKey: string;
        profileId?: string;
        name: string;
        nameIsFallback: boolean;
        arrivalDate?: string | null;
        departureDate?: string | null;
        assignedShifts: number;
        roleIds: Set<number>;
        roles: Set<string>;
    }

    // Record whether a display name was manufactured before its origin is lost.
    // A later genuine assignee name replaces both the text and that provenance.
    const participantStatusMap = new Map<string, ParticipantStatusAccumulator>();
    /** Reuse one accumulator across registration and assignment sources. A real
     * later name replaces a fallback without losing the collected status. */
    const ensureParticipantStatus = (
        participantKey: string,
        profileId: string | null | undefined,
        name?: string | null,
    ): ParticipantStatusAccumulator => {
        const existing = participantStatusMap.get(participantKey);
        if (existing) {
            // Empty source values cannot erase an already known person's name.
            if (name) {
                existing.name = name;
                existing.nameIsFallback = false;
            }
            return existing;
        }

        // Preserve controller wording while retaining its origin for the Vue DTO.
        const created: ParticipantStatusAccumulator = {
            participantKey,
            profileId: profileId ?? undefined,
            name: name || 'Participant',
            nameIsFallback: !name,
            assignedShifts: 0,
            roleIds: new Set<number>(),
            roles: new Set<string>(),
        };
        participantStatusMap.set(participantKey, created);
        return created;
    };

    eventParticipants.forEach((participant) => {
        const participantKey = participant.profileId
            ? `profile:${participant.profileId}`
            : `registration:${participant.id}`;
        const status = ensureParticipantStatus(participantKey, participant.profileId, participant.name);
        status.arrivalDate = participant.arrivalDate;
        status.departureDate = participant.departureDate;
    });

    Object.values(assigneeLists).flat().forEach((assignee) => {
        // Accumulate recorded work by profile while keeping the default role out of visible named roles.
        const participantKey = `profile:${assignee.profileId}`;
        const status = ensureParticipantStatus(participantKey, assignee.profileId, assignee.name);
        status.assignedShifts += 1;
        assignee.roles.forEach((role) => {
            if (role !== 'default') status.roles.add(role);
        });
    });

    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    participantRoles.forEach(({participantKey, roleIds}) => {
        // Enrich existing participants only; a role record never creates another participant.
        const status = participantStatusMap.get(participantKey);
        if (!status) return;
        roleIds.forEach((roleId) => {
            status.roleIds.add(roleId);
            const title = roleTitles.get(roleId);
            if (title && title !== 'default') status.roles.add(title);
        });
    });

    const participantList = Array.from(participantStatusMap.values())
        .map((status) => {
            const requirement = calculateParticipantRequirement(
                requirementConfig.plan,
                {
                    profileId: status.profileId,
                    arrivalDate: status.arrivalDate,
                    departureDate: status.departureDate,
                    roleIds: [...status.roleIds],
                    name: status.name,
                },
                requirementConfig.roleRequirements,
                requirementConfig.overrides,
                requirementConfig.stayRequirements,
            );
            return {
                participantKey: status.participantKey,
                name: status.name,
                // Only the new transport needs the origin of this presentation.
                // Standard projections retain their exact established shape.
                ...(includeNameProvenance ? {nameIsFallback: status.nameIsFallback} : {}),
                count: status.assignedShifts,
                assignedShifts: status.assignedShifts,
                roles: [...status.roles].sort((a, b) => a.localeCompare(b)),
                roleIds: [...status.roleIds],
                requiredShifts: requirement.requiredShifts,
                remainingShifts: Math.max(requirement.requiredShifts - status.assignedShifts, 0),
                source: requirement.source,
                attendanceDays: requirement.breakdown.attendanceDays,
                attendance: status.arrivalDate || status.departureDate
                    ? {arrivalDate: status.arrivalDate, departureDate: status.departureDate}
                    : undefined,
                assignmentMode: requirementConfig.plan.assignmentMode,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        plan,
        slots: slotsByDate,
        assignments,
        assigneeLists,
        participantList,
        roles: {allRoles, slotRoles},
        counters: {participants: participantList.length, open, empty},
        requirementProgress,
        canSelfAssign,
        textFields,
    };
}

/**
 * Prepare the existing printable schedule and its counters without changing
 * dates, assignments or admission. Participants are distinct assigned profiles
 * plus registrations in this plan's linked event, as in the detail projection.
 */
async function getScheduleExport(plan: ActivityPlan) {
    // Select the same participant sources as the detail owner; the DBAL counts
    // their UUID union without loading names or a second participant roster.
    const [slotsByDate, assigneeLists, slotRoles, textFields, participantCount] = await Promise.all([
        activityService.getActivitySlots(plan.id),
        activityService.getActivitySlotAssignees(plan.id),
        activityService.getActivitySlotRoles(plan.id),
        activityService.getActivityPlanTextFields(plan.id),
        activityService.countActivityPlanParticipants(plan.id, plan.event?.id ?? null),
    ]);

    return presentActivitySchedule(plan, slotsByDate, assigneeLists, slotRoles, textFields, participantCount);
}

/**
 * Provide data for duplication form.
 */

async function fetchForDuplicate(plan: ActivityPlan, session: Request['session']) {
    return await activityService.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current profile.
 */

async function deleteEntity(plan: ActivityPlan, session: Request['session']) {
    return await activityService.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers

/** Calendar dates remain DATE values; reject rollover dates rather than letting JavaScript normalize them. */
function validatePropertyDate(value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1000-01-01') {
        return helpers.error('any.invalid');
    }
    return value;
}

/** Schema ownership stays with this feature; the shared API checks each supplied field's permission first. */
function normalizeActivityProperties(body: unknown): ActivityPropertyPatch {
    const date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validatePropertyDate);
    const schema = Joi.object<ActivityPropertyPatch>({
        title: Joi.string().trim().min(1).max(255),
        description: Joi.string().max(16000).allow('', null),
        startDate: date,
        endDate: date,
    }).min(1).unknown(false).required();
    const {error, value} = schema.validate(body, {abortEarly: false});
    if (error) throw new APIError(error.message, {}, 400);
    if (value.description === '') value.description = null;
    return value;
}


async function updateProperties(plan: ActivityPlan, body: unknown): Promise<string> {
    const patch = normalizeActivityProperties(body);
    await saveActivityProperties(plan.id, patch, plan.eventId ?? null);
    return 'Activity plan updated';
}

async function updateDescription(planId: string, body: any, expectedEventId?: string | null) {
    const patch = normalizeActivityProperties({description: body?.description});
    if (patch.description === undefined) throw new APIError('Description is required', {}, 400);
    await saveActivityProperties(planId, patch, expectedEventId);
    return 'Description updated';
}

/**
 * Keep semantic date and parent-context checks beside property parsing. The DBAL callback
 * holds the root lock through those checks, generated-work invalidation and the final write;
 * concurrent slot creation takes the same lock before deciding whether its date is allowed.
 */
async function saveActivityProperties(planId: string, patch: ActivityPropertyPatch, expectedEventId?: string | null,
    transport?: ActivityPropertyTransportContext): Promise<components['schemas']['ActivityMetadata'] | void> {
    async function saveProperties(manager: EntityManager): Promise<components['schemas']['ActivityMetadata'] | void> {
        const plan = await requireRecommendationContext(manager, planId);
        assertEntityPropertyContext(plan, expectedEventId);
        // The v1 adapter adds current field authority and its reviewed baseline inside
        // this existing transaction. Direct callers retain their established checks.
        if (transport) {
            const permissions = await activityPermissions(plan, transport.session, manager);
            for (const field of Object.keys(patch) as Array<keyof ActivityPropertyPatch>) {
                if (!permissions.has(entityPropertyPermission('activity', field)!)) throw new ApiProblem('FORBIDDEN');
            }
            const baseline = activityMetadataProjection(plan, permissions);
            requireFieldComparison(transport.token, activityMetadataToken(plan, baseline, transport.session), Object.keys(patch));
        }
        const startDate = patch.startDate ?? plan.startDate;
        const endDate = patch.endDate ?? plan.endDate;
        if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400, {cause: 'ACTIVITY_DATE_RANGE_INVALID'});
        if (startDate !== plan.startDate || endDate !== plan.endDate) {
            if (await activityService.hasActivitySlotsOutsideRange(manager, planId, startDate, endDate)) {
                throw new APIError('The activity date range must include every saved slot', {}, 409, {cause: 'ACTIVITY_DATE_RANGE_EXCLUDES_ACTIVITIES'});
            }
            // Cancel while holding the lock: even a change back to the original dates
            // must invalidate a waiting job. Cancellation after rollback is conservative.
            invalidateEventContext(planId);
            await recommendationService.invalidateGeneratedRecommendations(manager, planId);
        }
        await activityService.updateActivityPlanProperties(planId, patch, manager);
        if (transport) {
            // Prepare the already-known resulting representation before commit; no
            // later projection or context admission can reject a successful write.
            const saved = Object.assign(plan, patch);
            const result = activityMetadataProjection(saved, await activityPermissions(saved, transport.session, manager));
            transport.prepare?.(result);
            return result;
        }
    }
    return activityService.withActivityTransaction(saveProperties);
}

/** Keep new and moved activities inside their current plan's inclusive date range. */
function validateSlotDate(plan: ActivityPlan, day?: string): void {
    // Callers repeat this comparison under the root lock before persistence.
    if (!day || day < plan.startDate || day > plan.endDate) {
        throw new APIError('Slot date must be within the activity plan date range', {}, 400, {cause: 'ACTIVITY_DATE_OUTSIDE_PLAN'});
    }
}

/** Serialize edits with narrowing the parent range; missing snapshots become controller errors. */
async function saveActivitySlot(slotId: string, fields: Partial<ActivitySlot>, admit?: ActivitySlotAdmission): Promise<boolean | undefined> {
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    async function saveSlot(manager: EntityManager): Promise<boolean | undefined> {
        const plan = await requireRecommendationContext(manager, planId);
        // Optional transport authority is evaluated against this locked plan and
        // current slot, independently from the old browser's presentation bundle.
        if (admit) {
            const slot = await activityService.getActivitySlotById(slotId, manager);
            if (!slot || slot.entityId !== plan.id) throw new ApiProblem('NOT_FOUND');
            await admit(manager, plan, slot);
        }
        if (fields.day !== undefined) validateSlotDate(plan, fields.day);
        return activityService.updateActivitySlot(slotId, fields, manager);
    }
    return activityService.withActivityTransaction(saveSlot);
}

async function createTextField(planId: string, body: any) {
    const {title = '', text = ''} = body;
    if (!title.trim()) throw new APIError('Title required', body, 400);
    if (title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 16000) throw new APIError('Text too long', body, 400);
    return await activityService.createActivityPlanTextField(planId, title.trim(), text);
}

/** Validate this plan-owned text field and its optional title grant before the existing sparse write. */
async function updateTextField(planId: string, textFieldId: string, body: any, permData?: PermBundle) {
    // Resolve actual field ownership before validating content or disclosing a write result.
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (field?.entityId !== planId) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    const {title, text = ''} = body;
    if (title !== undefined && title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 16000) throw new APIError('Text too long', body, 400);

    if (title !== undefined && !permData?.entity.has('MANAGE_REQUIREMENTS')) {
        throw new APIError('Not allowed', body, 403);
    }

    await activityService.updateActivityPlanTextField(textFieldId, text, title?.trim());
    return 'Text field updated';
}

/** Remove only an information field belonging to the requested Activity plan. */
async function deleteTextField(planId: string, textFieldId: string) {
    // Reject a foreign or missing field before invoking the unchanged deletion operation.
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (field?.entityId !== planId) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    await activityService.deleteActivityPlanTextField(textFieldId);
    return 'Text field deleted';
}

async function reorderSlots(id: string, order: { slotId: string, pos: number }[]) {
    await activityService.reorderActivitySlots(id, order);
    return 'Order saved';
}

/** Validate an activity draft, then retain the existing slot/role persistence order. */
async function quickAddSlot(plan: ActivityPlan, body: any, session: SessionLike) {
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
async function updateSlotDescription(slotId: string, body: any, admit?: ActivitySlotAdmission) {
    // The sparse writer retains range/context checks and its vanished-row diagnostic.
    if (!(await saveActivitySlot(slotId, {description: body.description}, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: string, body: any, permData?: PermBundle, admit?: ActivitySlotAdmission) {
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

    let normalizedRoles: number[] | undefined;
    if (body.roles !== undefined) {
        const slot = await activityService.getActivitySlotById(slotId);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        normalizedRoles = await validatePlanRoleIds(slot.entityId, body.roles, body);
    }

    const staged: Partial<ActivitySlot> = {};
    if (body.startTime !== undefined) staged.startTime = body.startTime || null;
    if (body.endTime !== undefined) staged.endTime = body.endTime || null;
    if (body.title !== undefined) staged.title = body.title;
    if (body.description !== undefined) staged.description = body.description || null;
    if (body.maxAssignees !== undefined) staged.maxAssignees = Number(body.maxAssignees) || null;

    if (!(await saveActivitySlot(slotId, staged, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }

    if (normalizedRoles !== undefined) {
        await activityService.updateActivitySlotRoles(slotId, normalizedRoles);
    }

    return 'Slot updated';
}


async function deleteAssignment(assignId: number) {
    await activityService.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}


async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.ACTIVITY, id, body);
    return 'Settings saved';
}


async function authorizeSelfAssignment(
    planId: string,
    slotId: string,
    profileId: string,
    operation: 'assign' | 'unassign',
    roleName?: string,
) {
    const [plan, slot] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotById(slotId),
    ]);

    if (!plan || !slot || slot.entityId !== planId) {
        throw new APIError('Activity slot not found in this plan', {planId, slotId}, 404);
    }

    let requestedRole: {name: string; maxQty: number} | undefined;
    if (roleName !== undefined) {
        if (typeof roleName !== 'string' || !roleName.trim()) {
            throw new APIError('Activity role is required', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_REQUIRED'});
        }
        const slotRoles = await activityService.getActivitySlotRoles(planId);
        requestedRole = slotRoles[slotId]?.find((role) => role.name === roleName);
        if (!requestedRole) {
            throw new APIError('Activity role is not available for this slot', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
    }

    // A user must always be able to remove an existing commitment, even if registration
    // or plan policy changed after it was created.
    if (operation === 'unassign') return;

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

    const assignees = (await activityService.getActivitySlotAssignees(planId))[slotId] ?? [];
    const existingAssignee = assignees.find((assignee) => assignee.profileId === profileId);
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
        if (!alreadyHasRole && roleCount >= requestedRole.maxQty) {
            throw new APIError('This activity role is already full', {planId, slotId, roleName}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
        }
    }
}


async function deleteSlot(slotId: string) {
    await activityService.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

/** Validate selected roles against the actual owning plan before attaching them to the slot. */
async function addSlotRole(slotId: string, body: any) {
    // Reject absent, malformed or default-role selections before resolving the persisted slot scope.
    const {roles} = body;
    if (!roles || !Array.isArray(roles) || roles.length < 1 || roles.includes("default")) {
        throw new APIError('Invalid roles', body, 400);
    }

    const slot = await activityService.getActivitySlotById(slotId);
    if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
    const normalizedRoles = await validatePlanRoleIds(slot.entityId, roles, body);
    await activityService.addActivitySlotRoles(slotId, normalizedRoles);
    return 'Roles added';
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

async function addActivityRole(plan: ActivityPlan, body: any) {
    const {name, description, isDefault} = body;
    if (!name || name === "default") throw new APIError('Missing name', body, 400, {cause: 'ACTIVITY_ROLE_NAME_INVALID'});
    return activityService.ensureRoleId(plan.id, name, isDefault === 'on', description);
}

/** Role quotas and assignment ownership are checked before replacing any role links. */
async function updateRoleAssignments(slotId: string, body: any) {
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
            if (entry.role !== 'default' && count > (role.maxQty ?? 0)) {
                throw new APIError('This activity role is already full', {slotId, role: entry.role}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
            }
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
async function assignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', confirmation?: unknown, admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) throw new APIError('Activity slot not found', {itemId}, 404);
    const planId = current.entityId;
    async function assignParticipant(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [itemId]);
        if (!slot) throw new APIError('Activity slot not found', {itemId}, 404);
        // Versioned admission joins this operation's existing root/slot locks;
        // callers that omit it remain responsible for admission.
        await admit?.(manager, plan, slot);
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const existing = assignments.find((assignment) => assignment.profile.id === profileId);
        if (!existing && !plan.allowOverfillAfterFull && slot.maxAssignees != null && assignments.length >= slot.maxAssignees) {
            throw new APIError('This activity slot is already full', {itemId}, 409, {cause: 'ACTIVITY_FULL'});
        }
        let role = await activityService.getActivityRoleByName(manager, planId, roleName);
        if (!role && roleName !== 'default') {
            throw new APIError('Activity role is not available for this plan', {itemId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
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
            if (slotRole.maxQty != null && roleCount >= slotRole.maxQty) {
                throw new APIError('This activity role is already full', {itemId, roleName}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
            }
        }
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

/** Removing the last role ends the signup; the controller owns this domain decision. */
async function unassignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) return;
    const planId = current.entityId;
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
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const assignment = assignments.find((entry) => entry.item.id === itemId && entry.profile.id === profileId);
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

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, activityService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, activityService.updateHeaderImage);
    return 'Image deleted';
}


/** Bind generic self-membership commands to Activity default-role signup and its overlap confirmation. */
function getAssignmentAccessMapping() {
    // Pass the existing confirmation only to assignment; unassignment keeps its original argument contract.
    return {
        assign: (body: any, profileId: string) => assignActivityAssignmentRole(body.itemId, profileId, 'default', body.overlapConfirmation),
        unassign: (body: any, profileId: string) => unassignActivityAssignmentRole(body.itemId, profileId),
    };
}

/** Bind named-role membership commands to the same Activity signup operations. */
function getRoleAccessMapping() {
    // Keep the submitted role and assignment confirmation together while removal uses the existing role command.
    return {
        assign: (body: any, profileId: string) => assignActivityAssignmentRole(body.itemId, profileId, body.role, body.overlapConfirmation),
        unassign: (body: any, profileId: string) => unassignActivityAssignmentRole(body.itemId, profileId, body.role),
    };
}


export default {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    getScheduleExport,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    updateProperties,
    createTextField,
    updateTextField,
    deleteTextField,
    reorderSlots,
    quickAddSlot,
    updateSlotDescription,
    updateSlotAttr,
    deleteAssignment,
    updateSettings,
    deleteSlot,
    addSlotRole,
    addActivityRole,
    updateRoleAssignments,

    updateHeaderImg,
    deleteHeaderImg,

    authorizeSelfAssignment,
    getAssignmentAccessMapping,
    getRoleAccessMapping,
};

/** Resolve the current feature root without exposing ORM absence or owner data. */
async function requireActivityPlan(id: string, manager?: EntityManager): Promise<ActivityPlan> {
    const plan = await activityService.getActivityPlanById(id, manager);
    if (!plan) throw new ApiProblem('NOT_FOUND');
    return plan;
}

/** Current method authority remains separate from detail-page admission. */
async function activityPermissions(plan: ActivityPlan, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'entity', entity: {entityType: 'activity', entityId: plan.id,
        ownerId: plan.ownerId, eventId: plan.eventId}}, session, undefined, manager);
}

/** Match the item method's independent creator grant and parent fallback. */
async function activityItemPermissions(plan: ActivityPlan, slot: ActivitySlot, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: 'activitySlot', entityId: slot.id,
        ownerId: slot.profileId, eventId: plan.eventId}, parent: {entityType: 'activity', entityId: plan.id,
        ownerId: plan.ownerId, eventId: plan.eventId}}, session, undefined, manager);
}

/** Capture identity from the admitted actor; posted profile values cannot select self. */
function activityActorId(session: SessionLike): string {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    return session.profile.id;
}

/** Root methods authorize independently of page admission, including public grants. */
async function requireActivityMethod(id: string, permission: PermType, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    if (!permissions.has(permission)) throw new ApiProblem('FORBIDDEN');
    return {plan, permissions};
}

/** Child identifiers are scoped before any feature mutation or private projection. */
async function requireActivitySlot(id: string, slotId: string, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const slot = await activityService.getActivitySlotById(slotId);
    if (!slot || slot.entityId !== id) throw new ApiProblem('NOT_FOUND');
    return {plan, slot, permissions: await activityItemPermissions(plan, slot, session)};
}

/** Build the shared permission bundle only for calls which consume that owner. */
async function activityPermissionBundle(plan: ActivityPlan, session: SessionLike): Promise<PermBundle> {
    const slots = await activityService.getActivitySlotsFlat(plan.id);
    return buildPermBundle({entityType: 'activity', entityId: plan.id, ownerId: plan.ownerId, eventId: plan.eventId},
        slots.map(slot => ({entityType: 'activitySlot', entityId: slot.id, ownerId: slot.profileId, eventId: plan.eventId})), session);
}

/** Shared property policy selects values individually rather than leaking a whole root into an editor. */
function activityMetadataProjection(plan: ActivityPlan, permissions: PermView): components['schemas']['ActivityMetadata'] {
    const values: components['schemas']['ActivityMetadata']['values'] = {};
    const editableFields: components['schemas']['ActivityMetadata']['editableFields'] = [];
    for (const field of ['title', 'description', 'startDate', 'endDate'] as const) {
        if (!permissions.has(entityPropertyPermission('activity', field)!)) continue;
        editableFields.push(field);
        if (field === 'description') values.description = plan.description ?? null;
        else values[field] = plan[field];
    }
    return {entityType: 'activity', id: plan.id, values, editableFields, currentEventId: plan.eventId ?? null,
        archived: Boolean(plan.archivedAt), inheritedArchived: Boolean(plan.event?.archivedAt)};
}

/** Metadata refresh and comparisons contain only fields currently visible to this actor. */
function activityMetadataToken(plan: ActivityPlan, data: components['schemas']['ActivityMetadata'], session: SessionLike): string {
    return comparisonToken('activity-meta', plan.id, session, data.values);
}

/** Public creation definitions preserve the audience matrix without disclosing an existing plan. */
export function activityFormContext(): components['schemas']['ActivityCreateContext'] {
    return {defaults: completeDefaults(getInitialPerms('activity')), ...permissionDefinitions()};
}

/** Initial creation retains account-only admission; duplicate GET has its own method grant. */
export function readActivityCreateContext(session: SessionLike): components['schemas']['ActivityCreateContext'] {
    activityActorId(session);
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
    return activityFormContext();
}

/** Stored image references remain private; consumers receive only an admitted route and opaque version. */
function activityHeaderProjection(plan: ActivityPlan) {
    return {headerUrl: plan.headerImg ? `/api/v1/activity-plans/${encodeURIComponent(plan.id)}/header` : null,
        headerVersion: getHeaderImageVersion(plan.headerImg)};
}

/** Shared field methods define every slot capability; presentation never grants authority. */
function activitySlotCapabilities(permissions: PermView): components['schemas']['ActivitySlotView']['capabilities'] {
    function allowed(field: keyof components['schemas']['ActivitySlotPatch']): boolean {
        const rule = activitySlotFieldPermissions[field];
        return permissions.allow(rule.permission, rule.parent);
    }
    return {editTitle: allowed('title'), editDescription: allowed('description'), editMeta: allowed('startTime'),
        // The inline title/capacity guard intentionally differs from the
        // modal's meta fallback and the field-specific server authorization.
        inlineMetadataAdmission: permissions.allow('EDIT_META', 'ITEM_EDIT'),
        editCapacity: allowed('maxAssignees'), editRoles: allowed('roles'), manageAssignments: allowed('roles'),
        remove: permissions.allow('ITEM_DELETE', 'ITEM_DELETE')};
}

/** Token values mirror only editable wire fields, including canonical role
 * identities, so the read baseline and conditional write share one projection. */
function activitySlotValues(slot: ActivitySlot, roles: number[], permissions: PermView): components['schemas']['ActivitySlotPatch'] {
    const capabilities = activitySlotCapabilities(permissions);
    return {...(capabilities.editTitle ? {title: slot.title} : {}),
        ...(capabilities.editDescription ? {description: slot.description ?? null} : {}),
        ...(capabilities.editMeta ? {startTime: slot.startTime ?? null, endTime: slot.endTime ?? null} : {}),
        ...(capabilities.editCapacity ? {maxAssignees: slot.maxAssignees ?? null} : {}),
        ...(capabilities.editRoles ? {roles: roles.map(String)} : {})};
}

/** Project the approved Vue civil calendar through the same pure owner used by
 * creation. This versioned presentation adapter performs no reads or writes;
 * shared presentation, domain calculations and printable output keep their owners. */
export function projectActivityScheduleWeeks(startDate: string, endDate: string): components['schemas']['ActivityWeek'][] {
    return civilDateWeeks(startDate, endDate);
}

/** Assemble ACT-01–07 through the existing view/requirements owners, then explicitly redact the wire projection. */
export async function readActivityPlan(id: string, session: SessionLike) {
    const profileId = activityActorId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    if (await getEntityViewAdmission('activity', plan, session, undefined, permissions) !== 'render') throw new ApiProblem('FORBIDDEN');
    // Existing production owners calculate counts, attendance and saved requirement progress.
    // The transport never spreads an ORM root, assignment, profile or event into its response.
    const source = await fetchForView(plan, {session} as Request, true);
    const bundle = await activityPermissionBundle(plan, session);
    const slots: components['schemas']['ActivitySlotView'][] = [];
    for (const slot of Object.values(source.slots).flat()) {
        const itemPermissions = bundle.item(slot.id);
        const visible = itemPermissions.allow('ACCESS_PARTICIPANTS', 'ACCESS_PARTICIPANTS');
        const assigned = source.assigneeLists[slot.id] ?? [];
        const own = assigned.find(assignment => assignment.profileId === profileId);
        const configured = source.roles.slotRoles[slot.id] ?? [];
        const values = activitySlotValues(slot, configured.map(role => role.id), itemPermissions);
        const roles = configured.map(role => {
            // A role remains visible while its holder's identity and removable
            // assignment handle follow the independent participant permission.
            const assignee = assigned.find(assignment => assignment.roles.includes(role.name));
            return {id: String(role.id), name: role.name, maxQty: role.maxQty, assignedQty: role.assignedQty,
                assignmentId: visible && assignee ? String(assignee.id) : null,
                assigneeName: visible && assignee ? assignee.name : null, self: assignee?.profileId === profileId};
        });
        slots.push({id: slot.id, day: slot.day, position: slot.pos, title: slot.title, description: slot.description ?? null,
            startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? null,
            assignedCount: slot.assignedCount, selfAssigned: Boolean(own), selfRoles: own?.roles ?? [], roles,
            assignees: visible ? assigned.map(assignment => ({assignmentId: String(assignment.id), name: assignment.name, roles: assignment.roles})) : [],
            capabilities: activitySlotCapabilities(itemPermissions), editToken: comparisonToken('activity-slot', slot.id, session, values)});
    }
    // Participant privacy is enforced by this new boundary; the shared
    // IMP-018 projection is neither serialized nor silently repaired here.
    const participants: components['schemas']['ActivityParticipant'][] = [];
    if (permissions.has('ACCESS_PARTICIPANTS')) {
        for (const participant of source.participantList) {
            // Whitelist the existing status fields; attendance is bounded rather
            // than exposing a registration/profile row or future source fields.
            participants.push({participantKey: participant.participantKey, name: participant.name,
                nameIsFallback: participant.nameIsFallback === true, count: participant.count,
                assignedShifts: participant.assignedShifts, roles: participant.roles, roleIds: (participant.roleIds ?? []).map(String),
                requiredShifts: participant.requiredShifts, remainingShifts: participant.remainingShifts,
                source: participant.source, attendanceDays: participant.attendanceDays, assignmentMode: participant.assignmentMode,
                attendance: participant.attendance ? {arrivalDate: participant.attendance.arrivalDate ?? null,
                    departureDate: participant.attendance.departureDate ?? null} : null});
        }
    }
    let currentEventUrl: string | null = null;
    if (plan.event) {
        const views = await evaluateEntities([{entityType: 'event', entityId: plan.event.id, ownerId: plan.event.ownerId, eventId: plan.event.id}], session);
        currentEventUrl = getAuthorizedEventUrl(plan.event.id, views.get(`event:${plan.event.id}`)!)?.replace(/^\/event(?=\/|$)/u, '/event') ?? null;
    }
    const metadata = activityMetadataProjection(plan, permissions);
    const data: components['schemas']['ActivityView'] = {
        entityType: 'activity', id, title: plan.title, description: plan.description ?? null,
        startDate: plan.startDate, endDate: plan.endDate, ...activityHeaderProjection(plan),
        currentEventId: plan.eventId ?? null, currentEventUrl, archived: Boolean(plan.archivedAt),
        inheritedArchived: Boolean(plan.event?.archivedAt), assignmentMode: plan.assignmentMode, canSelfAssign: source.canSelfAssign,
        allowOverfillAfterFull: Boolean(plan.allowOverfillAfterFull), bindingDeadline: plan.bindingDeadline?.toISOString() ?? null,
        requirementProgress: source.requirementProgress ?? null, slots, weeks: projectActivityScheduleWeeks(plan.startDate, plan.endDate),
        allRoles: source.roles.allRoles.map(role => ({id: String(role.id), title: role.title, description: role.description ?? null})),
        textFields: source.textFields.map(field => ({id: field.id, title: field.title, text: field.text ?? '',
            editToken: comparisonToken('activity-text', field.id, session, {text: field.text ?? '',
                ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})}),
            capabilities: {edit: permissions.has('ACCESS_VIEW'), editTitle: permissions.has('MANAGE_REQUIREMENTS'), delete: permissions.has('MANAGE_REQUIREMENTS')}})),
        participants, counters: {participants: permissions.has('ACCESS_PARTICIPANTS') ? source.counters.participants : null,
            open: source.counters.open, empty: source.counters.empty},
        orderToken: comparisonToken('activity-order', id, session, {order: slots.map(slot => ({slotId: slot.id, position: slot.position}))}),
        capabilities: {editTitle: metadata.editableFields.includes('title'), editDescription: metadata.editableFields.includes('description'),
            editDates: metadata.editableFields.includes('startDate') || metadata.editableFields.includes('endDate'),
            addSlot: permissions.has('ITEM_ADD'), reorderSlots: permissions.has('ITEM_EDIT'),
            manageSettings: Boolean(metadata.editableFields.length || permissions.any('MANAGE_PERMISSIONS', 'EDIT_META', 'DATA_DUPLICATE', 'DATA_EXPORT') || isOwner(session, plan.ownerId)),
            // Role creation has a separate browser EDIT_META admission;
            // its unchanged server operation still requires MANAGE_ASSIGNMENTS.
            manageRequirements: permissions.has('MANAGE_REQUIREMENTS'), manageRecommendations: permissions.has('MANAGE_ASSIGNMENTS'),
            roleCreationAdmission: permissions.has('EDIT_META'), exportSchedule: permissions.has('DATA_EXPORT'),
            // The retained advanced destination is a root grant on linked plans;
            // empty schedules and unrelated item grants do not change its visibility.
            rulesWorkspace: Boolean(plan.eventId && permissions.any('MANAGE_REQUIREMENTS', 'MANAGE_ASSIGNMENTS')),
            duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')), remove: isOwner(session, plan.ownerId)},
    };
    return {data, etag: entityTag('activity-view', {profileId, data})};
}

/** Creation reuses existing validation, root/slot transaction and audience persistence in their established order. */
export async function createActivityPlan(body: components['schemas']['ActivityCreateInput'], file: Express.Multer.File | undefined, session: SessionLike,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityCreated']>, persisted?: ActivityCreationCompletion): Promise<components['schemas']['ActivityCreated']> {
    readActivityCreateContext(session);
    checkNewImage(file);
    await authorizeEventLink(body.eventId, session);
    // Adapt only wire names and grouping; form parsing still owns date/time checks.
    const grouped: Record<string, unknown[]> = {};
    for (const slot of body.slots) (grouped[slot.day] ??= []).push({...slot, pos: slot.position, position: undefined});
    const parsed = preprocessCreate({...body, slots: JSON.stringify(grouped), event_id: body.eventId ?? ''});
    parsed.headerImg = file?.path;
    function prepareCreated(id: string): void { prepare?.({id}); }
    const id = await createEntity(activityActorId(session), parsed, prepareCreated);
    // Root/slot persistence is already final under the inherited creation order.
    // A later defaults failure must never delete that persisted root's image.
    persisted?.(id);
    await saveDefaultPermsFromBody('activity', id, {defaultPerms: body.defaultPermissions}, {inputFormat: 'masks'});
    return {id};
}

/** Duplicate form content without creation constraints: existing edits may need
 * correction in the copied form. Membership, images, history and ACLs are excluded. */
export async function readActivityDuplicate(id: string, session: SessionLike, eventId?: unknown): Promise<components['schemas']['ActivityDuplicate']> {
    const {plan} = await requireActivityMethod(id, 'DATA_DUPLICATE', session);
    const slots = Object.values(await fetchForDuplicate(plan, session as Request['session'])).flat();
    const selected = eventId !== undefined ? await readEventLinkSelection(eventId, session) : null;
    // Match form defaults without hiding signed capacities or blank titles;
    // submitting the copied draft still uses the stricter creation contract.
    return {title: plan.title, description: plan.description ?? null, startDate: plan.startDate, endDate: plan.endDate,
        eventId: null, slots: slots.map(slot => ({id: generateUniqueId(), day: slot.day, position: slot.pos, title: slot.title,
            description: slot.description ?? '', startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees || 1})),
        defaultPermissions: completeDefaults(await adminService.getDefaultPerms('activity', id)), formContext: activityFormContext(),
        ...(eventId !== undefined ? {selectedEvent: selected ? {...selected, description: selected.description ?? null} : null} : {})};
}

/** Field-only baseline supports independently granted edits without granting the detail page. */
export async function readActivityMetadata(id: string, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const data = activityMetadataProjection(plan, await activityPermissions(plan, session));
    if (!data.editableFields.length) throw new ApiProblem('FORBIDDEN');
    return {data, etag: activityMetadataToken(plan, data, session)};
}

/** Patch metadata under the existing root lock, preserving dates/assignments and preparing before commit. */
export async function patchActivityMetadata(id: string, body: components['schemas']['ActivityMetadataPatch'], session: SessionLike, token?: string,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityMetadata']>) {
    const patch = normalizeActivityProperties(body);
    const data = await saveActivityProperties(id, patch, undefined, {session, token, prepare}) as components['schemas']['ActivityMetadata'];
    return {data, etag: comparisonToken('activity-meta', id, session, data.values)};
}

/** Settings compose shared metadata, event, lifecycle and access owners with their existing grants. */
export async function readActivitySettings(id: string, session: SessionLike): Promise<components['schemas']['ActivitySettings']> {
    activityActorId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    const metadata = activityMetadataProjection(plan, permissions);
    const owns = isOwner(session, plan.ownerId);
    if (!owns && !metadata.editableFields.length && !permissions.any('EDIT_META', 'MANAGE_PERMISSIONS', 'DATA_DUPLICATE', 'DATA_EXPORT')) throw new ApiProblem('FORBIDDEN');
    const property = await getEntityPropertyPresentation('activity', plan, session);
    const archive = (await getArchivePresentations([{type: 'activity', id}], session)).get(`activity:${id}`)!;
    let access: components['schemas']['PackingAccess'] | null = null;
    if (permissions.has('MANAGE_PERMISSIONS')) {
        const admins = await adminService.listAdmins('activity', id);
        access = {defaults: completeDefaults(await adminService.getDefaultPerms('activity', id)), ...permissionDefinitions(),
            admins: admins.map(admin => ({profileId: admin.profileId, name: admin.profile.name, isGuest: Boolean(admin.profile.guestId),
                mask: admin.perms, editToken: comparisonToken('activity-admin', `${id}:${admin.profileId}`, session, {mask: admin.perms})}))};
    }
    // Parent disclosure follows its independent method grant, not child management.
    const current = property.currentEvent;
    const currentEvent = current ? {id: current.id, title: current.title ?? null, startDate: current.startDate ?? null,
        endDate: current.endDate ?? null, url: current.url?.replace(/^\/event(?=\/|$)/u, '/event') ?? null} : null;
    return {id, title: plan.title, ...activityHeaderProjection(plan),
        editableFields: metadata.editableFields,
        settingsToken: comparisonToken('activity-settings', id, session, {eventId: plan.eventId ?? null, header: plan.headerImg ?? null,
            ...(access ? {...activityDefaultValues(access.defaults), newAdmin: null} : {})}),
        capabilities: {editHeader: permissions.has(entityMethodPermission('editHeader')), linkEvent: permissions.has(entityMethodPermission('changeEvent')),
            managePermissions: permissions.has('MANAGE_PERMISSIONS'), duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')),
            remove: owns, manageArchive: archive.canManage, archive: archive.canArchive, restore: archive.canRestore,
            manageAutomation: archive.canManageAutomation, export: permissions.has('DATA_EXPORT')},
        currentEvent, archive: {direct: archive.directArchived, inherited: Boolean(archive.inheritedFromEventId),
            archivedAt: plan.archivedAt?.toISOString() ?? null, autoArchivePaused: archive.autoArchivePaused,
            hasAutomaticSchedule: archive.hasAutomaticSchedule, eventUrl: currentEvent?.url ?? null}, access};
}

/** Event discovery uses event-picker admission and excludes credentials/private parent fields. */
export async function searchActivityEvents(query: unknown, session: SessionLike): Promise<components['schemas']['ActivityEventOptions']> {
    const result = await getEventLinkOptions(query, session);
    return {items: result.items.map(event => ({...event, description: event.description ?? null})),
        selected: result.selected ? {...result.selected, description: result.selected.description ?? null} : null, nextCursor: result.nextCursor};
}

/** Relinking delegates current parent locks, attachment policy and recommendation invalidation to the shared owner. */
export async function changeActivityEvent(id: string, body: components['schemas']['ActivityEventChange'], session: SessionLike, token?: string,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityEventChanged']>): Promise<components['schemas']['ActivityEventChanged']> {
    const plan = await requireActivityPlan(id);
    /** The existing relink owner invokes this only after its current authority
     * and meaningful-change checks, while retaining its parent/root locks. */
    async function reviewContext(manager: EntityManager): Promise<void> {
        const current = await requireActivityPlan(id, manager);
        requireFieldComparison(token, comparisonToken('activity-settings', id, session, {eventId: current.eventId ?? null}), ['eventId']);
    }
    // Completion is prepared in that owner's transaction and retains existing page-admission semantics.
    async function prepareCompletion(manager: EntityManager, outcome: import('../../types/EntityPropertyTypes').EntityMutationOutcome) {
        const result = {changed: outcome.changed, canView: await getEntityViewAdmission('activity', outcome.root, session, manager) === 'render'};
        prepare?.(result);
        return result;
    }
    return changeEntityEvent('activity', plan, body, session, invalidateEventContext, reviewContext, {prepare: prepareCompletion});
}

/** Permission-only baseline reveals masks solely to current permission managers. */
export async function readActivityDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityDefaultsBaseline']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return readEntityDefaultsBaseline('activity', id, session);
}

/** Existing audience owner receives numeric masks; no copied permission collector or ACL rule is introduced. */
export async function setActivityDefaults(id: string, defaults: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    await updateEntityDefaults('activity', id, defaults, session, token);
}

/** Administrator-only baseline exposes exactly the requested profile's existing grant. */
export async function readActivityAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['ActivityAdminBaseline']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return readEntityAdministratorBaseline('activity', id, profileId, session);
}

/** The existing administrator controller retains profile validation and persistence semantics. */
export async function setActivityAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    // Activity deliberately retains its existing review-before-profile, unlocked path.
    await updateEntityAdministrator('activity', id, profileId, mask, session, token, undefined, {reviewOrder: 'review-first'});
}

/** Secure profile discovery retains account-only search and permission-management admission. */
export async function searchActivityProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['ActivityProfileOptions']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return searchEntityProfiles(query);
}

/** Method-only header baseline supplies no stored path or protected page fields. */
export async function readActivityHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityHeaderBaseline']> {
    const {plan} = await requireActivityMethod(id, entityMethodPermission('editHeader'), session);
    return {editToken: comparisonToken('activity-settings', id, session, {header: plan.headerImg ?? null})};
}

/** Header bytes retain full detail admission independently of upload authority. */
export async function readActivityHeaderPath(id: string, session: SessionLike): Promise<string> {
    const plan = await requireActivityPlan(id);
    if (await getEntityViewAdmission('activity', plan, session) !== 'render') throw new ApiProblem('FORBIDDEN');
    if (!plan.headerImg) throw new ApiProblem('NOT_FOUND');
    return plan.headerImg;
}

/** Header writes reuse the existing image replacement lifecycle and file cleanup owner. */
export async function setActivityHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string): Promise<void> {
    const {plan} = await requireActivityMethod(id, entityMethodPermission('editHeader'), session);
    checkNewImage(file);
    // Header-only callers compare the same field as the full settings dialog;
    // no stored path or unrelated access values leave either baseline.
    requireFieldComparison(token, comparisonToken('activity-settings', id, session, {header: plan.headerImg ?? null}), ['header']);
    if (file) await updateHeaderImg(plan, file);
    else await deleteHeaderImg(plan);
}

/** Archive/restore share existing authorization and retain records, files and assignments. */
export async function setActivityArchived(id: string, archived: boolean, session: SessionLike): Promise<void> {
    activityActorId(session);
    if (archived) await archiveEntity({type: 'activity', id}, {}, session);
    else await restoreEntity({type: 'activity', id}, {}, session);
}

/** Pause/resume only the existing independent schedule through the shared lifecycle owner. */
export async function setActivityAutomaticArchival(id: string, body: components['schemas']['EventAutomaticArchivalInput'], session: SessionLike): Promise<void> {
    activityActorId(session);
    // The shared owner checks current management and standalone scheduling under
    // its existing parent/root locks. Its completion avoids a postcommit read.
    function prepareScheduleCompletion() { return {changed: true}; }
    await setAutomaticArchival({type: 'activity', id}, body, session, {prepare: prepareScheduleCompletion});
}

/** Permanent deletion remains the feature's simple operation and requires the current profile owner. */
export async function deleteActivityPlan(id: string, session: SessionLike): Promise<void> {
    const plan = await requireActivityPlan(id);
    if (!isOwner(session, plan.ownerId)) throw new ApiProblem('FORBIDDEN');
    await deleteEntity(plan, session as Request['session']);
    if (plan.headerImg) removeImage(plan.headerImg);
}

/** Independent slot-edit baseline includes only fields permitted by the existing method grants. */
export async function readActivitySlotBaseline(id: string, slotId: string, session: SessionLike): Promise<components['schemas']['ActivitySlotBaseline']> {
    const {slot, permissions} = await requireActivitySlot(id, slotId, session);
    const configured = await activityService.getActivitySlotRoles(id);
    const values = activitySlotValues(slot, (configured[slotId] ?? []).map(role => role.id), permissions);
    if (!Object.keys(values).length) throw new ApiProblem('FORBIDDEN');
    return {values, editableFields: Object.keys(values) as components['schemas']['ActivitySlotBaseline']['editableFields'],
        editToken: comparisonToken('activity-slot', slotId, session, values)};
}

/** Slot creation delegates range/time/role validation and saved ordering to Quick Add. */
export async function createActivitySlot(id: string, body: components['schemas']['ActivityNewSlot'], session: SessionLike): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ITEM_ADD', session);
    activityActorId(session);
    await quickAddSlot(plan, {...body, date: body.day}, session);
}

/** Preserve sparse slot writes and role relationship behavior, including the deferred IMP-016 defect. */
export async function patchActivitySlot(id: string, slotId: string, body: components['schemas']['ActivitySlotPatch'], session: SessionLike, token?: string): Promise<void> {
    const {plan, permissions} = await requireActivitySlot(id, slotId, session);
    const bundle = await activityPermissionBundle(plan, session);
    /** Recheck each submitted field against the locked current item rather than
     * treating the initial editor's permission bundle as mutation authority. */
    async function admitSlot(manager: EntityManager, currentPlan: ActivityPlan, currentSlot: ActivitySlot): Promise<void> {
        if (currentPlan.id !== id) throw new ApiProblem('NOT_FOUND');
        const currentPermissions = await activityItemPermissions(currentPlan, currentSlot, session, manager);
        const configured = await activityService.getActivitySlotRoles(id);
        const values = activitySlotValues(currentSlot, (configured[slotId] ?? []).map(role => role.id), currentPermissions);
        for (const field of Object.keys(body)) {
            if (!Object.hasOwn(values, field)) throw new ApiProblem('FORBIDDEN');
        }
        requireFieldComparison(token, comparisonToken('activity-slot', slotId, session, values), Object.keys(body));
    }
    // The attribute operation requires its meta grant even for a mixed editor;
    // description-only saves use their separate shared method and fallback.
    if (Object.keys(body).every(field => field === 'description')) {
        if (!permissions.allow('EDIT_DESC', ['ITEM_EDIT', 'ITEM_EDIT_DESC'])) throw new ApiProblem('FORBIDDEN');
        await updateSlotDescription(slotId, body, admitSlot);
    } else {
        if (!permissions.allow('EDIT_META', ['ITEM_EDIT', 'ITEM_EDIT_META'])) throw new ApiProblem('FORBIDDEN');
        await updateSlotAttr(slotId, {...body}, bundle, admitSlot);
    }
}

/** Item deletion scopes the child and applies the same item/parent deletion grant. */
export async function removeActivitySlot(id: string, slotId: string, session: SessionLike): Promise<void> {
    const {permissions} = await requireActivitySlot(id, slotId, session);
    if (!permissions.allow('ITEM_DELETE', 'ITEM_DELETE')) throw new ApiProblem('FORBIDDEN');
    await deleteSlot(slotId);
}

/** Ordering baseline discloses only slot identifiers/positions to current reorder callers. */
export async function readActivityOrderBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityOrderBaseline']> {
    await requireActivityMethod(id, 'ITEM_EDIT', session);
    const order = (await activityService.getActivitySlotsFlat(id)).map(slot => ({slotId: slot.id, position: slot.pos}));
    return {order, editToken: comparisonToken('activity-order', id, session, {order})};
}

/** Direct ordering persists only submitted positions and leaves saved assignments intact. */
export async function setActivityOrder(id: string, body: components['schemas']['ActivityOrderInput'], session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'ITEM_EDIT', session);
    const current = await activityService.getActivitySlotsFlat(id);
    const order = current.map(slot => ({slotId: slot.id, position: slot.pos}));
    requireFieldComparison(token, comparisonToken('activity-order', id, session, {order}), ['order']);
    const slots = new Set(current.map(slot => slot.id));
    if (body.order.some(row => !slots.has(row.slotId))) throw new ApiProblem('NOT_FOUND');
    await reorderSlots(id, body.order.map(row => ({slotId: row.slotId, pos: row.position})));
}

/** Warning previews reuse the existing private sibling projection and opaque exact-overlap acknowledgement. */
export async function previewActivityAssignment(id: string, slotId: string, body: components['schemas']['ActivityWarningTarget'], session: SessionLike): Promise<AssignmentWarningPreview> {
    const {plan} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    await requireActivitySlot(id, slotId, session);
    return getAssignmentWarningPreview(id, slotId, session as Request['session'], await activityPermissionBundle(plan, session), body);
}

/** Self commands retain distinct whole-slot/named-role behavior, deadline rules and the existing locked warning check. */
export async function setActivityAssignment(id: string, slotId: string, body: components['schemas']['ActivityAssignmentInput'], session: SessionLike): Promise<void> {
    const {plan, permissions} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    const profileId = activityActorId(session);
    await requireActivitySlot(id, slotId, session);
    // Match the shared binding-deadline admission for both joining and leaving.
    if (plan.bindingDeadline && plan.bindingDeadline.getTime() <= Date.now() && !permissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    const operation = body.assigned ? 'assign' : 'unassign';
    await authorizeSelfAssignment(id, slotId, profileId, operation, body.role);
    /** The new transport repeats its own context/method admission inside the
     * shared assignment owner's existing locks, without another write owner. */
    async function admitAssignment(manager: EntityManager, currentPlan: ActivityPlan): Promise<void> {
        if (currentPlan.id !== id) throw new ApiProblem('NOT_FOUND');
        const currentPermissions = await activityPermissions(currentPlan, session, manager);
        if (!currentPermissions.has('ACCESS_VIEW')) throw new ApiProblem('FORBIDDEN');
        if (currentPlan.bindingDeadline && currentPlan.bindingDeadline.getTime() <= Date.now()
            && !currentPermissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    }
    if (body.assigned) await assignActivityAssignmentRole(slotId, profileId, body.role ?? 'default', body.overlapConfirmation, admitAssignment);
    else await unassignActivityAssignmentRole(slotId, profileId, body.role, admitAssignment);
}

/** Organizer removal uses the existing assignment owner and its per-item grant. */
export async function removeActivityAssignment(id: string, assignmentId: string, session: SessionLike): Promise<void> {
    const assignment = await activityService.getActivitySlotAssignmentById(Number(assignmentId));
    if (!assignment || assignment.entityId !== id) throw new ApiProblem('NOT_FOUND');
    const {permissions} = await requireActivitySlot(id, assignment.item.id, session);
    if (!permissions.allow('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    await deleteAssignment(Number(assignmentId));
}

/** Role creation retains the existing controller's name/default semantics and plan ownership. */
export async function createActivityRole(id: string, body: components['schemas']['ActivityRoleInput'], session: SessionLike): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    await addActivityRole(plan, {...body, isDefault: body.isDefault ? 'on' : undefined});
}

/** Organizer role assignment keeps the same signed-up participants, named-role quotas and replacement transaction. */
export async function setActivityRoleAssignments(id: string, slotId: string, body: components['schemas']['ActivityRoleAssignmentsInput'], session: SessionLike): Promise<void> {
    const {permissions} = await requireActivitySlot(id, slotId, session);
    if (!permissions.allow('MANAGE_ASSIGNMENTS', 'MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    await updateRoleAssignments(slotId, body);
}

/** Shared text creation remains distinct from local schedule filters and requires the management grant. */
export async function createActivityTextField(id: string, body: components['schemas']['ActivityTextFieldInput'], session: SessionLike): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    await createTextField(id, body);
}

/** Shared text writes retain ACCESS_VIEW for text and the additional MANAGE_REQUIREMENTS title grant. */
export async function patchActivityTextField(id: string, fieldId: string, body: components['schemas']['ActivityTextFieldPatch'], session: SessionLike, token?: string): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    // Text/title baselines are private to their existing method grants; shared
    // persistence remains the unchanged shared controller operation below.
    const field = await activityService.getActivityPlanTextFieldById(fieldId);
    if (!field || field.entityId !== id) throw new ApiProblem('NOT_FOUND');
    const permissions = await activityPermissions(plan, session);
    if (body.title !== undefined && !permissions.has('MANAGE_REQUIREMENTS')) throw new ApiProblem('FORBIDDEN');
    const values = {text: field.text ?? '', ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})};
    requireFieldComparison(token, comparisonToken('activity-text', fieldId, session, values), Object.keys(body));
    await updateTextField(id, fieldId, body, await activityPermissionBundle(plan, session));
}

/** Text removal keeps its existing child-scope check and management authorization. */
export async function removeActivityTextField(id: string, fieldId: string, session: SessionLike): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    await deleteTextField(id, fieldId);
}

/** Project private requirement inputs explicitly, retaining the shared pure engine's
 * saved analysis and calculation inputs without sending ORM relations or profile records. */
export async function readActivityRequirements(id: string, session: SessionLike): Promise<components['schemas']['ActivityRequirements']> {
    // Requirement management has its own method grant, separate from page admission.
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    const [data, allRoles] = await Promise.all([getRequirements(id, true), activityService.getAllRoles(id)]);
    const plan = data.plan;

    // Select scalars from each persistence result before it crosses the versioned
    // boundary. Numeric database handles become strings here; the shared
    // controller, persistence and requirement engines keep their numeric contract.
    return {
        plan: {id: plan.id, assignmentMode: plan.assignmentMode, generalRequiredShifts: plan.generalRequiredShifts ?? null,
            roundingMode: plan.roundingMode ?? null, bindingDeadline: plan.bindingDeadline?.toISOString() ?? null,
            startDate: plan.startDate, endDate: plan.endDate, allowOverfillAfterFull: Boolean(plan.allowOverfillAfterFull),
            allowExternalAssignees: Boolean(plan.allowExternalAssignees), allowArrivalDayEvening: Boolean(plan.allowArrivalDayEvening),
            allowDepartureDayMorning: Boolean(plan.allowDepartureDayMorning)},
        roleRequirements: data.roleRequirements.map(row => ({roleId: String(row.roleId), requiredShifts: row.requiredShifts})),
        stayRequirements: data.stayRequirements.map(row => ({stayDays: row.stayDays, requiredShifts: row.requiredShifts})),
        overrides: data.overrides.map(row => ({id: row.id == null ? undefined : String(row.id), profileId: row.profileId,
            roleId: row.roleId == null ? null : String(row.roleId),
            requiredShifts: row.requiredShifts, profileName: row.profile?.name ?? null})),
        participants: data.participants.map(row => ({participantKey: row.participantKey, name: row.name ?? null,
            roleIds: (row.roleIds ?? []).map(String), requiredShifts: row.requiredShifts, assignedShifts: row.assignedShifts,
            remainingShifts: row.remainingShifts, source: row.source, attendanceDays: row.attendanceDays,
            attendance: {arrivalDate: row.attendance?.arrivalDate ?? null, departureDate: row.attendance?.departureDate ?? null},
            roles: row.roles, assignmentMode: row.assignmentMode})),
        capacitySummary: {availableSlots: data.capacitySummary.availableSlots, requiredSlots: data.capacitySummary.requiredSlots,
            difference: data.capacitySummary.difference, configurationComplete: data.capacitySummary.configurationComplete},
        calculationContext: {
            participants: data.calculationContext.participants.map(row => ({profileId: row.profileId ?? null,
                name: row.name ?? null, arrivalDate: row.arrivalDate ?? null, departureDate: row.departureDate ?? null,
                roleIds: (row.roleIds ?? []).map(String)})),
            assignedShiftCounts: data.calculationContext.assignedShiftCounts,
            slots: data.calculationContext.slots.map(slot => ({id: slot.id, day: slot.day,
                startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? null,
                roles: slot.roles.map(role => ({...role, roleId: String(role.roleId)}))})),
        },
        overrideTargets: data.overrideTargets.map(row => ({key: row.key, profileId: row.profileId, label: row.label,
            nameIsFallback: row.nameIsFallback === true, arrivalDate: row.arrivalDate, departureDate: row.departureDate})),
        allRoles: allRoles.map(role => ({id: String(role.id), title: role.title, description: role.description ?? null})),
    };
}

/** Preserve the settings transaction and omission retention, with explicit saved-ID removal. */
export async function saveActivityRequirements(id: string, input: components['schemas']['ActivityRequirementsInput'], session: SessionLike): Promise<void> {
    // The existing controller owns all requirement decisions and its transaction lifecycle.
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    const {removedOverrideIds = [], ...settings} = input;
    await updateRequirements(id, settings, removedOverrideIds);
}

/** Recommendations display only their slot labels, never full slot persistence records. */
function activityRecommendationSlot(slot: Pick<ActivitySlot, 'id' | 'title' | 'day' | 'startTime' | 'endTime'>): components['schemas']['ActivityRecommendationSlot'] {
    return {id: slot.id, title: slot.title, day: slot.day, startTime: slot.startTime ?? null, endTime: slot.endTime ?? null};
}

/** Domain job diagnostics remain server-owned; status and identity are sufficient
 * for the localized terminal presentation without exposing worker or database errors. */
function activityRecommendationJob(job: RecommendationJobView): components['schemas']['ActivityRecommendationJob'] {
    return {id: job.id, planId: job.planId, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
        ...(job.recommendationCount === undefined ? {} : {recommendationCount: job.recommendationCount})};
}

/** Whitelist a warning's operation identity after the shared warning owner redacts sibling details. */
function activityRecommendationWarnings(results: RecommendationWarningResult[]): components['schemas']['ActivityRecommendationWarning'][] {
    // Existing domain warnings are plain scalar projections; normalize their optional profile shape.
    return results.map(result => ({recommendation: {
        ...(result.recommendation.id ? {id: result.recommendation.id} : {}),
        itemId: result.recommendation.itemId, profileId: result.recommendation.profileId ?? undefined,
        status: result.recommendation.status, operation: result.recommendation.operation,
        sourceItemId: result.recommendation.sourceItemId, manual: result.recommendation.manual,
    }, warnings: result.warnings}));
}

/** Entry intentionally retains workspace maintenance/enqueue semantics. Recovery reads and
 * domain-job observation never call that mutation path, so periodic reads cannot start work. */
export async function readActivityRecommendations(id: string, session: SessionLike, enter = false): Promise<components['schemas']['ActivityRecommendations']> {
    // Independently authorize the private recommendation workspace on every invocation.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const data = await getRecommendations(id, session, enter, true);

    // Reuse the existing presentation inputs but exclude ORM timestamps, ownership and relations.
    return {
        recommendations: data.recommendations.map(row => ({id: row.id, item: activityRecommendationSlot(row.item),
            profile: {id: row.profile.id, name: row.profile.name}, sourceItem: row.sourceItem ? activityRecommendationSlot(row.sourceItem) : null,
            status: row.status, operation: row.operation, manual: row.manual})),
        participantOptions: data.participantOptions.map(row => ({key: row.key, profileId: row.profileId, label: row.label,
            nameIsFallback: row.nameIsFallback === true, arrivalDate: row.arrivalDate, departureDate: row.departureDate})),
        slots: data.slots.map(activityRecommendationSlot),
        existingAssignments: data.existingAssignments.map(row => ({item: activityRecommendationSlot(row.item),
            profile: row.profile, roles: row.roles})),
        warnings: activityRecommendationWarnings(data.warnings),
        autoGenerationJob: data.autoGenerationJob ? activityRecommendationJob(data.autoGenerationJob) : null,
    };
}

/** Preview the exact batch with existing source validation and permission-redacted collisions. */
export async function previewActivityRecommendations(id: string, input: components['schemas']['ActivityRecommendationReview'], session: SessionLike): Promise<components['schemas']['ActivityRecommendationPreview']> {
    // Preview remains read-only; its opaque overlap digest grants no broader authority.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await getRecommendationWarningPreview(id, input, session);
    return {warnings: activityRecommendationWarnings(result.warnings), overlapConfirmation: result.overlapConfirmation};
}

/** Apply the submitted batch once, preserving skipped counts, reciprocal moves and
 * inherited postcommit regeneration behavior. No adapter refresh follows the command. */
export async function applyActivityRecommendations(id: string, input: components['schemas']['ActivityRecommendationApplication'], session: SessionLike): Promise<components['schemas']['ActivityRecommendationApplyResult']> {
    // The existing controller rechecks the warning review before its transaction writes.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await applyRecommendations(id, input, session);
    return {applied: result.applied, skipped: result.skipped, warnings: activityRecommendationWarnings(result.warnings)};
}

/** Explicit generation reuses the existing coordinator and coalescing identity. */
export async function generateActivityRecommendations(id: string, session: SessionLike): Promise<components['schemas']['ActivityRecommendationQueued']> {
    // Generation remains a deliberate command; ordinary snapshots cannot dispatch it.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await queueAutoGenerateRecommendations(id);
    return {job: activityRecommendationJob(result.job), coalesced: result.coalesced};
}

/** Observe only the specified domain job, including its current terminal state. */
export async function readActivityRecommendationJob(id: string, jobId: string, session: SessionLike): Promise<components['schemas']['ActivityRecommendationJobResult']> {
    // The existing owner scopes job identity to this plan and returns missing jobs honestly.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await getAutoRecommendationJob(id, jobId);
    return {job: activityRecommendationJob(result.job)};
}
