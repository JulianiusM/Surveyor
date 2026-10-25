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

import {Request} from "express";
import type {EntityManager} from 'typeorm';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import {requireLockedArchiveRoot} from './entityAdminController';
import Joi from 'joi';
import {Guest} from "../modules/database/entities/user/Guest";
import type {Session} from '../modules/database/entities/session/Session';
import {Profile} from "../modules/database/entities/user/Profile";
import {User} from "../modules/database/entities/user/User";
import * as userService from "../modules/database/services/UserService";
import mailer, {prepareActivationEmail, prepareGuestLinkEmail, preparePasswordResetEmail, resolveEmailRecipientName} from "../modules/email";
import type {PreparedIdentityEmail} from '../types/EmailTypes';
import {APIError, ExpectedError, ValidationError} from "../modules/lib/errors";
import {createSessionStore, persistSession, readStoredSession, requireSessionProfileId, stageIdentitySession, writeStoredSession} from "../modules/lib/session";
import {readFrontendSessionMetadata, rotateFrontendSessionContext, sameFrontendSessionIdentity} from '../modules/lib/frontendSession';
import {safeFrontendReturn} from '../modules/lib/frontendIdentity';
import type {AccountRegistrationTransactionOptions, RegistrationEmailDelivery, RegistrationReceipt, GuestRegistrationTransactionOptions, IdentityCompletionOptions, IdentityCompletionReceipt, IdentityLinkOptions, IdentityTransitionOptions, ProfileOwnerCleanup} from '../types/IdentityTypes';
import type {MessageKey} from '../types/LocalizationTypes';
import {ApiProblem} from '../modules/api/problem';
import {buildGuestLink, ENTITIES} from "../modules/lib/util";
import * as oidc from "../modules/oidc";
import settings from "../modules/settings";
import type {Entity, GuestLinkData, OverviewCollection, OverviewPageView, OverviewQuery, OverviewReadResult, OverviewRegion, OverviewRegionView, PersonalVisibilityCompletion, PersonalVisibilityResult} from "../types/UserTypes";
import type {ArchivePresentation, ArchiveReference, ArchiveSnapshotEntry, LockedArchiveContext, PersonalVisibility} from "../types/ArchiveTypes";
import type {SessionLike} from "../types/PermissionTypes";
import {archiveKey, isHiddenInOverview} from "../modules/archive/policy";
import {getArchivePresentations} from "./entityAdminController";
import {evaluateEntities} from "../modules/permissionEngine";
import type {components, operations} from '../types/api/v1';

const CREATE_TEMPLATE = 'users/register';

/** Direct creation admits an account with an active profile; a guest remains a separate identity. */
export function hasAccountProfile(session: SessionLike): boolean {
    return Boolean(session.auth?.user && session.profile);
}

/**
 * Project the established account-only admission for any feature. Adapters supply
 * their own bounded login/return URLs; this decision never depends on a browser's session guess.
 * The creation command independently repeats account admission before doing work.
 */
export function getAccountPageEntry(session: SessionLike, loginUrl: string, returnTo: string): components['schemas']['PageEntryOutcome'] {
    if (hasAccountProfile(session)) return {kind: 'render'};
    return {kind: 'redirect', url: `${loginUrl}?next=${encodeURIComponent(returnTo)}`,
        notice: {kind: 'info', messageKey: 'auth.accountRequired'}};
}
const LOGIN_TEMPLATE = 'users/login';

/**
 * Build identity-mail destinations for the shared registration/recovery operations.
 * Frontend callers opt into their bounded return destination and encoded query value;
 * direct callers retain their established route and literal next spelling.
 */
function identityLink(path: string, options?: IdentityLinkOptions): string {
    const next = options?.next ? (options.frontend ? safeFrontendReturn(options.next) : options.next) : undefined;
    // The frontend option serializes its bounded return destination. Direct mail
    // retains its original literal next parameter and route contract.
    return `${settings.value.rootUrl}${path}${next ? `?next=${options?.frontend ? encodeURIComponent(next) : next}` : ''}`;
}

/**
 * Validate registration fields once while retaining form diagnostic order and
 * renderer data. Stable causes let frontend adapters localize the same outcome;
 * credentials are never returned as form-error presentation data.
 */
function validateUserRegistration(body: any) {
    // Resolve the shared recipient/display name first. Form errors retain
    // only username and email; submitted credentials never become render data.
    const {username, displayname, password, password_repeat, email} = body;
    const name = resolveEmailRecipientName(typeof displayname === 'string' ? displayname : undefined, typeof username === 'string' ? username : undefined);
    const returnInfo = {username, email};

    // Required-field diagnostics precede repetition checks, preserving the established
    // rejection order for both adapters before either allocates identity records.
    if (!username || !name || !password || !password_repeat || !email) {
        throw new ValidationError(CREATE_TEMPLATE, 'Not all fields were filled out.', returnInfo);
    }

    if (password !== password_repeat) {
        throw new ValidationError(CREATE_TEMPLATE, 'Passwords do not match.', returnInfo, {cause: 'PASSWORD_MISMATCH'});
    }

    return {username, name, password, email};
}

/** Preserve the common username diagnostic while selecting the caller's current persistence scope. */
async function requireAvailableUsername(username: string, email: string, manager?: EntityManager): Promise<void> {
    const existingUser = await userService.getUserByUsername(username, manager);
    if (existingUser) {
        throw new ValidationError(CREATE_TEMPLATE, 'This username is already taken.', {username, email}, {cause: 'USERNAME_TAKEN'});
    }
}

/** Registration keeps its established persistence, activation and default mail error ordering. */
export async function registerUser(body: any, next?: string, options?: IdentityLinkOptions) {
    const {username, name, password, email} = validateUserRegistration(body);
    await requireAvailableUsername(username, email);

    // Benutzer registrieren
    let userId = await userService.registerUser(username, name, password, email);

    // Generiere den Aktivierungs-Token und sende ihn per E-Mail
    const token = await userService.generateActivationToken(userId);
    const activationLink = identityLink(`/users/activate/${encodeURIComponent(token)}`, {...options, next: options?.next ?? next});

    await mailer.sendActivationEmail({name, address: email}, activationLink);
}

/**
 * Prepare a frontend account, default profile and activation token in one registration
 * transaction. Signup preserves the current actor; only document completion opts
 * into an atomic staged flash write. Tokens remain inside the prepared mail owner.
 */
export async function registerUserWithSession<Result>(body: any, req: Request,
    options: AccountRegistrationTransactionOptions<Result>): Promise<RegistrationReceipt<Result>> {
    const input = validateUserRegistration(body);

    /** Create the inactive account and prepare all fallible activation/completion work before commit. */
    async function createAccount(manager: EntityManager, session: Request['session']) {
        // Reuse shared validation under this transaction. Database uniqueness
        // remains authoritative when separate sessions submit the same username.
        await requireAvailableUsername(input.username, input.email, manager);
        const id = await userService.registerUser(input.username, input.name, input.password, input.email, manager);
        const token = await userService.generateActivationToken(id, manager);

        // Activation link and both message forms are private preparation data.
        // A token update, renderer or response failure rolls back both new rows.
        const activationLink = identityLink(`/users/activate/${encodeURIComponent(token)}`, options);
        const emailReceipt = prepareActivationEmail({name: input.name, address: input.email}, activationLink);
        const results = await options.prepareResult(session, manager);
        return {results, emailReceipt};
    }

    return commitRegistration(req, options.context, createAccount, Boolean(options.persistCompletion));
}

/**
 * Share credential and activation checks between direct and versioned login.
 * An API caller may recheck its admitted session immediately before identity
 * mutation; only an active account reaches that hook and rotates the context.
 * Shared validation prose and renderer values remain owned by this controller.
 */
export async function loginUser(body: any, session: Request["session"], options?: IdentityTransitionOptions) {
    // Credential rejection and inactive-account resend preserve operation ordering.
    const user = await resolveLoginUser(body, options);
    await options?.beforeTransition?.();
    await saveAccountIdentity(session, user);
}

