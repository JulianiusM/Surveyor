import {In} from "typeorm";
import {AppDataSource} from "../dataSource";
import {
    ActivityAssignmentRecommendation,
    RecommendationStatus
} from "../entities/activity/ActivityAssignmentRecommendation";

/**
 * Persistence helpers for staged assignment recommendations. This module normalizes incoming
 * payloads and exposes lightweight CRUD operations so controllers and background hooks can
 * manage proposed assignments separately from committed slot sign-ups.
 */

export interface RecommendationInput {
    id?: string;
    itemId: string;
    profileId?: string | null;
    status?: RecommendationStatus;
}

export function normalizeRecommendationInput(input: RecommendationInput): RecommendationInput {
    if (!input.itemId) {
        throw new Error("Recommendation requires a slotId");
    }

    const hasProfile = input.profileId != null;

    if (!hasProfile) {
        throw new Error("Recommendation requires a profileId");
    }

    return {
        id: input.id,
        itemId: input.itemId,
        profileId: String(input.profileId),
        status: input.status ?? "PENDING",
    };
}

export async function getRecommendations(planId: string) {
    return await AppDataSource.getRepository(ActivityAssignmentRecommendation).find({
        where: {entity: {id: planId}},
        relations: {item: true, profile: true},
    });
}

export async function markRecommendationsApplied(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;

    await AppDataSource.getRepository(ActivityAssignmentRecommendation).update(
        {id: In(ids), entity: {id: planId}},
        {status: "APPLIED"},
    );
}

export async function replaceRecommendations(planId: string, recommendations: RecommendationInput[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityAssignmentRecommendation);
        const normalized = recommendations.map(normalizeRecommendationInput);

        await repo.delete({entity: {id: planId}});

        if (!normalized.length) return;

        const rows = normalized.map((rec) =>
            repo.create({
                entity: {id: planId},
                item: {id: rec.itemId},
                profile: {id: rec.profileId ?? ''},
                status: rec.status ?? "PENDING",
            })
        );

        await repo.save(rows);
    });
}
