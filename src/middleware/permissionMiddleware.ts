/*
 * lib/permissionMiddleware.ts
 */
import {APIError, ExpectedError} from "../modules/lib/errors";
import {NextFunction, Request, Response} from "express";
import {isRegisteredForEvent} from "../modules/database/services/EventService";
import {
    EntityGetter,
    GetAdditional,
    GetResource,
    ItemGetter,
    ItemWithParentGetter,
    Subject
} from "../types/PermissionTypes";
import {buildPermBundle, can, getDefaultPerms} from "../modules/permissionEngine";
import {asyncHandler} from "../modules/lib/asyncHandler";
import {getPermMeta, getPresets} from "../modules/lib/permissions";
import {CombEntityType} from "../types/UtilTypes";
import * as entityAdminService from "../modules/database/services/EntityAdminService"

/* -------------------- Error adapters -------------------- */
type ErrorAdapter = {
    badRequest: () => never;
    forbidden: () => never;
};

const apiErrors: ErrorAdapter = {
    badRequest: () => {
        throw new APIError("Not allowed", {}, 400);
    },
    forbidden: () => {
        throw new APIError("Not allowed", {}, 403);
    },
};

const expectedErrors: ErrorAdapter = {
    badRequest: () => {
        throw new ExpectedError("Not allowed", "error", 400);
    },
    forbidden: () => {
        throw new ExpectedError("Not allowed", "error", 403);
    },
};

/* -------------------- Helpers -------------------- */
const defaultGetResource: GetResource = (req) => req.resource;
const defaultGetAdditional: GetAdditional = (req) => req.additional ?? [];

function isOwner(
    req: Request,
    resource?: any,
    additional: any[] = []
): boolean {
    const own = req.session.user && req.session.user.id === resource?.ownerId;
    if (own) return true;

    for (const item of additional) {
        if (
            (req.session.user && req.session.user.id === item.userId) ||
            (req.session.guest && req.session.guest.id === item.guestId)
        ) {
            return true;
        }
    }
    return false;
}

async function isEventParticipant(req: Request, resource?: Record<string, any>) {
    const eventId = resource?.eventId;
    if (!eventId) return true; // Non-event resources are allowed
    return await isRegisteredForEvent(
        {userId: req.session.user?.id, guestId: req.session.guest?.id},
        eventId
    );
}

/* -------------------- One generic builder -------------------- */
/**
 * Allow if ANY of the listed conditions is true. Otherwise throw 403.
 * Optionally throws 400 when an eventId is passed but events are disabled.
 */
type AllowKey = "owner" | "eventParticipant";

export type UserRoleCheckOptions = {
    /** Which conditions are sufficient for access (any-of). */
    allow: AllowKey[];
    /** If false, a query eventId triggers 400; if true, it’s allowed. Default: true */
    useEvent?: boolean;
    /** Override resource/additional getters if needed. */
    getResource?: GetResource;
    getAdditional?: GetAdditional;
};

function makeUserRoleCheck(errs: ErrorAdapter, opts: UserRoleCheckOptions) {
    const {
        allow,
        useEvent = true,
        getResource = defaultGetResource,
        getAdditional = defaultGetAdditional,
    } = opts;

    return async (req: Request, _res: Response, next: NextFunction) => {
        // Optional 400 guard for event usage mismatch
        if (req.query.eventId && !useEvent) errs.badRequest();

        // Compute predicates and gate guest* by eventParticipant when requested
        const resource = getResource(req);
        const additional = getAdditional(req);

        const ownerOk = isOwner(req, resource, additional);
        const epOk = await isEventParticipant(req, resource);

        const checks: Record<AllowKey, boolean> = {
            owner: ownerOk,
            eventParticipant: epOk,
        };

        for (const key of allow) {
            if (checks[key]) return next();
        }

        errs.forbidden();
    };
}

/* -------------------- Two variants (API / Expected) -------------------- */
export const userRoleAPI = (opts: UserRoleCheckOptions) => makeUserRoleCheck(apiErrors, opts);
export const userRoleExpected = (opts: UserRoleCheckOptions) => makeUserRoleCheck(expectedErrors, opts);

/* -------------------- Optional convenience wrappers (drop-in replacements) -------------------- */
export const requireOwnerAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleAPI({allow: ["owner"], getResource, getAdditional});
export const requireOwner = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleExpected({allow: ["owner"], getResource, getAdditional});