/**
 * Share credential/activation diagnostics before any identity mutation. Inactive
 * login may refresh and mail an activation token before rejecting; keep that
 * established workflow outside an identity transaction that would roll it back.
 */
async function resolveLoginUser(body: any, options?: IdentityLinkOptions) {
    // Keep credentials inside this check; rejected forms redisplay only
    // the submitted username and retain their common invalid-login diagnostic.
    const {username, password} = body;
    const returnInfo = {username};

    if (!username || !password) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo, {cause: 'INVALID_CREDENTIALS'});
    }

    // Preserve username-first resolution and indistinguishable missing-user /
    // invalid-password errors.
    const user = await resolveNamedAccount(username);
    if (!user) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo, {cause: 'INVALID_CREDENTIALS'});
    }

    const isValidPassword = await userService.verifyPassword(user.id, password);
    if (!isValidPassword) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo, {cause: 'INVALID_CREDENTIALS'});
    }

    // An inactive account is not a session transition. Refresh expired activation
    // mail first, then report the precise inactive/resend cause to either adapter.
    if (!user.isActive) {
        let errorMsg = 'User not activated.';
        let cause: 'ACCOUNT_INACTIVE' | 'ACTIVATION_RESENT' = 'ACCOUNT_INACTIVE';
        if ((user.activationTokenExpiration ?? new Date(0)) < new Date()) {
            // Generiere den Aktivierungs-Token und sende ihn per E-Mail
            const token = await userService.generateActivationToken(user.id);
            const activationLink = identityLink(`/users/activate/${encodeURIComponent(token)}`, options);

            await mailer.sendActivationEmail({name: resolveEmailRecipientName(user.name, user.username), address: user.email}, activationLink);
            cause = 'ACTIVATION_RESENT';
            errorMsg += ' The activation link has expired. A new one has been sent to your email account.';
        }

        throw new ValidationError(LOGIN_TEMPLATE, errorMsg, returnInfo, {cause});
    }

    return user;
}

/** Direct saves immediately; isolated frontend saves defer to their enclosing completion transaction. */
async function saveAccountIdentity(session: Request['session'], user: User): Promise<void> {
    // Save the validated account/default profile with one new frontend scope.
    // A staged session cannot leak into request autosave if preparation rejects.
    session.auth = {user};
    session.profile = getDefaultProfile(user.profiles);
    rotateFrontendSessionContext(session);
    await persistSession(session);
}

/** Complete a validated frontend account login and its transport result in one stored-session commit. */
export async function loginUserWithSession<Result>(body: any, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    // Resolve credentials/resend before locking, without mutating request authority.
    const user = await resolveLoginUser(body, options);
    /** Apply shared authority mutation, then prepare completion while rollback is still possible. */
    async function prepareLogin(_manager: EntityManager, session: Request['session']): Promise<Result> {
        await saveAccountIdentity(session, user);
        return options.prepareResult(session, _manager);
    }
    return commitIdentityCompletion(req, options.context, prepareLogin, true);
}

/**
 * Join discovered cards with shared lifecycle state and this profile's private preference.
 * Inputs are keyed by type + ID because a dashboard mixes all entity kinds. Return copies
 * for rendering: decoration must not mutate ORM entities or store personal state on them.
 */
function decorateOverviewEntities(
    items: Entity[],
    archives: Map<string, ArchivePresentation>,
    visibility: Map<string, PersonalVisibility>,
): Entity[] {
    const decorated: Entity[] = [];
    for (const item of items) {
        const key = archiveKey(item);
        const archive = archives.get(key);
        if (!archive) {
            // A presentation needs an existing lifecycle root; never emit actionable controls
            // for a missing root if a caller supplied an incomplete projection.
            continue;
        }
        // No saved preference means "follow authoritative archival". Explicit shown/hidden
        // changes placement only; keeping archive alongside it preserves truthful status badges.
        const preference = visibility.get(key) ?? 'default';
        decorated.push({
            ...item,
            archive,
            visibility: preference,
            overviewHidden: isHiddenInOverview(archive.archived, preference),
        });
    }
    return decorated;
}

const OVERVIEW_COLLECTIONS: OverviewCollection[] = ['participant', 'owner'];
const OVERVIEW_REGIONS: OverviewRegion[] = ['main', 'hidden'];

// Navigation is request-local state. It is deliberately separate from the service query:
// opening a hidden section neither changes membership nor saves a visibility preference.
type OverviewNavigation = OverviewQuery & {open: boolean};
type OverviewNavigationState = Record<string, OverviewNavigation>;

function overviewKey(collection: OverviewCollection, region: OverviewRegion): string {
    return `${collection}_${region}`;
}

function overviewRegionId(collection: OverviewCollection, region: OverviewRegion): string {
    const collectionId = collection === 'participant' ? 'sec-parts' : 'sec-own-parts';
    return `${collectionId}-${region === 'main' ? 'main' : 'archived'}`;
}

/**
 * Page and fragment requests share this allowlist. A decimal string is validated before
 * conversion, rejecting nested query values, signs, fractions, overflow, and arbitrary size.
 * There is no caller-selected profile or page-size field in either transport.
 */
function normalizeOverviewNavigation(input: unknown, fragment: boolean) {
    const fields: Record<string, Joi.Schema> = {};
    for (const collection of OVERVIEW_COLLECTIONS) {
        for (const region of OVERVIEW_REGIONS) {
            const prefix = `${overviewKey(collection, region)}_`;
            fields[`${prefix}q`] = Joi.string().max(200).allow('');
            fields[`${prefix}type`] = Joi.string().valid('all', ...Object.values(ENTITIES));
            fields[`${prefix}page`] = Joi.string().pattern(/^(?:[1-9]\d{0,5}|1000000)$/);
            fields[`${prefix}childPage`] = Joi.string().pattern(/^(?:[1-9]\d{0,5}|1000000)$/);
            fields[`${prefix}event`] = Joi.string().uuid();
            fields[`${prefix}open`] = Joi.string().valid('1', '0');
        }
    }
    if (fragment) {
        fields.collection = Joi.string().valid(...OVERVIEW_COLLECTIONS).required();
        fields.region = Joi.string().valid(...OVERVIEW_REGIONS).required();
    }
    const parsed = Joi.object<Record<string, string>>(fields).unknown(false)
        .validate(input ?? {}, {convert: false, abortEarly: false});
    if (parsed.error) {
        throw new APIError('Invalid overview navigation', {}, 400);
    }

    const state: OverviewNavigationState = {};
    for (const collection of OVERVIEW_COLLECTIONS) {
        for (const region of OVERVIEW_REGIONS) {
            const key = overviewKey(collection, region);
            const prefix = `${key}_`;
            const eventId = parsed.value[`${prefix}event`]?.toLowerCase();
            state[key] = {
                collection,
                region,
                q: (parsed.value[`${prefix}q`] ?? '').trim(),
                type: (parsed.value[`${prefix}type`] ?? 'all') as OverviewQuery['type'],
                page: Number(parsed.value[`${prefix}page`] ?? '1'),
                childPage: Number(parsed.value[`${prefix}childPage`] ?? '1'),
                eventId,
                open: region === 'main' || parsed.value[`${prefix}open`] === '1' || !!eventId,
            };
        }
    }
    const target = fragment
        ? overviewKey(parsed.value.collection as OverviewCollection, parsed.value.region as OverviewRegion)
        : undefined;
    // Asking for a hidden region is the explicit load operation even when the caller omitted
    // its open marker. The canonical URL records it for reloads and ordinary browser history.
    if (target) state[target].open = true;
    return {state, target};
}

/** One serializer supplies canonical links and fallback form fields for every region. */
function overviewSearchParams(state: OverviewNavigationState): URLSearchParams {
    const params = new URLSearchParams();
    for (const query of Object.values(state)) {
        const prefix = `${overviewKey(query.collection, query.region)}_`;
        if (query.q) params.set(`${prefix}q`, query.q);
        if (query.type !== 'all') params.set(`${prefix}type`, query.type);
        if (query.page > 1) params.set(`${prefix}page`, String(query.page));
        if (query.eventId) params.set(`${prefix}event`, query.eventId);
        if (query.childPage > 1) params.set(`${prefix}childPage`, String(query.childPage));
        if (query.region === 'hidden' && query.open) params.set(`${prefix}open`, '1');
    }
    return params;
}

