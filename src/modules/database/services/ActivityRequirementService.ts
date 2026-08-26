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
    normalizeOverrideInput,
    normalizeRoleRequirementInput,
    normalizeStayRequirementInput,
    RequirementOverrideInput,
    RoleRequirementInput,
    StayRequirementInput,
} from "../../activity/requirements";
import {AppDataSource} from "../dataSource";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivityPlanRequirement} from "../entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../entities/activity/ActivityPlanRequirementOverride";
import {ActivityPlanStayRequirement} from "../entities/activity/ActivityPlanStayRequirement";

/**
 * Persistence layer for requirement settings. This service centralizes transactional updates
 * for plan-level defaults, role-based requirements, and participant overrides so controllers
 * and UI flows can keep the configuration consistent.
 */

export type PlanRequirementSettings = Partial<Pick<
    ActivityPlan,
    |
    "assignmentMode"
    | "generalRequiredShifts"
    | "roundingMode"
    | "bindingDeadline"
    | "allowOverfillAfterFull"
    | "allowExternalAssignees"
    | "allowArrivalDayEvening"
    | "allowDepartureDayMorning"
>>;

export interface RequirementConfiguration {
    plan: Pick<
        ActivityPlan,
        | "id"
        | "assignmentMode"
        | "generalRequiredShifts"
        | "roundingMode"
        | "startDate"
        | "endDate"
        | "bindingDeadline"
        | "allowOverfillAfterFull"
        | "allowExternalAssignees"
        | "allowArrivalDayEvening"
        | "allowDepartureDayMorning"
    >;
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    stayRequirements: ActivityPlanStayRequirement[];
}

export async function getRequirementConfiguration(planId: string): Promise<RequirementConfiguration> {
    const planRepo = AppDataSource.getRepository(ActivityPlan);
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
            activityPlanStayRequirements: true,
        },
    });

    if (!plan) {
        throw new Error(`Activity plan ${planId} not found`);
    }

    return {
        plan,
        roleRequirements: plan.activityPlanRequirements,
        overrides: plan.activityPlanRequirementOverrides,
        stayRequirements: [...(plan.activityPlanStayRequirements ?? [])].sort((a, b) => a.stayDays - b.stayDays),
    };
}

export async function replaceRoleRequirements(planId: string, requirements: RoleRequirementInput[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityPlanRequirement);
        const normalized = requirements.map(normalizeRoleRequirementInput);
        await repo.delete({entity: {id: planId}});

        if (!normalized.length) return;

        const rows = normalized.map((req) =>
            repo.create({
                entity: {id: planId},
                role: {id: req.roleId},
                requiredShifts: req.requiredShifts,
            })
        );
        await repo.save(rows);
    });
}

export async function replaceRequirementOverrides(planId: string, overrides: RequirementOverrideInput[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityPlanRequirementOverride);
        const normalized = overrides.map(normalizeOverrideInput);
        await repo.delete({entity: {id: planId}});

        if (!normalized.length) return;

        const rows = normalized.map((override) =>
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
): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(ActivityPlanRequirement);
        const overrideRepo = manager.getRepository(ActivityPlanRequirementOverride);
        const stayRepo = manager.getRepository(ActivityPlanStayRequirement);
        const planRepo = manager.getRepository(ActivityPlan);
        const normalizedRoles = roleRequirements.map(normalizeRoleRequirementInput);
        const normalizedOverrides = overrides.map(normalizeOverrideInput);
        const normalizedStayRequirements = stayRequirements.map(normalizeStayRequirementInput);

        if (new Set(normalizedStayRequirements.map((requirement) => requirement.stayDays)).size !== normalizedStayRequirements.length) {
            throw new Error("Stay durations must be unique");
        }

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

        // Delete old requirements and overrides sequentially
        await roleRepo.delete({entity: {id: planId}});
        await overrideRepo.delete({entity: {id: planId}});
        await stayRepo.delete({entity: {id: planId}});

        if (Object.keys(planPatch).length) {
            await planRepo.update({id: planId}, planPatch);
        }

        if (normalizedRoles.length) {
            const roleRows = normalizedRoles.map((req) =>
                roleRepo.create({
                    entity: {id: planId},
                    role: {id: req.roleId},
                    requiredShifts: req.requiredShifts,
                })
            );
            await roleRepo.save(roleRows);
        }

        if (normalizedOverrides.length) {
            const overrideRows = normalizedOverrides.map((override) =>
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

        if (normalizedStayRequirements.length) {
            const stayRows = normalizedStayRequirements.map((requirement) =>
                stayRepo.create({
                    entity: {id: planId},
                    stayDays: requirement.stayDays,
                    requiredShifts: requirement.requiredShifts,
                })
            );
            await stayRepo.save(stayRows);
        }
    });
}
