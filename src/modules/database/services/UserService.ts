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

import bcrypt from 'bcryptjs';
import {EntityManager, In, MoreThan, Repository, type FindOptionsWhere, type SelectQueryBuilder} from "typeorm";
import type {ArchiveReference, PersonalVisibility} from '../../../types/ArchiveTypes';
import type {Entity, OidcClaims, OverviewCollection, OverviewQuery, OverviewReadResult, UserInfo} from "../../../types/UserTypes";
import type {EntityType} from '../../../types/UtilTypes';
import {archiveKey} from '../../archive/policy';
import {coerceLimit, convertEntity, generateUniqueToken, maskEmail, SQL_ALLOW_LIST} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {Guest} from '../entities/user/Guest';
import {Profile} from "../entities/user/Profile";
import {User} from '../entities/user/User';
import {EntityVisibilityPreference} from '../entities/archive/EntityVisibilityPreference';
import {BaseEntity} from '../entities/abstract/BaseEntity';
import {getActivityParticipationQuery} from './ActivityService';
import {getDriversParticipationQuery} from './DriverService';
import {createManagedEntityQuery} from './EntityAdminService';
import {addOverviewArchiveProjection, getArchiveSnapshot, getRootRepository} from './EntityLifecycleService';
import {getEventParticipationQuery} from './EventService';
import {getPackingParticipationQuery} from './PackingService';
import {getSurveyParticipationQuery} from './SurveyService';

export async function registerUser(username: string, name: string, password: string, email: string) {
    return await AppDataSource.transaction(async (em: EntityManager) => {
        const repo = em.getRepository(User);
        const hashed = await bcrypt.hash(password, 10);

        const user = repo.create({username, name, password: hashed, email, isActive: false});
        const result = await repo.save(user);

        const profileRepo = em.getRepository(Profile);
        const profile = profileRepo.create({name, defaultForOwner: true, user: result});
        await profileRepo.save(profile);
        return result.id;
    });
}

export async function getUserByUsername(username: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {username},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

export async function getUserByEmail(email: string) {
    return await AppDataSource.getRepository(User).findOne({
        where: {email},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

export async function verifyPassword(userId: number, password: string) {
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOne({
        where: {id: userId}, select: {
            password: true
        }
    });
    if (!user?.password) return false;
    return bcrypt.compare(password, user.password);
}

export async function generateActivationToken(userId: number) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update({id: userId}, {
        activationToken: token,
        activationTokenExpiration: expiration
    });
    return token;
}

export async function verifyActivationToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            activationToken: token,
            activationTokenExpiration: MoreThan(new Date())
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        }
    });
}

export async function activateUser(userId: number) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({id: userId}, {
        isActive: true,
        activationToken: null,
        activationTokenExpiration: null
    });
}

export async function generatePasswordResetToken(username: string) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update({username}, {
        resetToken: token,
        resetTokenExpiration: expiration
    });
    return token;
}

export async function verifyPasswordResetToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            resetToken: token,
            resetTokenExpiration: MoreThan(new Date())
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        }
    });
}

export async function resetPassword(username: string, newPassword: string) {
    const repo = AppDataSource.getRepository(User);
    const hashed = await bcrypt.hash(newPassword, 10);
    await repo.update({username}, {
        password: hashed,
        resetToken: null,
        resetTokenExpiration: null
    });
}

// Guests

export async function createGuest(username: string, email: string | null = null) {
    return await AppDataSource.transaction(async (em) => {
        const repo = em.getRepository(Guest);
        const token = generateUniqueToken();
        const guest = repo.create({username, email, token});
        const result = await repo.save(guest);

        const profileRepo = em.getRepository(Profile);
        const profile = profileRepo.create({name: username, defaultForOwner: true, guest: guest});
        const profileRes = await profileRepo.save(profile);

        if (!result.profile) {
            result.profile = profileRes;
        }

        return result;
    });
}

export async function getGuestByToken(token: string, guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    return await repo.findOne({
        where: {id: guestId, token: token},
        select: {
            id: true,
            username: true,
            email: true
        },
        relations: {
            profile: true
        }
    });
}

export async function getGuestInternal(guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    return await repo.findOne({
        where: {id: guestId},
        select: {
            id: true,
            username: true,
            email: true,
            token: true
        },
        relations: {
            profile: true
        }
    });
}

export async function getGuestLinkToken(guestId: string) {
    const guest = await getGuestInternal(guestId);
    return guest?.token || null;
}