function overviewUrl(state: OverviewNavigationState, key: string, change: Partial<OverviewNavigation> = {}): string {
    const selected = {...state[key], ...change};
    const params = overviewSearchParams({...state, [key]: selected});
    const search = params.toString();
    return `/users/dashboard${search ? `?${search}` : ''}#${overviewRegionId(selected.collection, selected.region)}`;
}

/**
 * Project only the bounded read results. Lifecycle comes from the same service snapshot as
 * placement/counts, while action capabilities still use the existing permission evaluator.
 * Parent metadata is never returned merely because a child independently belongs here.
 */
async function decorateOverviewReads(reads: OverviewReadResult[], session: SessionLike): Promise<void> {
    const references: ArchiveReference[] = [];
    const snapshot = new Map<string, ArchiveSnapshotEntry>();
    const contextEvents = new Map<string, Entity>();
    for (const read of reads) {
        references.push(...read.items);
        if (read.event) references.push(read.event);
        for (const [key, value] of read.archiveSnapshot) snapshot.set(key, value);
        for (const event of read.contextEvents) contextEvents.set(event.id, event);
    }
    const [archives, permissions] = await Promise.all([
        getArchivePresentations(references, session, snapshot),
        evaluateEntities(Array.from(contextEvents.values(), event => ({
            entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
        })), session),
    ]);
    for (const read of reads) {
        read.items = decorateOverviewEntities(read.items, archives, read.visibility);
        if (read.event) {
            read.event = decorateOverviewEntities([read.event], archives, read.visibility)[0];
        } else {
            // Only fallback cards need parent context; selected-event children already have
            // their enclosing event card. Restrict both the title and the actionable link.
            for (const item of read.items) {
                if (!item.eventId) continue;
                const parent = contextEvents.get(item.eventId);
                const permission = permissions.get(archiveKey({type: 'event', id: item.eventId}));
                if (parent && permission?.has('ACCESS_VIEW')) {
                    item.eventContext = {title: parent.title, url: parent.url};
                }
            }
        }
    }
}

function makeOverviewRegionView(
    state: OverviewNavigationState,
    key: string,
    read: OverviewReadResult | undefined,
    totals: {collectionTotal: number; hiddenTotal: number; pageSize: number},
): OverviewRegionView {
    const query = state[key];
    const prefix = `${key}_`;
    const title = query.collection === 'participant' ? 'Your participation' : 'Administrable entities';
    const search = overviewSearchParams(state);
    // GET search forms keep every other region and selected parent, but filter changes
    // reset both page numbers. Their q/type inputs supply this region's new filter values.
    for (const field of ['q', 'type', 'page', 'childPage']) search.delete(`${prefix}${field}`);
    if (query.region === 'hidden') search.set(`${prefix}open`, '1');
    const view: OverviewRegionView = {
        collection: query.collection, region: query.region, q: query.q, type: query.type,
        page: query.page, childPage: query.childPage, eventId: query.eventId,
        id: overviewRegionId(query.collection, query.region), title, queryPrefix: prefix,
        items: read?.items ?? [], parent: read?.event,
        totalEntities: totals.collectionTotal, hiddenEntities: totals.hiddenTotal,
        regionEntities: read?.regionTotal ?? totals.hiddenTotal,
        matchingEntities: read?.matchingTotal ?? 0,
        totalCards: read?.cardTotal ?? 0, totalChildren: read?.childTotal ?? 0,
        availableTypes: read?.types ?? [], pageSize: totals.pageSize,
        canonicalUrl: overviewUrl(state, key, {open: true}),
        backUrl: overviewUrl(state, key, {eventId: undefined, childPage: 1}),
        clearUrl: overviewUrl(state, key, {q: '', type: 'all', page: 1, childPage: 1}),
        loaded: !!read,
        searchFields: Array.from(search, ([name, value]) => ({name, value})),
    };
    if (!read) return view;

    for (const item of view.items) {
        if (item.overview && item.overview.total > 0 && !view.parent) {
            item.overview = {...item.overview, url: overviewUrl(state, key, {eventId: item.id, childPage: 1})};
        }
    }
    const page = view.parent ? view.childPage : view.page;
    const total = view.parent ? (view.parent.overview?.matching ?? 0) : view.totalCards;
    if (page > 1) view.previousUrl = overviewUrl(state, key, view.parent ? {childPage: page - 1} : {page: page - 1});
    if (page * view.pageSize < total) view.nextUrl = overviewUrl(state, key, view.parent ? {childPage: page + 1} : {page: page + 1});
    return view;
}

/** Full HTML and fragment navigation use the same bounded reader and presentation path. */
async function readOverviewNavigation(session: SessionLike, input: unknown, fragment: boolean) {
    const profileId = requireSessionProfileId(session);
    const {state, target} = normalizeOverviewNavigation(input, fragment);
    const selected = target ? [state[target]] : Object.values(state).filter(query => query.open);
    const queries: OverviewQuery[] = selected.map(({open, ...query}) => query);
    // Identity, normalized query values and the maximum of four regions are owned here:
    // the closed navigation matrix cannot select another profile or arbitrary DBAL input.
    // Services consume this validated contract without repeating transport-level checks.
    const reads = await userService.getOverviewPages(profileId, queries);
    await decorateOverviewReads(reads, session);
    const byRegion = new Map<string, OverviewReadResult>();
    for (const read of reads) {
        const key = overviewKey(read.query.collection, read.query.region);
        // The service clamps pages and clears a selected event that no longer qualifies.
        // Every generated link uses that recomputed state, including links in other regions.
        state[key] = {...read.query, open: state[key].open};
        byRegion.set(key, read);
    }
    return {state, target, byRegion};
}

export async function getOverviewPage(session: SessionLike, query: unknown = {}): Promise<OverviewPageView> {
    const {state, byRegion} = await readOverviewNavigation(session, query, false);
    function collectionView(collection: OverviewCollection) {
        const mainKey = overviewKey(collection, 'main');
        const hiddenKey = overviewKey(collection, 'hidden');
        const main = byRegion.get(mainKey)!;
        return {
            main: makeOverviewRegionView(state, mainKey, main, main),
            hidden: makeOverviewRegionView(state, hiddenKey, byRegion.get(hiddenKey), main),
            total: main.collectionTotal,
        };
    }
    return {participant: collectionView('participant'), owner: collectionView('owner')};
}

export async function getOverviewRegion(session: SessionLike, query: unknown): Promise<OverviewRegionView> {
    const {state, target, byRegion} = await readOverviewNavigation(session, query, true);
    const read = byRegion.get(target!)!;
    return makeOverviewRegionView(state, target!, read, read);
}

/**
 * Change only the authenticated session profile's overview placement, never shared archival.
 * The controller checks current overview membership while holding the target row lock, which
 * serializes the check/write with a concurrent database deletion. A visible card from an old
 * page is not sufficient authority to save a preference after membership has been removed.
 */
export function setPersonalVisibility(entityType: string, id: string, body: unknown, session: SessionLike): Promise<PersonalVisibilityResult>;
/** An explicit adapter completion replaces only the default postcommit presentation read. */
export function setPersonalVisibility<Result>(entityType: string, id: string, body: unknown, session: SessionLike,
    completion: PersonalVisibilityCompletion<Result>): Promise<Result>;
