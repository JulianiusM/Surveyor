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

import type {ActivityPlan} from '../backend/modules/database/entities/activity/ActivityPlan';
import type {EntityManager} from 'typeorm';
import type {DriversList} from '../backend/modules/database/entities/drivers/DriversList';
import type {Event} from '../backend/modules/database/entities/event/Event';
import type {PackingList} from '../backend/modules/database/entities/packing/PackingList';
import type {Survey} from '../backend/modules/database/entities/surveys/Survey';
import {Guest} from '../backend/modules/database/entities/user/Guest';
import type {EntityType} from './UtilTypes';
import type {ArchivePresentation, ArchiveSnapshotEntry, PersonalVisibility} from './ArchiveTypes';

export type OidcClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
    name?: string;
    // add whatever custom claims you mapped in authentik (e.g., groups)
    groups?: string[];
};

export type UserInfo = {
    id: string;
    username: string;
    email: string;
    name: string;
}

export type DashboardEntities = {
    surveys: Survey[];
    packingLists: PackingList[];
    activityPlans: ActivityPlan[];
    driversLists: DriversList[];
    events: Event[];
}

export type EntityBase = {
    id: string;
    title: string;
    ownerId: string;
    eventId?: string | null;
    description?: string | null;
    headerImg?: string | null;
}

export type Entity = EntityBase & {
    url: string;
    type: EntityType;
    imageUrl?: string | null;
    /** Opaque image identity for clients that refresh an unchanged image URL. */
    imageVersion?: string | null;
    /**
     * Shared server-derived lifecycle and permitted actions for an entity card.
     * Optional because the card contract is also used on pages without archival controls;
     * those callers do not need to load feature state merely to render a normal link.
     */
    archive?: ArchivePresentation;
    /**
     * Present only in the acting profile's overview, never in shared event cards.
     * The controller reads one preference for all appearances of this type/ID pair.
     */
    visibility?: PersonalVisibility;
    /**
     * Final overview placement computed from authoritative archival and the private preference.
     * Overview projections consume this result rather than reproducing visibility rules. An omitted value
     * leaves ordinary card collections unpartitioned instead of inferring user preferences.
     */
    overviewHidden?: boolean;
    /** Eligible linked-card counts belong to this collection/region, never all event attachments. */
    overview?: {total: number; matching: number; url?: string};
    /** Optional parent context is supplied only after checking the event's ACCESS_VIEW permission. */
    eventContext?: {title: string; url: string};
}

export type OverviewCollection = 'participant' | 'owner';
export type OverviewRegion = 'main' | 'hidden';

/** Personal placement remains distinct from the target's shared lifecycle and capabilities. */
export interface PersonalVisibilityResult {
    archive: ArchivePresentation | undefined;
    visibility: PersonalVisibility;
    overviewHidden: boolean;
}

/** Prepare an adapter's receipt on the visibility write's connection before its final commit. */
export interface PersonalVisibilityCompletion<Result> {
    prepare(manager: EntityManager, result: PersonalVisibilityResult): Result | Promise<Result>;
}

/** Validated navigation input. Page size and the acting profile are always server-owned. */
export interface OverviewQuery {
    collection: OverviewCollection;
    region: OverviewRegion;
    q: string;
    type: EntityType | 'all';
    page: number;
    childPage: number;
    eventId?: string;
}

/**
 * Bounded database read projection. Lifecycle and placement share the page's read snapshot;
 * parent context still requires controller authorization before any title/link is rendered.
 * Maps contain only returned roots and their necessary parent events, never the full overview.
 */
export interface OverviewReadResult {
    query: OverviewQuery;
    items: Entity[];
    event?: Entity;
    collectionTotal: number;
    hiddenTotal: number;
    regionTotal: number;
    matchingTotal: number;
    cardTotal: number;
    childTotal: number;
    types: EntityType[];
    pageSize: number;
    archiveSnapshot: Map<string, ArchiveSnapshotEntry>;
    visibility: Map<string, PersonalVisibility>;
    contextEvents: Entity[];
}

/**
 * Shared controller projection for one bounded Overview region. The versioned adapter
 * selects its permitted cards, counts and paging availability from this existing result.
 */
export interface OverviewRegionView extends OverviewQuery {
    id: string;
    title: string;
    queryPrefix: string;
    items: Entity[];
    parent?: Entity;
    totalEntities: number;
    hiddenEntities: number;
    regionEntities: number;
    matchingEntities: number;
    totalCards: number;
    totalChildren: number;
    availableTypes: EntityType[];
    pageSize: number;
    canonicalUrl: string;
    backUrl: string;
    clearUrl: string;
    previousUrl?: string;
    nextUrl?: string;
    loaded: boolean;
    searchFields: Array<{name: string; value: string}>;
}

export type GuestLinkData = Guest & { link: string }

/** Shared document admission; attached roots are checked before standalone guest entry. */
export type EntityViewAdmission = 'render' | 'guest' | 'event-registration-required';
