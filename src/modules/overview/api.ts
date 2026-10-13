/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {components, operations} from '../../types/api/v1';
import type {EntityManager} from 'typeorm';
import type {Entity, PersonalVisibilityResult} from '../../types/UserTypes';
import type {ApiResponsePreparer} from '../../types/ApiTransportTypes';
import type {SessionLike} from '../../types/PermissionTypes';
import {getOverviewRegion, setPersonalVisibility} from '../../controller/userController';
import {APIError} from '../lib/errors';
import {ApiProblem} from '../api/problem';
import {isOwner} from '../permissionEngine';

/** Project the native mixed overview independently of any one migrated feature's command API. */
export async function readOverview(query: operations['getOverview']['parameters']['query'], session: SessionLike): Promise<components['schemas']['OverviewRegion']> {
    const prefix = `${query.collection}_${query.region}_`;
    // Badges and cards must use the same authorized roots. An absent filter includes all
    // entity kinds, including non-packing children inside a selected event container.
    const navigation: Record<string, string> = {collection: query.collection, region: query.region, [`${prefix}type`]: query.type ?? 'all'};
    for (const key of ['q', 'page', 'childPage'] as const) if (query[key] !== undefined) navigation[`${prefix}${key}`] = query[key];
    if (query.eventId) navigation[`${prefix}event`] = query.eventId;
    const region = await getOverviewRegion(session, navigation);
    function projectCard(card: Entity): components['schemas']['OverviewCard'] {
        const packingCard = card.type === 'packing';
        // Native owner cards expose Duplicate/Delete for the owning profile, including
        // existing guest-owned content. Account-only creation remains a later POST check;
        // neither audience grants nor administrator permissions imply these owner actions.
        const ownerActions = packingCard && region.collection === 'owner' && isOwner(session, card.ownerId);
        return {id: card.id, type: card.type, title: card.title, description: card.description ?? null,
            url: packingCard ? `/frontend-pilot/packing/${encodeURIComponent(card.id)}` : card.url,
            headerUrl: card.imageUrl ? packingCard ? `/api/v1/packing-lists/${encodeURIComponent(card.id)}/header` : card.imageUrl : null,
            headerVersion: card.imageVersion ?? null, eventContext: card.eventContext ?? null,
            visibility: card.visibility ?? 'default', overviewHidden: Boolean(card.overviewHidden),
            archived: Boolean(card.archive?.archived), inheritedArchived: Boolean(card.archive?.inheritedFromEventId),
            capabilities: {archive: packingCard && Boolean(card.archive?.canArchive), restore: packingCard && Boolean(card.archive?.canRestore),
                duplicate: ownerActions, remove: ownerActions},
            children: card.overview ? {total: card.overview.total, matching: card.overview.matching} : null};
    }
    return {collection: region.collection, region: region.region, q: region.q, type: region.type, availableTypes: region.availableTypes,
        page: region.page, childPage: region.childPage,
        eventId: region.eventId ?? null, pageSize: region.pageSize, totalEntities: region.totalEntities, hiddenEntities: region.hiddenEntities,
        regionEntities: region.regionEntities, matchingEntities: region.matchingEntities, totalCards: region.totalCards, totalChildren: region.totalChildren,
        hasPrevious: Boolean(region.previousUrl), hasNext: Boolean(region.nextUrl), parent: region.parent ? projectCard(region.parent) : null,
        items: region.items.map(projectCard)};
}

/** Desired personal visibility is naturally retryable and always belongs to the admitted profile. */
export function setOverviewVisibility(entityType: components['schemas']['OverviewCard']['type'], id: string,
    body: components['schemas']['OverviewVisibilityInput'], session: SessionLike): Promise<components['schemas']['OverviewVisibilityResult']>;
/** A transport preparer captures the declared response while the preference can still roll back. */
export function setOverviewVisibility<Result>(entityType: components['schemas']['OverviewCard']['type'], id: string,
    body: components['schemas']['OverviewVisibilityInput'], session: SessionLike,
    prepareResult: ApiResponsePreparer<'setOverviewVisibility', 200, Result>): Promise<Result>;
/** Map the shared locked outcome once; ordinary callers retain their exact DTO and error contract. */
export async function setOverviewVisibility<Result>(entityType: components['schemas']['OverviewCard']['type'], id: string,
    body: components['schemas']['OverviewVisibilityInput'], session: SessionLike,
    prepareResult?: ApiResponsePreparer<'setOverviewVisibility', 200, Result>): Promise<components['schemas']['OverviewVisibilityResult'] | Result> {
    /** Keep wire mapping separate from membership/placement policy and optional transport preparation. */
    function prepareVisibility(_manager: EntityManager, outcome: PersonalVisibilityResult) {
        // Only these public primitives leave the adapter; native archive capability
        // details remain in the shared controller's presentation contract.
        const result = {visibility: outcome.visibility, overviewHidden: outcome.overviewHidden, archived: Boolean(outcome.archive?.archived)};
        return prepareResult ? prepareResult(result) : result;
    }

    try {
        // Business admission, persistence and lifecycle projection remain shared.
        // Mapping/preparation errors reject before that transaction can commit.
        return await setPersonalVisibility(entityType, id, body, session, {prepare: prepareVisibility});
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
        throw error;
    }
}