/** Share admission and membership policy while preparing requested completion under the existing target lock. */
export async function setPersonalVisibility<Result>(entityType: string, id: string, body: unknown, session: SessionLike,
    completion?: PersonalVisibilityCompletion<Result>): Promise<PersonalVisibilityResult | Result> {
    // Resolve identity before interpreting route input. Both account and guest sessions use
    // profiles; no route parameter or payload field may select a different acting profile.
    const profileId = requireSessionProfileId(session);
    const targetSchema = Joi.object<ArchiveReference>({
        type: Joi.string().valid(...Object.values(ENTITIES)).required(),
        id: Joi.string().uuid().required(),
    });
    const target = targetSchema.validate({type: entityType, id}, {convert: false});
    if (target.error) {
        throw new APIError('Invalid overview entity', {}, 400);
    }

    // Unknown fields are rejected so a payload cannot select a different profile or write archive timestamps.
    const visibilitySchema = Joi.object<{visibility: PersonalVisibility}>({
        visibility: Joi.string().valid('default', 'hidden', 'shown').required(),
    }).unknown(false);
    const preference = visibilitySchema.validate(body ?? {}, {abortEarly: false, convert: false});
    if (preference.error) {
        throw new APIError('Invalid visibility request', {}, 400);
    }

    // UUID input is case-insensitive, while in-memory keys and stored polymorphic
    // references use the app's canonical lowercase spelling.
    const reference: ArchiveReference = {type: target.value.type, id: target.value.id.toLowerCase()};
    const visibility = preference.value.visibility;
    /** Check current membership and prepare any explicit adapter receipt on this locked transaction. */
    async function saveVisibility(manager: EntityManager, context: LockedArchiveContext) {
        // A page rendered earlier does not authorize a write after deletion or membership loss.
        // The controller checks both against the transaction holding the current root lock.
        requireLockedArchiveRoot(context);
        if (!await userService.isOverviewMember(profileId, reference, manager)) throw new APIError('This entity is not in your overview', {}, 403, {cause: 'OVERVIEW_MEMBERSHIP_LOST'});
        await userService.setVisibility(profileId, reference, visibility, manager);

        // Explicit completions use this transaction's lifecycle and grants. Any
        // projection or receipt failure still rolls back the private preference.
        if (completion) {
            const result = await personalVisibilityResult(reference, visibility, session, manager);
            return completion.prepare(manager, result);
        }
    }
    const prepared = await lifecycleService.withLockedArchiveTarget(reference, saveVisibility);

    // The supplied completion has already prepared its exact result. Direct
    // callers retain their original presentation read after the preference commit.
    if (completion) return prepared as Result;
    return personalVisibilityResult(reference, visibility, session);
}

/** Project personal placement once, using a supplied transaction or the ordinary read. */
async function personalVisibilityResult(reference: ArchiveReference, visibility: PersonalVisibility, session: SessionLike,
    manager?: EntityManager): Promise<PersonalVisibilityResult> {
    // Recompute placement against current authoritative state after the private write.
    // The response preserves both concepts instead of presenting "shown" as a shared restore.
    const presentations = await getArchivePresentations([reference], session, undefined, manager);
    const archive = presentations.get(archiveKey(reference));
    return {
        archive,
        visibility,
        overviewHidden: isHiddenInOverview(archive?.archived ?? false, visibility),
    };
}

/** Share direct and guarded recovery mail while keeping an unknown account a quiet
 * no-op. Only the trusted link option selects the destination frontend route. */
export async function sendPasswordForgotMail(username: string, options?: IdentityLinkOptions) {
    const user = await resolveNamedAccount(username);
    if (!user) {
        return;
    }

    // Generiere ein Passwort-Zurücksetzungs-Token und speichere es in der Datenbank
    const token = await userService.generatePasswordResetToken(user.username);
    const resetLink = identityLink(`/users/reset-password/${encodeURIComponent(token)}`, options);

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    await mailer.sendPasswordResetEmail({name: resolveEmailRecipientName(user.name, user.username), address: user.email}, resetLink);
}

/** Own direct and guarded username-first account resolution, retaining the caller's optional persistence scope. */
async function resolveNamedAccount(username: string, manager?: EntityManager) {
    // An exact username wins over the email fallback. Locked callers pass the
    // same manager for both reads; direct callers keep their default DBAL scope.
    const user = await userService.getUserByUsername(username, manager);
    return user ?? await userService.getUserByEmail(username, manager);
}

/**
 * Prepare frontend recovery's existing generic confirmation and optional token/mail
 * on the locked completion transaction. Unknown accounts stay a quiet no-op;
 * setup errors roll back, while caught SMTP failure retains normal confirmation.
 * Direct forgot-mail and inactive-login resend keep their original owners/order.
 */
export async function requestPasswordResetWithSession<Result>(username: string, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Reuse username-first discovery without another connection or an account-found result. */
    async function prepareRecovery(manager: EntityManager, session: Request['session']) {
        const user = await resolveNamedAccount(username, manager);
        let emailReceipt: PreparedIdentityEmail | null = null;
        if (user) {
            // Token persistence, recipient/templates and cached sender setup can
            // still fail here. No private link or discovery flag enters the reply.
            const token = await userService.generatePasswordResetToken(user.username, manager);
            const link = identityLink(`/users/reset-password/${encodeURIComponent(token)}`, options);
            emailReceipt = preparePasswordResetEmail({name: resolveEmailRecipientName(user.name, user.username), address: user.email}, link);
        }
        const result = await options.prepareResult(session, manager);
        return {result, emailReceipt};
    }
    const committed = await commitIdentityCompletion(req, options.context, prepareRecovery, Boolean(options.persistCompletion));

    // The operation is final. Existing SMTP catch semantics keep generic success;
    // delivery cannot reopen admission, rerender output or overwrite another actor.
    if (committed.result.emailReceipt) {
        await settleIdentityDelivery(committed.result.emailReceipt);
    }
    return Object.freeze({session: committed.session, result: committed.result.result});
}

/** Token-page admission uses the existing verification owner and controller message;
 * TOKEN_INVALID supplies the versioned adapter's stable, private-data-free cause. */
export async function checkPasswordForgotToken(token: string) {
    // Admission and consumption share the same token diagnostic owner.
    await requirePasswordResetToken(token);
}

/** Preserve the reset form's mismatch-before-token diagnostic order.
 * A successful command re-verifies the token before delegating the password write;
 * page admission is not a lasting authorization to submit an expired token. */
export async function resetPassword(token: string, body: any) {
    const password = validatePasswordResetInput(token, body);

    // Überprüfe den Token und setze das Passwort zurück
    const user = await requirePasswordResetToken(token);

    // Setze das Passwort zurück
    await userService.resetPassword(user.username, password);
}

/** Preserve the mismatch-before-token check and renderer data for both completion paths. */
function validatePasswordResetInput(token: string, body: any) {
    const {password, confirmPassword} = body;
    if (password !== confirmPassword) {
        throw new ValidationError('users/reset-password', 'Passwords do not match!', {token}, {cause: 'PASSWORD_MISMATCH'});
    }
    return password;
}

/** Share reset-token diagnostics; only a locked frontend read rechecks expiry after its wait. */
async function requirePasswordResetToken(token: string, manager?: EntityManager, lock = false) {
    const user = await userService.verifyPasswordResetToken(token, manager, lock);
    // Ordinary queries retain their existing expiry predicate. A frontend lock can
    // wait past that query timestamp, so validate its returned expiry again.
    if (!user || lock && (!user.resetTokenExpiration || user.resetTokenExpiration <= new Date())) {
        throw new ExpectedError('Invalid or expired token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
    }
    return user;
}

/**
 * Consume a frontend reset capability exactly once with its prepared API/document
 * completion. Direct reset remains unchanged above. The session/token locks and
 * password update share one manager; unchanged actor state needs no JSON write.
 */
export async function resetPasswordWithSession<Result>(token: string, body: any, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    const password = validatePasswordResetInput(token, body);
    /** Recheck the locked capability, prepare output and update password/token before final commit. */
    async function consumeReset(manager: EntityManager, session: Request['session']): Promise<Result> {
        const user = await requirePasswordResetToken(token, manager, true);

        const result = await options.prepareResult(session, manager);
        await userService.resetPassword(user.username, password, manager);
        return result;
    }
    return commitIdentityCompletion(req, options.context, consumeReset, Boolean(options.persistCompletion));
}

/** Activation submission verifies current token evidence again before the shared
 * account write. The controller literal error and versioned stable cause stay distinct. */
export async function activateAccount(token: string) {
    // Überprüfe, ob der Aktivierungs-Token gültig ist
    const user = await userService.verifyActivationToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
    }

    // Aktiviere den Benutzer
    await userService.activateUser(user.id);
}

