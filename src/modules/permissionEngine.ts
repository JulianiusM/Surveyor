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

// src/lib/permEngine.ts
import type {EntityManager} from 'typeorm';
import type {
    Audience,
    EntityDescriptor,
    EntityPermissionQueryScope,
    ItemDescriptor,
    PermBundle,
    PermEngineCaches,
    PermType,
    PermView,
    SaveOpts,
    SessionLike,
    Subject
} from "../types/PermissionTypes";
import type {CombEntityType} from "../types/UtilTypes";
import * as entityAdminService from './database/services/EntityAdminService';
import {getProfilePerms, updatePerms} from './database/services/EntityAdminService';
import {isRegisteredForEvent} from './database/services/EventService';
import {ALL_MASK, getInitialPerms, hasPerm, PERM, toMaskFromBodyValue} from './lib/permissions';
import {jsonReplacer, normalizeToArray} from "./lib/util";

function keyUser(t: CombEntityType, id: string, profileId: string) {
    return `${t}:${id}:${profileId}`;
}

function keyEnt(t: CombEntityType, id: string) {
    return `${t}:${id}`;
}

function isOwner(
    session: SessionLike,
    ownerId?: string | null
): boolean {
    return !!(session.profile && ownerId && session.profile.id === ownerId);
}

/** Share session-audience activation between ordinary evaluation and candidate discovery. */
function activeAudiences(session: SessionLike): Exclude<Audience, 'participant'>[] {
    const audiences: Exclude<Audience, 'participant'>[] = ['public'];
    if (session.profile?.user?.id) audiences.push('authenticated');
    if (session.profile?.user?.id || session.profile?.guest?.id) audiences.push('guest');
    return audiences;
}

/**
 * Prepare one-bit discovery policy before LIMIT. Reusing audience activation prevents a
 * second interpretation of account/guest identity in SQL; participation comes from persisted
 * registrations. The normal batch evaluator remains authoritative over returned candidates.
 */
export function getEntityPermissionQueryScope(session: SessionLike, permission: PermType): EntityPermissionQueryScope {
    return {profileId: session.profile?.id ?? null, audiences: activeAudiences(session), requiredMask: PERM[permission]};
}

/** Core: compute effective mask for ONE subject (no parent) */
async function computeMaskFor(
    t: CombEntityType,
    id: string,
    ownerId: string | null | undefined,
    eventId: string | null | undefined,
    session: SessionLike,
    caches?: PermEngineCaches
): Promise<number> {
    // 0) Owner ⇒ full mask
    if (isOwner(session, ownerId)) return ALL_MASK;

    const profileId = session.profile?.id ?? null;

    // The effective ACL including all inheritances
    let eff = 0;
    eff |= await loadUserPerms(t, id, profileId, caches);

    // Load Default ACLs
    let defaults: Record<string, number> | undefined;
    const kd = keyEnt(t, id);
    if (caches?.defaults?.has(kd)) {
        defaults = caches.defaults.get(kd)!;
    } else {
        defaults = await getDefaultPerms(t, id);
        caches?.defaults?.set?.(kd, defaults);
    }

    for (const audience of activeAudiences(session)) eff |= defaults?.[audience] ?? 0;

    // Participant audience
    eff |= await loadEventParticipantPerms(eventId, profileId, defaults, caches);

    return eff;
}

async function loadUserPerms(t: CombEntityType, id: string, profileId: string | null, caches?: PermEngineCaches) {
    if (profileId) {
        const k = keyUser(t, id, profileId);
        if (caches?.userPerms?.has(k)) {
            return caches.userPerms.get(k)!;
        } else {
            const u = await getProfilePerms(t, id, profileId);
            caches?.userPerms?.set?.(k, u);
            return u;
        }
    }
    return 0;
}

async function loadEventParticipantPerms(eventId: string | null | undefined, profileId: string | null, defaults?: Record<string, number>, caches?: PermEngineCaches) {
    if (eventId) {
        let isPart: boolean | undefined = caches?.participant?.get(eventId);
        if (isPart === undefined) {
            isPart = await isRegisteredForEvent(profileId || '', eventId);
            caches?.participant?.set?.(eventId, isPart);
        }
        if (isPart && defaults?.participant) return defaults.participant;
    }
    return 0;
}

