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
    slotId: string;
    userId?: number | null;
    guestId?: string | null;
    status?: RecommendationStatus;
}

export function normalizeRecommendationInput(input: RecommendationInput): RecommendationInput {
    if (!input.slotId) {
        throw new Error("Recommendation requires a slotId");
    }

    const hasUser = input.userId != null;
    const hasGuest = input.guestId != null;

    if (!hasUser && !hasGuest) {
        throw new Error("Recommendation requires a userId or guestId");
    }

    if (hasUser && hasGuest) {
        throw new Error("Recommendation cannot target both user and guest");
    }

    return {
        id: input.id,
        slotId: input.slotId,
        userId: hasUser ? Number(input.userId) : null,
        guestId: hasGuest ? String(input.guestId) : null,
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
                item: {id: rec.slotId},
                profile: {id: rec.guestId ?? ''},
                status: rec.status ?? "PENDING",
            })
        );

        await repo.save(rows);
    });
}