/**
 * Commit a frontend token consumption with its prepared API/document completion.
 * Session and token locks share one connection; direct activation keeps its
 * original owner above. No mutable-context check, flash save or token projection
 * follows this commit, and the public receipt never contains the capability.
 */
export async function activateAccountWithSession<Result>(token: string, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Admit the currently valid locked token and prepare feedback before either write. */
    async function activateWithinSession(manager: EntityManager, session: Request['session']): Promise<Result> {
        const user = await userService.verifyActivationToken(token, manager, true);
        // Acquiring the token lock can wait behind another transaction. Its
        // unchanged expiry rule must still hold when that wait actually ends.
        if (!user || !user.activationTokenExpiration || user.activationTokenExpiration <= new Date()) {
            throw new ExpectedError('Invalid or expired token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
        }

        // Preparation can still reject without consuming the token. The update
        // and optional staged document flash belong to this same final commit.
        const result = await options.prepareResult(session, manager);
        await userService.activateUser(user.id, manager);
        return result;
    }

    return commitIdentityCompletion(req, options.context, activateWithinSession, Boolean(options.persistCompletion));
}

/**
 * ---- OIDC integration (v6) ----
 * These are thin controller wrappers that delegate to your oidc module.
 * They keep your controller layer consistent with the manual login flow.
 */

// GET /auth/login → redirect to Authentik
export async function loginUserWithOidc(session: Request['session']) {
    // Delegates to startLogin (buildAuthorizationUrl + session PKCE/nonce)
    return oidc.startLogin(session);
}

// GET /auth/callback → handles code exchange, JIT-provision, session setup, redirect
export async function loginUserWithOidcCallback(req: Request) {
    // oidcCallback sets req.session.userId and req.session.user, then redirects
    return oidc.callback(req);
}

// POST /auth/logout → clears local session and (if available) does RP-initiated logout
export async function logoutUserOidc(session: Request['session']) {
    session.frontendAuthReturn = undefined;
    return oidc.logout(session);
}

/**
 * Complete only ordinary frontend logout on fresh locked session evidence. Every
 * truthy token object belongs to the existing provider workflow, including an
 * empty object; its preparation/failure ordering is deliberately untouched.
 * Anonymous authority and the prepared completion share this operation's commit.
 */
export async function logoutUserWithSession<Result>(req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Reuse the existing logout mutation only after excluding the protected provider path under the lock. */
    async function prepareLogout(manager: EntityManager, session: Request['session']): Promise<Result> {
        // The request's earlier token-free classification is not enduring proof.
        // Abort before clearing authority if fresh stored evidence needs its provider.
        if (session.tokens) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
        await logoutUserOidc(session);

        // The inner save is deferred on staging. Fallible output or document
        // notice preparation still precedes the outer owner's only durable write.
        return options.prepareResult(session, manager);
    }
    return commitIdentityCompletion(req, options.context, prepareLogout, true);
}

// Guests
/** Replace guest authority and rotate its scope identically for direct and guarded transitions. */
function setGuestIdentity(session: Request['session'], guest: Guest): void {
    session.auth = {guest};
    session.profile = guest.profile;
    rotateFrontendSessionContext(session);
}

/**
 * Resolve a private guest login token before replacing the active identity. An API
 * caller rechecks its captured context after the lookup; direct callers keep the
 * same invalid-token diagnostic and session persistence without that extra guard.
 */
export async function loginGuest(guestId: string, token: string, session: Request["session"], options?: IdentityTransitionOptions,
    manager?: EntityManager) {
    // Token verification returns the persisted guest and its profile. Submitted
    // profile identifiers never choose the identity attached to this session.
    const guest = await userService.getGuestByToken(token, guestId, manager);
    if (!guest) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
    }
    // The lookup may have yielded to another tab. Finish the optional admission
    // check before changing authority, then persist the rotated identity together.
    await options?.beforeTransition?.();
    setGuestIdentity(session, guest);
    await persistSession(session);
}

/** Reuse guest-token admission under the locked completion transaction, without a second connection. */
export async function loginGuestWithSession<Result>(guestId: string, token: string, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Shared validation/authority logic runs only on isolated staging until its result is ready. */
    async function prepareGuestLogin(manager: EntityManager, session: Request['session']): Promise<Result> {
        await loginGuest(guestId, token, session, undefined, manager);
        return options.prepareResult(session, manager);
    }
    return commitIdentityCompletion(req, options.context, prepareGuestLogin, true);
}

/** Normalize the common registration input without changing name/email acceptance. */
function normalizeGuestContact(username: string, email: string | undefined): string | undefined {
    if (!username) throw new ValidationError('users/register-guest', 'Username required', {username, email});
    return email?.trim().toLowerCase();
}

/**
 * Preserve shared feature registration and its injectable persistence hook. The
 * guarded versioned workflow below uses this same input and guest/profile DBAL,
 * but owns atomic stored-session persistence and an immutable completion receipt.
 */
export async function registerGuest(username: string, email: string | undefined, session: Request['session'],
    options?: IdentityLinkOptions, createGuest: typeof userService.createGuest = userService.createGuest): Promise<string> {
    // Direct callers supply their existing creator; preserve its ordering and
    // link destination options without introducing a new transaction scope.
    const normalizedEmail = normalizeGuestContact(username, email);

    const guest = await createGuest(username, normalizedEmail);

    // Persist session authority before delivering its existing private link/mail.
    // The atomic API operation never enters this post-creation session-save path.
    setGuestIdentity(session, guest);
    await persistSession(session);
    const link = options?.frontend
        ? identityLink(`/guest/${encodeURIComponent(guest.id)}/login/${encodeURIComponent(guest.token)}`, options)
        : buildGuestLink(guest.id, guest.token);
    if (normalizedEmail) await mailer.sendLinkEmail({name: resolveEmailRecipientName(guest.username, guest.profile?.name), address: normalizedEmail}, link);
    return link;
}

/**
 * Commit a versioned guest, profile and stored session together under the original
 * session row lock. Prepare every response/mail variant before that final commit;
 * a rollback leaves request authority untouched, while later delivery cannot turn
 * completed creation into a rejection or reopen it against another tab's actor.
 */
export async function registerGuestWithSession<Result>(username: string, email: string | undefined,
    req: Request, options: GuestRegistrationTransactionOptions<Result>): Promise<RegistrationReceipt<Result>> {
    const normalizedEmail = normalizeGuestContact(username, email);

    /** Create the guest on the shared locked transaction and prepare its private completion. */
    async function createGuestRegistration(manager: EntityManager, session: Request['session']) {
        const guest = await userService.createGuest(username, normalizedEmail, manager);
        setGuestIdentity(session, guest);

        // Token/link projection, every validated serialized API outcome and both
        // email renderings can still fail here and roll back all new records.
        const personalLink = identityLink(`/guest/${encodeURIComponent(guest.id)}/login/${encodeURIComponent(guest.token)}`, options);
        const results = await options.prepareResult(session, personalLink);
        const emailReceipt = normalizedEmail ? prepareGuestLinkEmail({
            name: resolveEmailRecipientName(guest.username, guest.profile?.name), address: normalizedEmail,
        }, personalLink) : null;

        return {results, emailReceipt};
    }

    return commitRegistration(req, options.context, createGuestRegistration, true);
}

/** Private preparation data stays in this owner; neither API DTOs nor SMTP details enter DBAL policy. */
interface PreparedRegistration<Result> {
    results: Record<RegistrationEmailDelivery, Result>;
    emailReceipt: PreparedIdentityEmail | null;
}

/**
 * Share registration's captured-context admission, isolated staging and commit
 * finality. Feature callbacks own their records and response/mail preparation;
 * DBAL owns the session lock and transaction, while SMTP remains postcommit delivery.
 */