// requireEventParticipant (owner OR eventParticipant)
export const requireEventParticipantAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleAPI({allow: ["owner", "eventParticipant"], getResource, getAdditional});
export const requireEventParticipant = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    userRoleExpected({allow: ["owner", "eventParticipant"], getResource, getAdditional});

/* -------------------- Unchanged auth redirect middleware -------------------- */
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.session.user) return next();
    req.flash("info", "You must be logged in to access this site.");
    res.redirect("/users/login");
}

/* ---------- Entity Administration ---------- */
/** Core requirePerm, now delegates to engine.can(...) */
function requirePermInternal(
    getSubject: (req: Request) => Promise<Subject> | Subject,
    requiredPerm: number,
    err: ErrorAdapter,
    requiredParentPerm?: number
) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        const subject = await getSubject(req);
        const ok = await can(subject, req.session ?? {}, requiredPerm, requiredParentPerm);
        if (!ok) {
            return err.forbidden();
        }
        next();
    };
}

/** Entity version */
export function requirePermissionApi(getEntity: EntityGetter, requiredPerm: number) {
    return requirePermInternal((req) => ({kind: 'entity', entity: getEntity(req) as any}), requiredPerm, apiErrors);
}

export function requirePermission(getEntity: EntityGetter, requiredPerm: number) {
    return requirePermInternal((req) => ({
        kind: 'entity',
        entity: getEntity(req) as any
    }), requiredPerm, expectedErrors);
}

/** Item version (with parent). You may pass a different requiredParentPerm; if omitted, same perm is checked on parent. */
export function requireItemPermissionApi(get: ItemWithParentGetter, requiredPerm: number, requiredParentPerm?: number) {
    return requirePermInternal((req) => ({kind: 'item', ...(get(req) as any)}), requiredPerm, apiErrors, requiredParentPerm);
}

export function requireItemPermission(get: ItemWithParentGetter, requiredPerm: number, requiredParentPerm?: number) {
    return requirePermInternal((req) => ({kind: 'item', ...(get(req) as any)}), requiredPerm, expectedErrors, requiredParentPerm);
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalPermissionApi(getData: EntityGetter, requiredPerm: number, getEntity: GetResource) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requirePermissionApi(getData, requiredPerm)
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalPermission(getData: EntityGetter, requiredPerm: number, getEntity: GetResource) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requirePermission(getData, requiredPerm)(req, res, next);
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalItemPermissionApi(getData: ItemWithParentGetter, requiredPerm: number, getEntity: GetResource, requiredParentPerm?: number) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requireItemPermissionApi(getData, requiredPerm, requiredParentPerm)
    }
}

// Checks for a permission to an optional entity. getEntity must return the entity in question (will skip the check if missing).
// getData must return the corresponding information for the entity and will be used to perform the check.
export function optionalItemPermission(getData: ItemWithParentGetter, requiredPerm: number, getEntity: GetResource, requiredParentPerm?: number) {
    return (req: Request, res: Response, next: NextFunction) => {
        const resource = getEntity(req);
        if (!resource) return next();
        return requireItemPermission(getData, requiredPerm, requiredParentPerm)(req, res, next);
    }
}

/** Build { perm: { entity, item(id), ... } } for Pug */
export function attachPermBundle(getEntity: EntityGetter, getItems: ItemGetter) {
    return asyncHandler(async (req, res, next) => {
        const ent = await getEntity(req);
        const items = await getItems(req);
        res.locals.permData = await buildPermBundle(ent, items, req.session ?? {});
        next();
    });
}

export function attachPermMeta(entityType: CombEntityType, idSupplyer?: string | ((req: Request) => string)) {
    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        let id: string | undefined = undefined;
        if (typeof idSupplyer === 'string') id = idSupplyer;
        else if (typeof idSupplyer === 'function') id = idSupplyer(req);

        res.locals.perms = {
            permMeta: getPermMeta(),
            defaultPerms: await getDefaultPerms(entityType, id),
            presets: getPresets(),
        }
        next();
    });
}

export function attachAdminData(entityType: CombEntityType, idSupplyer?: string | ((req: Request) => string)) {
    return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        let id: string | undefined = undefined;
        if (typeof idSupplyer === 'string') id = idSupplyer;
        else if (typeof idSupplyer === 'function') id = idSupplyer(req);

        res.locals.admins = await entityAdminService.listAdmins(entityType, id ?? "");
        next();
    })
}