export async function getGuestByEmail(email: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) return [];

    return await AppDataSource.getRepository(Guest)
        .createQueryBuilder('gl')
        .where('LOWER(TRIM(gl.email)) = :email', {email: normalizedEmail})
        .orderBy('gl.createdAt', 'DESC')
        .getMany();
}

/**
 * ---- SSO / OIDC helpers ----
 */

async function usernameExists(username: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(User);
    const count = await repo.count({where: {username}});
    return count > 0;
}

async function toUniqueUsername(base: string): Promise<string> {
    const sanitized = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 30) || 'user';
    if (!(await usernameExists(sanitized))) return sanitized;

    // add numeric suffix
    for (let i = 1; i < 10_000; i++) {
        const candidate = `${sanitized}-${i}`;
        if (!(await usernameExists(candidate))) return candidate;
    }
    // fallback (should never happen)
    return `${sanitized}-${Date.now()}`;
}

/**
 * Find a user by OIDC issuer+sub.
 */
export async function getUserByOidc(oidcIssuer: string, oidcSub: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {oidcIssuer, oidcSub},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

/**
 * Link an existing local user to an OIDC identity.
 * Useful if you want a one-time “Connect SSO” button.
 */
export async function linkUserToOidc(
    userId: number,
    oidcIssuer: string,
    oidcSub: string
) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({id: userId}, {oidcIssuer, oidcSub});
}

/**
 * Find or create a user from OIDC claims.
 * - Primary key: (issuer, sub)
 * - Optional fallback: email match (link existing local account)
 * - JIT-provisions a new user when needed.
 */
export async function findOrCreateUserFromOidc(
    oidcIssuer: string,
    claims: OidcClaims,
    {linkByEmail = true} = {}
) {
    const repo = AppDataSource.getRepository(User);
    const {sub, email, preferred_username, name} = claims;

    // 1) Try exact OIDC match first
    let user = await repo.findOne({
        where: {oidcIssuer, oidcSub: sub},
        relations: {profiles: true},
    });

    // 2) If not found: try link-by-email (optional)
    if (!user && linkByEmail && email) {
        user = await repo.findOne({where: {email}, relations: {profiles: true}});
        if (user) {
            user.oidcIssuer = oidcIssuer;
            user.oidcSub = sub;
            if (user.isActive !== true) user.isActive = true;
            await repo.save(user);
        }
    }

    // 3) If still not found: create a new local user (JIT provisioning)
    // inside findOrCreateUserFromOidc, in the "3) If still not found: create a new local user" block
    if (!user) {
        const baseUsername =
            preferred_username ||
            (email ? email.split('@')[0] : `oidc_${sub.slice(0, 8)}`);
        const uniqueUsername = await toUniqueUsername(baseUsername);

        // Ensure we don't violate unique(email)
        let emailToUse = email || `${sub}@no-email.local`;

        // If linkByEmail is disabled OR the email is already taken, use a synthetic email
        if (email) {
            const emailTaken = await repo.exists({where: {email}});
            if (!linkByEmail || emailTaken) {
                emailToUse = `${sub}@no-email.local`;
            }
        }

        return await AppDataSource.transaction(async (em) => {
            const newUsr = em.getRepository(User).create({
                username: uniqueUsername,
                name: name || baseUsername,
                email: emailToUse,
                password: null,
                isActive: true,
                oidcIssuer,
                oidcSub: sub,
            });
            const newProfile = em.getRepository(Profile).create({
                name: newUsr.name,
                defaultForOwner: true,
                user: newUsr
            });
            const savedProfile = await em.getRepository(Profile).save(newProfile);
            user = await handleUserSaving(newUsr, sub, em.getRepository(User));
            if (!user.profiles || user.profiles.length === 0) {
                user.profiles = [savedProfile];
            }

            return user;
        });
    }

    return user;
}

async function handleUserSaving(user: User, sub: string, repo?: Repository<User>) {
    repo ??= AppDataSource.getRepository(User);
    try {
        user = await repo.save(user);
    } catch (err: any) {
        // Last-chance fallback for race conditions (MySQL/PG/SQLite)
        const message = String(err?.message || '');
        if (
            err?.code === 'ER_DUP_ENTRY' || // MySQL/MariaDB
            err?.code === '23505' ||        // Postgres
            message.includes('UNIQUE')      // SQLite/others
        ) {
            user.email = `${sub}@no-email.local`;
            user = await repo.save(user);
        } else {
            throw err;
        }
    }
    return user;
}

/**
 * Optional: remove OIDC link (keeps the local account).
 */
export async function unlinkOidc(userId: number) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({id: userId}, {oidcIssuer: null, oidcSub: null});
}

/**
 * Resolve by id | email | username.
 * Use only behind a permission check to avoid enumeration leaks.
 */