function makePermView(mask: number, parentMask: number): PermView {
    const selfHas = (k: PermType) => hasPerm(mask, PERM[k]);
    const parentHas = (k: PermType) => hasPerm(parentMask, PERM[k]);

    return {
        mask,
        parentMask,
        has: selfHas,
        allow: (k, parentKey) => {
            const parentKeys = normalizeToArray(parentKey, [k]) as PermType[];

            return selfHas(k) || parentKeys.some(parentHas);
        },
        all: (...keys) => keys.every(selfHas),
        any: (...keys) => keys.some(selfHas),
        bits: Object.fromEntries(Object.keys(PERM).map(k => [k, hasPerm(mask, (PERM as any)[k])]))
    };
}

/** Evaluate one subject (entity or item-with-parent) into a PermView */
export async function evaluateSubject(
    subject: Subject,
    session: SessionLike,
    caches?: PermEngineCaches
): Promise<PermView> {
    if (subject.kind === 'entity') {
        const m = await computeMaskFor(
            subject.entity.entityType,
            subject.entity.entityId,
            subject.entity.ownerId ?? null,
            subject.entity.eventId ?? null,
            session,
            caches
        );
        return makePermView(m, 0);
    } else {
        const parentMask = await computeMaskFor(
            subject.parent.entityType,
            subject.parent.entityId,
            subject.parent.ownerId ?? null,
            subject.parent.eventId ?? null,
            session,
            caches
        );
        const selfMask = await computeMaskFor(
            subject.item.entityType,
            subject.item.entityId,
            subject.item.ownerId ?? null,
            (subject.item.eventId ?? subject.parent.eventId ?? null),
            session,
            caches
        );
        return makePermView(selfMask, parentMask);
    }
}

/**
 * Evaluate overview roots and their parent events with the existing permission rules.
 * Preloading the inputs avoids one database round trip per card; evaluateSubject
 * remains the sole authority for combining ownership, audiences, and individual grants.
 * Return one PermView per type + ID, matching the keys used by archival presentation.
 * Descriptors must include the parent event ID for participant-audience evaluation;
 * that relationship does not itself copy the event's administrative grants to a child.
 */
export async function evaluateEntities(entities: EntityDescriptor[], session: SessionLike, manager?: EntityManager): Promise<Map<string, PermView>> {
    // The same root may occur in both dashboard collections or as several children's parent.
    // Deduplicate before loading permission rows so all callers share one result for that root.
    const entitiesByKey = new Map<string, EntityDescriptor>();
    for (const entity of entities) {
        entitiesByKey.set(keyEnt(entity.entityType, entity.entityId), entity);
    }
    const unique = Array.from(entitiesByKey.values());
    const profileId = session.profile?.id;
    const inputs = await entityAdminService.getEntityPermissionInputs(unique, profileId, manager);
    // These caches live only for this evaluation and this session. Never retain profile grants
    // or event membership globally: another viewer or a later request may have different access.
    const caches: Required<PermEngineCaches> = {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    };

    // Seed negative results as well as positive ones. The existing evaluator interprets an
    // absent cache entry as "not loaded" and would otherwise issue one fallback query per card.
    // Defaults use type:id, individual grants add profileId, and participation uses eventId.
    for (const entity of unique) {
        caches.defaults.set(keyEnt(entity.entityType, entity.entityId), {});
        if (profileId) {
            caches.userPerms.set(keyUser(entity.entityType, entity.entityId, profileId), 0);
        }
        if (entity.eventId) {
            caches.participant.set(entity.eventId, false);
        }
    }
    // Overlay only returned rows on the known-empty inputs. The service queries individual
    // grants only when profileId exists, so every row below belongs to that same active profile.
    for (const row of inputs.individual) {
        caches.userPerms.set(keyUser(row.entityType, row.entityId, profileId!), row.perms);
    }
    // One entity can have several audience rows; preserve each named audience for the normal
    // evaluator to combine according to the session rather than combining masks prematurely.
    for (const row of inputs.defaults) {
        caches.defaults.get(keyEnt(row.entityType, row.entityId))![row.audience] = row.perms;
    }
    // Registration rows contribute membership only. The participant grant itself still comes
    // from each evaluated entity's audience defaults, including when multiple children share an event.
    for (const row of inputs.registrations) {
        caches.participant.set(row.event.id, true);
    }
    // Ordinary event membership includes its owner without requiring a registration row.
    // Preserve that same rule in batches, especially when evaluating a separately owned
    // child whose participant audience is governed by this event.
    for (const event of inputs.ownedEvents) {
        caches.participant.set(event.id, true);
    }

    // With every input populated, the ordinary evaluator now consumes these caches without
    // per-card permission queries. Ownership and all grant-combination behavior stay in one place.
    const views = new Map<string, PermView>();
    for (const entity of unique) {
        const view = await evaluateSubject({kind: 'entity', entity}, session, caches);
        views.set(keyEnt(entity.entityType, entity.entityId), view);
    }
    return views;
}

