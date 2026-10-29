/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {
    AssignmentCandidate, SlotAssignmentMap, ActivityRequirementPreparationInputs, RequirementConfiguration,
    ActivityRecommendationPersistenceContext, ActivityLinkedPlanContext, AutoAssignmentContext,
    AutoAssignmentSlot, RecommendationInput, ActivityRecommendationContext,
    ActivityRecommendationOperationInput, ActivityRequirementUpdate,
} from '../../../types/ActivityTypes';
import type {EntityManager} from 'typeorm';
import {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../database/entities/activity/ActivitySlot';
import {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import type {ParticipantRow} from '../../../types/EventTypes';
import type {ParticipantAttendance, RequirementOverrideInput} from '../../../types/ActivityRequirementTypes';
import * as activityService from '../database/services/ActivityService';
import * as requirementService from '../database/services/ActivityRequirementService';
import * as eventService from '../database/services/EventService';
import * as userService from '../database/services/UserService';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import {APIError} from '../lib/errors';
import {toAssignmentCandidate, normalizeRecommendationInput, recommendationInputKey} from './availability';
import type {ActivityAssignment} from '../database/entities/activity/ActivityAssignment';
import {fingerprintRecommendationContext, RecommendationJobCoordinator, RecommendationQueueFullError} from './recommendationJobs';
import {projectEventParticipants, uuidKey, sameUuid, indexByUuid} from '../lib/util';
import {generateFairRecommendations} from './fairAssignment';
import {countInclusiveDays, hasCompleteStayRequirements, toParticipantKey, calculateRequirementAnalysis,
    calculateBaselineRequirementForPlan} from '../../../common/activity/requirements';
import settings from '../settings';

/** Apply the configured duration policy using constant-time civil-day counting. */
export function isActivityOversized(plan: Pick<ActivityPlan, 'startDate' | 'endDate'>): boolean {
    return countInclusiveDays(plan.startDate, plan.endDate) > settings.value.activityMaxDurationDays;
}

/** Admit new/expanded ranges before allocation or persistence; older long plans may keep or reduce their day count. */
export function requireActivityDuration(startDate: string, endDate: string,
    previous?: Pick<ActivityPlan, 'startDate' | 'endDate'>): void {
    // Only increases are constrained for existing data. Shifting an unchanged
    // duration retains its saved-slot checks in the owning property operation.
    const days = countInclusiveDays(startDate, endDate);
    if (days > settings.value.activityMaxDurationDays
        && (!previous || days > countInclusiveDays(previous.startDate, previous.endDate))) {
        throw new APIError('Activity duration exceeds the configured maximum', {}, 400, {cause: 'ACTIVITY_DURATION_LIMIT'});
    }
}

/** Stop whole-plan requirements work before loading duration-sized collections or allocating the engine input. */
export function requireActivityRequirementWork(plan: Pick<ActivityPlan, 'startDate' | 'endDate'>): void {
    // Existing saved rows remain untouched; managers can shorten the plan through
    // the ordinary date operation without discarding any out-of-range slot.
    if (isActivityOversized(plan)) {
        throw new APIError('Requirements are read-only for an oversized activity plan', {}, 409,
            {cause: 'ACTIVITY_REQUIREMENTS_OVERSIZED'});
    }
}

/** Merge known participant identities in supplied group order.
 * Later nonnull attendance/name/role fields replace earlier values; missing
 * fields retain them, and the final result keeps stable participant-key order. */
export function mergeParticipants(...groups: ParticipantAttendance[][]): ParticipantAttendance[] {
    // Unknown identities cannot acquire an entry; each known key has one merge
    // target regardless of which captured source group supplied its fields.
    const participants = new Map<string, ParticipantAttendance>();
    for (const group of groups) {
        for (const source of group) {
            const participant = source.profileId ? {...source, profileId: uuidKey(source.profileId)} : source;
            const key = toParticipantKey(participant);
            if (key === "participant:unknown") continue;
            const existing = participants.get(key);
            participants.set(key, existing ? {
                ...existing,
                arrivalDate: participant.arrivalDate ?? existing.arrivalDate,
                departureDate: participant.departureDate ?? existing.departureDate,
                name: participant.name ?? existing.name,
                roleIds: participant.roleIds ?? existing.roleIds,
            } : participant);
        }
    }
    // Sort only the merged projection, preserving the input collections.
    return [...participants.values()].sort((a, b) => toParticipantKey(a).localeCompare(toParticipantKey(b)));
}

/** Project already loaded assignments into the existing slot display map without querying or changing saved rows. */
export function projectActivityAssignees(assignments: readonly ActivityAssignment[]): SlotAssignmentMap {
    // Each saved assignment contributes once in returned row order. Name
    // absence uses the existing marker; empty names and role-title order remain intact.
    const map: SlotAssignmentMap = {};

    for (const assignment of assignments) {
        const slotId = uuidKey(assignment.item.id);

        const name = assignment.profile.name ?? "—";

        const roles = assignment.activityAssignmentRoles.map(
            (ar) => ar.role.title
        );

        const assignee = {
            id: assignment.id,
            profileId: assignment.profile.id,
            name,
            roles,
        };

        if (!map[slotId]) map[slotId] = [];
        map[slotId].push(assignee);
    }

    return map;
}

/** Recover profile participant identities from the existing assignment-key map.
 * Non-profile keys contribute nothing; this projection invents no attendance,
 * role or display data from the associated slot collections. */
export function participantsFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    // Preserve the established key split and profile-only selection semantics.
    return Object.keys(assignments).flatMap((key) => {
        const [type, id] = key.split(":");
        return type === "profile" ? [{profileId: uuidKey(id)}] : [];
    });
}

/** Admit a saved configuration and project UUID references for the shared pure
 * engine without changing hydrated rows or numeric requirement identifiers. */
export async function requireRequirementConfiguration(planId: string, manager?: EntityManager,
    includeStayRequirements = true): Promise<RequirementConfiguration> {
    const configuration = await requirementService.getRequirementConfiguration(planId, manager, includeStayRequirements);
    if (!configuration) throw new APIError('Activity plan not found', {planId}, 404);
    return {...configuration, overrides: configuration.overrides.map(override => ({
            ...override, profileId: uuidKey(override.profileId),
            profile: override.profile ? {...override.profile, id: uuidKey(override.profile.id)} : override.profile,
        }))};
}

/** Read and analyze admitted saved requirements through the existing pure engine.
 * Preserve the independent initial reads and return their context for controller presentation. */
export async function getActivityRequirementAnalysis(planId: string) {
    const current = await activityService.getActivityPlanById(planId);
    if (!current) throw new APIError('Activity plan not found', {planId}, 404);
    requireActivityRequirementWork(current);
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

    const {eventParticipants, calculation} = await prepareActivityRequirementContext({plan,
        configuration: requirementConfig, assignments, slots, slotRoles});
    // The pure engine remains the sole owner of requirement arithmetic; callers
    // add their presentation without changing its inputs or saved results.
    const analysis = calculateRequirementAnalysis(calculation);
    return {requirementConfig, analysis, allRoles, eventParticipants, calculation};
}

/** Calculate the existing requirement baseline from saved configuration, attendance and slot capacity. */
export async function calculateBaselineRequirement(planId: string) {
    const current = await activityService.getActivityPlanById(planId);
    if (!current) throw new APIError('Activity plan not found', {planId}, 404);
    requireActivityRequirementWork(current);
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

    // Registered and already assigned identities use the same asynchronous context
    // as analysis, without changing this operation's preceding independent reads.
    const {calculation} = await prepareActivityRequirementContext({plan,
        configuration: requirementConfig, assignments, slots, slotRoles});
    // Share structural slot inputs while retaining the baseline algorithm's distinct arithmetic.
    const baseline = calculateBaselineRequirementForPlan(calculation);

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
    const registered = indexByUuid(plan.eventId ? await activityService.getRegisteredProfileIds(manager, plan.eventId) : [], id => id);
    const result: RequirementOverrideInput[] = [];
    const submittedIds = new Set<number>();
    const targetKeys = new Set<string>();
    for (const input of submitted) {
        const override = {...input, roleId: input.roleId ?? null};
        const previous = override.id == null ? undefined : savedById.get(override.id);
        if (override.id != null && (!previous || submittedIds.has(override.id) || removedIds.has(override.id))) {
            throw new APIError('Override does not belong to this activity plan or is duplicated', {}, 400, {cause: 'ACTIVITY_OVERRIDE_INVALID'});
        }
        const unchanged = previous && sameUuid(previous.profileId, override.profileId)
            && (previous.roleId ?? null) === (override.roleId ?? null)
            && previous.requiredShifts === override.requiredShifts;
        if (!unchanged && (!override.profileId || !registered.has(uuidKey(override.profileId)))) {
            throw new APIError('Overrides must target participants registered for this event', {}, 400, {cause: 'ACTIVITY_OVERRIDE_PARTICIPANT_REQUIRED'});
        }
        override.profileId = unchanged ? previous.profileId : registered.get(uuidKey(override.profileId!))!;
        const key = `${uuidKey(override.profileId)}:${override.roleId ?? ''}`;
        if (targetKeys.has(key)) throw new APIError('An override target may only appear once', {}, 400, {cause: 'ACTIVITY_OVERRIDE_DUPLICATE'});
        targetKeys.add(key);
        if (override.id != null) submittedIds.add(override.id);
        result.push(override);
    }
    // Omission still removes a current participant's override, as in the existing editor.
    // A former participant is absent from that editor's choices, so omission must retain
    // the original row instead of turning an unrelated settings save into data deletion.
    for (const previous of saved) {
        if (registered.has(uuidKey(previous.profileId)) || submittedIds.has(previous.id) || removedIds.has(previous.id)) continue;
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
export async function saveActivityRequirementConfiguration(planId: string, input: ActivityRequirementUpdate,
    removedOverrideIds: readonly string[] = []): Promise<void> {
    const {roleRequirements, stayRequirements, overrides, ...planSettings} = input;
    const expectedPlan = await activityService.getActivityPlanById(planId);

    /** Recheck relationship, roles and requirement completeness on the locked
     * plan, retaining unchanged former-participant overrides before replacing
     * the approved configuration through the same transaction manager. */
    async function saveRequirements(manager: EntityManager): Promise<void> {
        // An unlocked editor baseline cannot authorize saving after a relink.
        const plan = await requireRecommendationContext(manager, planId);
        requireActivityRequirementWork(plan);
        if (expectedPlan && (expectedPlan.eventId ?? null) !== (plan.eventId ?? null) && !sameUuid(expectedPlan.eventId, plan.eventId)) {
            throw new APIError('Activity plan event changed; reload the requirements', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
        }

        if (!plan.eventId) {
            throw new APIError('Event is required to configure participant overrides', {planId}, 400, {cause: 'ACTIVITY_EVENT_REQUIRED'});
        }

        // Membership and saved-override decisions use this same locked transaction.
        // Unchanged targets from a former event are retained; new/changed overrides still
        // require current registration. Checking only the posted rows here would reject a
        // harmless settings save after relinking and encourage the browser to drop history.

        // Both general role requirements and individual overrides must name
        // roles owned by this current plan, regardless of submitted ID spelling.
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

        // REQUIRED mode needs one saved row for every inclusive stay duration;
        // validate the complete table before settings or overrides can be written.
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

        // Merge explicit removals with retained history only after all shared
        // configuration checks pass, then persist the coherent replacement once.
        const retainedOverrides = await mergeRequirementOverrides(manager, plan, overrides, removedOverrideIds);
        await requirementService.replaceRequirements(planId, roleRequirements, retainedOverrides, normalizedSettings, stayRequirements, manager, planDays);
    }
    await activityService.withActivityTransaction(saveRequirements);
}

/**
 * Decisions are made after acquiring the root lock, not between separate service transactions.
 * The process-local callback detects jobs invalidated while they wait for that lock.
 */
export async function requireRecommendationContext(
    manager: EntityManager, planId: string, expected?: ActivityRecommendationPersistenceContext,
): Promise<ActivityPlan> {
    // Acquire the established parent/root context locks before interpreting the
    // saved relationship; the unlocked discovery result is not current authority.
    const {initialEventId, plan} = await activityService.lockActivityContext(manager, planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    // Check both a relink observed while locking and any caller-captured job/date
    // evidence before downstream operations can persist stale calculations.
    if (((plan.eventId ?? null) !== initialEventId && !sameUuid(plan.eventId, initialEventId)) || (expected && (expected.isCurrent?.() === false
        || ((plan.eventId ?? null) !== expected.eventId && !sameUuid(plan.eventId, expected.eventId))
        || plan.startDate !== expected.startDate || plan.endDate !== expected.endDate))) {
        throw new APIError('Activity plan context changed; reload and try again', {reason: 'activity-context-changed'}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
    }
    return plan;
}

/**
 * Assemble foreign commitments once from the saved relationship. Sibling roles, counts and
 * requirements deliberately stay out of the local participant projection. An active move
 * reserves its target but cannot release a commitment owned by a different plan's transaction.
 */
export async function buildLinkedPlanContext(plan: ActivityPlan, manager?: EntityManager): Promise<ActivityLinkedPlanContext> {
    const context: ActivityLinkedPlanContext = {plans: [], commitments: {}};
    if (!plan.eventId) return context;
    // Resolve siblings from the saved event relationship before reading their assignment/proposal evidence.
    const siblings = await activityService.getLinkedActivityPlans(plan.eventId, plan.id, manager);
    const byId = indexByUuid(siblings, sibling => sibling.id);
    const ids = siblings.map((sibling) => sibling.id);
    const [assignments, recommendations] = await Promise.all([
        activityService.getAssignmentsForPlans(ids, manager),
        recommendationService.getRecommendationsForPlans(ids, manager),
    ]);
    for (const sibling of siblings) {
        context.plans.push({id: sibling.id, assignmentMode: sibling.assignmentMode, startDate: sibling.startDate, endDate: sibling.endDate});
    }
    /** Reserve only commitments falling within this plan's date range, retaining their foreign provenance. */
    function addCommitment(profileId: string, slot: ActivitySlot, sibling: ActivityPlan, recommendation?: ActivityAssignmentRecommendation): void {
        if (slot.day < plan.startDate || slot.day > plan.endDate) return;
        const key = toParticipantKey({profileId: uuidKey(profileId)});
        context.commitments[key] ??= [];
        context.commitments[key].push({
            ...toAssignmentCandidate(slot), title: slot.title, planId: sibling.id,
            planTitle: sibling.title, assignmentMode: sibling.assignmentMode,
            recommendationId: recommendation?.id, recommendationStatus: recommendation?.status,
            operation: recommendation?.operation, sourceItemId: recommendation?.sourceItem?.id ?? null,
        });
    }
    // Saved assignments always reserve time; active non-removal proposals additionally reserve their targets.
    for (const assignment of assignments) {
        const sibling = byId.get(uuidKey(assignment.entityId));
        if (sibling) addCommitment(assignment.profile.id, assignment.item, sibling);
    }
    for (const recommendation of recommendations) {
        if (!['PENDING', 'APPROVED'].includes(recommendation.status) || recommendation.operation === 'UNASSIGN') continue;
        const sibling = byId.get(uuidKey(recommendation.entityId));
        if (sibling) addCommitment(recommendation.profile.id, recommendation.item, sibling, recommendation);
    }
    return context;
}

/** Merge admitted registration, assignment and proposal sources by stable profile identity, then enrich missing data. */
export async function buildParticipantAttendanceMap(
    plan: ActivityPlan,
    overrides: RequirementConfiguration["overrides"],
    existingAssignments: Record<string, {
        id: string;
        day: string;
        startTime?: string | null;
        endTime?: string | null;
        pos?: number | null
    }[]>,
    recommendations: { itemId: string; profileId: string }[],
    eventParticipants: ParticipantRow[] = [],
    manager?: EntityManager,
): Promise<Record<string, ParticipantAttendance>> {
    const attendance: Record<string, ParticipantAttendance> = {};

    /** Enrich one identity without replacing known attendance, roles or names with absent values. */
    const upsert = (source: ParticipantAttendance) => {
        // Preserve earlier evidence when the later source omits a field.
        const participant = source.profileId ? {...source, profileId: uuidKey(source.profileId)} : source;
        const key = toParticipantKey(participant);
        if (!key) return;
        if (!attendance[key]) {
            attendance[key] = participant;
            return;
        }

        const existing = attendance[key];
        attendance[key] = {
            ...existing,
            arrivalDate: participant.arrivalDate ?? existing.arrivalDate,
            departureDate: participant.departureDate ?? existing.departureDate,
            roleIds: participant.roleIds ?? existing.roleIds,
            name: participant.name ?? existing.name,
        };
    };

    eventParticipants.forEach((participant) => {
        upsert({
            profileId: participant.profileId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        });
    });

    // Committed assignees remain part of the read projection after relinking or an
    // external-assignee policy change. Their names and recorded work must stay visible;
    // recommendation selection and persistence enforce eligibility independently.
    Object.keys(existingAssignments).forEach((key) => {
        // Only persisted profile-backed assignment identities enter this attendance map.
        const [type, id] = key.split(":");
        if (type === "profile") {
            upsert({profileId: String(id)});
        }
    });

    // Retained overrides can enrich a registered or already assigned profile's name,
    // but an override alone never adds a participant or grants recommendation eligibility.
    for (const override of overrides) {
        if (attendance[toParticipantKey({profileId: uuidKey(override.profileId)})]) {
            upsert({profileId: override.profileId, name: override.profile.name});
        }
    }
    for (const rec of recommendations) {
        if (!plan.eventId || attendance[toParticipantKey({profileId: uuidKey(rec.profileId)})]) {
            upsert({profileId: rec.profileId ?? undefined});
        }
    }

    // Resolve only missing display names in one DBAL read, on the caller's manager when supplied.
    const unnamedProfileIds = Object.values(attendance)
        .filter((participant) => participant.profileId && !participant.name)
        .map((participant) => participant.profileId as string);
    const profiles = await userService.getProfilesByIds(unnamedProfileIds, manager);
    profiles.forEach((profile) => upsert({profileId: profile.id, name: profile.name}));

    // Load roleIds from ActivityAssignmentRole for each participant
    const participantRoles = await activityService.getParticipantRolesForPlan(plan.id, manager);
    for (const {participantKey, roleIds} of participantRoles) {
        if (attendance[participantKey] && roleIds.length > 0) {
            attendance[participantKey].roleIds = [...new Set([...(attendance[participantKey].roleIds || []), ...roleIds])];
        }
    }

    return attendance;
}

/** Prepare the matching analysis/baseline context after each caller's own initial reads.
 * This operation is deliberately asynchronous: Event participants, missing names
 * and persisted participant roles are read in their existing order on the supplied manager. */
export async function prepareActivityRequirementContext(
    {plan, configuration, assignments, slots, slotRoles}: ActivityRequirementPreparationInputs,
    manager?: EntityManager,
) {
    // Read only the already selected parent, then retain registered and historical
    // assignee attendance through the existing shared enrichment operation.
    const eventParticipants = plan.event
        ? projectEventParticipants(await eventService.getEventParticipantRows(plan.event.id, manager)) : [];
    const attendance = await buildParticipantAttendanceMap(plan, configuration.overrides, assignments, [], eventParticipants, manager);

    // Both calculations consume the same slot-role quantities and assignment counts;
    // their distinct arithmetic and presentation remain with the existing engines/callers.
    const slotsWithRoles = projectRequirementSlots(slots, slotRoles);
    const assignedShiftCounts = Object.fromEntries(Object.entries(assignments)
        .map(([participantKey, participantAssignments]) => [participantKey, participantAssignments.length]));
    return {eventParticipants, calculation: {plan, participants: Object.values(attendance),
            roleRequirements: configuration.roleRequirements, overrides: configuration.overrides,
            stayRequirements: configuration.stayRequirements, slots: slotsWithRoles, assignedShiftCounts}};
}

/** Project stored role identity and quantities once for both requirement engines. */
function projectRequirementSlots(slots: ActivityRequirementPreparationInputs['slots'],
    slotRoles: ActivityRequirementPreparationInputs['slotRoles']) {
    // Normalize UUID/role identities without changing capacity, timeboxes or assigned quantities.
    return slots.map(slot => ({id: uuidKey(slot.id), day: slot.day, startTime: slot.startTime,
        endTime: slot.endTime, maxAssignees: slot.maxAssignees,
        roles: (slotRoles[uuidKey(slot.id)] ?? []).map(role => ({roleId: Number(role.id),
            maxQty: role.maxQty, assignedQty: role.assignedQty}))}));
}

/** Preserve saved row identity for review; context memory deliberately excludes it from allocation fingerprints. */
export function toRecommendationInput(recommendation: ActivityAssignmentRecommendation,
    identity: 'saved' | 'memory' = 'saved'): RecommendationInput {
    // Populate one fresh result in original property order. Memory never reads or inserts a saved row ID.
    const input = (identity === 'memory' ? {} : {id: recommendation.id}) as RecommendationInput;
    input.itemId = recommendation.item.id;
    input.profileId = recommendation.profile.id;
    input.status = recommendation.status;
    input.operation = recommendation.operation;
    input.sourceItemId = recommendation.sourceItem?.id ?? null;
    input.manual = recommendation.manual;
    input.hidden = recommendation.hidden;
    if (recommendation.pairingKnown) input.swapGroup = recommendation.swapGroup ?? null;
    if (identity === 'saved') return input;
    const memory = normalizeRecommendationInput(input, 'canonical');
    delete memory.id;
    return memory;
}

/** Validation belongs at the command boundary, including generated internal commands. */
export function normalizeRecommendationForPersistence(input: RecommendationInput): RecommendationInput {
    if (!input.itemId || !input.profileId) throw new APIError('Recommendation requires a slot and profile', input, 400);
    if (input.operation === 'REASSIGN' && (!input.sourceItemId || sameUuid(input.sourceItemId, input.itemId))) {
        throw new APIError('Reassignment requires a different source slot', input, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
    }
    return normalizeRecommendationInput(input);
}

/** Review commands recheck their original event/date context after acquiring the root lock. */
export async function saveReviewedRecommendations(
    planId: string, recommendations: RecommendationInput[], expected: ActivityRecommendationPersistenceContext,
): Promise<void> {
    const normalized = recommendations.map(normalizeRecommendationForPersistence);
    /** Revalidate relationship/date evidence under the owning transaction before replacing reviewed rows. */
    async function saveReviewed(manager: EntityManager): Promise<void> {
        // A concurrent relationship or date change must fail before any existing review history is replaced.
        await requireRecommendationContext(manager, planId, expected);
        await recommendationService.replaceRecommendations(planId, normalized, manager);
    }
    await activityService.withActivityTransaction(saveReviewed);
}

/**
 * Atomically reconciles generated work without erasing manual drafts or review history.
 * Only generated pending rows are replaceable. A participant/slot pair matching rejection memory is
 * re-exposed as rejected instead of being inserted as a new pending recommendation.
 */
export async function saveGeneratedRecommendations(
    planId: string,
    recommendations: RecommendationInput[],
    expected?: ActivityRecommendationPersistenceContext,
): Promise<void> {
    /** Reconcile generated candidates only after the locked context and optional input fingerprint still match. */
    async function saveGenerated(manager: EntityManager): Promise<void> {
        // Lock and validate first; no generated row is invalidated until its original input is confirmed current.
        await requireRecommendationContext(manager, planId, expected);
        if (expected?.inputFingerprint) {
            const current = await buildPlanRecommendationContext(planId, undefined, manager);
            if (fingerprintRecommendationContext(current) !== expected.inputFingerprint) {
                throw new APIError('Activity plan inputs changed; generate recommendations again', {reason: 'activity-context-changed'}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
            }
        }
        const normalized = recommendations.map(normalizeRecommendationForPersistence);
        await recommendationService.invalidateGeneratedRecommendations(manager, planId);

        if (!normalized.length) return;
        const preserved = await recommendationService.getRecommendations(planId, manager);
        // Accepted/manual work is deduplicated by the complete operation. Rejection memory
        // deliberately uses only participant plus target slot: regenerating another kind of
        // suggestion for that same target must not silently undo the organizer's rejection.
        const preservedKeys = new Set(preserved
            .filter((row) => row.status !== "REJECTED")
            .map((row) => recommendationInputKey(toRecommendationInput(row))));
        const rejectedByTarget = new Map(preserved
            .filter((row) => row.status === "REJECTED")
            .map((row) => [`${uuidKey(row.item.id)}:${uuidKey(row.profile.id)}`, row]));
        const rows: RecommendationInput[] = [];
        for (const recommendation of normalized) {
            const rejectedMemory = rejectedByTarget.get(`${uuidKey(recommendation.itemId)}:${uuidKey(String(recommendation.profileId))}`);
            if (rejectedMemory) {
                rows.push({
                    ...toRecommendationInput(rejectedMemory),
                    operation: recommendation.operation ?? "ASSIGN",
                    sourceItemId: recommendation.sourceItemId ?? null,
                    manual: false,
                    hidden: false,
                });
                continue;
            }
            if (preservedKeys.has(recommendationInputKey(recommendation))) continue;
            rows.push({...recommendation, id: undefined, status: 'PENDING', manual: false, hidden: false});
        }
        await recommendationService.saveRecommendations(planId, rows, manager);
    }
    await activityService.withActivityTransaction(saveGenerated);
}

/** The final persistence check needs the relationship and dates that this read actually used. */
export function recommendationContext(plan: Pick<ActivityPlan, 'eventId' | 'startDate' | 'endDate'>): ActivityRecommendationContext {
    return {eventId: plan.eventId ? uuidKey(plan.eventId) : null, startDate: plan.startDate, endDate: plan.endDate};
}

/**
 * Assemble algorithm input at the feature boundary. Current registration and the explicit
 * external-assignee policy select participants; saved overrides contribute requirements only.
 * The worker receives values, never repositories or an independent authorization decision.
 */
export async function buildPlanRecommendationContext(
    planId: string,
    existingRecommendations?: ActivityAssignmentRecommendation[],
    manager?: EntityManager,
): Promise<AutoAssignmentContext> {
    if (!manager) {
        async function readContext(snapshot: EntityManager): Promise<AutoAssignmentContext> {
            return buildPlanRecommendationContext(planId, existingRecommendations, snapshot);
        }
        return activityService.withActivityReadSnapshot(readContext);
    }
    const plan = await activityService.getActivityPlanById(planId, manager);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    requireActivityRequirementWork(plan);
    const [requirementConfig, slots, existingAssignments, participantRoles] = await Promise.all([
        requireRequirementConfiguration(planId, manager),
        activityService.getActivitySlotsFlat(planId, manager) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId, manager),
        activityService.getParticipantRolesForPlan(planId, manager),
    ]);

    existingRecommendations ??= await recommendationService.getRecommendations(planId, manager);
    const recommendationMemory = existingRecommendations.map(recommendation => toRecommendationInput(recommendation, 'memory'));
    const eventParticipants = plan.event
        ? await eventService.getEventParticipantRows(plan.event.id, manager).then(projectEventParticipants)
        : [];
    const participants = mergeParticipants(
        eventParticipants.map((participant) => ({
            profileId: participant.profileId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        })),
        // Existing external assignees remain eligible only under the plan's established
        // external policy (or for a standalone plan). Retained overrides are requirements,
        // never an independent source of participants after a relationship changes.
        !plan.event || plan.allowExternalAssignees ? participantsFromAssignments(existingAssignments) : [],
    );
    const participantByKey = new Map(participants.map((participant) => [toParticipantKey(participant), participant]));
    for (const participantRole of participantRoles) {
        const participant = participantByKey.get(participantRole.participantKey);
        if (participant) participant.roleIds = participantRole.roleIds;
    }

    const context: AutoAssignmentContext = {
        plan: {
            eventId: plan.eventId ? uuidKey(plan.eventId) : null,
            allowExternalAssignees: plan.allowExternalAssignees,
            assignmentMode: plan.assignmentMode,
            generalRequiredShifts: plan.generalRequiredShifts,
            roundingMode: plan.roundingMode,
            startDate: plan.startDate,
            endDate: plan.endDate,
            allowOverfillAfterFull: plan.allowOverfillAfterFull,
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
        slots: slots.map(slot => ({...slot, id: uuidKey(slot.id)})),
        participants,
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        stayRequirements: requirementConfig.stayRequirements,
        existingAssignments: Object.fromEntries(Object.entries(existingAssignments).map(([key, assignments]) => [
            key, assignments.map(assignment => ({...assignment, id: uuidKey(assignment.id)})),
        ])),
        existingRecommendations: recommendationMemory,
        linkedPlans: await buildLinkedPlanContext(plan, manager),
    };
    // Warning consumers retain loaded references. Only this fresh worker snapshot
    // keys linked UUID values for deterministic calculation and fingerprinting.
    const linked = context.linkedPlans!;
    context.linkedPlans = {
        plans: linked.plans.map(plan => ({...plan, id: uuidKey(plan.id)})),
        commitments: Object.fromEntries(Object.entries(linked.commitments).map(([key, assignments]) => [key,
            assignments.map(assignment => ({...assignment, id: uuidKey(assignment.id),
                planId: assignment.planId ? uuidKey(assignment.planId) : assignment.planId,
                recommendationId: assignment.recommendationId ? uuidKey(assignment.recommendationId) : assignment.recommendationId,
                sourceItemId: assignment.sourceItemId ? uuidKey(assignment.sourceItemId) : assignment.sourceItemId})),
        ])),
    };
    return context;
}

/**
 * Applies a reviewed recommendation batch atomically. Reassignments release all
 * source slots before capacity is checked for their targets, which also makes a
 * two-row swap safe regardless of row order.
 */
export async function applyActivityRecommendationOperations(
    planId: string,
    operations: ActivityRecommendationOperationInput[],
    expected?: ActivityRecommendationContext,
    manager?: EntityManager,
): Promise<void> {
    if (operations.length === 0) return;

    /** Validate and apply the complete reviewed write set under the current plan,
     * slot and assignment locks. Source removals and target additions are staged
     * together so capacity checks admit reciprocal swaps before persistence. */
    async function applyOperations(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId, expected);

        // Lock every referenced target/source and reject foreign or vanished
        // slots before examining assignment membership or constructing changes.
        const referencedSlotIds = [...new Set(operations.flatMap((operation) => [
            operation.itemId,
            ...(operation.sourceItemId ? [operation.sourceItemId] : []),
        ]).map(uuidKey))];
        const slots = await activityService.getLockedActivitySlots(manager, referencedSlotIds);
        if (slots.length !== referencedSlotIds.length || slots.some((slot) => !sameUuid(slot.entityId, planId))) {
            throw new APIError("Recommendation slot does not belong to this activity plan", {planId}, 400, {cause: 'ACTIVITY_RECOMMENDATION_TARGET_INVALID'});
        }
        const slotById = indexByUuid(slots, slot => slot.id);

        // Compare operations with the same locked assignment baseline. No staged
        // removal or addition changes the database until the whole batch passes.
        const assignments = await activityService.getLockedPlanAssignments(manager, planId);
        function pairKey(itemId: string, profileId: string): string {
            return `${uuidKey(itemId)}:${uuidKey(profileId)}`;
        }
        const assignmentByPair = new Map(
            assignments.map((assignment) => [pairKey(assignment.item.id, assignment.profile.id), assignment]),
        );
        // Retained drafts can name profiles from a former event. Recheck eligibility using
        // the now-locked relationship; saved overrides alone never authorize an assignment.
        if (plan.eventId) {
            const allowedProfiles = new Set((await activityService.getRegisteredProfileIds(manager, plan.eventId)).map(uuidKey));
            if (plan.allowExternalAssignees) {
                for (const assignment of assignments) allowedProfiles.add(uuidKey(assignment.profile.id));
            }
            for (const operation of operations) {
                if (!allowedProfiles.has(uuidKey(operation.profileId))) {
                    throw new APIError('Recommendations must target participants registered for this event', operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_PARTICIPANT_REQUIRED'});
                }
            }
        }
        const removals = new Map<number, ActivityAssignment>();
        const additions: ActivityRecommendationOperationInput[] = [];
        const additionPairs = new Set<string>();

        // Each source may change once, and each proposed target pair must remain
        // unique; automatic moves cannot release an assignment holding named roles.
        for (const operation of operations) {
            const targetPair = pairKey(operation.itemId, operation.profileId);
            if (operation.operation === "ASSIGN") {
                if (assignmentByPair.has(targetPair) || additionPairs.has(targetPair)) {
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
                }
                additionPairs.add(targetPair);
                additions.push(operation);
                continue;
            }

            const sourceItemId = operation.operation === "REASSIGN"
                ? operation.sourceItemId
                : operation.itemId;
            if (!sourceItemId) {
                throw new APIError("Reassignment requires a source slot", operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
            }
            const source = assignmentByPair.get(pairKey(sourceItemId, operation.profileId));
            if (!source) {
                throw new APIError("Recommendation source assignment no longer exists", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_MISSING'});
            }
            if (removals.has(source.id)) {
                throw new APIError("An assignment can only be changed once per recommendation batch", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_CHANGE_DUPLICATE'});
            }

            if (operation.operation === "REASSIGN") {
                if (sameUuid(sourceItemId, operation.itemId)) {
                    throw new APIError("Reassignment target must differ from its source", operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
                }
                if (source.activityAssignmentRoles.some(({role}) => !role.isDefault)) {
                    throw new APIError("Assignments with named roles cannot be automatically reassigned", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_NAMED_ROLE'});
                }
                if (assignmentByPair.has(targetPair) || additionPairs.has(targetPair)) {
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
                }
                additionPairs.add(targetPair);
                additions.push(operation);
            }
            removals.set(source.id, source);
        }

        const projectedCounts = new Map<string, number>();
        // Calculate final occupancy before any write. Removing every source first permits
        // reciprocal moves between full slots; validating additions against the original
        // occupancy would wrongly reject those swaps or make the result depend on row order.
        for (const assignment of assignments) {
            if (!removals.has(assignment.id)) {
                const slotKey = uuidKey(assignment.item.id);
                projectedCounts.set(slotKey, (projectedCounts.get(slotKey) ?? 0) + 1);
            }
        }
        for (const addition of additions) {
            const target = slotById.get(uuidKey(addition.itemId))!;
            const count = projectedCounts.get(uuidKey(target.id)) ?? 0;
            if (!plan.allowOverfillAfterFull && target.maxAssignees != null && count >= target.maxAssignees) {
                throw new APIError("This activity slot is already full", addition, 409, {cause: 'ACTIVITY_FULL'});
            }
            projectedCounts.set(uuidKey(target.id), count + 1);
        }

        // Only the feature operation decides which removals/additions are valid. The DBAL receives
        // the resulting write set and applies it in this still-locked transaction.
        const rows: {itemId: string; profileId: string; roleId: number}[] = [];
        if (additions.length) {
            const [defaultRole] = await activityService.ensureRoleId(planId, 'default', true, undefined, manager);
            for (const addition of additions) rows.push({...addition,
                itemId: slotById.get(uuidKey(addition.itemId))!.id, roleId: defaultRole.id});
        }
        await activityService.writeAssignmentChanges(manager, planId, [...removals.keys()], rows);
    }
    if (manager) await applyOperations(manager);
    else await activityService.withActivityTransaction(applyOperations);
}

// Background persistence and HTTP edits consume the same locked feature operation.
// The coordinator performs scheduling/cache work and never chooses a database write policy.
const recommendationJobCoordinator = new RecommendationJobCoordinator({
    loadContext: loadRecommendationJobContext,
    persist: saveGeneratedRecommendations,
});

/** Recheck generation eligibility when a queued job actually begins. */
async function loadRecommendationJobContext(planId: string): Promise<AutoAssignmentContext> {
    // Queue waiting does not preserve an earlier assignment mode or input set.
    const context = await buildPlanRecommendationContext(planId);
    if (context.plan.assignmentMode === 'FREE') {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409, {cause: 'ACTIVITY_RECOMMENDATIONS_DISABLED'});
    }
    return context;
}

/**
 * Used under the plan lock after validation by relationship/date mutations. A later rollback
 * may conservatively cancel an in-flight calculation, but never changes saved assignments.
 */
export function invalidateEventContext(planId: string): void {
    recommendationJobCoordinator.invalidate(uuidKey(planId));
}

/** Refresh recommendations after application; jobs use the same persistence guard. */
export async function generateAndSaveRecommendations(planId: string, existing: ActivityAssignmentRecommendation[]): Promise<RecommendationInput[]> {
    // Capture the saved input identity before computing recommendations outside the write transaction.
    const context = await buildPlanRecommendationContext(planId, existing);
    const fingerprint = fingerprintRecommendationContext(context);
    const recommendations = generateFairRecommendations(context);
    // Reject stale computation before entering persistence, which repeats this guard under its own locks.
    const freshContext = await buildPlanRecommendationContext(planId);
    if (fingerprintRecommendationContext(freshContext) !== fingerprint) {
        throw new APIError('Plan inputs changed while recommendations were being calculated', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
    }
    // Persist against the exact event/date context and input fingerprint used by this calculation.
    await saveGeneratedRecommendations(planId, recommendations, {
        eventId: context.plan.eventId ?? null,
        startDate: context.plan.startDate,
        endDate: context.plan.endDate,
        inputFingerprint: fingerprint,
    });
    return recommendations;
}

/** Admit explicit generation against saved requirements before enqueueing any work. */
export async function queueAutoGenerateRecommendations(planId: string) {
    // Free assignment and incomplete stay requirements cannot start a useful job.
    const plan = await activityService.getActivityPlanById(planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    requireActivityRequirementWork(plan);
    if (plan.assignmentMode === "FREE") {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409, {cause: 'ACTIVITY_RECOMMENDATIONS_DISABLED'});
    }
    const requirementConfig = await requireRequirementConfiguration(planId);
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    if (!hasCompleteStayRequirements(planDays, requirementConfig.stayRequirements)) {
        throw new APIError(
            `Automatic recommendations need saved stay-duration requirements for days 1 through ${planDays}`,
            {planId},
            409,
            {cause: 'ACTIVITY_GENERATION_REQUIREMENTS_INCOMPLETE'},
        );
    }

    // The coordinator retains coalescing and queue capacity. Its trusted queue
    // failure carries the existing bounded retry advice rather than private text.
    try {
        const queued = recommendationJobCoordinator.enqueue(uuidKey(plan.id));
        return {
            message: queued.coalesced ? 'Recommendation job already queued' : 'Recommendation job queued',
            job: queued.job,
            coalesced: queued.coalesced,
        };
    } catch (error) {
        if (error instanceof RecommendationQueueFullError) {
            throw new APIError(error.message, {retryAfter: 5}, 503, {cause: error});
        }
        throw error;
    }
}

/** Disclose a process-local job only within its originating Activity plan. */
export async function getAutoRecommendationJob(planId: string, jobId: string) {
    // A cached job identifier never authorizes access to another plan's result.
    const job = recommendationJobCoordinator.get(uuidKey(jobId));
    if (!job || !sameUuid(job.planId, planId)) {
        throw new APIError('Recommendation job not found', {planId, jobId}, 404);
    }
    return {job};
}
