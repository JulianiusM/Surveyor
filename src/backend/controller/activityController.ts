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

import {
    defaultPermissionValues as activityDefaultValues, readEntityDefaultsBaseline, updateEntityDefaults,
    readEntityAdministratorBaseline, updateEntityAdministrator, searchEntityProfiles, completeDefaults,
    getEntityPropertyPresentation, readEntitySettingsAccess, entityCreationPermissionContext, basicEntityPropertyRules,
} from './entityAdminController';
import type {RequirementPageSection} from '../../types/ActivityRequirementTypes';
import * as requirementService from '../modules/database/services/ActivityRequirementService';
import {
    toParticipantKey,
    toParticipantName, calculateParticipantRequirement,
} from '../../common/activity/requirements';
import {
    projectActivityAssignees, getActivityRequirementAnalysis, saveActivityRequirementConfiguration, isActivityOversized,
    requireActivityDuration, invalidateEventContext,
    queueAutoGenerateRecommendations, getAutoRecommendationJob, requireRequirementConfiguration,
    requireRecommendationContext,
} from '../modules/activity/autoAssignment';
import settings from '../modules/settings';
import {
    quickAddSlot, updateSlotDescription, updateSlotAttr, activitySlotFieldPermission, applyActivityProperties,
    authorizeSelfAssignment, addActivityRole, updateRoleAssignments, assignActivityAssignmentRole, unassignActivityAssignmentRole,
} from '../modules/activity/slots';
import type {CivilDateWindow} from '../../types/CivilDateTypes';
import type {
    ActivityPrintDay, ActivityPrintWeek, SlotAssignmentMap, RecommendationJobView,
    ActivityCreationCompletion, ActivityPropertyPatch, AssignmentWarningPreview, RecommendationWarningResult,
    RecommendationGenerationOutcome, RecommendationApplicationSummary, ActivityRequirementUpdate,
} from '../../types/ActivityTypes';
import {
    getRecommendations, getRecommendationWarningPreview, applyRecommendations,
    getAssignmentWarningPreview,
} from '../modules/activity/recommendations';


import {
    authorizeEventLink, getEventLinkOptions, readEventLinkSelection, assertEntityPropertyContext,
    readAuthorizedEventUrl, getEntityViewAdmission, changeEntityEvent, projectEntitySettingsEvent,
} from '../modules/event/linkage';


// controllers/activityController.js
import {hasAccountProfile} from './userController';
import {Request} from 'express';

import type {EntityManager} from 'typeorm';
import {comparisonToken, entityTag, requireFieldComparison} from '../modules/api/transport';
import {archiveEntity, getArchivePresentations, restoreEntity, setAutomaticArchival} from '../modules/entityArchival';
import {
    entityMethodPermission, entityPropertyPermission, buildPermBundle, evaluateSubject, isOwner,
    saveDefaultPermsFromBody,
} from '../modules/permissionEngine';

import {ApiProblem} from '../modules/api/problem';
import {requireApiProfileId} from '../modules/api/session';
import {
    checkNewImage, removeImage, performImageSwap,
} from '../modules/lib/fileCommons';
import * as adminService from '../modules/database/services/EntityAdminService';
import {
    getHeaderImageVersion, projectEventParticipants, uuidKey, sameUuid, resolveUuidReferences,
    fromISOtoLocal, generateUniqueId, validateCalendarDate,
} from '../modules/lib/util';
import {civilDateWeeks, civilDateWindow, parseCivilDate} from '../../common/lib/civilDate';
import {archiveKey} from '../modules/archive/policy';
import type {components} from '../../types/api/v1';
import type {ActivityCommandPreparation, ActivityPropertyTransportContext} from '../../types/ActivityV1Types';
// Business logic for the Activity routes
import Joi from 'joi';



import {ActivityPlan} from '../modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../modules/database/entities/activity/ActivitySlot';
import * as activityService from '../modules/database/services/ActivityService';
import * as eventService from '../modules/database/services/EventService';

import {APIError, ValidationError} from '../modules/lib/errors';

import type {PermBundle, PermView, PermType, SessionLike} from '../../types/PermissionTypes';
import type {EntityBase} from '../../types/UserTypes';


// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */

