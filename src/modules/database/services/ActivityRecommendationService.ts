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

import {EntityManager, In} from "typeorm";
import type {RecommendationInput} from "../../../types/ActivityTypes";
import {AppDataSource} from "../dataSource";
import {ActivityAssignmentRecommendation} from "../entities/activity/ActivityAssignmentRecommendation";
export type {RecommendationInput} from "../../../types/ActivityTypes";

/** DBAL-only recommendation reads/writes. Reconciliation and validity decisions belong to the controller. */
export async function getRecommendations(planId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(ActivityAssignmentRecommendation).find({
        where: {entity: {id: planId}}, relations: {item: true, sourceItem: true, profile: true},
    });
}

/** Delete precisely the selected generated rows; callers decide when invalidation is required. */
export async function invalidateGeneratedRecommendations(manager: EntityManager, planId: string): Promise<void> {
    await manager.getRepository(ActivityAssignmentRecommendation).delete({
        entity: {id: planId}, status: 'PENDING', manual: false,
    });
}

/** Save caller-selected rows without interpreting manual, reviewed, or rejection-memory policy. */
export async function saveRecommendations(
    planId: string, recommendations: RecommendationInput[], manager: EntityManager = AppDataSource.manager,
): Promise<void> {
    const repo = manager.getRepository(ActivityAssignmentRecommendation);
    const rows = recommendations.map((rec) => repo.create({
        id: rec.id,
        entity: {id: planId}, item: {id: rec.itemId}, profile: {id: rec.profileId ?? ''},
        status: rec.status ?? 'PENDING', operation: rec.operation ?? 'ASSIGN',
        sourceItem: rec.sourceItemId ? {id: rec.sourceItemId} : null,
        manual: Boolean(rec.manual), hidden: Boolean(rec.hidden),
    }));
    if (rows.length) await repo.save(rows);
}

/** Replace a validated snapshot atomically; reuse the controller transaction when supplied. */
export async function replaceRecommendations(
    planId: string, recommendations: RecommendationInput[], manager?: EntityManager,
): Promise<void> {
    async function replaceRows(transaction: EntityManager): Promise<void> {
        await transaction.getRepository(ActivityAssignmentRecommendation).delete({entity: {id: planId}});
        await saveRecommendations(planId, recommendations, transaction);
    }
    if (manager) await replaceRows(manager);
    else await AppDataSource.transaction(replaceRows);
}

export async function markRecommendationsApplied(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await AppDataSource.getRepository(ActivityAssignmentRecommendation).update(
        {id: In(ids), entity: {id: planId}}, {status: 'APPLIED', hidden: true},
    );
}

export async function deleteRecommendations(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await AppDataSource.getRepository(ActivityAssignmentRecommendation).delete({id: In(ids), entity: {id: planId}});
}

export async function markRecommendationsRejected(planId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await AppDataSource.getRepository(ActivityAssignmentRecommendation).update(
        {id: In(ids), entity: {id: planId}}, {status: 'REJECTED'},
    );
}