async function commitRegistration<Result>(req: Request, context: string | null,
    prepare: (manager: EntityManager, session: Request['session']) => Promise<PreparedRegistration<Result>>,
    persistSessionState: boolean): Promise<RegistrationReceipt<Result>> {
    // The shared owner finishes all locked persistence before external mail can
    // run. Registration's variant selection is a delivery outcome only.
    const completed = await commitIdentityCompletion(req, context, prepare, persistSessionState);
    const committed = completed.result;

    let emailDelivery: RegistrationEmailDelivery = 'not-requested';
    if (committed.emailReceipt) {
        emailDelivery = await settleIdentityDelivery(committed.emailReceipt) ? 'sent' : 'failed';
    }
    return Object.freeze({session: completed.session, result: committed.results[emailDelivery], emailDelivery});
}

/** A prepared SMTP receipt can report failure after commit, never reject or replay its finished business operation. */
async function settleIdentityDelivery(receipt: PreparedIdentityEmail): Promise<boolean> {
    // Setup, persistence and result validation have already finished. Catch only
    // this opaque external boundary, including an unexpected delivery rejection.
    try { return await receipt.deliver(); }
    catch { return false; }
}

/**
 * Prepare a captured frontend identity operation on fresh locked session evidence.
 * Callbacks own business checks and completion data; DBAL owns the transaction.
 * Original request authority stays untouched until a successful adapter adopts
 * the receipt, preventing Express autosave from leaking rolled-back state.
 */
async function commitIdentityCompletion<Result>(req: Request, context: string | null,
    prepare: (manager: EntityManager, session: Request['session']) => Promise<Result>,
    persistSessionState: boolean): Promise<IdentityCompletionReceipt<Result>> {
    const sessionId = req.sessionID;

    /** Keep every prepared write and optional completion session on the locked connection. */
    async function prepareLocked(manager: EntityManager, lockedSession: Session | null) {
        // The library remains the owner of expiry, destroyed-row and JSON
        // semantics. Recognized sessions must retain their captured authority;
        // absence is allowed only for an admitted, uninitialized server candidate.
        const store = createSessionStore(manager);
        const stored = await readStoredSession(store, sessionId);
        if (stored) {
            if (!lockedSession || !sameFrontendSessionIdentity(req.session, stored)
                || readFrontendSessionMetadata(stored, sessionId).context !== context) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
        } else {
            // A login/guest creation can be the browser's first session-changing
            // action. No empty row is saved before credential/business validation.
            // Previously observed, expired or destroyed authority cannot use this path.
            const original = req.session;
            if (lockedSession || req.apiSessionStored !== false || context !== null || original.auth || original.profile
                || original.tokens || original.oidc || original.frontendContext || original.frontendCsrfToken) {
                throw new ApiProblem('SESSION_CONTEXT_CHANGED');
            }
        }

        // No staged authority/completion reaches request autosave on rollback.
        // Account API signup has no identity change and needs no session write.
        // Capture before staging: Cookie construction and flash consumption can
        // share nested objects with this decoded store value. Compare snapshots,
        // never two aliases after preparation has already mutated them.
        const original = stored ?? req.session;
        const originalJson = persistSessionState ? JSON.stringify(original) : undefined;
        const session = stageIdentitySession(req, original);
        const result = await prepare(manager, session);
        if (persistSessionState && JSON.stringify(session) !== originalJson) {
            await writeStoredSession(store, sessionId, session);
        }
        return Object.freeze({session, result});
    }

    // Serialization, SQL and ambiguous commit errors propagate unchanged. Only
    // an actually completed transaction may acknowledge registration success.
    return userService.withIdentitySessionTransaction(sessionId, prepareLocked);
}

/**
 * Deliver every matching guest's existing recovery link through the selected
 * direct or bounded frontend destination. An unknown email remains a quiet no-op; this
 * operation neither creates identities nor exposes recovery tokens in its reply.
 */
export async function recoverGuestAccount(email: string, options?: IdentityLinkOptions) {
    // Resolve persisted matches once, then build each private link through its
    // established destination owner. The email owns those links, not an API DTO.
    const guests = await userService.getGuestByEmail(email);
    const guestLinkData: GuestLinkData[] = [];
    for (let guest of guests) {
        const link = options?.frontend
            ? identityLink(`/guest/${encodeURIComponent(guest.id)}/login/${encodeURIComponent(guest.token)}`, options)
            : buildGuestLink(guest.id, guest.token);
        guestLinkData.push({...guest, link});
    }

    // Mail only when matches exist, while the requesting surface keeps the same
    // public confirmation for known and unknown addresses.
    if (guestLinkData.length > 0) {
        const recipientNames = [...new Set(guestLinkData.map(guest => resolveEmailRecipientName(guest.username, guest.profile?.name)))].filter(Boolean).join(' / ');
        await mailer.sendGuestRecoveryEmail({name: recipientNames, address: email}, guestLinkData);
    }
}

export async function hasGuestAccountForEmail(email: string) {
    const guests = await userService.getGuestByEmail(email);
    return guests.length > 0;
}

export async function getMigrationToken(profileId: string) {
    return await userService.generateMigrationToken(profileId);
}

/** Resolve the migration capability before any transfer. Its stable rejection
 * cause lets JSON distinguish an invalid token from an already entered transfer,
 * while direct entry points retain the same status, message and validation order. */
export async function getProfileToMigrate(token: string) {
    const profile = await userService.verifyMigrationToken(token);
    if (!profile) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401, {}, {cause: 'TOKEN_INVALID'});
    }
    return profile;
}

export function migrateProfile(userId: number, token: string): Promise<string>;
export function migrateProfile(userId: number, token: string, presentation: 'facts'): Promise<ProfileOwnerCleanup>;
/** Transfer and notify through the existing shared workflow. Direct callers keep
 * their exact prose; the API requests cleanup facts without parsing that prose or
 * repeating a read, persistence operation or mail side effect. */
export async function migrateProfile(userId: number, token: string, presentation?: 'facts'): Promise<string | ProfileOwnerCleanup> {
    // Keep capability validation, transfer and notification in their established order.
    const profile = await getProfileToMigrate(token);
    const previousOwner = await userService.moveProfileToUserTx(profile.id, userId);
    if (previousOwner?.email) {
        await mailer.sendMigrationEmail({name: resolveEmailRecipientName(previousOwner instanceof User ? previousOwner.name : undefined, previousOwner.username), address: previousOwner.email}, profile, (await userService.getUserById(userId))!)
    }

    // Only completed cleanup supplies presentation facts. An exception still
    // stops this inherited sequence and remains unknown at the versioned adapter.
    const cleanup = await handlePreviousProfileOwner(previousOwner);
    return presentation === 'facts' ? cleanup : `Migration successful. ${profileOwnerCleanupMessage(cleanup)}`;
}

/** Preserve former-owner cleanup and delivery order while reporting its completed
 * branch. Presentation must never infer deletion from an earlier owner snapshot. */
async function handlePreviousProfileOwner(previousOwner?: User | Guest): Promise<ProfileOwnerCleanup> {
    // Account deletion remains conditional on the existing remaining-profile read.
    if (previousOwner instanceof User) {
        const otherProfiles = await userService.getProfilesForUser(previousOwner.id);
        if (otherProfiles.length === 0) {
            await userService.deleteUser(previousOwner.id);
            await mailer.sendDeletionEmail({name: resolveEmailRecipientName(previousOwner.name, previousOwner.username), address: previousOwner.email}, previousOwner);
            return 'account-deleted';
        }
    } else if (previousOwner instanceof Guest) {
        await userService.deleteGuest(previousOwner.id);
        if (previousOwner.email) {
            await mailer.sendDeletionEmail({name: resolveEmailRecipientName(previousOwner.username, previousOwner.profile?.name), address: previousOwner.email}, previousOwner);
        }
        return 'guest-deleted';
    }
    return 'none';
}

/** Direct callers retain the original English suffix, including its empty value.
 * Only the existing controller's semantic result selects this presentation. */
function profileOwnerCleanupMessage(cleanup: ProfileOwnerCleanup): string {
    if (cleanup === 'account-deleted') return 'Previous user account permanently deleted!';
    if (cleanup === 'guest-deleted') return 'Previous guest account permanently deleted!';
    return '';
}

/** Verify the typed username before selecting the existing account or
 * guest deletion workflow, including its mail and provider/logout completion. */