export async function findUserByNameOrEmail(identifier: string | number): Promise<User | null> {
    const repo = AppDataSource.getRepository(User);
    const raw = String(identifier).trim();

    if (/^\d+$/.test(raw)) {
        return await repo.findOne({where: {id: Number(raw)}});
    }

    if (raw.includes('@')) {
        // case-insensitive email; avoid LOWER() on column to keep indexes usable where possible
        return await repo
            .createQueryBuilder('u')
            .where('u.email = :email', {email: raw})
            .orWhere('u.email LIKE :emailCase', {emailCase: raw}) // fallback for case-insensitive collations
            .orWhere('u.username = :username', {username: raw})
            .getOne();
    }

    // username exact, email fallback
    return await repo
        .createQueryBuilder('u')
        .where('u.username = :username', {username: raw})
        .orWhere('u.email = :email', {email: raw})
        .getOne();
}

/**
 * Prefix search for username/email (index-friendly). Validates the query.
 * Returns { id, username, emailMasked } (no raw email by default).
 */
export async function searchUsersSecure(query: string, limit = 10): Promise<Array<UserInfo>> {
    const repo = AppDataSource.getRepository(Profile);
    const q = (query || '').trim();

    if (!SQL_ALLOW_LIST.test(q)) return [];            // too short / invalid chars -> no results
    const lim = coerceLimit(limit, 10, 25);

    const likePrefix = `${q}%`;

    const rows = await repo
        .createQueryBuilder('p')
        .innerJoinAndSelect('p.user', 'u')
        .where('p.name LIKE :pfx', {pfx: likePrefix})
        .orWhere('u.email LIKE :pfx', {pfx: likePrefix})
        .orWhere('u.username LIKE :pfx', {pfx: likePrefix})
        .orderBy('p.name', 'ASC')
        .limit(lim)
        .getMany();

    function doMailMask(p: Profile) {
        let maskedMail = '-';
        if (p.user?.email) {
            maskedMail = maskEmail(p.user.email);
        } else if (p.guest?.email) {
            maskedMail = maskEmail(p.guest.email);
        }
        return maskedMail;
    }

    return rows.map(p => ({
        id: p.id,
        username: p.user?.username ?? p.guest?.username ?? '-',
        email: doMailMask(p),
        name: p.name
    }));
}

/** Optional helpers you might find useful elsewhere */
export async function getUserById(id: number): Promise<User | null> {
    return await AppDataSource.getRepository(User).findOne({where: {id}, relations: {profiles: true}});
}

export async function getProfileById(id: string) {
    return await AppDataSource.getRepository(Profile).findOneBy({id});
}

export async function getProfilesByIds(ids: string[], manager: EntityManager = AppDataSource.manager): Promise<Pick<Profile, 'id' | 'name'>[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) return [];
    return await manager.getRepository(Profile).find({
        where: {id: In(uniqueIds)},
        select: {id: true, name: true},
    });
}

// The feature services own participation rules. Reuse their queries for the
// profile's single-target check instead of duplicating predicates or loading a dashboard.
// In particular, participation differs by feature (registrations, assignments or
// responses); private visibility must follow those existing definitions exactly.
const participationQueries = {
    activity: getActivityParticipationQuery,
    drivers: getDriversParticipationQuery,
    event: getEventParticipationQuery,
    packing: getPackingParticipationQuery,
    survey: getSurveyParticipationQuery,
};

// These limits describe rendered pages, never the total number of memberships.
// Four regions can be requested together, each with at most 24 cards or a parent
// and 24 children. No caller can request an unbounded dashboard through this API.
const OVERVIEW_PAGE_SIZE = 24;
const OVERVIEW_TYPES: EntityType[] = ['survey', 'activity', 'packing', 'drivers', 'event'];

/** SQL composition and raw rows stay private to this persistence module. */
interface OverviewSql {
    sql: string;
    parameters: unknown[];
}

interface OverviewRootRow {
    id: string;
    type: EntityType;
    eventId: string | null;
    visibility: 'HIDDEN' | 'SHOWN' | null;
}

interface OverviewDisplayRow {
    id: string;
    title: string;
    description: string | null;
    headerImg: string | null;
    ownerId: string;
}

interface OverviewTypeCount {
    type: EntityType;
    overviewHidden: number | string;
    total: number | string;
}

interface OverviewChildCount {
    eventId: string;
    total: number | string;
    matching: number | string;
}

