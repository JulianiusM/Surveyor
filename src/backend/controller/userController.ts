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
import {
    requireLockedArchiveRoot, getArchivePresentations,
} from '../modules/entityArchival';
import Joi from 'joi';
import {Guest} from "../modules/database/entities/user/Guest";
import type {Session} from '../modules/database/entities/session/Session';
import {Profile} from "../modules/database/entities/user/Profile";
import {User} from "../modules/database/entities/user/User";
import * as userService from "../modules/database/services/UserService";
import * as identity from '../modules/identity';
import mailer, {prepareActivationEmail, prepareGuestLinkEmail, preparePasswordResetEmail, resolveEmailRecipientName} from "../modules/email";
import type {PreparedIdentityEmail} from '../../types/EmailTypes';
import {APIError, ExpectedError, ValidationError} from "../modules/lib/errors";
import {createSessionStore, persistSession, readStoredSession, requireSessionProfileId, stageIdentitySession, writeStoredSession} from "../modules/lib/session";
import {readFrontendSessionMetadata, rotateFrontendSessionContext, sameFrontendSessionIdentity} from '../modules/lib/frontendSession';
import {safeFrontendReturn} from '../../common/lib/frontendIdentity';
import type {AccountRegistrationTransactionOptions, RegistrationEmailDelivery, RegistrationReceipt, GuestRegistrationTransactionOptions, IdentityCompletionOptions, IdentityCompletionReceipt, IdentityLinkOptions, IdentityTransitionOptions, ProfileOwnerCleanup, ProfileWorkflowPreparation, ProviderLogoutOutcome} from '../../types/IdentityTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import {ApiProblem} from '../modules/api/problem';
import {buildGuestLink, ENTITIES, uuidKey} from "../modules/lib/util";
import * as oidc from "../modules/oidc";
import settings from "../modules/settings";
import type {Entity, GuestLinkData, OverviewCollection, OverviewQuery, OverviewReadResult, OverviewRegion, OverviewRegionView, PersonalVisibilityCompletion, PersonalVisibilityResult} from "../../types/UserTypes";
import type {ArchivePresentation, ArchiveReference, ArchiveSnapshotEntry, LockedArchiveContext, PersonalVisibility} from "../../types/ArchiveTypes";
import type {SessionLike} from "../../types/PermissionTypes";
import {archiveKey, isHiddenInOverview} from "../modules/archive/policy";
import {evaluateEntities, entityPermissionKey} from "../modules/permissionEngine";
import type {components, operations} from '../../types/api/v1';

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
    let next: string | undefined;
    if (options?.next) {
        next = options.frontend ? safeFrontendReturn(options.next) : options.next;
    }
    // The frontend option serializes its bounded return destination. Direct mail
    // retains its original literal next parameter and route contract.
    const destination = `${settings.value.rootUrl}${path}`;
    if (!next) return destination;
    const returnValue = options?.frontend ? encodeURIComponent(next) : next;
    return `${destination}?next=${returnValue}`;
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

    // New-credential admission follows the existing required/equality diagnostics,
    // before account lookups, hashing, tokens or notification preparation.
    identity.requireNewPassword(password, CREATE_TEMPLATE);
    // The authored name schema also protects direct business callers. Retain
    // the established omitted/empty display-name fallback without new trimming.
    identity.requireLocalRegistrationNames(username, typeof displayname === 'string' && displayname ? displayname : name);
    return {username, name, password, email};
}

