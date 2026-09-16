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
import Joi from 'joi';
import {Guest} from "../modules/database/entities/user/Guest";
import {Profile} from "../modules/database/entities/user/Profile";
import {User} from "../modules/database/entities/user/User";
import * as userService from "../modules/database/services/UserService";
import mailer, {resolveEmailRecipientName} from "../modules/email";
import {APIError, ExpectedError, ValidationError} from "../modules/lib/errors";
import {persistSession, requireSessionProfileId} from "../modules/lib/session";
import {buildGuestLink, ENTITIES} from "../modules/lib/util";
import * as oidc from "../modules/oidc";
import settings from "../modules/settings";
import type {Entity, GuestLinkData, OverviewCollection, OverviewPageView, OverviewQuery, OverviewReadResult, OverviewRegion, OverviewRegionView} from "../types/UserTypes";
import type {ArchivePresentation, ArchiveReference, ArchiveState, PersonalVisibility} from "../types/ArchiveTypes";
import type {SessionLike} from "../types/PermissionTypes";
import {archiveKey, isHiddenInOverview} from "../modules/archive/policy";
import {getArchivePresentations} from "./entityAdminController";
import {evaluateEntities} from "../modules/permissionEngine";

const CREATE_TEMPLATE = 'users/register';
const LOGIN_TEMPLATE = 'users/login';

export async function registerUser(body: any, next?: string) {
    const {username, displayname, password, password_repeat, email} = body;
    const name = resolveEmailRecipientName(typeof displayname === 'string' ? displayname : undefined, typeof username === 'string' ? username : undefined);
    const returnInfo = {username, email};

    if (!username || !name || !password || !password_repeat || !email) {
        throw new ValidationError(CREATE_TEMPLATE, 'Not all fields were filled out.', returnInfo);
    }

    if (password !== password_repeat) {
        throw new ValidationError(CREATE_TEMPLATE, 'Passwords do not match.', returnInfo);
    }

    const existingUser = await userService.getUserByUsername(username);
    if (existingUser) {
        throw new ValidationError(CREATE_TEMPLATE, 'This username is already taken.', returnInfo);
    }

    // Benutzer registrieren
    let userId = await userService.registerUser(username, name, password, email);

    // Generiere den Aktivierungs-Token und sende ihn per E-Mail
    const token = await userService.generateActivationToken(userId);
    const nextLink = next ? `?next=${next}` : "";
    const activationLink = `${settings.value.rootUrl}/users/activate/${token}${nextLink}`;

    await mailer.sendActivationEmail({name, address: email}, activationLink);
}

export async function loginUser(body: any, session: Request["session"]) {
    const {username, password} = body;
    const returnInfo = {username};

    if (!username || !password) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo);
    }

    const user = (await userService.getUserByUsername(username)) ?? (await userService.getUserByEmail(username));
    if (!user) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo);
    }

    const isValidPassword = await userService.verifyPassword(user.id, password);
    if (!isValidPassword) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username/email or password', returnInfo);
    }

    if (!user.isActive) {
        let errorMsg = "User not activated.";
        if ((user.activationTokenExpiration ?? new Date(0)) < new Date()) {
            // Generiere den Aktivierungs-Token und sende ihn per E-Mail
            const token = await userService.generateActivationToken(user.id);
            const activationLink = `${settings.value.rootUrl}/users/activate/${token}`;

            await mailer.sendActivationEmail({name: resolveEmailRecipientName(user.name, user.username), address: user.email}, activationLink);
            errorMsg += " The activation link has expired. A new one has been sent to your email account.";
        }
        throw new ValidationError(LOGIN_TEMPLATE, errorMsg, returnInfo);
    }

    session.auth = {user};
    session.profile = getDefaultProfile(user.profiles);
    await persistSession(session);
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
    const states = new Map<string, ArchiveState>();
    const contextEvents = new Map<string, Entity>();
    for (const read of reads) {
        references.push(...read.items);
        if (read.event) references.push(read.event);
        for (const [key, value] of read.archives) states.set(key, value);
        for (const event of read.contextEvents) contextEvents.set(event.id, event);
    }
    const [archives, permissions] = await Promise.all([
        getArchivePresentations(references, session, states),
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
 * The service checks current overview membership while holding the target row lock, which
 * serializes the check/write with a concurrent database deletion. A visible card from an old
 * page is not sufficient authority to save a preference after membership has been removed.
 */
export async function setPersonalVisibility(entityType: string, id: string, body: unknown, session: SessionLike) {
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
    await userService.setVisibility(profileId, reference, visibility);
    // Recompute placement against current authoritative state after the private write.
    // The response preserves both concepts instead of presenting "shown" as a shared restore.
    const presentations = await getArchivePresentations([reference], session);
    const archive = presentations.get(archiveKey(reference));
    return {
        archive,
        visibility,
        overviewHidden: isHiddenInOverview(archive?.archived ?? false, visibility),
    };
}

export async function sendPasswordForgotMail(username: string) {
    const user = (await userService.getUserByUsername(username)) || (await userService.getUserByEmail(username));
    if (!user) {
        return;
    }

    // Generiere ein Passwort-Zurücksetzungs-Token und speichere es in der Datenbank
    const token = await userService.generatePasswordResetToken(user.username);
    const resetLink = `${settings.value.rootUrl}/users/reset-password/${token}`;

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    await mailer.sendPasswordResetEmail({name: resolveEmailRecipientName(user.name, user.username), address: user.email}, resetLink);
}

export async function checkPasswordForgotToken(token: string) {
    // Überprüfe, ob der Token gültig ist
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }
}

export async function resetPassword(token: string, body: any) {
    const {password, confirmPassword} = body;

    if (password !== confirmPassword) {
        throw new ValidationError('users/reset-password', 'Passwords do not match!', {token})
    }

    // Überprüfe den Token und setze das Passwort zurück
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Setze das Passwort zurück
    await userService.resetPassword(user.username, password);
}

export async function activateAccount(token: string) {
    // Überprüfe, ob der Aktivierungs-Token gültig ist
    const user = await userService.verifyActivationToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Aktiviere den Benutzer
    await userService.activateUser(user.id);
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
    return oidc.logout(session);
}

// Guests
export async function loginGuest(guestId: string, token: string, session: Request["session"]) {
    const guest = await userService.getGuestByToken(token, guestId);
    if (!guest) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401);
    }
    // switch to guest session
    session.auth = {guest};
    session.profile = guest.profile;
    await persistSession(session);
}