/** Reuse exactly the predicates also used to authorize personal visibility writes. */
function overviewMembershipQuery(manager: EntityManager, profileId: string, collection: OverviewCollection, type: EntityType): SelectQueryBuilder<BaseEntity> {
    if (collection === 'owner') {
        return createManagedEntityQuery(getRootRepository(manager, type), type, profileId);
    }
    return participationQueries[type](profileId, manager) as SelectQueryBuilder<BaseEntity>;
}

/**
 * Project memberships to a common SQL shape without hydrating their relations.
 * Compile each builder independently: managed builders reuse parameter names
 * across types, and concatenating their named parameters would overwrite them.
 * Positional parameters preserve each branch's own type/profile values.
 */
function overviewRootQuery(manager: EntityManager, profileId: string, collection: OverviewCollection, type: EntityType, input: OverviewQuery, parent = false): SelectQueryBuilder<BaseEntity> {
    const query = overviewMembershipQuery(manager, profileId, collection, type);
    const alias = query.alias;
    // UUIDs contain ASCII only. Keep their temporary-table representation narrow;
    // retaining the root tables' utf8mb4 allocation spills large unions to disk.
    // The parent lookup keeps its primary-key expression unwrapped so MariaDB
    // can use an indexed join rather than scanning every event for each child.
    query.select(parent ? `${alias}.id` : `CONVERT(${alias}.id USING ascii)`, 'id')
        .addSelect(':overviewCardType', 'type')
        .leftJoin(EntityVisibilityPreference, 'overviewPreference',
            `overviewPreference.profile_id = :overviewActor AND overviewPreference.entity_type = :overviewCardType AND overviewPreference.entity_id = ${alias}.id`)
        .addSelect('overviewPreference.visibility', 'visibility')
        .setParameters({overviewCardType: type, overviewActor: profileId});
    addOverviewArchiveProjection(query, type);
    addOverviewMatchProjection(query, type, input);
    return query;
}

function overviewSource(manager: EntityManager, profileId: string, input: OverviewQuery): OverviewSql {
    const branches: string[] = [];
    const parameters: unknown[] = [];
    for (const type of OVERVIEW_TYPES) {
        const query = overviewRootQuery(manager, profileId, input.collection, type, input);
        const [sql, branchParameters] = query.getQueryAndParameters();
        branches.push(sql);
        parameters.push(...branchParameters);
    }

    // Parent membership is a small event-only relation. Joining the complete
    // heterogeneous union again would materialize every child a second time.
    const eventQuery = overviewRootQuery(manager, profileId, input.collection, 'event', input, true);
    const [eventSql, eventParameters] = eventQuery.getQueryAndParameters();
    parameters.push(...eventParameters);
    // This is the single SQL translation of isHiddenInOverview. Parent preference
    // does not occur here: only shared parent archival affects a child's default.
    return {
        sql: `WITH overview_roots AS (${branches.join('\nUNION ALL\n')}),
            overview_eligible AS (${overviewPlacementSql('overview_roots')}),
            overview_event_roots AS (${eventSql}),
            overview_events AS (${overviewPlacementSql('overview_event_roots')})`,
        parameters,
    };
}

function overviewPlacementSql(source: string): string {
    // source is one of the private CTE identifiers above, never request input.
    return `SELECT ${source}.*,
        CASE WHEN visibility = 'HIDDEN' THEN 1
             WHEN visibility = 'SHOWN' THEN 0
             ELSE effectiveArchived END AS overviewHidden FROM ${source}`;
}

/**
 * Compute search as a boolean while reading the root, before UNION materialization.
 * Copying TEXT descriptions into temporary tables forced disk-backed work even
 * for a 24-card page. Only matching and identity fields belong in this stage;
 * even titles are loaded after grouping so wide strings cannot inflate it.
 */
function addOverviewMatchProjection(builder: SelectQueryBuilder<BaseEntity>, type: EntityType, query: OverviewQuery): void {
    const alias = builder.alias;
    const conditions: string[] = [];
    if (query.type !== 'all' && query.type !== type) {
        builder.addSelect('0', 'matches');
        return;
    }
    if (query.q) {
        // Use an explicit escape character rather than depending on the server's
        // NO_BACKSLASH_ESCAPES mode. A user's percent/underscore is ordinary text.
        const pattern = `%${query.q.toLowerCase().replace(/[!%_]/g, '!$&')}%`;
        conditions.push(`(
            LOWER(CONVERT(${alias}.title USING utf8mb4)) COLLATE utf8mb4_bin LIKE :overviewPattern ESCAPE '!'
            OR LOWER(CONVERT(COALESCE(${alias}.description, '') USING utf8mb4)) COLLATE utf8mb4_bin LIKE :overviewPattern ESCAPE '!'
            OR CONVERT(:overviewCardType USING utf8mb4) COLLATE utf8mb4_bin LIKE :overviewPattern ESCAPE '!'
        )`);
        builder.setParameter('overviewPattern', pattern);
    }
    builder.addSelect(conditions.length ? conditions.join(' AND ') : '1', 'matches');
}