/** Build bundle for an entity and all its items (view helper) */
export async function buildPermBundle(
    entity: EntityDescriptor,
    items: ItemDescriptor[],
    session: SessionLike
): Promise<PermBundle> {
    const caches: PermEngineCaches = {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    };

    const entityView = await evaluateSubject({kind: 'entity', entity}, session, caches);
    const itemMap = new Map<string, PermView>();

    for (const it of items) {
        const pv = await evaluateSubject({kind: 'item', item: it, parent: entity}, session, caches);
        itemMap.set(it.entityId, pv);
    }

    const empty = makePermView(0, entityView.mask);
    const getItem = (id: string) => itemMap.get(id) ?? empty;

    const bundle: PermBundle = {
        entity: entityView,
        items: itemMap,
        item: getItem,
        itemHas: (id: string, key: keyof typeof PERM) => getItem(id).has(key),
        itemAllow: (id: string, key: keyof typeof PERM, parentKey?: keyof typeof PERM | (keyof typeof PERM)[]) => getItem(id).allow(key, parentKey),
    };

    bundle.toJSON = () => JSON.stringify({entity: bundle.entity, items: bundle.items}, jsonReplacer);

    return bundle;
}

/** Single-place check used by middleware */
export async function can(
    subject: Subject,
    session: SessionLike,
    requiredPerm: number,
    requiredParentPerm?: number | number[]
): Promise<boolean> {
    const view = await evaluateSubject(subject, session, {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    });

    // self
    if (hasPerm(view.mask, requiredPerm)) return true;

    const parentPerms = normalizeToArray(requiredParentPerm, [requiredPerm]) as number[];

    // item: optionally allow via parent
    return 'parentMask' in view && parentPerms.some((perm) => hasPerm(view.parentMask, perm));


}

// Load current defaultPerms (bitmasks per audience) from DB
export async function getDefaultPerms(entityType: CombEntityType, entityId?: string) {
    if (!entityId) return getInitialPerms(entityType);
    return await entityAdminService.getDefaultPerms(entityType, entityId);
}

/**
 * Parse default-permission matrix from the request body and persist via updatePerms().
 * Works with both application/x-www-form-urlencoded and JSON posts from the mixin.
 *
 * Usage from a controller:
 *   await saveDefaultPermsFromBody('event', eventId, req.body);
 */
export async function saveDefaultPermsFromBody(
    entityType: CombEntityType,
    entityId: string,
    body: any,
    opts: SaveOpts = {}
): Promise<void> {
    const fieldBase = opts.fieldBase ?? 'defaultPerms';
    const audiences: Audience[] = opts.audiences ?? ['guest', 'participant', 'authenticated', 'public'];

    // The mixin posts: body[fieldBase][audience] = [ 'EDIT_META', 'EDIT_STRUCTURE', ... ]
    const src = (body?.[fieldBase]) ? body[fieldBase] : {};

    // Build the upsert payload; undefined means "leave as-is"
    const partial: { [K in Audience]?: number } = {};

    for (const aud of audiences) {
        const raw = src?.[aud];
        const mask = toMaskFromBodyValue(raw, PERM);
        if (mask === undefined) {
            if (opts.clearMissing) partial[aud] = 0; // explicit clear if requested
            // else: untouched
        } else {
            partial[aud] = mask; // set to computed mask (can be 0 if user ticked none)
        }
    }

    // Persist (upsert per audience). updatePerms ignores undefined fields.
    await updatePerms(entityType, entityId, {
        guest: partial.guest,
        participant: partial.participant,
        authenticated: partial.authenticated,
        public: partial.public,
    });
}