/** Preserve the common username diagnostic while selecting the caller's current persistence scope. */
async function requireAvailableUsername(username: string, email: string, manager?: EntityManager): Promise<void> {
    const existingUser = await userService.getUserByUsername(username, manager);
    if (existingUser) {
        throw new ValidationError(CREATE_TEMPLATE, 'This username is already taken.', {username, email}, {cause: 'USERNAME_TAKEN'});
    }
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
    await options?.credentialAdmission?.account(user?.id ?? null);
    if (!user) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo, {cause: 'INVALID_CREDENTIALS'});
    }

    const isValidPassword = await userService.verifyPassword(user.id, password);
    if (!isValidPassword) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo, {cause: 'INVALID_CREDENTIALS'});
    }
    await options?.credentialAdmission?.verified();

    // An inactive account is not a session transition. Refresh expired activation
    // mail first, then report the precise inactive/resend cause to either adapter.
    if (!user.isActive) {
        let errorMsg = 'User not activated.';
        let cause: 'ACCOUNT_INACTIVE' | 'ACTIVATION_RESENT' = 'ACCOUNT_INACTIVE';
        if ((user.activationTokenExpiration ?? new Date(0)) < new Date()) {
            await options?.beforeIdentityMail?.(user.email);
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

/** Select local account authority synchronously; each caller retains its original save timing. */
function applyAccountIdentity(session: Request['session'], user: User): void {
    session.auth = {user};
    session.profile = getDefaultProfile(user.profiles);
    rotateFrontendSessionContext(session);
}

/** Direct saves immediately; isolated frontend saves defer to their enclosing completion transaction. */
async function saveAccountIdentity(session: Request['session'], user: User): Promise<void> {
    // Save the validated account/default profile with one new frontend scope.
    // A staged session cannot leak into request autosave if preparation rejects.
    applyAccountIdentity(session, user);
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
 * Region requests use this allowlist. A decimal string is validated before
 * conversion, rejecting nested query values, signs, fractions, overflow, and arbitrary size.
 * There is no caller-selected profile or page-size field.
 */
function normalizeOverviewNavigation(input: unknown) {
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
    fields.collection = Joi.string().valid(...OVERVIEW_COLLECTIONS).required();
    fields.region = Joi.string().valid(...OVERVIEW_REGIONS).required();
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
            const eventValue = parsed.value[`${prefix}event`];
            const eventId = eventValue === undefined ? undefined : uuidKey(eventValue);
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
    const target = overviewKey(parsed.value.collection as OverviewCollection, parsed.value.region as OverviewRegion);
    // Asking for a hidden region is the explicit load operation even when the caller omitted
    // its open marker. The canonical URL records it for reloads and ordinary browser history.
    state[target].open = true;
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
    const query = search ? '?' + search : '';
    return `/users/dashboard${query}#${overviewRegionId(selected.collection, selected.region)}`;
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
        for (const event of read.contextEvents) contextEvents.set(uuidKey(event.id), event);
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
                const parent = contextEvents.get(uuidKey(item.eventId));
                const permission = permissions.get(entityPermissionKey('event', item.eventId));
                if (parent && permission?.has('ACCESS_VIEW')) {
                    item.eventContext = {title: parent.title, url: parent.url};
                }
            }
        }
    }
}

/**
 * Build one loaded region's navigation while retaining other regions' search parameters.
 * Cards gain their existing expansion URLs; parent context selects child-page pagination.
 */
function makeOverviewRegionView(
    state: OverviewNavigationState,
    key: string,
    read: OverviewReadResult,
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
        items: read.items, parent: read.event,
        totalEntities: read.collectionTotal, hiddenEntities: read.hiddenTotal,
        regionEntities: read.regionTotal,
        matchingEntities: read.matchingTotal,
        totalCards: read.cardTotal, totalChildren: read.childTotal,
        availableTypes: read.types, pageSize: read.pageSize,
        canonicalUrl: overviewUrl(state, key, {open: true}),
        backUrl: overviewUrl(state, key, {eventId: undefined, childPage: 1}),
        clearUrl: overviewUrl(state, key, {q: '', type: 'all', page: 1, childPage: 1}),
        loaded: true,
        searchFields: Array.from(search, ([name, value]) => ({name, value})),
    };

    // Add expansion destinations only for event containers on the mixed page;
    // an already expanded parent retains its independently selected child context.
    for (const item of view.items) {
        if (item.overview && item.overview.total > 0 && !view.parent) {
            item.overview = {...item.overview, url: overviewUrl(state, key, {eventId: item.id, childPage: 1})};
        }
    }
    // Page links change only the active surface's page key, preserving all
    // other region filters and the selected parent through overviewUrl.
    const page = view.parent ? view.childPage : view.page;
    const total = view.parent ? (view.parent.overview?.matching ?? 0) : view.totalCards;
    if (page > 1) view.previousUrl = overviewUrl(state, key, view.parent ? {childPage: page - 1} : {page: page - 1});
    if (page * view.pageSize < total) view.nextUrl = overviewUrl(state, key, view.parent ? {childPage: page + 1} : {page: page + 1});
    return view;
}

