import {AppDataSource} from "../dataSource";
import {ActivityPlanRequirement} from "../entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../entities/activity/ActivityPlanRequirementOverride";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {normalizeOverrideInput, RequirementOverrideInput} from "../../activity/requirements";

export interface RoleRequirementInput {
    roleId: number;
    requiredShifts: number;
}

export interface RequirementConfiguration {
    plan: Pick<ActivityPlan, "id" | "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "startDate" | "endDate">;
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
}

export async function getRequirementConfiguration(planId: string): Promise<RequirementConfiguration> {
    const planRepo = AppDataSource.getRepository(ActivityPlan);
    const plan = await planRepo.findOne({
        where: {id: planId},
        select: [
            "id",
            "assignmentMode",
            "generalRequiredShifts",
            "roundingMode",
            "startDate",
            "endDate",
        ],
        relations: {
            activityPlanRequirements: {role: true},
            activityPlanRequirementOverrides: {role: true, user: true, guest: true},
        },
    });

    if (!plan) {
        throw new Error(`Activity plan ${planId} not found`);
    }

    return {
        plan,
        roleRequirements: plan.activityPlanRequirements,
        overrides: plan.activityPlanRequirementOverrides,
    };
}

export async function replaceRoleRequirements(planId: string, requirements: RoleRequirementInput[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityPlanRequirement);
        await repo.delete({plan: {id: planId}});

        if (!requirements.length) return;

        const rows = requirements.map((req) =>
            repo.create({
                plan: {id: planId},
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
        await repo.delete({plan: {id: planId}});

        if (!normalized.length) return;

        const rows = normalized.map((override) =>
            repo.create({
                id: override.id,
                plan: {id: planId},
                role: override.roleId ? {id: override.roleId} : undefined,
                user: override.userId ? {id: override.userId} : undefined,
                guest: override.guestId ? {id: override.guestId} : undefined,
                requiredShifts: override.requiredShifts,
            })
        );

        await repo.save(rows);
    });
}
