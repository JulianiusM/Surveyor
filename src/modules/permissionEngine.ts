// src/lib/permEngine.ts
import {ALL_MASK, getInitialPerms, hasPerm, PERM, toMaskFromBodyValue} from './lib/permissions';
import * as entityAdminService from './database/services/EntityAdminService';
import {getUserPerms, updatePerms} from './database/services/EntityAdminService';
import {isRegisteredForEvent} from './database/services/EventService';
import type {
    Audience,
    EntityDescriptor,
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
import {jsonReplacer} from "./lib/util";

function keyUser(t: CombEntityType, id: string, userId: number) {
    return `${t}:${id}:${userId}`;
}

function keyEnt(t: CombEntityType, id: string) {
    return `${t}:${id}`;
}

function isOwnerTyped(
    session: SessionLike,
    ownerUserId?: number | null,
    ownerGuestId?: number | null
): boolean {
    const uid = session.user?.id ?? null;
    const gid = session.guest?.id ?? null;

    if (uid && ownerUserId && uid === ownerUserId) return true;
    return !!(gid && ownerGuestId && gid === ownerGuestId);

}

/** Core: compute effective mask for ONE subject (no parent) */
async function computeMaskFor(
    t: CombEntityType,
    id: string,
    ownerUserId: number | null | undefined,
    ownerGuestId: number | null | undefined,
    eventId: string | null | undefined,
    session: SessionLike,
    caches?: PermEngineCaches
): Promise<number> {
    // 0) Owner ⇒ full mask
    if (isOwnerTyped(session, ownerUserId, ownerGuestId)) return ALL_MASK;

    const userId = session.user?.id ?? null;
    const guestId = session.guest?.id ?? null;

    // Per-user ACL
    let eff = 0;
    if (userId) {
        const k = keyUser(t, id, userId);
        if (caches?.userPerms?.has(k)) eff = caches.userPerms.get(k)!;
        else {
            const u = await getUserPerms(t, id, userId);
            caches?.userPerms?.set?.(k, u);
            eff |= u;
        }
    }

    // Default ACLs
    let defaults: Record<string, number> | undefined;
    const kd = keyEnt(t, id);
    if (caches?.defaults?.has(kd)) defaults = caches.defaults.get(kd)!;
    else {
        defaults = await getDefaultPerms(t, id);
        caches?.defaults?.set?.(kd, defaults);
    }

    if (defaults?.public) eff |= defaults.public;
    if (userId && defaults?.authenticated) eff |= defaults.authenticated;
    if ((userId || guestId) && defaults?.guest) eff |= defaults.guest;

    // Participant audience
    if (eventId) {
        const eid = String(eventId);
        let isPart: boolean | undefined = caches?.participant?.get(eid);
        if (isPart === undefined) {
            isPart = await isRegisteredForEvent(
                {userId: userId ?? undefined, guestId: guestId ?? undefined},
                eid
            );
            caches?.participant?.set?.(eid, isPart);
        }
        if (isPart && defaults?.participant) eff |= defaults.participant;
    }

    return eff;
}

function makePermView(mask: number, parentMask: number): PermView {
    const selfHas = (k: PermType) => hasPerm(mask, PERM[k]);
    const parentHas = (k: PermType) => hasPerm(parentMask, PERM[k]);
    return {
        mask,
        parentMask,
        has: selfHas,
        allow: (k, parentKey) => selfHas(k) || parentHas(parentKey ?? k),
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
            subject.entity.ownerUserId ?? null,
            subject.entity.ownerGuestId ?? null,
            subject.entity.eventId ?? null,
            session,
            caches
        );
        return makePermView(m, 0);
    } else {
        const parentMask = await computeMaskFor(
            subject.parent.entityType,
            subject.parent.entityId,
            subject.parent.ownerUserId ?? null,
            subject.parent.ownerGuestId ?? null,
            subject.parent.eventId ?? null,
            session,
            caches
        );
        const selfMask = await computeMaskFor(
            subject.item.entityType,
            subject.item.entityId,
            subject.item.ownerUserId ?? null,
            subject.item.ownerGuestId ?? null,
            (subject.item.eventId ?? subject.parent.eventId ?? null),
            session,
            caches
        );
        return makePermView(selfMask, parentMask);
    }
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
        itemAllow: (id: string, key: keyof typeof PERM, parentKey?: keyof typeof PERM) => getItem(id).allow(key, parentKey),
    };

    bundle.toJSON = () => JSON.stringify({entity: bundle.entity, items: bundle.items}, jsonReplacer);

    return bundle;
}

/** Single-place check used by middleware */
export async function can(
    subject: Subject,
    session: SessionLike,
    requiredPerm: number,
    requiredParentPerm?: number
): Promise<boolean> {
    const view = await evaluateSubject(subject, session, {
        participant: new Map(),
        userPerms: new Map(),
        defaults: new Map(),
    });

    // self
    if (hasPerm(view.mask, requiredPerm)) return true;

    // item: optionally allow via parent
    if (requiredParentPerm && hasPerm(view.parentMask, requiredParentPerm)) return true;

    // default fallback: same perm on parent if subject is item and no parentRequiredPerm specified
    if ('parentMask' in view && hasPerm(view.parentMask, requiredParentPerm ?? requiredPerm)) return true;

    return false;
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
    const src = (body && body[fieldBase]) ? body[fieldBase] : {};

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