function overviewRegionSource(source: OverviewSql, query: OverviewQuery): OverviewSql {
    return {
        sql: `${source.sql}, overview_region AS (
            SELECT * FROM overview_eligible WHERE overviewHidden = ?
        ), overview_parent_region AS (
            SELECT * FROM overview_events WHERE overviewHidden = ?
        )`,
        parameters: [...source.parameters, query.region === 'hidden' ? 1 : 0, query.region === 'hidden' ? 1 : 0],
    };
}

/**
 * A child is represented by its event only when that event is independently in
 * this same collection and visibility region. Search applies to underlying roots;
 * an event can therefore remain as navigation to a matching child. This mapping
 * occurs before the mixed-grid LIMIT, so large events occupy one overview slot.
 */
function overviewRepresentativeSource(source: OverviewSql): OverviewSql {
    return {
        sql: `${source.sql}, overview_matches AS (
            SELECT item.* FROM overview_region item WHERE item.matches = 1
        ), overview_representatives AS (
            SELECT CASE WHEN parent.id IS NULL THEN item.id ELSE parent.id END AS id,
                CASE WHEN parent.id IS NULL THEN item.type ELSE parent.type END AS type,
                CASE WHEN parent.id IS NULL THEN item.eventId ELSE NULL END AS eventId,
                CASE WHEN parent.id IS NULL THEN item.visibility ELSE parent.visibility END AS visibility
            FROM overview_matches item
            LEFT JOIN overview_parent_region parent ON parent.id = item.eventId
        ), overview_cards AS (
            SELECT id, type, eventId, visibility, COUNT(*) AS matchingCount
            FROM overview_representatives GROUP BY id, type, eventId, visibility
        )`,
        parameters: source.parameters,
    };
}

function clampOverviewPage(page: number, count: number): number {
    return Math.max(1, Math.min(page, Math.ceil(count / OVERVIEW_PAGE_SIZE)));
}

function overviewCard(row: OverviewRootRow & OverviewDisplayRow, visibility: Map<string, PersonalVisibility>): Entity {
    const card = convertEntity(row, row.type);
    const preference = row.visibility === 'HIDDEN' ? 'hidden' : row.visibility === 'SHOWN' ? 'shown' : 'default';
    visibility.set(archiveKey(card), preference);
    return card;
}

/** Load full display fields only for a selected page, in at most one query per type. */
async function loadOverviewCards(manager: EntityManager, rows: OverviewRootRow[], visibility: Map<string, PersonalVisibility>): Promise<Entity[]> {
    const fields = new Map<string, OverviewDisplayRow>();
    for (const type of OVERVIEW_TYPES) {
        const ids: string[] = [];
        for (const row of rows) if (row.type === type) ids.push(row.id);
        if (!ids.length) continue;
        const displayRows = await getRootRepository(manager, type).createQueryBuilder('display')
            .select('display.id', 'id').addSelect('display.title', 'title')
            .addSelect('display.description', 'description').addSelect('display.header_img', 'headerImg')
            .addSelect('display.owner_id', 'ownerId')
            .where('display.id IN (:...ids)', {ids}).getRawMany<OverviewDisplayRow>();
        for (const row of displayRows) fields.set(archiveKey({type, id: row.id}), row);
    }
    const cards: Entity[] = [];
    for (const row of rows) {
        const display = fields.get(archiveKey(row));
        if (display) cards.push(overviewCard({...row, ...display}, visibility));
    }
    return cards;
}

/**
 * Sort representative identities using indexed root lookups after grouping.
 * Keeping title strings outside the membership union avoids large temporary
 * tables for profiles with many linked children. Type-qualified joins preserve
 * polymorphic identities even when two root tables contain the same UUID.
 */
