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

import type {PlanRequirementSettings, RequirementConfiguration} from '../../../../types/ActivityTypes';


import type {
    RequirementOverrideInput, RoleRequirementInput, StayRequirementInput, RequirementPageSection,
} from "../../../../types/ActivityRequirementTypes";
import type {
    EntityManager, ObjectLiteral, SelectQueryBuilder,
} from "typeorm";
import {Between, LessThanOrEqual} from 'typeorm';
import {countInclusiveDays} from '../../../../common/activity/requirements';
import {AppDataSource} from "../dataSource";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivityPlanRequirement} from "../entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../entities/activity/ActivityPlanRequirementOverride";
import {ActivityPlanStayRequirement} from "../entities/activity/ActivityPlanStayRequirement";

/** Count and fetch one bounded SQL page without hydrating the complete saved collection. */
async function readRequirementRows<Row extends ObjectLiteral>(query: SelectQueryBuilder<Row>, requestedPage: number) {
    // Counts do not materialize rows. Clamp before applying the SQL offset so an
    // out-of-range request still returns the final existing page deterministically.
    const total = await query.getCount();
    const pages = Math.max(1, Math.ceil(total / 100));
    const page = Math.min(Math.max(1, requestedPage), pages);
    const rows = await query.skip((page - 1) * 100).take(100).getMany();
    return {rows, total, pages, page};
}

/** Read only the selected stored requirement collection; policy and editing rights remain feature-owned. */
export async function getRequirementPage(planId: string, section: RequirementPageSection, requestedPage: number,
    manager: EntityManager = AppDataSource.manager) {
    const empty = {roleRequirements: [] as ActivityPlanRequirement[], stayRequirements: [] as ActivityPlanStayRequirement[],
        overrides: [] as ActivityPlanRequirementOverride[]};
    // Each branch chooses its actual relation projection, preserving the saved
    // row identities/names while the common page owner bounds every SQL read.
    if (section === 'roles') {
        const query = manager.getRepository(ActivityPlanRequirement).createQueryBuilder('requirement')
            .leftJoinAndSelect('requirement.role', 'role').where('requirement.entity_id = :planId', {planId})
            .orderBy('requirement.id', 'ASC');
        const result = await readRequirementRows(query, requestedPage);
        return {...empty, roleRequirements: result.rows, total: result.total, pages: result.pages, page: result.page};
    }
    if (section === 'overrides') {
        const query = manager.getRepository(ActivityPlanRequirementOverride).createQueryBuilder('requirement')
            .leftJoinAndSelect('requirement.role', 'role').leftJoinAndSelect('requirement.profile', 'profile')
            .where('requirement.entity_id = :planId', {planId}).orderBy('requirement.id', 'ASC');
        const result = await readRequirementRows(query, requestedPage);
        return {...empty, overrides: result.rows, total: result.total, pages: result.pages, page: result.page};
    }
    const query = manager.getRepository(ActivityPlanStayRequirement).createQueryBuilder('requirement')
        .where('requirement.entity_id = :planId', {planId}).orderBy('requirement.stay_days', 'ASC');
    const result = await readRequirementRows(query, requestedPage);
    return {...empty, stayRequirements: result.rows, total: result.total, pages: result.pages, page: result.page};
}

/** Load the selected plan settings and their stored requirement collections.
 * Reuse the caller's manager, preserve nullable absence and sort the copied stay
 * rows by duration without interpreting their required-shift policy. */
export async function getRequirementConfiguration(
    planId: string,
    manager: EntityManager = AppDataSource.manager,
    includeStayRequirements = true,
): Promise<RequirementConfiguration | null> {
    // Hydrate only the established settings projection and related requirement data.
    const planRepo = manager.getRepository(ActivityPlan);
    const plan = await planRepo.findOne({
        where: {id: planId},
        select: {
            id: true,
            assignmentMode: true,
            generalRequiredShifts: true,
            roundingMode: true,
            startDate: true,
            endDate: true,
            bindingDeadline: true,
            allowOverfillAfterFull: true,
            allowExternalAssignees: true,
            allowArrivalDayEvening: true,
            allowDepartureDayMorning: true
        },
        relations: {
            activityPlanRequirements: {role: true},
            activityPlanRequirementOverrides: {role: true, profile: true},
        },
    });

    // Absence remains a nullable DBAL result; the controller chooses its outcome.
    if (!plan) return null;

    // Saved values outside a shortened range are retained historical inputs,
    // not part of its current configuration. Bound SQL before hydrating rows.
    const stayRequirements = includeStayRequirements
        ? await manager.getRepository(ActivityPlanStayRequirement).find({
            where: {entity: {id: planId}, stayDays: Between(1, countInclusiveDays(plan.startDate, plan.endDate))},
            order: {stayDays: 'ASC'},
        }) : [];

    return {
        plan,
        roleRequirements: plan.activityPlanRequirements,
        overrides: plan.activityPlanRequirementOverrides,
        stayRequirements,
    };
}

/** Replace all stored role requirements in the existing transaction.
 * An empty supplied collection clears the plan's rows; validation belongs to the
 * controller and no additional locks or business defaults are introduced here. */
