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

import Joi from 'joi';
import type {EntityManager} from 'typeorm';
import type {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../database/entities/activity/ActivitySlot';
import type {RequirementOverrideInput} from '../../../types/ActivityRequirementTypes';
import * as activityService from '../database/services/ActivityService';
import * as requirementService from '../database/services/ActivityRequirementService';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import {calculateRequirementAnalysis, calculateBaselineRequirementForPlan, countInclusiveDays, toParticipantKey, toParticipantName} from '../../../common/activity/requirements';
import {requireRequirementConfiguration, requireRecommendationContext, buildParticipantAttendanceMap} from './context';

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
            .custom((value, helpers) => {
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

    return value as {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
        allowExternalAssignees?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
        roleRequirements: { roleId: number; requiredShifts: number }[];
        stayRequirements: { stayDays: number; requiredShifts: number }[];
        overrides: any[];
    };
}

/** Analyze the existing saved requirements and return their shared presentation.
 * The versioned projection may retain missing-name origin for reactive client
 * localization; direct callers keep the exact existing response shape. */
export async function getRequirements(planId: string, includeNameProvenance = false) {
    // Reuse the admitted plan's existing configuration, participants and slots.
    const [plan, requirementConfig, assignments, slots, allRoles, slotRoles] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requireRequirementConfiguration(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getAllRoles(planId),
        activityService.getActivitySlotRoles(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];

    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        [],
        eventParticipants,
    );

    const slotsWithRoles = projectRequirementSlots(slots, slotRoles);
    const assignedShiftCounts = Object.fromEntries(
        Object.entries(assignments).map(([participantKey, participantAssignments]) => [participantKey, participantAssignments.length]),
    );
    // The pure engine remains the sole owner of requirement arithmetic. Optional
    // label provenance below changes neither its inputs nor its saved results.
    const analysis = calculateRequirementAnalysis({
        plan,
        participants: Object.values(attendance),
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        stayRequirements: requirementConfig.stayRequirements,
        slots: slotsWithRoles,
        assignedShiftCounts,
    });
    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    const participants = analysis.participants.map((participant) => ({
        ...participant,
        roles: (participant.roleIds || [])
            .map((roleId) => roleTitles.get(roleId))
            .filter((title): title is string => Boolean(title && title !== 'default')),
        assignmentMode: requirementConfig.plan.assignmentMode,
    }));

    const overrideTargets = eventParticipants.map((participant) => ({
        key: toParticipantKey(participant),
        profileId: participant.profileId ?? null,
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
            participants: Object.values(attendance),
            assignedShiftCounts,
            slots: slotsWithRoles,
        },
        overrideTargets,
    };
}

/** Calculate the existing requirement baseline from saved configuration, attendance and slot capacity. */
export async function calculateBaselineRequirement(planId: string) {
    // Preserve the existing independent reads; this analysis does not start a write transaction.
    const [plan, requirementConfig, slots, assignments, slotRoles] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requireRequirementConfiguration(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotRoles(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    // Registered and already assigned identities use the same attendance policy as requirement analysis.
    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        [],
        eventParticipants,
    );

    const slotsWithRoles = projectRequirementSlots(slots, slotRoles);
    // Share structural slot inputs while retaining the baseline algorithm's distinct arithmetic.
    const baseline = calculateBaselineRequirementForPlan({
        plan,
        slots: slotsWithRoles,
        participants: Object.values(attendance),
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
    });

    return baseline;
}

/**
 * A settings form may no longer list a saved profile after the plan moves to another event.
 * Preserve those unchanged rows, including omitted rows, inside the same locked transaction.
 * Versioned editors can explicitly remove an admitted saved ID without deleting unseen rows.
 * Their existence never authorizes a new target or a changed override for a nonparticipant.
 */
async function mergeRequirementOverrides(
    manager: EntityManager,
    plan: ActivityPlan,
    submitted: RequirementOverrideInput[],
    removedOverrideIds: readonly string[],
): Promise<RequirementOverrideInput[]> {
    const {overrides: saved} = await requireRequirementConfiguration(plan.id, manager);
    const savedById = new Map(saved.map((override) => [override.id, override]));
    // Removal is deliberate and plan-scoped. Omission still means retention for
    // former participants; it must never delete a concurrent unseen override.
    const removedIds = new Set<number>();
    for (const id of removedOverrideIds) {
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || String(numericId) !== id || !savedById.has(numericId) || removedIds.has(numericId)) {
            throw new APIError('Removed override must identify one saved override belonging to this activity plan', {}, 400, {cause: 'ACTIVITY_OVERRIDE_INVALID'});
        }
        removedIds.add(numericId);
    }
    const registered = new Set(plan.eventId ? await activityService.getRegisteredProfileIds(manager, plan.eventId) : []);
    const result: RequirementOverrideInput[] = [];
    const submittedIds = new Set<number>();
    const targetKeys = new Set<string>();
    for (const input of submitted) {
        const override = {...input, roleId: input.roleId ?? null};
        const previous = override.id == null ? undefined : savedById.get(override.id);
        if (override.id != null && (!previous || submittedIds.has(override.id) || removedIds.has(override.id))) {
            throw new APIError('Override does not belong to this activity plan or is duplicated', {}, 400, {cause: 'ACTIVITY_OVERRIDE_INVALID'});
        }
        const unchanged = previous && previous.profileId === override.profileId
            && (previous.roleId ?? null) === (override.roleId ?? null)
            && previous.requiredShifts === override.requiredShifts;
        if (!unchanged && (!override.profileId || !registered.has(override.profileId))) {
            throw new APIError('Overrides must target participants registered for this event', {}, 400, {cause: 'ACTIVITY_OVERRIDE_PARTICIPANT_REQUIRED'});
        }
        const key = `${override.profileId}:${override.roleId ?? ''}`;
        if (targetKeys.has(key)) throw new APIError('An override target may only appear once', {}, 400, {cause: 'ACTIVITY_OVERRIDE_DUPLICATE'});
        targetKeys.add(key);
        if (override.id != null) submittedIds.add(override.id);
        result.push(override);
    }
    // Omission still removes a current participant's override, as in the existing editor.
    // A former participant is absent from that editor's choices, so omission must retain
    // the original row instead of turning an unrelated settings save into data deletion.
    for (const previous of saved) {
        if (registered.has(previous.profileId) || submittedIds.has(previous.id) || removedIds.has(previous.id)) continue;
        result.push({
            id: previous.id,
            profileId: previous.profileId,
            roleId: previous.roleId ?? null,
            requiredShifts: previous.requiredShifts,
        });
    }
    return result;
}

/** Save one coherent requirements configuration under the existing plan lock.
 * Explicit versioned removal IDs supplement the omission-retention rule;
 * permissions, current membership checks and persistence remain with their owners. */
export async function updateRequirements(planId: string, body: any, removedOverrideIds: readonly string[] = []) {
    const {roleRequirements, stayRequirements, overrides, ...planSettings} = preprocessRequirementUpdate(body);
    const expectedPlan = await activityService.getActivityPlanById(planId);
    async function saveRequirements(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        if (expectedPlan && (expectedPlan.eventId ?? null) !== (plan.eventId ?? null)) {
            throw new APIError('Activity plan event changed; reload the requirements', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
        }

        if (!plan.eventId) {
            throw new APIError('Event is required to configure participant overrides', {planId}, 400, {cause: 'ACTIVITY_EVENT_REQUIRED'});
        }

        // Membership and saved-override decisions use this same locked transaction.
        // Unchanged targets from a former event are retained; new/changed overrides still
        // require current registration. Checking only the posted rows here would reject a
        // harmless settings save after relinking and encourage the browser to drop history.

        const allowedRoleIds = new Set((await activityService.getAllRoles(planId, manager)).map((role) => role.id));
        const invalidRoleRequirement = roleRequirements.find((requirement) => !allowedRoleIds.has(requirement.roleId));
        const invalidOverrideRole = overrides.find(
            (override) => override.roleId != null && !allowedRoleIds.has(Number(override.roleId)),
        );
        if (invalidRoleRequirement || invalidOverrideRole) {
            throw new APIError(
                'Requirement roles must belong to this activity plan',
                invalidRoleRequirement ?? invalidOverrideRole,
                400,
                {cause: 'ACTIVITY_REQUIREMENT_ROLE_INVALID'},
            );
        }

        const planDays = countInclusiveDays(plan.startDate, plan.endDate);
        const invalidStayRequirement = stayRequirements.find((requirement) => requirement.stayDays > planDays);
        if (invalidStayRequirement) {
            throw new APIError('Stay duration cannot exceed the activity plan duration', invalidStayRequirement, 400, {cause: 'ACTIVITY_STAY_DURATION_INVALID'});
        }
        const targetAssignmentMode = planSettings.assignmentMode ?? plan.assignmentMode;
        const savedStayDays = new Set(stayRequirements.map((requirement) => requirement.stayDays));
        if (
            targetAssignmentMode === "REQUIRED"
            && (stayRequirements.length !== planDays
                || Array.from({length: planDays}, (_, index) => index + 1).some((day) => !savedStayDays.has(day)))
        ) {
            throw new APIError(
                `Required mode needs exactly one saved requirement for every stay duration from 1 to ${planDays} days`,
                {stayRequirements, planDays},
                400,
                {cause: 'ACTIVITY_STAY_REQUIREMENTS_INCOMPLETE'},
            );
        }

        // Convert bindingDeadline string to Date if present
        const normalizedSettings: Partial<Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "bindingDeadline" | "allowOverfillAfterFull" | "allowExternalAssignees" | "allowArrivalDayEvening" | "allowDepartureDayMorning">> = {
            assignmentMode: planSettings.assignmentMode,
            generalRequiredShifts: planSettings.generalRequiredShifts,
            roundingMode: planSettings.roundingMode,
            allowOverfillAfterFull: planSettings.allowOverfillAfterFull,
            allowExternalAssignees: planSettings.allowExternalAssignees,
            allowArrivalDayEvening: planSettings.allowArrivalDayEvening,
            allowDepartureDayMorning: planSettings.allowDepartureDayMorning,
        };

        if (planSettings.bindingDeadline !== undefined) {
            if (planSettings.bindingDeadline === null) {
                normalizedSettings.bindingDeadline = null;
            } else if (typeof planSettings.bindingDeadline === 'string') {
                normalizedSettings.bindingDeadline = new Date(planSettings.bindingDeadline);
            } else {
                normalizedSettings.bindingDeadline = planSettings.bindingDeadline;
            }
        }

        const retainedOverrides = await mergeRequirementOverrides(manager, plan, overrides, removedOverrideIds);
        await requirementService.replaceRequirements(planId, roleRequirements, retainedOverrides, normalizedSettings, stayRequirements, manager);
    }
    await activityService.withActivityTransaction(saveRequirements);
    return 'Requirements updated';
}


/** Project stored slot/role inputs once for analysis and baseline calculations, preserving their distinct engines. */
function projectRequirementSlots(slots: ActivitySlot[],
    slotRoles: Awaited<ReturnType<typeof activityService.getActivitySlotRoles>>) {
    // Normalize role identity only; keep capacity and assignment quantities unchanged.
    return slots.map((slot) => ({
        id: slot.id,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxAssignees: slot.maxAssignees,
        roles: (slotRoles[slot.id] ?? []).map((role) => ({
            roleId: Number(role.id),
            maxQty: role.maxQty,
            assignedQty: role.assignedQty,
        })),
    }));
}