export async function deleteAccount(body: any, session: Request['session']) {
    const {username} = body;
    // A mismatch is a confirmed rejection before either identity can be deleted.
    if (!username || (username !== session.auth?.guest?.username && username !== session.auth?.user?.username)) {
        throw new ValidationError("users/delete-account", "Invalid account deletion verification", {username},
            {cause: 'ACCOUNT_DELETION_CONFIRMATION_INVALID'});
    }
    if (session.auth?.guest && session.auth.user) {
        throw new ExpectedError("Ambiguous session. Log out and try again", "error", 500);
    }
    if (session.auth?.user) {
        return deleteUser(session);
    }
    if (session.auth?.guest) {
        return deleteGuest(session);
    }
    throw new ExpectedError("Invalid session. Log out and try again", "error", 500);
}

export async function deleteUser(session: Request['session']) {
    if (!session.auth?.user) {
        throw new ExpectedError("Not logged in as user!", "error", 401);
    }
    const deleted = await userService.deleteUser(session.auth.user.id);
    if (deleted?.email) {
        await mailer.sendDeletionEmail({name: resolveEmailRecipientName(deleted.name, deleted.username), address: deleted.email}, deleted);
    }
    return await logoutUserOidc(session);
}

export async function deleteGuest(session: Request['session']) {
    if (!session.auth?.guest) {
        throw new ExpectedError("Not logged in as guest!", "error", 401);
    }

    const deleted = await userService.deleteGuest(session.auth.guest.id);
    if (deleted?.email) {
        await mailer.sendDeletionEmail({name: resolveEmailRecipientName(deleted.username, deleted.profile?.name), address: deleted.email}, deleted);
    }
    return await logoutUserOidc(session);
}

export function deactivateProfile(body: any, session: Request['session']): Promise<string>;
export function deactivateProfile(body: any, session: Request['session'], presentation: 'facts'): Promise<ProfileOwnerCleanup>;
/** Preserve confirmation, ownership removal and former-owner cleanup.
 * The optional API projection reports facts after the same completed sequence;
 * default callers retain their exact original string and trailing empty suffix. */
export async function deactivateProfile(body: any, session: Request['session'], presentation?: 'facts'): Promise<string | ProfileOwnerCleanup> {
    // Confirmation is the existing first check, before any ownership write.
    const {name} = body;
    if (!name || name !== session.profile?.name) {
        throw new ValidationError("users/profile/delete", "Invalid profile deactivation verification", {name},
            {cause: 'PROFILE_DEACTIVATION_CONFIRMATION_INVALID'});
    }

    if (!session.profile) {
        throw new ExpectedError("No active profile!", "error", 401);
    }

    // Cleanup still follows removal and can fail after that work has completed.
    const previousOwner = await userService.removeProfileFromOwner(session.profile.id);
    const cleanup = await handlePreviousProfileOwner(previousOwner);
    return presentation === 'facts' ? cleanup : `Profile successfully deactivated. ${profileOwnerCleanupMessage(cleanup)}`;
}

/**
 * Select an account-owned profile, or its existing default, before replacing the
 * active profile. The optional API guard rechecks the originally admitted context
 * after persistence reads; profile selection and diagnostics remain unchanged.
 */
export async function changeActiveProfile(session: Request['session'], profileId?: string, beforeTransition?: () => Promise<void>,
    manager?: EntityManager) {
    // Guest profiles belong to a separate identity and cannot use account profile
    // selection. A submitted identifier must belong to this account in the DB.
    if (!session.auth?.user) {
        throw new ExpectedError("Not logged in as user!", "error", 401);
    }

    let profile;
    if (profileId) {
        profile = await userService.getProfileById(profileId, manager);
        if (profile?.userId !== session.auth.user.id) {
            throw new ExpectedError("Invalid profile id", "error", 400, {}, {cause: 'PROFILE_SELECTION_INVALID'});
        }
    } else {
        const profiles = await userService.getProfilesForUser(session.auth.user.id, manager);
        if (profiles.length > 0) {
            profile = getDefaultProfile(profiles);
        } else {
            throw new ExpectedError("Invalid profile id", "error", 400, {}, {cause: 'PROFILE_SELECTION_INVALID'});
        }
    }

    // Reads may have waited while another tab changed identity. Only current
    // admission permits replacing the profile and rotating/persisting its context.
    await beforeTransition?.();
    session.profile = profile;
    rotateFrontendSessionContext(session);
    await persistSession(session);
}

/** Commit an account-owned profile selection with its prepared frontend completion, preserving shared rules. */
export async function changeActiveProfileWithSession<Result>(profileId: string, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Keep profile ownership reads and the eventual session write on the same locked manager. */
    async function prepareProfileChange(manager: EntityManager, session: Request['session']): Promise<Result> {
        await changeActiveProfile(session, profileId, undefined, manager);
        return options.prepareResult(session, manager);
    }
    return commitIdentityCompletion(req, options.context, prepareProfileChange, true);
}

export async function validateSession(session: Request['session']) {
    let ok = true;
    // Check profile validity
    if (ok && session.profile) {
        const profile = await userService.getProfileById(session.profile.id);
        if (!profile || (profile.userId !== session.auth?.user?.id && profile.guestId !== session.auth?.guest?.id)) {
            ok = false;
        }
    }

    // Check user authentication
    if (ok && session.auth?.user) {
        const user = await userService.getUserById(session.auth.user.id);
        if (!user) {
            ok = false;
        }
    }

    // Check guest authentication
    if (ok && session.auth?.guest) {
        const guest = await userService.getGuestInternal(session.auth.guest.id);
        if (!guest) {
            ok = false;
        }
    }

    // Check for dangling profile without auth
    if (ok && session.profile && !session.auth) {
        ok = false;
    }

    return ok;
}

/** Retain blank-name validation, optional rename and default selection,
 * then reload the saved active profile before persisting the session copy. */
export async function updateProfile(body: any, session: Request['session']) {
    const {name, isDefault} = body;
    const profileId = session.profile!.id;
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/view", "Invalid profile name", {}, {cause: 'PROFILE_NAME_REQUIRED'});
    }
    // An omitted name keeps its old value; default selection still saves next.
    if (name) {
        await userService.updateProfileName(profileId, name);
    }
    await userService.updateProfileDefault(profileId, !!isDefault);

    // Session presentation follows both original profile writes in their order.
    session.profile = await userService.getProfileById(profileId);
    await persistSession(session);
    return "Updated profile";
}

export async function getProfilesForUser(userId: number) {
    return await userService.getProfilesForUser(userId);
}

/** Reject the original blank-name case before creating an account-owned profile;
 * selection and session changes remain with their existing separate workflows. */
export async function createProfile(body: any, userId: number) {
    const {name} = body;
    // Keep submitted form data on form rejection without entering persistence.
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/create", "Invalid profile name", body, {cause: 'PROFILE_NAME_REQUIRED'});
    }
    return await userService.createProfile(userId, name);
}

/**
 * Project only editable profile fields after verifying their current owner.
 * Sessions and ORM rows contain capabilities and credentials which never belong
 * in this administration projection.
 */
export async function getIdentityProfile(session: SessionLike): Promise<components['schemas']['ProfileSettings']> {
    // A persisted session label is not authority after transfer or deletion.
    const profile = session.profile ? await userService.getProfileById(session.profile.id) : null;
    if (!profile || !(session.auth?.user || session.auth?.guest)
        || (session.auth?.user ? profile.userId !== session.auth.user.id : profile.guestId !== session.auth?.guest?.id)) {
        throw new ApiProblem('AUTH_REQUIRED');
    }
    return {id: profile.id, name: profile.name, isDefault: profile.defaultForOwner};
}

/** Read an account's own profiles; guests retain their separate single-profile workflow. */
export async function getIdentityProfiles(session: SessionLike): Promise<components['schemas']['ProfileManagement']> {
    // Identity is server-selected. No request field can choose another account.
    if (!session.auth?.user) throw new ApiProblem(session.auth?.guest ? 'FORBIDDEN' : 'AUTH_REQUIRED');
    const profiles = await userService.getProfilesForUser(session.auth.user.id);
    return {profiles: profiles.map(profile => ({id: profile.id, name: profile.name, isDefault: profile.defaultForOwner})),
        activeProfileId: session.profile?.id ?? null};
}