export async function replaceRoleRequirements(planId: string, requirements: RoleRequirementInput[]): Promise<void> {
    /** Delete and recreate only this plan's role requirement rows atomically. */
    await AppDataSource.transaction(async (manager) => {
        // Clear the old set first, including the deliberate empty-set operation.
        const repo = manager.getRepository(ActivityPlanRequirement);
        await repo.delete({entity: {id: planId}});

        if (!requirements.length) return;

        // Preserve the controller-supplied role IDs and required-shift values.
        const rows = requirements.map((req) =>
            repo.create({
                entity: {id: planId},
                role: {id: req.roleId},
                requiredShifts: req.requiredShifts,
            })
        );
        await repo.save(rows);
    });
}

/** Replace the plan's stored participant/role override rows atomically.
 * Preserve submitted row IDs and existing nullable role/profile mapping; caller
 * validation and the separately scoped requirement workflow remain unchanged. */
export async function replaceRequirementOverrides(planId: string, overrides: RequirementOverrideInput[]): Promise<void> {
    /** Clear and recreate only the selected plan's override collection. */
    await AppDataSource.transaction(async (manager) => {
        // Empty input intentionally commits the deletion without creating rows.
        const repo = manager.getRepository(ActivityPlanRequirementOverride);
        await repo.delete({entity: {id: planId}});

        if (!overrides.length) return;

        // Materialize the same validated row identities and relationship values.
        const rows = overrides.map((override) =>
            repo.create({
                id: override.id,
                entity: {id: planId},
                role: override.roleId ? {id: override.roleId} : undefined,
                profile: {id: override.profileId ?? ''},
                requiredShifts: override.requiredShifts,
            })
        );

        await repo.save(rows);
    });
}

export async function replaceRequirements(
    planId: string,
    roleRequirements: RoleRequirementInput[],
    overrides: RequirementOverrideInput[],
    planSettings?: PlanRequirementSettings,
    stayRequirements: StayRequirementInput[] = [],
    manager?: EntityManager,
    stayReplacementThrough?: number,
): Promise<void> {
    // The controller supplies validated, reconciled rows under its plan lock. This callback
    // only maps those rows to persistence and participates in that same transaction.
    /** Replace controller-validated requirement collections on this transaction.
     * Omitted settings remain stored; empty collections intentionally clear their previous rows. */
    async function persistRequirements(manager: EntityManager): Promise<void> {
        const roleRepo = manager.getRepository(ActivityPlanRequirement);
        const overrideRepo = manager.getRepository(ActivityPlanRequirementOverride);
        const stayRepo = manager.getRepository(ActivityPlanStayRequirement);
        const planRepo = manager.getRepository(ActivityPlan);
        // Omitted settings are deliberately excluded from the SQL patch. Validation and
        // defaults have already been decided by the controller; omission preserves storage.
        const planPatch: PlanRequirementSettings = {};

        if (planSettings?.assignmentMode !== undefined) {
            planPatch.assignmentMode = planSettings.assignmentMode;
        }
        if (planSettings?.generalRequiredShifts !== undefined) {
            planPatch.generalRequiredShifts = planSettings.generalRequiredShifts;
        }
        if (planSettings?.roundingMode !== undefined) {
            planPatch.roundingMode = planSettings.roundingMode;
        }
        if (planSettings?.bindingDeadline !== undefined) {
            planPatch.bindingDeadline = planSettings.bindingDeadline;
        }
        if (planSettings?.allowOverfillAfterFull !== undefined) {
            planPatch.allowOverfillAfterFull = planSettings.allowOverfillAfterFull;
        }
        if (planSettings?.allowExternalAssignees !== undefined) {
            planPatch.allowExternalAssignees = planSettings.allowExternalAssignees;
        }
        if (planSettings?.allowArrivalDayEvening !== undefined) {
            planPatch.allowArrivalDayEvening = planSettings.allowArrivalDayEvening;
        }
        if (planSettings?.allowDepartureDayMorning !== undefined) {
            planPatch.allowDepartureDayMorning = planSettings.allowDepartureDayMorning;
        }

        // Replace active inputs in their existing sequential order. An explicit
        // duration boundary retains values outside a shortened saved plan; the
        // feature supplied that boundary while holding its operation lock.
        await roleRepo.delete({entity: {id: planId}});
        await overrideRepo.delete({entity: {id: planId}});
        await stayRepo.delete({entity: {id: planId},
            ...(stayReplacementThrough === undefined ? {} : {stayDays: LessThanOrEqual(stayReplacementThrough)})});

        if (Object.keys(planPatch).length) {
            await planRepo.update({id: planId}, planPatch);
        }

        // Empty active sets retain their deletion, while saved durations outside
        // the supplied replacement scope remain available for a later expansion.
        if (roleRequirements.length) {
            const roleRows = roleRequirements.map((req) =>
                roleRepo.create({
                    entity: {id: planId},
                    role: {id: req.roleId},
                    requiredShifts: req.requiredShifts,
                })
            );
            await roleRepo.save(roleRows);
        }

        if (overrides.length) {
            const overrideRows = overrides.map((override) =>
                overrideRepo.create({
                    id: override.id,
                    entity: {id: planId},
                    role: override.roleId ? {id: override.roleId} : undefined,
                    profile: {id: override.profileId ?? ''},
                    requiredShifts: override.requiredShifts,
                })
            );
            await overrideRepo.save(overrideRows);
        }

        if (stayRequirements.length) {
            const stayRows = stayRequirements.map((requirement) =>
                stayRepo.create({
                    entity: {id: planId},
                    stayDays: requirement.stayDays,
                    requiredShifts: requirement.requiredShifts,
                })
            );
            await stayRepo.save(stayRows);
        }
    }
    if (manager) await persistRequirements(manager);
    else await AppDataSource.transaction(persistRequirements);
}
