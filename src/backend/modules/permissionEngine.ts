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
} from "../../types/PermissionTypes";
import type {CombEntityType, EntityType} from "../../types/UtilTypes";
import type {EntityPropertyField} from '../../types/EntityPropertyTypes';
import type {EventMethod} from '../../types/EventTypes';
import {APIError} from './lib/errors';
import * as entityAdminService from './database/services/EntityAdminService';
import {getProfilePerms, updatePerms} from './database/services/EntityAdminService';
import {isRegisteredForEvent} from './database/services/EventService';
import {ALL_MASK, getInitialPerms, getPermMeta, getPresets, hasPerm, PERM, toMaskFromBodyValue} from './lib/permissions';
import {jsonReplacer, normalizeToArray, sameUuid, uuidKey} from "./lib/util";

function keyUser(t: CombEntityType, id: string, profileId: string) {
    return `${t}:${uuidKey(id)}:${uuidKey(profileId)}`;
}

/** Key permission evidence by subject type and the shared UUID identity.
 * Numeric item IDs retain their spelling; opaque comparison tokens never enter this key. */
export function entityPermissionKey(t: CombEntityType, id: string): string {
    return `${t}:${uuidKey(id)}`;
}

/**
 * Ownership belongs to the active profile, whether it belongs to an account or a guest.
 * Reuse this pure predicate for owner-only operations; an effective permission mask does
 * not distinguish ownership from administrator grants and must not authorize deletion.
 */