/** Admit one selected region and retain every region's navigation through the bounded read. */
async function readOverviewNavigation(session: SessionLike, input: unknown) {
    const profileId = requireSessionProfileId(session);
    const {state, target} = normalizeOverviewNavigation(input);
    const selected = [state[target]];
    const queries: OverviewQuery[] = selected.map(({open, ...query}) => query);
    // Identity, normalized query values and the selected region are owned here:
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

export async function getOverviewRegion(session: SessionLike, query: unknown): Promise<OverviewRegionView> {
    const {state, target, byRegion} = await readOverviewNavigation(session, query);
    const read = byRegion.get(target)!;
    return makeOverviewRegionView(state, target, read);
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
    const reference: ArchiveReference = {type: target.value.type, id: uuidKey(target.value.id)};
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

/** Resolve credential and recovery accounts by username before falling back to email. */
async function resolveNamedAccount(username: string, manager?: EntityManager) {
    // Recovery supplies its completion manager for both reads. Credential
    // admission retains ordinary DBAL reads before the identity lock is acquired.
    const user = await userService.getUserByUsername(username, manager);
    return user ?? await userService.getUserByEmail(username, manager);
}

/**
 * Prepare frontend recovery's existing generic confirmation and optional token/mail
 * on the locked completion transaction. Unknown accounts stay a quiet no-op;
 * setup errors roll back, while caught SMTP failure retains normal confirmation.
 * Inactive-login resend retains its separate credential-admission ordering.
 */
export async function requestPasswordResetWithSession<Result>(username: string, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** Reuse username-first discovery without another connection or an account-found result. */
    async function prepareRecovery(manager: EntityManager, session: Request['session']) {
        const user = await resolveNamedAccount(username, manager);
        await options.beforeIdentityMail?.(user?.email ?? username);
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

/** Preserve reset's mismatch-before-token check and existing renderer data. */
function validatePasswordResetInput(token: string, body: any) {
    const {password, confirmPassword} = body;
    if (password !== confirmPassword) {
        throw new ValidationError('users/reset-password', 'Passwords do not match!', {token}, {cause: 'PASSWORD_MISMATCH'});
    }
    // Reject an invalid replacement before reading or consuming its reset token.
    identity.requireNewPassword(password, 'users/reset-password');
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
 * completion. The session/token locks and password update share one manager;
 * unchanged actor state needs no JSON write.
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

/**
 * Commit a frontend token consumption with its prepared API/document completion.
 * Session and token locks share one connection. No mutable-context check,
 * flash save or token projection follows this commit, and the public receipt
 * never contains the capability.
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

/** Complete validated provider login through the local account owner, then save identity and tokens together. */
export async function loginUserWithOidcCallback(req: Request) {
    // Protocol validation finishes before any local account or session authority changes.
    const {issuer, identityClaims, tokens} = await oidc.exchangeCallback(req);
    // Resolve the established linking/provisioning policy before changing session authority.
    const user = await identity.findOrCreateUserFromOidc(issuer, identityClaims);
    applyAccountIdentity(req.session, user);

    // Provider tokens follow identity selection; no early save occurs through the shared synchronous helper.
    req.session.tokens = {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at, // epoch seconds if present
        token_type: tokens.token_type,
    };

    // Clear transient OIDC artifacts
    req.session.oidc = undefined;

    // Persist once after clearing transient protocol state, retaining the original provider completion boundary.
    await persistSession(req.session);
}

export function logoutUserOidc(session: Request['session']): Promise<string>;
export function logoutUserOidc(session: Request['session'], presentation: 'outcome'): Promise<ProviderLogoutOutcome>;
/** Coordinate local/provider logout; explicit outcome consumers distinguish only post-save provider failure. */
export async function logoutUserOidc(session: Request['session'], presentation?: 'outcome'): Promise<string | ProviderLogoutOutcome> {
    // Provider-bearing account deletion keeps its current string/error contract.
    return presentation ? oidc.logout(session, presentation) : oidc.logout(session);
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

/** Admit the shared stored-name rule before guest creation, preserving the
 * existing required-name diagnostic and email normalization. */
function normalizeGuestContact(username: string, email: string | undefined): string | undefined {
    if (!username) throw new ValidationError('users/register-guest', 'Username required', {username, email});
    identity.requireIdentityName(username);
    return email?.trim().toLowerCase();
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
    persistSessionState: boolean, superseded?: () => Result): Promise<IdentityCompletionReceipt<Result>> {
    const sessionId = req.sessionID;

    /** Feedback may be omitted, but its old request must never autosave over a newer identity. */
    function rejectOrOmitSuperseded(): IdentityCompletionReceipt<Result> {
        // Identity commands still reject before business writes. Only the approved
        // feedback caller supplies this no-op result; never adopt the newer actor.
        if (!superseded) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
        return Object.freeze({session: stageIdentitySession(req, req.session), result: superseded()});
    }

    /** Keep every prepared write and optional completion session on the locked connection. */
    async function prepareLocked(manager: EntityManager, lockedSession: Session | null) {
        // The library remains the owner of expiry, destroyed-row and JSON
        // semantics. Recognized sessions must retain their captured authority;
        // absence is allowed only for an admitted, uninitialized server candidate.
        const store = createSessionStore(manager);
        const stored = await readStoredSession(store, sessionId);
        if (stored) {
            if (!lockedSession || !sameFrontendSessionIdentity(req.session, stored)
                || readFrontendSessionMetadata(stored, sessionId).context !== context) return rejectOrOmitSuperseded();
        } else {
            // A login/guest creation can be the browser's first session-changing
            // action. No empty row is saved before credential/business validation.
            // Previously observed, expired or destroyed authority cannot use this path.
            const original = req.session;
            if (lockedSession || req.apiSessionStored !== false || context !== null || original.auth || original.profile
                || original.tokens || original.oidc || original.frontendContext || original.frontendCsrfToken) {
                return rejectOrOmitSuperseded();
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
 * Complete document feedback on its originating generation using the existing
 * locked Session owner. Superseded feedback is omitted without changing captured
 * authority; both committed consumption and omission seal later response saves.
 */
export async function completeDocumentFeedback<Result>(req: Request,
    prepare: (session: Request['session']) => Result): Promise<Result | undefined> {
    // For expiry feedback this is the completed logout's generation, rather than
    // the earlier captured actor. Nothing reloads or adopts another tab's actor.
    const context = readFrontendSessionMetadata(req.session, req.sessionID).context;
    async function prepareFeedback(_manager: EntityManager, session: Request['session']): Promise<Result | undefined> {
        return prepare(session);
    }
    const completed = await commitIdentityCompletion(req, context, prepareFeedback, true, () => undefined);
    // The same staged save acknowledgement prevents Express from writing an old
    // full snapshot after this transaction or after another identity has won.
    req.session = completed.session;
    return completed.result;
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
    await options?.beforeIdentityMail?.(guests[0]?.email ?? email);
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

/** Direct callers retain the original English suffix, including its empty value.
 * Only the existing controller's semantic result selects this presentation. */
function profileOwnerCleanupMessage(cleanup: ProfileOwnerCleanup): string {
    if (cleanup === 'account-deleted') return 'Previous user account permanently deleted!';
    if (cleanup === 'guest-deleted') return 'Previous guest account permanently deleted!';
    return '';
}

export function deactivateProfile(body: any, session: Request['session']): Promise<string>;
export function deactivateProfile(body: any, session: Request['session'], presentation: 'facts'): Promise<ProfileOwnerCleanup>;
/** Preserve confirmation, ownership removal and former-owner cleanup.
 * The optional API projection reports facts after the same completed sequence;
 * default callers retain their exact original string and trailing empty suffix. */
export async function deactivateProfile(body: any, session: Request['session'], presentation?: 'facts'): Promise<string> {
    // The feature owns confirmation, detach and cleanup; this controller selects presentation only.
    const cleanup = await identity.deactivateProfile(body, session);
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

/** Complete current-profile fields, required Session refresh and the prepared
 * acknowledgement together, preserving the admitted generation without rotation. */
export async function updateProfileWithSession<Result>(body: any, req: Request,
    options: IdentityCompletionOptions<Result>): Promise<IdentityCompletionReceipt<Result>> {
    /** The existing completion owner supplies current staged authority and one manager. */
    async function prepareProfileEdit(manager: EntityManager, session: Request['session']): Promise<Result> {
        // Shared feature policy checks locked ownership and saves the fields;
        // only this completion coordinator installs their required Session view.
        session.profile = await identity.updateProfile(body, session, manager);
        return options.prepareResult(session, manager);
    }
    return commitIdentityCompletion(req, options.context, prepareProfileEdit, true);
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
    identity.requireIdentityName(name);
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
        profile = await identity.getProfileToMigrate(token);
    } catch (error) {
        // The shared read's known invalid-token result owns a full 401 message,
        // not authentication loss. Preserve that presentation without clearing an
        // otherwise valid account or interpreting arbitrary exception prose.
        if (!(error instanceof ExpectedError) || error.status !== 401) throw error;
        return {kind: 'denied', status: 401, messageKey: 'profile.invalidMigrationToken'};
    }

    // Token holders see exactly the existing preview fields. Never expose
    // ORM account credentials, private guest links or unrelated relationships.
    let owner: components['schemas']['ProfileMigrationPreview']['profile']['owner'] = null;
    if (profile.user) {
        owner = {kind: 'account', name: profile.user.name, username: profile.user.username, email: profile.user.email};
    } else if (profile.guest) {
        owner = {kind: 'guest', username: profile.guest.username, email: profile.guest.email ?? null};
    }
    return {kind: 'preview', token: profile.migrationToken!, profile: {id: profile.id, name: profile.name, owner}};
}

/** Share document and mounted-navigation admission without returning private fields. */
export function getProfileAdministrationEntry(session: SessionLike,
    view: operations['getProfileAdministrationEntry']['parameters']['query']['view'], returnTo?: unknown): components['schemas']['PageEntryOutcome'] {
    // A guest remains a valid identity when a full-account page redirects to login.
    // The adapter supplies the view; the established account owner decides admission.
    const defaultPath = view === 'edit' ? '/users/profile' : `/users/profile/${view}`;
    const destination = safeFrontendReturn(returnTo ?? defaultPath);
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
export function requestProfileMigrationToken(session: SessionLike): Promise<components['schemas']['ProfileMigrationToken']>;
export function requestProfileMigrationToken<Result>(session: SessionLike,
    prepareResult: (result: components['schemas']['ProfileMigrationToken']) => Result | Promise<Result>): Promise<Result>;
/** Coordinate captured admission and locked business issuance, including any precommit transport preparation. */
export async function requestProfileMigrationToken<Result>(session: SessionLike,
    prepareResult?: (result: components['schemas']['ProfileMigrationToken']) => Result | Promise<Result>): Promise<Result | components['schemas']['ProfileMigrationToken']> {
    requireProfileWorkflow(session, false);
    try {
        return await identity.issueMigrationToken<Result | components['schemas']['ProfileMigrationToken']>(session, prepareResult ?? (result => result));
    } catch (error) {
        if (error instanceof ApiProblem) throw error;
        // Token persistence may already have replaced the previous capability.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

/**
 * Capture only scalar completion evidence from the existing operation's Session.
 * A later authoritative GET owns identity/roster display; no postcommit store
 * reload, flash save or full ORM projection can reject this completed workflow.
 */
function profileWorkflowCompletion(req: Request, destination: string, messageKey: MessageKey, redirect: string | null = null,
    session: Request['session'] = req.session):
    components['schemas']['ProfileWorkflowCompletion'] {
    // Explicit selection/logout rotates a complete metadata pair. A transfer
    // preserves the admitted actor, including read-only stored-data fallback when a
    // stored generation is partial. Its raw context alone is not that actor's scope.
    const completeContext = session.frontendContext && session.frontendCsrfToken
        ? session.frontendContext : req.apiActor?.context ?? null;
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

export function executeIdentityProfileMigration(req: Request, token: string): Promise<components['schemas']['ProfileWorkflowCompletion']>;
export function executeIdentityProfileMigration<Result>(req: Request, token: string, prepareResult: ProfileWorkflowPreparation<Result>): Promise<Result>;
/** Coordinate admitted transfer and precommit response preparation without rotating the recipient's Session. */
export async function executeIdentityProfileMigration<Result>(req: Request, token: string,
    prepareResult?: ProfileWorkflowPreparation<Result>): Promise<Result | components['schemas']['ProfileWorkflowCompletion']> {
    requireProfileWorkflow(req.apiActor!, true);
    try {
        /** The feature invokes this while ownership, cleanup and result preparation may still roll back. */
        function prepareCompletion(cleanup: ProfileOwnerCleanup) {
            const completion = profileWorkflowCompletion(req, '/users/profile/manage', profileWorkflowNoticeKeys.migration[cleanup]);
            return prepareResult ? prepareResult(completion) : completion;
        }
        return await identity.migrateProfile(req.apiActor!.auth!.user!.id, token, prepareCompletion);
    } catch (error) {
        // Current-token and locked admission rejections precede mutation. An
        // unclassified error or uncertain commit must never invite automatic replay.
        if ((error instanceof ExpectedError && error.cause === 'TOKEN_INVALID') || error instanceof ApiProblem) throw error;
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
        if (cleanup === 'account-deleted') {
            // The final User no longer exists. Retain the detached Profile and
            // finish ordinary local sign-out, without a new transaction or provider request.
            await oidc.logoutLocal(req.session);
            return profileWorkflowCompletion(req, '/', profileWorkflowNoticeKeys.deactivation[cleanup]);
        }
        await changeActiveProfile(req.session);
        return profileWorkflowCompletion(req, '/users/profile/manage', profileWorkflowNoticeKeys.deactivation[cleanup]);
    } catch (error) {
        // Only confirmation or the feature's exact pre-detach ownership denial
        // is a known rejection. A matching API code from a later phase is not.
        if (error instanceof ValidationError || identity.isDeactivationOwnershipRejection(error)) throw error;
        // Cleanup, remaining-profile selection and local save can fail after
        // detach. Do not report those later failures as a definite rejection.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

export function deleteIdentityAccount(req: Request, body: components['schemas']['AccountDeletionInput']): Promise<components['schemas']['ProfileWorkflowCompletion']>;
export function deleteIdentityAccount<Result>(req: Request, body: components['schemas']['AccountDeletionInput'],
    prepareResult: ProfileWorkflowPreparation<Result>): Promise<Result>;
/** Commit account deletion and local anonymous authority once, preparing every
 * local receipt before commit. Provider discovery and optional URL serialization
 * are guarded delivery work with a prepared warning fallback, never a second
 * business rejection, Session write or automatic replay. */
export async function deleteIdentityAccount<Result>(req: Request, body: components['schemas']['AccountDeletionInput'],
    prepareResult?: ProfileWorkflowPreparation<Result>): Promise<Result | components['schemas']['ProfileWorkflowCompletion']> {
    requireProfileWorkflow(req.apiActor!, false);
    try {
        /** Actual adapters only validate/serialize this scalar receipt; they do
         * not query, persist or change authority. Precommit failures still roll back. */
        async function prepareCompletion(completion: components['schemas']['ProfileWorkflowCompletion']) {
            return prepareResult ? await prepareResult(completion) : completion;
        }

        /** Prepare deletion, mail content, anonymous authority and fallbacks on
         * the original identity owner's locked Session/database connection. */
        async function prepareDeletion(manager: EntityManager, session: Request['session']) {
            // Fresh stored tokens choose external delivery only. They never bypass
            // deletion confirmation or select another account/profile to remove.
            const providerEvidence = session.tokens ? {idTokenHint: session.tokens.id_token} : null;
            const emails = await identity.prepareAccountDeletion(body, session, manager);
            await oidc.logoutLocal(session);
            const completion = profileWorkflowCompletion(req, '/', 'profile.accountDeleted', null, session);
            const result = await prepareCompletion(completion);

            // Token-free completion retains its established delivery semantics.
            // Provider-bearing completion additionally prepares both warnings
            // before any irreversible local write becomes durable.
            const providerWarning = providerEvidence ? await prepareCompletion({...completion,
                notice: {kind: 'info', messageKey: 'profile.accountDeletedProviderUnconfirmed'}}) : result;
            const deliveryWarning = providerEvidence ? await prepareCompletion({...completion,
                notice: {kind: 'info', messageKey: 'profile.accountDeletedDeliveryUnconfirmed'}}) : result;
            return {result, completion, providerWarning, deliveryWarning, emails, providerEvidence};
        }
        const committed = await commitIdentityCompletion(req, req.apiActor!.context, prepareDeletion, true);
        req.session = committed.session;
        const delivered = await identity.deliverPreparedIdentityEmails(committed.result.emails);
        if (!committed.result.providerEvidence) return committed.result.result;
        // Keep failed-mail confirmation visible locally, including the fact that
        // no external provider termination has occurred. Never replay deletion.
        if (!delivered) return committed.result.deliveryWarning;

        try {
            // Discovery follows committed local sign-out. A dynamic provider URL
            // is delivery data, so all preparation failures select the already
            // validated local warning without changing business confirmation.
            const provider = await oidc.prepareProviderLogout(committed.result.providerEvidence);
            if (provider.providerLogout) return committed.result.providerWarning;
            return await prepareCompletion({...committed.result.completion, redirect: provider.redirect});
        } catch {
            return committed.result.providerWarning;
        }
    } catch (error) {
        if (error instanceof ValidationError || error instanceof ApiProblem) throw error;
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