export function preprocessCreate(body: any): Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] } {
    // Enforce the effective server policy before parsing or materializing slot drafts.
    if (typeof body.startDate === 'string' && typeof body.endDate === 'string'
        && parseCivilDate(body.startDate) && parseCivilDate(body.endDate)) {
        requireActivityDuration(body.startDate, body.endDate);
    }
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

export async function createEntity(
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

/**
 * Assemble the shared saved schedule and participant analysis. Versioned callers
 * may request presentation provenance; standard projections keep their
 * established fields and English fallbacks without additional reads or effects.
 */

export async function fetchForView(plan: ActivityPlan, req: Request, includeNameProvenance = false, window?: CivilDateWindow) {
    // Load the same schedule and independent participant/configuration inputs for
    // both renderers; name provenance never changes authority or membership.
    const selected = window?.oversized ? window : undefined;
    const oversized = Boolean(selected);
    const slotsByDate = await activityService.getActivitySlots(plan.id, selected);
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
        activityService.getActivitySlotAssignments(plan.id, session.profile!.id, selected),
        activityService.getActivitySlotAssigneeRows(plan.id, undefined, selected).then(projectActivityAssignees),
        activityService.getAllRoles(plan.id),
        activityService.getActivitySlotRoles(plan.id, selected),
        oversized ? Promise.resolve({plan, roleRequirements: [], overrides: [], stayRequirements: []})
            : requireRequirementConfiguration(plan.id),
        plan.event?.id ? eventService.getEventParticipantRows(plan.event.id).then(projectEventParticipants) : Promise.resolve([]),
        activityService.getParticipantRolesForPlan(plan.id, undefined, selected),
    ]);
    const textFields = await activityService.getActivityPlanTextFields(plan.id);

    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (!slot) continue;
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    const currentProfileId = uuidKey(session.profile!.id);
    const registration = eventParticipants.find((participant) => sameUuid(participant.profileId, currentProfileId));
    const canSelfAssign = !plan.event?.id || Boolean(registration) || Boolean(plan.allowExternalAssignees);
    const currentRoleIds = participantRoles.find(
        (participant) => participant.participantKey === `profile:${currentProfileId}`,
    )?.roleIds;
    const shouldShowRequirementProgress = !oversized && canSelfAssign && (
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
            ? toParticipantKey({profileId: uuidKey(participant.profileId)})
            : `registration:${participant.id}`;
        const status = ensureParticipantStatus(participantKey, participant.profileId ? uuidKey(participant.profileId) : participant.profileId, participant.name);
        status.arrivalDate = participant.arrivalDate;
        status.departureDate = participant.departureDate;
    });

    Object.values(assigneeLists).flat().forEach((assignee) => {
        // Accumulate recorded work by profile while keeping the default role out of visible named roles.
        const participantKey = toParticipantKey({profileId: uuidKey(assignee.profileId)});
        const status = ensureParticipantStatus(participantKey, uuidKey(assignee.profileId), assignee.name);
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
export async function getScheduleExport(plan: ActivityPlan, requestedStart?: unknown) {
    const window = civilDateWindow(plan.startDate, plan.endDate, settings.value.activityMaxDurationDays, requestedStart);
    // Select the same participant sources as the detail owner; the DBAL counts
    // their UUID union without loading names or a second participant roster.
    const [slotsByDate, assigneeLists, slotRoles, textFields, participantCount] = await Promise.all([
        activityService.getActivitySlots(plan.id, window.oversized ? window : undefined),
        activityService.getActivitySlotAssigneeRows(plan.id, undefined, window.oversized ? window : undefined).then(projectActivityAssignees),
        activityService.getActivitySlotRoles(plan.id, window.oversized ? window : undefined),
        activityService.getActivityPlanTextFields(plan.id),
        activityService.countActivityPlanParticipants(plan.id, plan.event?.id ?? null),
    ]);

    return presentActivitySchedule(plan, slotsByDate, assigneeLists, slotRoles, textFields, participantCount, window);
}

/**
 * Provide data for duplication form.
 */

async function fetchForDuplicate(plan: ActivityPlan, _session: Request['session']) {
    return await activityService.getActivitySlots(plan.id);
}

/**
 * Delete the selected plan through its existing persistence owner.
 */

export async function deleteEntity(plan: ActivityPlan, _session: Request['session']) {
    return await activityService.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers

/** Schema ownership stays with this feature; the shared API checks each supplied field's permission first. */
function normalizeActivityProperties(body: unknown): ActivityPropertyPatch {
    const date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validateCalendarDate);
    const schema = Joi.object<ActivityPropertyPatch>({
        ...basicEntityPropertyRules(),
        startDate: date,
        endDate: date,
    }).min(1).unknown(false).required();
    const {error, value} = schema.validate(body, {abortEarly: false});
    if (error) throw new APIError(error.message, {}, 400);
    if (value.description === '') value.description = null;
    return value;
}


export async function updateProperties(plan: ActivityPlan, body: unknown): Promise<string> {
    const patch = normalizeActivityProperties(body);
    await saveActivityProperties(plan.id, patch, plan.eventId ?? null);
    return 'Activity plan updated';
}

export async function updateDescription(planId: string, body: any, expectedEventId?: string | null) {
    const patch = normalizeActivityProperties({description: body?.description});
    if (patch.description === undefined) throw new APIError('Description is required', {}, 400);
    await saveActivityProperties(planId, patch, expectedEventId);
    return 'Description updated';
}

/**
 * Keep context/field admission in the DBAL callback, then invoke the shared date policy.
 * The callback holds the root lock through generated-work invalidation and the final write;
 * concurrent slot creation takes the same lock before deciding whether its date is allowed.
 */
async function saveActivityProperties(planId: string, patch: ActivityPropertyPatch, expectedEventId?: string | null,
    transport?: ActivityPropertyTransportContext): Promise<components['schemas']['ActivityMetadata'] | void> {
    /** Recheck saved context and optional versioned field evidence under the plan lock,
     * then persist the sparse patch and prepare its requested result before commit. */
    async function saveProperties(manager: EntityManager): Promise<components['schemas']['ActivityMetadata'] | void> {
        // Acquire the current parent/plan context before interpreting an earlier
        // relationship or projecting any field that the adapter may compare.
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
        // Domain range checks, recommendation invalidation and the sparse write
        // use the already locked plan and this same transaction manager.
        await applyActivityProperties(planId, plan, patch, manager);
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

export async function createTextField(planId: string, body: any) {
    const {title = '', text = ''} = body;
    if (!title.trim()) throw new APIError('Title required', body, 400);
    if (title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 16000) throw new APIError('Text too long', body, 400);
    return await activityService.createActivityPlanTextField(planId, title.trim(), text);
}

/** Validate this plan-owned text field and its optional title grant before the existing sparse write. */
export async function updateTextField(planId: string, textFieldId: string, body: any, permData?: PermBundle) {
    // Resolve actual field ownership before validating content or disclosing a write result.
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (!sameUuid(field?.entityId, planId)) {
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
export async function deleteTextField(planId: string, textFieldId: string) {
    // Reject a foreign or missing field before invoking the unchanged deletion operation.
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (!sameUuid(field?.entityId, planId)) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    await activityService.deleteActivityPlanTextField(textFieldId);
    return 'Text field deleted';
}

export async function reorderSlots(id: string, order: { slotId: string, pos: number }[]) {
    await activityService.reorderActivitySlots(id, order);
    return 'Order saved';
}


export async function deleteAssignment(assignId: number) {
    await activityService.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}


export async function deleteSlot(slotId: string) {
    await activityService.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, activityService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, activityService.updateHeaderImage);
    return 'Image deleted';
}

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
    if (!slot || !sameUuid(slot.entityId, id)) throw new ApiProblem('NOT_FOUND');
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

    // Select each field through its own property grant; a partial editor must not
    // receive other values merely because they share the same metadata response.
    for (const field of ['title', 'description', 'startDate', 'endDate'] as const) {
        if (!permissions.has(entityPropertyPermission('activity', field)!)) continue;
        editableFields.push(field);
        if (field === 'description') values.description = plan.description ?? null;
        else values[field] = plan[field];
    }

    // Keep the existing root/link/archive context separate from the editable value set.
    return {entityType: 'activity', id: plan.id, values, editableFields, currentEventId: plan.eventId ?? null,
        archived: Boolean(plan.archivedAt), inheritedArchived: Boolean(plan.event?.archivedAt)};
}

/** Metadata refresh and comparisons contain only fields currently visible to this actor. */
function activityMetadataToken(plan: ActivityPlan, data: components['schemas']['ActivityMetadata'], session: SessionLike): string {
    return comparisonToken('activity-meta', uuidKey(plan.id), session, data.values);
}

/** Public creation definitions preserve the audience matrix without disclosing an existing plan. */
export function activityFormContext(): components['schemas']['ActivityCreateContext'] {
    return {...entityCreationPermissionContext('activity'), maxDurationDays: settings.value.activityMaxDurationDays};
}

/** Initial creation retains account-only admission; duplicate GET has its own method grant. */
export function readActivityCreateContext(session: SessionLike): components['schemas']['ActivityCreateContext'] {
    requireApiProfileId(session);
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
        const rule = activitySlotFieldPermission(field);
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
export async function readActivityPlan(id: string, session: SessionLike, _view?: 'detail' | 'admin', query?: Readonly<Record<string, unknown>>) {
    const profileId = requireApiProfileId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    if (await getEntityViewAdmission('activity', plan, session, undefined, permissions) !== 'render') throw new ApiProblem('FORBIDDEN');
    // Existing production owners calculate counts, attendance and saved requirement progress.
    // The transport never spreads an ORM root, assignment, profile or event into its response.
    const window = civilDateWindow(plan.startDate, plan.endDate, settings.value.activityMaxDurationDays, query?.windowStart);
    const source = await fetchForView(plan, {session} as Request, true, window);
    const bundle = await activityPermissionBundle(plan, session);
    const slots: components['schemas']['ActivitySlotView'][] = [];
    for (const slot of Object.values(source.slots).flat()) {
        const itemPermissions = bundle.item(slot.id);
        const visible = itemPermissions.allow('ACCESS_PARTICIPANTS', 'ACCESS_PARTICIPANTS');
        const assigned = source.assigneeLists[uuidKey(slot.id)] ?? [];
        const own = assigned.find(assignment => sameUuid(assignment.profileId, profileId));
        const configured = source.roles.slotRoles[uuidKey(slot.id)] ?? [];
        const values = activitySlotValues(slot, configured.map(role => role.id), itemPermissions);
        const roles = configured.map(role => {
            // A role remains visible while its holder's identity and removable
            // assignment handle follow the independent participant permission.
            const assignee = assigned.find(assignment => assignment.roles.includes(role.name));
            return {id: String(role.id), name: role.name, maxQty: role.maxQty, assignedQty: role.assignedQty,
                assignmentId: visible && assignee ? String(assignee.id) : null,
                assigneeName: visible && assignee ? assignee.name : null, self: sameUuid(assignee?.profileId, profileId)};
        });
        slots.push({id: slot.id, day: slot.day, position: slot.pos, title: slot.title, description: slot.description ?? null,
            startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? null,
            assignedCount: slot.assignedCount, selfAssigned: Boolean(own), selfRoles: own?.roles ?? [], roles,
            assignees: visible ? assigned.map(assignment => ({assignmentId: String(assignment.id), name: assignment.name, roles: assignment.roles})) : [],
            capabilities: activitySlotCapabilities(itemPermissions), editToken: comparisonToken('activity-slot', uuidKey(slot.id), session, values)});
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
    const currentEventUrl = await readAuthorizedEventUrl(plan.event, session);
    const metadata = activityMetadataProjection(plan, permissions);
    const data: components['schemas']['ActivityView'] = {
        entityType: 'activity', id, title: plan.title, description: plan.description ?? null,
        startDate: plan.startDate, endDate: plan.endDate, ...activityHeaderProjection(plan),
        currentEventId: plan.eventId ?? null, currentEventUrl, archived: Boolean(plan.archivedAt),
        inheritedArchived: Boolean(plan.event?.archivedAt), assignmentMode: plan.assignmentMode, canSelfAssign: source.canSelfAssign,
        allowOverfillAfterFull: Boolean(plan.allowOverfillAfterFull), bindingDeadline: plan.bindingDeadline?.toISOString() ?? null,
        requirementProgress: source.requirementProgress ?? null, slots, window,
        weeks: projectActivityScheduleWeeks(window.startDate, window.endDate),
        allRoles: source.roles.allRoles.map(role => ({id: String(role.id), title: role.title, description: role.description ?? null})),
        textFields: source.textFields.map(field => ({id: field.id, title: field.title, text: field.text ?? '',
            editToken: comparisonToken('activity-text', uuidKey(field.id), session, {text: field.text ?? '',
                ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})}),
            capabilities: {edit: permissions.has('ACCESS_VIEW'), editTitle: permissions.has('MANAGE_REQUIREMENTS'), delete: permissions.has('MANAGE_REQUIREMENTS')}})),
        participants, counters: {participants: permissions.has('ACCESS_PARTICIPANTS') ? source.counters.participants : null,
            open: source.counters.open, empty: source.counters.empty},
        orderToken: comparisonToken('activity-order', uuidKey(plan.id), session, {order: slots.map(slot => ({slotId: slot.id, position: slot.position}))}),
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
    for (const slot of body.slots) {
        grouped[slot.day] ??= [];
        grouped[slot.day].push({...slot, pos: slot.position, position: undefined});
    }
    const parsed = preprocessCreate({...body, slots: JSON.stringify(grouped), event_id: body.eventId ?? ''});
    parsed.headerImg = file?.path;
    function prepareCreated(id: string): void { prepare?.({id}); }
    const id = await createEntity(requireApiProfileId(session), parsed, prepareCreated);
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
    return {data, etag: comparisonToken('activity-meta', uuidKey(data.id), session, data.values)};
}

/** Settings compose shared metadata, event, lifecycle and access owners with their existing grants. */
export async function readActivitySettings(id: string, session: SessionLike): Promise<components['schemas']['ActivitySettings']> {
    requireApiProfileId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    const metadata = activityMetadataProjection(plan, permissions);
    const owns = isOwner(session, plan.ownerId);
    if (!owns && !metadata.editableFields.length && !permissions.any('EDIT_META', 'MANAGE_PERMISSIONS', 'DATA_DUPLICATE', 'DATA_EXPORT')) throw new ApiProblem('FORBIDDEN');
    const property = await getEntityPropertyPresentation('activity', plan, session);
    const reference = {type: 'activity' as const, id};
    const archive = (await getArchivePresentations([reference], session)).get(archiveKey(reference))!;
    let access: components['schemas']['EntityAccess'] | null = null;
    if (permissions.has('MANAGE_PERMISSIONS')) {
        access = await readEntitySettingsAccess('activity', id, session);
    }
    // Parent disclosure follows its independent method grant, not child management.
    const currentEvent = projectEntitySettingsEvent(property.currentEvent);
    return {id, title: plan.title, ...activityHeaderProjection(plan),
        editableFields: metadata.editableFields,
        settingsToken: comparisonToken('activity-settings', uuidKey(plan.id), session, {eventId: plan.eventId ?? null, header: plan.headerImg ?? null,
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
        requireFieldComparison(token, comparisonToken('activity-settings', uuidKey(current.id), session, {eventId: current.eventId ?? null}), ['eventId']);
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

/** Shared comparison admission delegates target validation and grant decisions to the permission owner. */
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
    return {editToken: comparisonToken('activity-settings', uuidKey(plan.id), session, {header: plan.headerImg ?? null})};
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
    requireFieldComparison(token, comparisonToken('activity-settings', uuidKey(plan.id), session, {header: plan.headerImg ?? null}), ['header']);
    if (file) await updateHeaderImg(plan, file);
    else await deleteHeaderImg(plan);
}

/** Archive/restore share existing authorization and retain records, files and assignments. */
export async function setActivityArchived(id: string, archived: boolean, session: SessionLike): Promise<void> {
    requireApiProfileId(session);
    if (archived) await archiveEntity({type: 'activity', id}, {}, session);
    else await restoreEntity({type: 'activity', id}, {}, session);
}

/** Pause/resume only the existing independent schedule through the shared lifecycle owner. */
export async function setActivityAutomaticArchival(id: string, body: components['schemas']['EventAutomaticArchivalInput'], session: SessionLike): Promise<void> {
    requireApiProfileId(session);
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
    const values = activitySlotValues(slot, (configured[uuidKey(slot.id)] ?? []).map(role => role.id), permissions);
    if (!Object.keys(values).length) throw new ApiProblem('FORBIDDEN');
    return {values, editableFields: Object.keys(values) as components['schemas']['ActivitySlotBaseline']['editableFields'],
        editToken: comparisonToken('activity-slot', uuidKey(slot.id), session, values)};
}

/** Slot creation delegates range/time/role validation and saved ordering to Quick Add. */
export async function createActivitySlot(id: string, body: components['schemas']['ActivityNewSlot'], session: SessionLike): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ITEM_ADD', session);
    requireApiProfileId(session);
    await quickAddSlot(plan, {...body, date: body.day}, session);
}

/** Preserve sparse slot writes and plan-owned role relationships, including explicit removal of every role. */
export async function patchActivitySlot(id: string, slotId: string, body: components['schemas']['ActivitySlotPatch'], session: SessionLike, token?: string): Promise<void> {
    const {plan, permissions} = await requireActivitySlot(id, slotId, session);
    const bundle = await activityPermissionBundle(plan, session);
    /** Recheck each submitted field against the locked current item rather than
     * treating the initial editor's permission bundle as mutation authority. */
    async function admitSlot(manager: EntityManager, currentPlan: ActivityPlan, currentSlot: ActivitySlot): Promise<void> {
        if (!sameUuid(currentPlan.id, id)) throw new ApiProblem('NOT_FOUND');
        const currentPermissions = await activityItemPermissions(currentPlan, currentSlot, session, manager);
        const configured = await activityService.getActivitySlotRoles(id);
        const values = activitySlotValues(currentSlot, (configured[uuidKey(currentSlot.id)] ?? []).map(role => role.id), currentPermissions);
        for (const field of Object.keys(body)) {
            if (!Object.hasOwn(values, field)) throw new ApiProblem('FORBIDDEN');
        }
        requireFieldComparison(token, comparisonToken('activity-slot', uuidKey(currentSlot.id), session, values), Object.keys(body));
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
export async function readActivityOrderBaseline(id: string, session: SessionLike, requestedStart?: unknown): Promise<components['schemas']['ActivityOrderBaseline']> {
    const {plan} = await requireActivityMethod(id, 'ITEM_EDIT', session);
    const window = civilDateWindow(plan.startDate, plan.endDate, settings.value.activityMaxDurationDays, requestedStart);
    const order = (await activityService.getActivitySlotsFlat(id, undefined, window.oversized ? window : undefined))
        .map(slot => ({slotId: slot.id, position: slot.pos}));
    return {order, editToken: comparisonToken('activity-order', uuidKey(plan.id), session, {order})};
}

/** Direct ordering persists only submitted positions and leaves saved assignments intact. */
export async function setActivityOrder(id: string, body: components['schemas']['ActivityOrderInput'], session: SessionLike, token?: string): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ITEM_EDIT', session);
    const window = civilDateWindow(plan.startDate, plan.endDate, settings.value.activityMaxDurationDays, body.windowStart);
    const current = await activityService.getActivitySlotsFlat(id, undefined, window.oversized ? window : undefined);
    const order = current.map(slot => ({slotId: slot.id, position: slot.pos}));
    requireFieldComparison(token, comparisonToken('activity-order', uuidKey(plan.id), session, {order}), ['order']);
    const slots = resolveUuidReferences(body.order.map(row => row.slotId), current, slot => slot.id);
    if (!slots) throw new ApiProblem('NOT_FOUND');
    // Activity ordering is partial and permits repeated references; resolve identity
    // without changing submitted positions or importing another list's uniqueness policy.
    await reorderSlots(id, body.order.map((row, index) => ({slotId: slots[index].id, pos: row.position})));
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
    const profileId = requireApiProfileId(session);
    await requireActivitySlot(id, slotId, session);
    // Match the shared binding-deadline admission for both joining and leaving.
    if (plan.bindingDeadline && plan.bindingDeadline.getTime() <= Date.now() && !permissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    const operation = body.assigned ? 'assign' : 'unassign';
    await authorizeSelfAssignment(id, slotId, profileId, operation, body.role);
    /** The new transport repeats its own context/method admission inside the
     * shared assignment owner's existing locks, without another write owner. */
    async function admitAssignment(manager: EntityManager, currentPlan: ActivityPlan): Promise<void> {
        if (!sameUuid(currentPlan.id, id)) throw new ApiProblem('NOT_FOUND');
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
    if (!assignment || !sameUuid(assignment.entityId, id)) throw new ApiProblem('NOT_FOUND');
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
    if (!field || !sameUuid(field.entityId, id)) throw new ApiProblem('NOT_FOUND');
    const permissions = await activityPermissions(plan, session);
    if (body.title !== undefined && !permissions.has('MANAGE_REQUIREMENTS')) throw new ApiProblem('FORBIDDEN');
    const values = {text: field.text ?? '', ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})};
    requireFieldComparison(token, comparisonToken('activity-text', uuidKey(field.id), session, values), Object.keys(body));
    await updateTextField(id, fieldId, body, await activityPermissionBundle(plan, session));
}

/** Text removal keeps its existing child-scope check and management authorization. */
export async function removeActivityTextField(id: string, fieldId: string, session: SessionLike): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    await deleteTextField(id, fieldId);
}

/** Project private requirement inputs explicitly, retaining the shared pure engine's
 * saved analysis and calculation inputs without sending ORM relations or profile records. */
export async function readActivityRequirements(id: string, session: SessionLike, page = 1,
    section: RequirementPageSection = 'stays'): Promise<components['schemas']['ActivityRequirements']> {
    // Requirement management has its own method grant, separate from page admission.
    const {plan: currentPlan} = await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    const oversized = isActivityOversized(currentPlan);
    // Oversized reads must not call the complete configuration loader or engine.
    // The selected SQL page retains every other saved row without reading it.
    const storedPage = oversized ? await requirementService.getRequirementPage(id, section, page) : null;
    const data = storedPage ? {...storedPage, plan: currentPlan, participants: [],
        capacitySummary: {availableSlots: 0, requiredSlots: 0, difference: 0, configurationComplete: false},
        calculationContext: {participants: [], assignedShiftCounts: {}, slots: []}, overrideTargets: []}
        : await getRequirements(id, true);
    const allRoles = storedPage ? [...storedPage.roleRequirements, ...storedPage.overrides].flatMap(row => row.role ? [row.role] : [])
        : await activityService.getAllRoles(id);
    const plan = data.plan;

    // Select scalars from each persistence result before it crosses the versioned
    // boundary. Numeric database handles become strings here; the shared
    // controller, persistence and requirement engines keep their numeric contract.
    return {
        ...(storedPage ? {paging: {readOnly: true, section, page: storedPage.page, pages: storedPage.pages,
                total: storedPage.total, pageSize: 100 as const, maxDurationDays: settings.value.activityMaxDurationDays}} : {}),
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
            ...(result.recommendation.swapGroup === undefined ? {} : {swapGroup: result.recommendation.swapGroup}),
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
            status: row.status, operation: row.operation, manual: row.manual,
            ...(row.pairingKnown ? {swapGroup: row.swapGroup ?? null} : {})})),
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

/** Apply once and prepare all finite completion variants before assignment commit.
 * Existing guarded generation reports a separate outcome; postcommit delivery
 * cannot repeat projection, authorization or the assignment operation. */
export async function applyActivityRecommendations(id: string, input: components['schemas']['ActivityRecommendationApplication'],
    session: SessionLike, prepare?: ActivityCommandPreparation<Readonly<Record<RecommendationGenerationOutcome,
        components['schemas']['ActivityRecommendationApplyResult']>>>): Promise<components['schemas']['ActivityRecommendationApplyResult']> {
    // The existing controller rechecks the warning review before its transaction writes.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    let variants: Record<RecommendationGenerationOutcome, components['schemas']['ActivityRecommendationApplyResult']>;
    /** Project the same safe committed evidence before any variant is serialized. */
    function prepareApplication(result: RecommendationApplicationSummary): void {
        const data = {applied: result.applied, skipped: result.skipped,
            warnings: activityRecommendationWarnings(result.warnings)};
        // Both the direct controller result and the transport use these exact
        // projections. A failure in any callback still rolls back application.
        variants = {'not-required': {...data, generationOutcome: 'not-required'},
            complete: {...data, generationOutcome: 'complete'}, failed: {...data, generationOutcome: 'failed'}};
        prepare?.(variants);
    }
    const result = await applyRecommendations(id, input, session, prepareApplication);
    return variants![result.generationOutcome];
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

/** Render the existing UTC print schedule from controller-selected data without reading or mutating persistence. */
function presentActivitySchedule(plan: ActivityPlan,
    slotsByDate: Awaited<ReturnType<typeof activityService.getActivitySlots>>, assigneeLists: SlotAssignmentMap,
    slotRoles: Awaited<ReturnType<typeof activityService.getActivitySlotRoles>>,
    textFields: Awaited<ReturnType<typeof activityService.getActivityPlanTextFields>>, participantCount: number, window: CivilDateWindow) {
    // Stored plan dates already passed feature admission. Reuse the same civil
    // Monday-week enumeration as creation and versioned schedule presentation.
    const dayMap = new Map<string, ActivityPrintDay>();
    const weeks: ActivityPrintWeek[] = [];
    for (const week of civilDateWeeks(window.startDate, window.endDate)) {
        const days: ActivityPrintDay[] = [];
        for (const dayKey of week.days) {
            const weekday = (new Date(dayKey + 'T00:00:00Z').getUTCDay() + 6) % 7;
            const slots = (slotsByDate[dayKey] || []).map((slot) => ({
                ...slot,
                assignees: assigneeLists[uuidKey(slot.id)] || [],
                roles: slotRoles[uuidKey(slot.id)] || [],
            }));
            const day = {date: dayKey, dayIndex: weekday, slots};
            dayMap.set(dayKey, day);
            days.push(day);
        }
        weeks.push({start: week.start, days});
    }

    // Occupancy still comes from the displayed slots; only the participant
    // counter uses UUID deduplication, independently of display-name spelling.
    const slotList = Array.from(dayMap.values()).flatMap((d) => d.slots);
    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    return {
        plan,
        window,
        event: plan.event,
        days: Array.from(dayMap.values()),
        weeks,
        textFields,
        counters: {
            participants: participantCount,
            slots: slotList.length,
            open,
            empty,
        },
        generatedAt: new Date().toISOString(),
    };
}

/** Decode the existing requirement form into its optional settings and replacement row sets. */
function preprocessRequirementUpdate(body: any) {
    // Keep row validation separate from plan settings; domain eligibility is checked under the later plan lock.
    const roleRequirementSchema = Joi.object({
        roleId: Joi.number().integer().positive().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const stayRequirementSchema = Joi.object({
        stayDays: Joi.number().integer().positive().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const overrideSchema = Joi.object({
        id: Joi.number().integer().positive().optional(),
        roleId: Joi.number().integer().positive().allow(null),
        profileId: Joi.string().uuid().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const schema = Joi.object({
        assignmentMode: Joi.string().valid("FREE", "REQUIRED").optional(),
        generalRequiredShifts: Joi.number().integer().min(0).allow(null).optional(),
        roundingMode: Joi.string().valid("CEIL", "ROUND", "FLOOR").allow(null).optional(),
        bindingDeadline: Joi.alternatives()
            .try(Joi.date().iso(), Joi.string().allow(null, ""))
            .optional()
            .custom((value, _helpers) => {
                // The legacy form uses a blank deadline as an explicit clear operation.
                if (typeof value === "string" && value.trim() === "") {
                    return null;
                }
                return value;
            }),
        allowOverfillAfterFull: Joi.boolean().optional(),
        allowExternalAssignees: Joi.boolean().optional(),
        allowArrivalDayEvening: Joi.boolean().optional(),
        allowDepartureDayMorning: Joi.boolean().optional(),
        roleRequirements: Joi.array().items(roleRequirementSchema).default([]),
        stayRequirements: Joi.array().items(stayRequirementSchema).unique('stayDays').default([]),
        overrides: Joi.array().items(overrideSchema).default([]),
    });

    // Preserve collected form diagnostics and the original optional-field/array-default semantics.
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    return value as ActivityRequirementUpdate;
}

/** Project the existing saved requirement analysis through the shared presentation.
 * The versioned projection may retain missing-name origin for reactive client
 * localization; direct callers keep the exact existing response shape. */
export async function getRequirements(planId: string, includeNameProvenance = false) {
    const {requirementConfig, analysis, allRoles, eventParticipants, calculation} = await getActivityRequirementAnalysis(planId);
    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    const participants = analysis.participants.map((participant) => ({
        ...participant,
        roles: (participant.roleIds || [])
            .map((roleId) => roleTitles.get(roleId))
            .filter((title): title is string => Boolean(title && title !== 'default')),
        assignmentMode: requirementConfig.plan.assignmentMode,
    }));

    const overrideTargets = eventParticipants.map((participant) => ({
        key: toParticipantKey({...participant, profileId: participant.profileId ? uuidKey(participant.profileId) : participant.profileId}),
        profileId: participant.profileId ? uuidKey(participant.profileId) : null,
        label: toParticipantName(participant),
        ...(includeNameProvenance ? {nameIsFallback: !participant.name} : {}),
        arrivalDate: participant.arrivalDate ?? null,
        departureDate: participant.departureDate ?? null,
    }));

    return {
        ...requirementConfig,
        participants,
        capacitySummary: analysis.capacitySummary,
        calculationContext: {
            participants: calculation.participants,
            assignedShiftCounts: calculation.assignedShiftCounts,
            slots: calculation.slots,
        },
        overrideTargets,
    };
}

/** Save one coherent requirements configuration under the existing plan lock.
 * Explicit versioned removal IDs supplement the omission-retention rule;
 * permissions, current membership checks and persistence remain with their owners. */
export async function updateRequirements(planId: string, body: any, removedOverrideIds: readonly string[] = []) {
    // Decode the request before the feature reads its expected context and enters
    // the existing transaction; all locked decisions stay with that owner.
    await saveActivityRequirementConfiguration(planId, preprocessRequirementUpdate(body), removedOverrideIds);
    return 'Requirements updated';
}