function overviewCardPage(manager: EntityManager, query: OverviewQuery, children = false): OverviewSql {
    const page = manager.createQueryBuilder().select('card.*')
        .from(children ? 'overview_region' : 'overview_cards', 'card');
    const titles: string[] = [];
    for (const type of OVERVIEW_TYPES) {
        const alias = `overviewTitle_${type}`;
        const parameter = `overviewTitleType_${type}`;
        page.leftJoin(getRootRepository(manager, type).metadata.tablePath, alias,
            `card.type = :${parameter} AND ${alias}.id = card.id`, {[parameter]: type});
        titles.push(`${alias}.title`);
    }
    const title = `COALESCE(${titles.join(', ')})`;
    page.orderBy(`LOWER(CONVERT(${title} USING utf8mb4)) COLLATE utf8mb4_bin`)
        .addOrderBy('card.type').addOrderBy('card.id')
        .limit(OVERVIEW_PAGE_SIZE)
        .offset(((children ? query.childPage : query.page) - 1) * OVERVIEW_PAGE_SIZE);
    if (children) page.where('card.eventId = :overviewSelectedEvent AND card.matches = 1', {overviewSelectedEvent: query.eventId});
    const [sql, parameters] = page.getQueryAndParameters();
    return {sql, parameters};
}

/** Count only eligible children of the bounded set of displayed event cards. */
async function overviewChildCounts(manager: EntityManager, source: OverviewSql, eventIds: string[]): Promise<Map<string, OverviewChildCount>> {
    const counts = new Map<string, OverviewChildCount>();
    if (!eventIds.length) return counts;
    const placeholders = eventIds.map(() => '?').join(', ');
    const rows = await manager.query<OverviewChildCount[]>(`${source.sql}
        SELECT child.eventId, COUNT(*) AS total, SUM(child.matches) AS matching
        FROM overview_region child WHERE child.eventId IN (${placeholders}) GROUP BY child.eventId`,
    [...source.parameters, ...eventIds]);
    for (const row of rows) counts.set(row.eventId, row);
    return counts;
}

/** Read one surface using a caller-owned transaction, never an event's full relations. */
async function readOverviewRegion(manager: EntityManager, profileId: string, input: OverviewQuery): Promise<OverviewReadResult> {
    // Navigation is validated and normalized by userController before this DBAL call.
    // Keep a local copy because bounded pagination adjusts page numbers in the read result.
    const query = {...input};
    const source = overviewSource(manager, profileId, query);
    const region = overviewRegionSource(source, query);
    const representatives = overviewRepresentativeSource(region);
    const counts = await manager.query<OverviewTypeCount[]>(`${source.sql}
        SELECT type, overviewHidden, COUNT(*) AS total FROM overview_eligible GROUP BY type, overviewHidden`, source.parameters);
    const result: OverviewReadResult = {
        query, items: [], collectionTotal: 0, hiddenTotal: 0, regionTotal: 0,
        matchingTotal: 0, cardTotal: 0, childTotal: 0, types: [], pageSize: OVERVIEW_PAGE_SIZE,
        archiveSnapshot: new Map(), visibility: new Map(), contextEvents: [],
    };
    for (const count of counts) {
        const total = Number(count.total);
        const hidden = Number(count.overviewHidden) === 1;
        result.collectionTotal += total;
        if (hidden) result.hiddenTotal += total;
        if (hidden === (query.region === 'hidden')) {
            result.regionTotal += total;
            result.types.push(count.type);
        }
    }
    // Empty collections need no representative or card queries. Counts still let
    // the renderer distinguish a genuinely empty collection from hidden content.
    if (!result.regionTotal) {
        result.query = {...query, page: 1, childPage: 1, eventId: undefined};
        return result;
    }

    const totals = await manager.query<Array<{matchingTotal: number | string; cardTotal: number | string}>>(`${representatives.sql}
        SELECT COALESCE(SUM(matchingCount), 0) AS matchingTotal, COUNT(*) AS cardTotal
        FROM overview_cards`, representatives.parameters);
    result.matchingTotal = Number(totals[0].matchingTotal);
    result.cardTotal = Number(totals[0].cardTotal);
    query.page = clampOverviewPage(query.page, result.cardTotal);

    if (query.eventId) {
        // A stale/forged selection cannot act as a container. Its surviving
        // children naturally reappear in the mixed grid through the same query.
        const parents = await manager.query<OverviewRootRow[]>(`${region.sql}
            SELECT * FROM overview_parent_region WHERE id = ? LIMIT 1`,
        [...region.parameters, query.eventId]);
        if (parents.length) {
            [result.event] = await loadOverviewCards(manager, parents, result.visibility);
            const childCounts = await overviewChildCounts(manager, region, [query.eventId]);
            const count = childCounts.get(query.eventId);
            const matching = Number(count?.matching ?? 0);
            result.childTotal = Number(count?.total ?? 0);
            result.event.overview = {total: result.childTotal, matching};
            query.childPage = clampOverviewPage(query.childPage, matching);
            const page = overviewCardPage(manager, query, true);
            const rows = await manager.query<OverviewRootRow[]>(`${region.sql} ${page.sql}`, [...region.parameters, ...page.parameters]);
            result.items = await loadOverviewCards(manager, rows, result.visibility);
            return result;
        }
        query.eventId = undefined;
    }

    query.childPage = 1;
    const page = overviewCardPage(manager, query);
    const rows = await manager.query<OverviewRootRow[]>(`${representatives.sql} ${page.sql}`, [...representatives.parameters, ...page.parameters]);
    const eventIds: string[] = [];
    result.items = await loadOverviewCards(manager, rows, result.visibility);
    for (const card of result.items) {
        if (card.type === 'event') eventIds.push(card.id);
    }
    const childCounts = await overviewChildCounts(manager, region, eventIds);
    for (const card of result.items) {
        const count = card.type === 'event' ? childCounts.get(card.id) : undefined;
        if (count) card.overview = {total: Number(count.total), matching: Number(count.matching)};
    }
    return result;
}