/**
 * Project the shared capability preview for an admitted full account.
 * Invalid capability presentation is distinct from loss of the viewing session;
 * this read never consumes the token or changes ownership/previous-owner cleanup.
 */
export async function getProfileMigrationPreview(session: SessionLike, token: string): Promise<components['schemas']['ProfileMigrationPreviewOutcome']> {
    // Keep account admission with the business owner. The transport separately
    // authenticates the captured session/context and validates the submitted shape.
    if (!hasAccountProfile(session)) throw new ApiProblem(session.auth?.guest ? 'FORBIDDEN' : 'AUTH_REQUIRED');
    let profile: Profile;
    try {
        profile = await getProfileToMigrate(token);
    } catch (error) {
        // The shared read's known invalid-token result owns a full 401 message,
        // not authentication loss. Preserve that presentation without clearing an
        // otherwise valid account or interpreting arbitrary exception prose.
        if (!(error instanceof ExpectedError) || error.status !== 401) throw error;
        return {kind: 'denied', status: 401, messageKey: 'profile.invalidMigrationToken'};
    }

    // Token holders see exactly the existing preview fields. Never expose
    // ORM account credentials, private guest links or unrelated relationships.
    const owner = profile.user ? {kind: 'account' as const, name: profile.user.name,
        username: profile.user.username, email: profile.user.email}
        : profile.guest ? {kind: 'guest' as const, username: profile.guest.username, email: profile.guest.email ?? null} : null;
    return {kind: 'preview', token: profile.migrationToken!, profile: {id: profile.id, name: profile.name, owner}};
}

/** Share document and mounted-navigation admission without returning private fields. */
export function getProfileAdministrationEntry(session: SessionLike,
    view: operations['getProfileAdministrationEntry']['parameters']['query']['view'], returnTo?: unknown): components['schemas']['PageEntryOutcome'] {
    // A guest remains a valid identity when a full-account page redirects to login.
    // The adapter supplies the view; the established account owner decides admission.
    const destination = safeFrontendReturn(returnTo ?? `/users/profile${view === 'edit' ? '' : `/${view}`}`);
    if (view !== 'edit') return getAccountPageEntry(session, '/users/login', destination);
    return session.profile ? {kind: 'render'}
        : {kind: 'redirect', url: `/users/login?next=${encodeURIComponent(destination)}`, notice: null};
}

/** Read-only workflow admission; selecting a page never issues or consumes its capability. */
export function getProfileWorkflowEntry(session: SessionLike,
    kind: 'token' | 'entry' | 'deactivate' | 'delete-account', returnTo?: unknown): components['schemas']['ProfileWorkflowEntry'] {
    // Token issuance and account deletion retain guest support. Transfer and
    // deactivation remain full-account workflows, independently of page rendering.
    const view = kind === 'entry' || kind === 'deactivate' ? 'manage' : 'edit';
    return {entry: getProfileAdministrationEntry(session, view, returnTo)};
}

/** Preserve account/guest admission without a second identity or session owner. */
function requireProfileWorkflow(session: SessionLike, accountOnly: boolean): void {
    if (!session.profile || !(session.auth?.user || session.auth?.guest)) throw new ApiProblem('AUTH_REQUIRED');
    if (accountOnly && !session.auth?.user) throw new ApiProblem('FORBIDDEN');
}

/** Issue once through the existing token owner; a lost result must never trigger automatic reissuance. */
export async function requestProfileMigrationToken(session: SessionLike): Promise<components['schemas']['ProfileMigrationToken']> {
    requireProfileWorkflow(session, false);
    try {
        return {token: await getMigrationToken(session.profile!.id)};
    } catch {
        // Token persistence may already have replaced the previous capability.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

/**
 * Capture only scalar completion evidence from the existing operation's Session.
 * A later authoritative GET owns identity/roster display; no postcommit store
 * reload, flash save or full ORM projection can reject this completed workflow.
 */
function profileWorkflowCompletion(req: Request, destination: string, messageKey: MessageKey, redirect: string | null = null):
    components['schemas']['ProfileWorkflowCompletion'] {
    // Explicit selection/logout rotates a complete metadata pair. A transfer
    // preserves the admitted actor, including read-only stored-data fallback when a
    // stored generation is partial. Its raw context alone is not that actor's scope.
    const completeContext = req.session.frontendContext && req.session.frontendCsrfToken
        ? req.session.frontendContext : req.apiActor?.context ?? null;
    return {resultingContext: completeContext,
        destination, notice: {kind: 'success', messageKey}, redirect};
}

// Complete catalog messages preserve each confirmed cleanup detail without
// concatenating translated fragments or inspecting unstructured English response text.
const profileWorkflowNoticeKeys = {
    migration: {none: 'profile.migrationCompleted', 'account-deleted': 'profile.migrationCompletedAccountDeleted',
        'guest-deleted': 'profile.migrationCompletedGuestDeleted'},
    deactivation: {none: 'profile.deactivationCompleted', 'account-deleted': 'profile.deactivationCompletedAccountDeleted',
        'guest-deleted': 'profile.deactivationCompletedGuestDeleted'},
} as const satisfies Record<'migration' | 'deactivation', Record<ProfileOwnerCleanup, MessageKey>>;

/** Reuse transfer and former-owner cleanup exactly; only the transport result changes. */
export async function executeIdentityProfileMigration(req: Request, token: string): Promise<components['schemas']['ProfileWorkflowCompletion']> {
    requireProfileWorkflow(req.apiActor!, true);
    try {
        // The shared owner validates the capability before moving the profile,
        // then performs its established mail and previous-owner cleanup sequence.
        const cleanup = await migrateProfile(req.apiActor!.auth!.user!.id, token, 'facts');
        return profileWorkflowCompletion(req, '/users/profile/manage', profileWorkflowNoticeKeys.migration[cleanup]);
    } catch (error) {
        // Only the shared owner's explicitly annotated initial token rejection
        // proves no transfer occurred. Every later failure may be partial work.
        if (error instanceof ExpectedError && error.cause === 'TOKEN_INVALID') throw error;
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

/** Retain deactivation followed by ordinary remaining-profile selection, including its partial failures. */
export async function deactivateIdentityProfile(req: Request, body: components['schemas']['ProfileDeactivationInput']):
    Promise<components['schemas']['ProfileWorkflowCompletion']> {
    requireProfileWorkflow(req.apiActor!, true);
    try {
        // Confirmation validation is the shared operation's first step. Its
        // existing separate deactivation and selection commits remain unchanged.
        const cleanup = await deactivateProfile(body, req.session, 'facts');
        await changeActiveProfile(req.session);
        return profileWorkflowCompletion(req, '/users/profile/manage', profileWorkflowNoticeKeys.deactivation[cleanup]);
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        // In particular, the inherited last-profile 400 occurs after mutation;
        // reporting it as a definite API rejection would invite an unsafe replay.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

/** Preserve ordinary account/guest deletion, mail and provider completion without adding atomicity. */
export async function deleteIdentityAccount(req: Request, body: components['schemas']['AccountDeletionInput']):
    Promise<components['schemas']['ProfileWorkflowCompletion']> {
    requireProfileWorkflow(req.apiActor!, false);
    try {
        // The existing owner supplies the real provider/root destination. Do not
        // preflight or replace that workflow with a new session transaction.
        const redirect = await deleteAccount(body, req.session);
        return profileWorkflowCompletion(req, '/', 'profile.accountDeleted',
            redirect === settings.value.rootUrl ? null : redirect);
    } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

export function getDefaultProfile(profiles: Profile[]) {
    const sortedProfiles = profiles.toSorted((a, b) => a.track.createdAt.getTime() - b.track.createdAt.getTime())
    let profile = sortedProfiles.find(p => p.defaultForOwner);
    // No default profile --> use oldest instead.
    profile ??= sortedProfiles[0];

    return profile;
}
