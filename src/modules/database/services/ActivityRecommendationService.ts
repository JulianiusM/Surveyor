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

import {In} from "typeorm";
import {AppDataSource} from "../dataSource";
import {
    ActivityAssignmentRecommendation,
    RecommendationOperation,
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
    operation?: RecommendationOperation;
    sourceItemId?: string | null;
    manual?: boolean;
    hidden?: boolean;
}

export function normalizeRecommendationInput(input: RecommendationInput): RecommendationInput {
    if (!input.itemId) {
        throw new Error("Recommendation requires a slotId");
    }

    const hasProfile = input.profileId != null;

    if (!hasProfile) {
        throw new Error("Recommendation requires a profileId");
    }

    const operation = input.operation ?? "ASSIGN";
    const sourceItemId = input.sourceItemId == null ? null : String(input.sourceItemId);
    if (operation === "REASSIGN" && (!sourceItemId || sourceItemId === input.itemId)) {
        throw new Error("Reassignment requires a different source slot");
    }

    return {
        id: input.id,
        itemId: input.itemId,
        profileId: String(input.profileId),
        status: input.status ?? "PENDING",
        operation,
        sourceItemId: operation === "REASSIGN" ? sourceItemId : null,
        manual: Boolean(input.manual),
        hidden: Boolean(input.hidden),
    };
}

export async function getRecommendations(planId: string) {
    return await AppDataSource.getRepository(ActivityAssignmentRecommendation).find({
        where: {entity: {id: planId}},
        relations: {item: true, sourceItem: true, profile: true},
    });
}

export async function markRecommendationsApplied(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;

    await AppDataSource.getRepository(ActivityAssignmentRecommendation).update(
        {id: In(ids), entity: {id: planId}},
        {status: "APPLIED", hidden: true},
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
                id: rec.id,
                entity: {id: planId},
                item: {id: rec.itemId},
                profile: {id: rec.profileId ?? ''},
                status: rec.status ?? "PENDING",
                operation: rec.operation ?? "ASSIGN",
                sourceItem: rec.sourceItemId ? {id: rec.sourceItemId} : null,
                manual: Boolean(rec.manual),
                hidden: Boolean(rec.hidden),
            })
        );

        await repo.save(rows);
    });
}

export async function deleteRecommendations(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await AppDataSource.getRepository(ActivityAssignmentRecommendation).delete({
        id: In(ids),
        entity: {id: planId},
    });
}

export async function markRecommendationsRejected(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await AppDataSource.getRepository(ActivityAssignmentRecommendation).update(
        {id: In(ids), entity: {id: planId}},
        {status: "REJECTED"},
    );
}

/**
 * Atomically reconciles generated work without erasing review history. Only pending
 * rows are replaceable. A generated participant/slot pair matching rejection memory is
 * re-exposed as rejected instead of being inserted as a new pending recommendation.
 */
export async function replacePendingRecommendations(planId: string, recommendations: RecommendationInput[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityAssignmentRecommendation);
        const normalized = recommendations.map(normalizeRecommendationInput);
        await repo.delete({entity: {id: planId}, status: "PENDING"});

        if (!normalized.length) return;
        const preserved = await repo.find({
            where: {entity: {id: planId}},
            relations: {item: true, sourceItem: true, profile: true},
        });
        const preservedKeys = new Set(preserved
            .filter((row) => row.status !== "REJECTED")
            .map((row) => `${row.operation}:${row.sourceItem?.id ?? ""}:${row.item.id}:${row.profile.id}`));
        const rejectedByTarget = new Map(preserved
            .filter((row) => row.status === "REJECTED")
            .map((row) => [`${row.item.id}:${row.profile.id}`, row]));
        const rows: ActivityAssignmentRecommendation[] = [];
        const reemittedRejected: ActivityAssignmentRecommendation[] = [];
        for (const recommendation of normalized) {
            const rejectedMemory = rejectedByTarget.get(`${recommendation.itemId}:${recommendation.profileId}`);
            if (rejectedMemory) {
                repo.merge(rejectedMemory, {
                    operation: recommendation.operation ?? "ASSIGN",
                    sourceItem: recommendation.sourceItemId ? {id: recommendation.sourceItemId} : null,
                    manual: false,
                    hidden: false,
                });
                reemittedRejected.push(rejectedMemory);
                continue;
            }
            if (preservedKeys.has(
                `${recommendation.operation}:${recommendation.sourceItemId ?? ""}:${recommendation.itemId}:${recommendation.profileId}`,
            )) continue;
            rows.push(repo.create({
                entity: {id: planId},
                item: {id: recommendation.itemId},
                profile: {id: recommendation.profileId ?? ""},
                status: "PENDING",
                operation: recommendation.operation ?? "ASSIGN",
                sourceItem: recommendation.sourceItemId ? {id: recommendation.sourceItemId} : null,
                manual: false,
                hidden: false,
            }));
        }
        if (reemittedRejected.length > 0) await repo.save(reemittedRejected);
        if (rows.length > 0) await repo.save(rows);
    });
}