export async function recoverGuestAccount(email: string) {
    const guests = await userService.getGuestByEmail(email);
    const guestLinkData: GuestLinkData[] = [];
    for (let guest of guests) {
        guestLinkData.push({...guest, link: buildGuestLink(guest.id, guest.token)});
    }

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

export async function getProfileToMigrate(token: string) {
    const profile = await userService.verifyMigrationToken(token);
    if (!profile) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401);
    }
    return profile;
}

export async function migrateProfile(userId: number, token: string) {
    const profile = await getProfileToMigrate(token);
    const previousOwner = await userService.moveProfileToUserTx(profile.id, userId);
    if (previousOwner?.email) {
        await mailer.sendMigrationEmail({name: resolveEmailRecipientName(previousOwner instanceof User ? previousOwner.name : undefined, previousOwner.username), address: previousOwner.email}, profile, (await userService.getUserById(userId))!)
    }
    return `Migration successful. ${await handlePreviousProfileOwner(previousOwner)}`;
}

async function handlePreviousProfileOwner(previousOwner?: User | Guest) {
    if (previousOwner instanceof User) {
        const otherProfiles = await userService.getProfilesForUser(previousOwner.id);
        if (otherProfiles.length === 0) {
            await userService.deleteUser(previousOwner.id);
            await mailer.sendDeletionEmail({name: resolveEmailRecipientName(previousOwner.name, previousOwner.username), address: previousOwner.email}, previousOwner);
            return "Previous user account permanently deleted!"
        }
    } else if (previousOwner instanceof Guest) {
        await userService.deleteGuest(previousOwner.id);
        if (previousOwner.email) {
            await mailer.sendDeletionEmail({name: resolveEmailRecipientName(previousOwner.username, previousOwner.profile?.name), address: previousOwner.email}, previousOwner);
        }
        return "Previous guest account permanently deleted!"
    }
    return '';
}

export async function deleteAccount(body: any, session: Request['session']) {
    const {username} = body;
    if (!username || (username !== session.auth?.guest?.username && username !== session.auth?.user?.username)) {
        throw new ValidationError("users/delete-account", "Invalid account deletion verification", {username});
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

export async function deactivateProfile(body: any, session: Request['session']) {
    const {name} = body;
    if (!name || name !== session.profile?.name) {
        throw new ValidationError("users/profile/delete", "Invalid profile deactivation verification", {name});
    }

    if (!session.profile) {
        throw new ExpectedError("No active profile!", "error", 401);
    }

    const previousOwner = await userService.removeProfileFromOwner(session.profile.id);
    const handleAnswer = await handlePreviousProfileOwner(previousOwner);
    return `Profile successfully deactivated. ${handleAnswer}`;
}

export async function changeActiveProfile(session: Request['session'], profileId?: string) {
    if (!session.auth?.user) {
        throw new ExpectedError("Not logged in as user!", "error", 401);
    }

    let profile;
    if (profileId) {
        profile = await userService.getProfileById(profileId);
        if (profile?.userId !== session.auth.user.id) {
            throw new ExpectedError("Invalid profile id", "error", 400);
        }
    } else {
        const profiles = await userService.getProfilesForUser(session.auth.user.id);
        if (profiles.length > 0) {
            profile = getDefaultProfile(profiles);
        } else {
            throw new ExpectedError("Invalid profile id", "error", 400);
        }
    }

    session.profile = profile;
    await persistSession(session);
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

export async function updateProfile(body: any, session: Request['session']) {
    const {name, isDefault} = body;
    const profileId = session.profile!.id;
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/view", "Invalid profile name");
    }
    if (name) {
        await userService.updateProfileName(profileId, name);
    }
    await userService.updateProfileDefault(profileId, !!isDefault);

    session.profile = await userService.getProfileById(profileId);
    await persistSession(session);
    return "Updated profile";
}

export async function getProfilesForUser(userId: number) {
    return await userService.getProfilesForUser(userId);
}

export async function createProfile(body: any, userId: number) {
    const {name} = body;
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/create", "Invalid profile name", body);
    }
    return await userService.createProfile(userId, name);
}

export function getDefaultProfile(profiles: Profile[]) {
    const sortedProfiles = profiles.toSorted((a, b) => a.track.createdAt.getTime() - b.track.createdAt.getTime())
    let profile = sortedProfiles.find(p => p.defaultForOwner);
    // No default profile --> use oldest instead.
    profile ??= sortedProfiles[0];

    return profile;
}