/**
 * Read only bounded card pages and their lifecycle inputs in a common snapshot.
 * Context parents are presentation inputs, never additional overview members;
 * the controller must check their ACCESS_VIEW before revealing a title/link.
 */
export async function getOverviewPages(profileId: string, queries: OverviewQuery[]): Promise<OverviewReadResult[]> {
    async function readPages(manager: EntityManager): Promise<OverviewReadResult[]> {
        const results: OverviewReadResult[] = [];
        const references: ArchiveReference[] = [];
        const contextIds = new Set<string>();
        // Sequential reads share one connection/snapshot; parallel transaction
        // queries do not gain database concurrency and obscure read ordering.
        for (const query of queries) {
            const result = await readOverviewRegion(manager, profileId, query);
            results.push(result);
            for (const item of result.items) {
                references.push(item);
                if (item.eventId) contextIds.add(item.eventId);
            }
            if (result.event) references.push(result.event);
        }
        const archives = await getArchiveSnapshot(references, manager);
        const contextEvents: Entity[] = [];
        if (contextIds.size) {
            const parents = await getRootRepository(manager, 'event').createQueryBuilder('parent')
                .select('parent.id', 'id').addSelect('parent.title', 'title').addSelect('parent.owner_id', 'ownerId')
                .where('parent.id IN (:...ids)', {ids: Array.from(contextIds)}).getRawMany<Pick<OverviewDisplayRow, 'id' | 'title' | 'ownerId'>>();
            for (const parent of parents) contextEvents.push(convertEntity(parent, 'event'));
        }
        for (const result of results) {
            result.archiveSnapshot = archives;
            result.contextEvents = contextEvents;
        }
        return results;
    }
    return AppDataSource.transaction('REPEATABLE READ', readPages);
}

export async function isOverviewMember(profileId: string, ref: ArchiveReference, manager: EntityManager): Promise<boolean> {
    // Either overview permits a private choice. The managed query already includes
    // ownership and explicit administration assignments, so do not reduce
    // this to an owner check or accept an arbitrary entity just because it is viewable.
    const repository = getRootRepository(manager, ref.type);
    const managed = createManagedEntityQuery(repository, ref.type, profileId)
        .andWhere('entity.id = :overviewEntityId', {overviewEntityId: ref.id});
    if (await managed.getExists()) {
        return true;
    }

    // Use the same transaction manager as the preference write. The query's existing
    // joins/predicates remain the single source of truth for current participation.
    const participation = participationQueries[ref.type](profileId, manager);
    participation.andWhere(`${participation.alias}.id = :overviewEntityId`, {overviewEntityId: ref.id});
    return participation.getExists();
}

/**
 * Personal visibility belongs to a profile, not to shared entity state.
 * Only apply preferences to entities already discovered through current membership;
 * a retained preference must never create a card or grant access on its own.
 * Root IDs are polymorphic, so a normal domain DELETE can leave a preference row.
 * That row has no visible effect without an existing, discovered root; newly created
 * or duplicated entities receive fresh UUIDs. Deleting the profile removes its rows
 * through the profile foreign key. Do not use this table to discover overview entities.
 */