export function isOwner(
    session: SessionLike,
    ownerId?: string | null
): boolean {
    return !!(session.profile && sameUuid(session.profile.id, ownerId));
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

/** Combine one subject's owner, individual and active-audience grants without
 * importing its parent's mask. Caches belong to this actor's evaluation; a supplied
 * manager keeps uncached reads inside the caller's authorization transaction. */
async function computeMaskFor(
    t: CombEntityType,
    id: string,
    ownerId: string | null | undefined,
    eventId: string | null | undefined,
    session: SessionLike,
    caches?: PermEngineCaches,
    manager?: EntityManager,
): Promise<number> {
    // 0) Owner ⇒ full mask
    if (isOwner(session, ownerId)) return ALL_MASK;

    const profileId = session.profile?.id ?? null;

    // Individual grants accumulate with audience defaults; neither source overrides
    // the other. A missing profile contributes no individual permission lookup.
    let eff = 0;
    eff |= await loadUserPerms(t, id, profileId, caches, manager);

    // Reuse this subject's defaults within the evaluation, including an empty result.
    // An uncached lookup uses the same manager as its individual/participant reads.
    let defaults: Record<string, number> | undefined;
    const kd = entityPermissionKey(t, id);
    if (caches?.defaults?.has(kd)) {
        defaults = caches.defaults.get(kd)!;
    } else {
        defaults = await getDefaultPerms(t, id, manager);
        caches?.defaults?.set?.(kd, defaults);
    }

    for (const audience of activeAudiences(session)) eff |= defaults?.[audience] ?? 0;

    // Participation activates this subject's own participant default. It does not
    // import administrative permissions from the associated event.
    eff |= await loadEventParticipantPerms(eventId, profileId, defaults, caches, manager);

    return eff;
}

/** Read only this profile's named grant for the selected subject. Cache keys include
 * subject type, ID and profile; uncached reads retain the caller's optional manager. */
async function loadUserPerms(t: CombEntityType, id: string, profileId: string | null, caches?: PermEngineCaches, manager?: EntityManager) {
    // Anonymous sessions cannot have a profile-specific grant. Preserve a cached
    // zero as a loaded result rather than repeatedly querying an absent ACL row.
    if (profileId) {
        const k = keyUser(t, id, profileId);
        if (caches?.userPerms?.has(k)) {
            return caches.userPerms.get(k)!;
        } else {
            // Publish the DBAL result only in this evaluation's caller-owned cache.
            // Passing the manager preserves the locked command's read boundary.
            const u = await getProfilePerms(t, id, profileId, manager);
            caches?.userPerms?.set?.(k, u);
            return u;
        }
    }
    return 0;
}

/** Activate the subject's participant audience through the existing event-membership
 * rule. The event-only cache is valid for one actor's evaluation; it stores membership,
 * while each subject still supplies its own participant permission mask. */
async function loadEventParticipantPerms(eventId: string | null | undefined, profileId: string | null, defaults?: Record<string, number>, caches?: PermEngineCaches, manager?: EntityManager) {
    // A standalone subject has no event-derived participant audience. For linked
    // subjects, false is a complete cached membership result, not a cache miss.
    if (eventId) {
        const key = uuidKey(eventId);
        let isPart: boolean | undefined = caches?.participant?.get(key);
        if (isPart === undefined) {
            // Use the shared membership owner, including its event-owner rule, in
            // the same transaction as any other uncached permission inputs.
            isPart = await isRegisteredForEvent(profileId || '', eventId, manager);
            caches?.participant?.set?.(key, isPart);
        }
        // Membership alone grants no bit: the evaluated subject must define it.
        if (isPart && defaults?.participant) return defaults.participant;
    }
    return 0;
}

/** Expose separate subject/parent masks through the established permission predicates. */
function makePermView(mask: number, parentMask: number): PermView {
    // Capture both raw masks; only allow() consults caller-selected parent fallbacks.
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

/** Evaluate a root or an item with its parent into separate permission masks.
 * Shared actor-scoped caches avoid repeated reads; the optional manager reaches
 * both masks so locked callers do not mix transaction and application snapshots. */
export async function evaluateSubject(
    subject: Subject,
    session: SessionLike,
    caches?: PermEngineCaches,
    manager?: EntityManager,
): Promise<PermView> {
    // A root has no parent fallback. Item callers receive both masks and select
    // their operation's permitted fallback through PermView rather than merging ACLs.
    if (subject.kind === 'entity') {
        const m = await computeMaskFor(
            subject.entity.entityType,
            subject.entity.entityId,
            subject.entity.ownerId ?? null,
            subject.entity.eventId ?? null,
            session,
            caches, manager
        );
        return makePermView(m, 0);
    } else {
        // Evaluate parent and item independently. An item may use its parent's
        // event membership without inheriting every parent permission bit.
        const parentMask = await computeMaskFor(
            subject.parent.entityType,
            subject.parent.entityId,
            subject.parent.ownerId ?? null,
            subject.parent.eventId ?? null,
            session,
            caches, manager
        );
        const selfMask = await computeMaskFor(
            subject.item.entityType,
            subject.item.entityId,
            subject.item.ownerId ?? null,
            (subject.item.eventId ?? subject.parent.eventId ?? null),
            session,
            caches, manager
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
        entitiesByKey.set(entityPermissionKey(entity.entityType, entity.entityId), entity);
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
        caches.defaults.set(entityPermissionKey(entity.entityType, entity.entityId), {});
        if (profileId) {
            caches.userPerms.set(keyUser(entity.entityType, entity.entityId, profileId), 0);
        }
        if (entity.eventId) {
            caches.participant.set(uuidKey(entity.eventId), false);
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
        caches.defaults.get(entityPermissionKey(row.entityType, row.entityId))![row.audience] = row.perms;
    }
    // Registration rows contribute membership only. The participant grant itself still comes
    // from each evaluated entity's audience defaults, including when multiple children share an event.
    for (const row of inputs.registrations) {
        caches.participant.set(uuidKey(row.event.id), true);
    }
    // Ordinary event membership includes its owner without requiring a registration row.
    // Preserve that same rule in batches, especially when evaluating a separately owned
    // child whose participant audience is governed by this event.
    for (const event of inputs.ownedEvents) {
        caches.participant.set(uuidKey(event.id), true);
    }

    // With every input populated, the ordinary evaluator now consumes these caches without
    // per-card permission queries. Ownership and all grant-combination behavior stay in one place.
    const views = new Map<string, PermView>();
    for (const entity of unique) {
        const view = await evaluateSubject({kind: 'entity', entity}, session, caches);
        views.set(entityPermissionKey(entity.entityType, entity.entityId), view);
    }
    return views;
}

/** Evaluate one root and its items with shared actor-local caches. Item masks
 * stay separate from the parent; missing-item fallback and serialization expose
 * the existing view contract rather than copying parent grants into each item. */
export async function buildPermBundle(
    entity: EntityDescriptor,
    items: ItemDescriptor[],
    session: SessionLike
): Promise<PermBundle> {
    // Share fetched evidence within this bundle only, never across actors or requests.
    const caches: PermEngineCaches = {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    };

    const entityView = await evaluateSubject({kind: 'entity', entity}, session, caches);
    const itemMap = new Map<string, PermView>();

    for (const it of items) {
        const pv = await evaluateSubject({kind: 'item', item: it, parent: entity}, session, caches);
        itemMap.set(uuidKey(it.entityId), pv);
    }

    // A missing item has no individual grants; allow() may still consult its
    // explicit parent fallback, exactly like the ordinary item evaluator.
    const empty = makePermView(0, entityView.mask);
    const getItem = (id: string) => itemMap.get(uuidKey(id)) ?? empty;

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

/** Shared permission check used by middleware and locked controller commands.
 * An optional manager keeps authorization in the caller's transaction; existing
 * direct callers retain the same fresh caches and application-manager reads. */
export async function can(
    subject: Subject,
    session: SessionLike,
    requiredPerm: number,
    requiredParentPerm?: number | number[],
    manager?: EntityManager,
): Promise<boolean> {
    // Fresh caches belong to this one decision; a previous request's grants or
    // membership cannot stand in for authorization under the supplied manager.
    const view = await evaluateSubject(subject, session, {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    }, manager);

    // A direct subject grant satisfies the command before any parent fallback.
    if (hasPerm(view.mask, requiredPerm)) return true;

    const parentPerms = normalizeToArray(requiredParentPerm, [requiredPerm]) as number[];

    // Only the caller-selected parent bits can satisfy an item fallback. The
    // default uses the same required bit and preserves ordinary direct callers.
    return 'parentMask' in view && parentPerms.some((perm) => hasPerm(view.parentMask, perm));


}

/** Read persisted audience defaults through the optional transaction manager.
 * Creation without an entity ID uses the existing initial defaults instead. */
export async function getDefaultPerms(entityType: CombEntityType, entityId?: string, manager?: EntityManager) {
    if (!entityId) return getInitialPerms(entityType);
    return await entityAdminService.getDefaultPerms(entityType, entityId, manager);
}

/**
 * Parse default-permission matrix from the request body and persist via updatePerms().
 * Form-shaped controller inputs retain their named-key decoder. A versioned HTTP
 * adapter validates integer masks first and explicitly selects inputFormat:'masks';
 * this shared collector does not become a competing request validator.
 * A supplied manager preserves the controller's existing lock/commit boundary.
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

        // Versioned commands have already crossed their generated integer/mask
        // validator. Preserve all authored bits, including reserved future bits;
        // form collectors keep their existing key decoder and empty semantics.
        const mask = opts.inputFormat === 'masks' ? raw as number | undefined : toMaskFromBodyValue(raw, PERM);
        if (mask === undefined) {
            if (opts.clearMissing) partial[aud] = 0; // explicit clear if requested
            // else: untouched
        } else {
            partial[aud] = mask; // set to computed mask (can be 0 if user ticked none)
        }
    }

    // Persist (upsert per audience). updatePerms ignores undefined fields.
    // Locked controller commands retain their existing transaction; direct callers
    // omit the manager and use the DBAL's unchanged application-manager default.
    await updatePerms(entityType, entityId, {
        guest: partial.guest,
        participant: partial.participant,
        authenticated: partial.authenticated,
        public: partial.public,
    }, opts.manager);
}

// One closed field policy drives both renderer projection and request authorization.
// Feature controllers retain normalization and domain checks; arbitrary property bags are rejected.
const basicPropertyPermissions: Partial<Record<EntityPropertyField, PermType>> = {
    title: 'EDIT_TITLE', description: 'EDIT_DESC',
};

const eventPropertyPermissions: Partial<Record<EntityPropertyField, PermType>> = {
    ...basicPropertyPermissions,
    startDate: 'EDIT_META', endDate: 'EDIT_META', location: 'EDIT_META',
    bindingDeadline: 'EDIT_META', deadlineTz: 'EDIT_META',
    allowRegDateUpdatesAfterDeadline: 'EDIT_META', allowRegCancelationAfterDeadline: 'EDIT_META',
    maxParticipants: 'EDIT_CAPACITY', requireDietaryInfo: 'MANAGE_REQUIREMENTS',
    allowDietComment: 'MANAGE_REQUIREMENTS', allowRegDietUpdateAfterDeadline: 'MANAGE_REQUIREMENTS',
};

// These methods are already shared by feature operations. Keep their grant
// definitions in this permission owner so a migrated capability/command cannot drift
// from the direct adapter while retaining each method's distinct admission checks.
const entityMethodPermissions = {
    editHeader: 'EDIT_META',
    changeEvent: 'EDIT_META',
    managePermissions: 'MANAGE_PERMISSIONS',
    duplicate: 'DATA_DUPLICATE',
} as const;

/** Return the existing shared method's grant without exposing mutable policy.
 * Callers still own profile/page admission and the permission engine owns grant
 * evaluation; choosing one method never grants another method's authority. */
export function entityMethodPermission(method: keyof typeof entityMethodPermissions): PermType {
    return entityMethodPermissions[method];
}

/** Project the maintained permission/preset definitions for all creation/settings callers. */
export function permissionDefinitions() {
    return {permissions: getPermMeta().map(({key, bit}) => ({key, bit})), presets: getPresets().map(({key, mask}) => ({key, mask}))};
}

function propertyPermissions(type: EntityType): Partial<Record<EntityPropertyField, PermType>> {
    if (type === 'event') return eventPropertyPermissions;
    if (type === 'activity') return {...basicPropertyPermissions, startDate: 'EDIT_META', endDate: 'EDIT_META'};
    return basicPropertyPermissions;
}

/** Read one established field declaration without exposing the mutable policy to adapters. */
export function entityPropertyPermission(type: EntityType, field: EntityPropertyField): PermType | undefined {
    return propertyPermissions(type)[field];
}

/** Return fresh field/grant tuples for authorized presentation without exposing mutable grant tables. */
export function entityPropertyFields(type: EntityType): readonly (readonly [EntityPropertyField, PermType])[] {
    return Object.entries(propertyPermissions(type)) as [EntityPropertyField, PermType][];
}

/** Reject forbidden and unsupported fields before any feature persistence can run. */
export function assertEditableEntityFields(type: EntityType, body: unknown, permissions: PermView, owner = false): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError('Invalid property update.', {}, 400);
    const policy = propertyPermissions(type);
    for (const field of Object.keys(body)) {
        if (!Object.hasOwn(policy, field)) throw new APIError('Unknown entity property.', {field}, 400);
        const allowed = type === 'survey' ? owner : permissions.has(policy[field as EntityPropertyField]!);
        if (!allowed) throw new APIError('Not allowed to edit this property.', {field}, 403);
    }
}

/** One declaration selects method grants for permission middleware, v1 commands and
 * capabilities. This preserves the existing independent bits and the participant
 * export's combined requirement; profile/account/participant admission remains
 * with the document route or shared operation rather than being inferred here. */
const eventMethodPermissions: Record<EventMethod, readonly PermType[]> = {
    register: ['ACCESS_REGISTRATION'], admin: ['ACCESS_ADMIN'], participants: ['ACCESS_PARTICIPANTS'],
    manageRegistrations: ['MANAGE_REGISTRATIONS'], items: ['ACCESS_ITEMS'], manageAssignments: ['MANAGE_ASSIGNMENTS'],
    exportParticipants: ['DATA_EXPORT', 'ACCESS_PARTICIPANTS'],
    managePermissions: [entityMethodPermission('managePermissions')],
    editHeader: [entityMethodPermission('editHeader')], duplicate: [entityMethodPermission('duplicate')],
};

/** Translate this owner's complete grant choice to the existing permission middleware bitmask. */
export function eventMethodPermission(method: EventMethod): number {
    return eventMethodPermissions[method].reduce((mask, key) => mask | PERM[key], 0);
}

/** The permission engine interprets grants; this owner selects every required method bit. */
export function mayPerformEventMethod(permissions: PermView, method: EventMethod): boolean {
    return permissions.all(...eventMethodPermissions[method]);
}

/** Return one necessary SQL candidate bit without exposing the private grant table.
 * Candidate filtering never authorizes disclosure: callers still evaluate the complete method rule. */
export function eventMethodCandidatePermission(method: EventMethod): PermType {
    return eventMethodPermissions[method][0]!;
}