export async function getVisibilityPreferences(profileId: string, refs: ArchiveReference[]): Promise<Map<string, PersonalVisibility>> {
    // Administration and participation may contain the same root. Resolve its one
    // profile-specific choice once, then apply it to both existing appearances.
    const unique = new Map<string, ArchiveReference>();
    for (const ref of refs) {
        unique.set(archiveKey(ref), ref);
    }
    const references = Array.from(unique.values());
    const preferences = new Map<string, PersonalVisibility>();
    const repository = AppDataSource.getRepository(EntityVisibilityPreference);

    // Bound the OR conditions for large overviews. Each condition includes the profile
    // and the complete type/id pair; separate IN lists could match unintended pairs.
    // An empty reference list naturally performs no query and returns no preferences.
    for (let offset = 0; offset < references.length; offset += 250) {
        const targets: FindOptionsWhere<EntityVisibilityPreference>[] = [];
        for (const ref of references.slice(offset, offset + 250)) {
            targets.push({profile: {id: profileId}, entityType: ref.type, entityId: ref.id});
        }
        const rows = await repository.find({where: targets});
        for (const row of rows) {
            // Translate the storage enum at this boundary. Missing map entries mean
            // 'default'; callers do not need to know how explicit choices are stored.
            const key = archiveKey({type: row.entityType, id: row.entityId});
            preferences.set(key, row.visibility === 'HIDDEN' ? 'hidden' : 'shown');
        }
    }
    return preferences;
}

/** Write the caller-normalized personal preference using the supplied transaction. */
export async function setVisibility(profileId: string, ref: ArchiveReference, visibility: PersonalVisibility, manager: EntityManager = AppDataSource.manager): Promise<void> {
    const repository = manager.getRepository(EntityVisibilityPreference);
    const target = {entityType: ref.type, entityId: ref.id, profile: {id: profileId}};
    // Absence is the storage representation of the default. The compound identity ensures
    // this statement cannot remove another profile's preference or any shared entity data.
    if (visibility === 'default') {
        await repository.delete(target);
        return;
    }
    const storedVisibility = visibility === 'hidden' ? 'HIDDEN' : 'SHOWN';
    await repository.upsert({...target, visibility: storedVisibility}, ['profile', 'entityType', 'entityId']);
}

export async function generateMigrationToken(profileId: string) {
    const repo = AppDataSource.getRepository(Profile);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + (3_600_000 * 24));
    await repo.update({id: profileId}, {
        migrationToken: token,
        migrationTokenExpiration: expiration
    });
    return token;
}

export async function verifyMigrationToken(token: string) {
    const repo = AppDataSource.getRepository(Profile);
    return await repo.findOne({
        where: {
            migrationToken: token,
            migrationTokenExpiration: MoreThan(new Date())
        },
        relations: {
            user: true,
            guest: true,
        }
    });
}

export async function addProfileToUser(profileId: string, userId: number, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {
        user: {id: userId},
    })
}

export async function removeProfileFromOwner(profileId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    const profile = await repo.findOne({where: {id: profileId}, relations: {user: true, guest: true}});
    let owner;
    if (profile?.user) {
        owner = profile.user;
        await repo.update({id: profileId}, {user: null, defaultForOwner: false});
    } else if (profile?.guest) {
        owner = profile.guest;
        await repo.update({id: profileId}, {guest: null, defaultForOwner: false});
    }

    return owner;
}

export async function removeMigrationToken(profileId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {migrationToken: null, migrationTokenExpiration: null});
}

export async function moveProfileToUserTx(profileId: string, userId: number) {
    return await AppDataSource.transaction(async em => {
        const owner = await removeProfileFromOwner(profileId, em);
        await addProfileToUser(profileId, userId, em);
        await removeMigrationToken(profileId, em);
        return owner;
    })
}

export async function deleteUser(userId: number) {
    const repo = AppDataSource.getRepository(User);
    const deleted = await repo.findOneBy({id: userId});
    await repo.delete({id: userId});
    return deleted;
}

export async function deleteGuest(guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    const deleted = await repo.findOneBy({id: guestId});
    await repo.delete({id: guestId});
    return deleted;
}

export async function getProfilesForUser(userId: number) {
    const repo = AppDataSource.getRepository(Profile);
    return await repo.findBy({user: {id: userId}});
}

export async function updateProfileName(profileId: string, name: string) {
    const repo = AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {name: name});
}

export async function updateProfileDefault(profileId: string, isDefault: boolean) {
    await AppDataSource.transaction(async em => {
        const repo = em.getRepository(Profile);
        if (isDefault) {
            // Remove all other defaults for the owner of this profile if a new one is set
            const profile = await repo.findOneByOrFail({id: profileId});
            if (profile.userId) {
                await repo.update({user: {id: profile.userId}}, {defaultForOwner: false});
            }
            if (profile.guestId) {
                await repo.update({guest: {id: profile.guestId}}, {defaultForOwner: false});
            }
        }
        await repo.update({id: profileId}, {defaultForOwner: isDefault});
    })
}

export async function createProfile(userId: number, name: string) {
    const repo = AppDataSource.getRepository(Profile);
    const profile = repo.create({user: {id: userId}, name: name});
    return await repo.save(profile);
}
