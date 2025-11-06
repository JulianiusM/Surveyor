/*
 * lib/permissionMiddleware.ts
 */
import {APIError, ExpectedError} from "../modules/lib/errors";
import {NextFunction, Request, Response} from "express";
import {isRegisteredForEvent} from "../modules/database/services/EventService";

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
type GetResource = (req: Request) => any;
type GetAdditional = (req: Request) => any[];

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
type AllowKey = "owner" | "eventParticipant" | "guestManage" | "guestAdd";

export type PermissionOptions = {
    /** Which conditions are sufficient for access (any-of). */
    allow: AllowKey[];
    /** If false, a query eventId triggers 400; if true, it’s allowed. Default: true */
    useEvent?: boolean;
    /** Override resource/additional getters if needed. */
    getResource?: GetResource;
    getAdditional?: GetAdditional;
};

function makePermission(errs: ErrorAdapter, opts: PermissionOptions) {
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
        const identified = req.session.guest || req.session.user;

        // Do we need to gate guest* behind eventParticipant?
        const needsEPGate =
            allow.includes("eventParticipant") &&
            allow.some(k => k === "guestManage" || k === "guestAdd");

        const ownerOk = isOwner(req, resource, additional);
        const epOk = await isEventParticipant(req, resource);

        // guest* require identification; if gated, also require epOk
        const gmOk = Boolean(resource?.guestManage && identified && (!needsEPGate || epOk));
        const gaOk = Boolean(resource?.allowGuestAdd && identified && (!needsEPGate || epOk));

        const checks: Record<AllowKey, boolean> = {
            owner: ownerOk,
            eventParticipant: epOk,
            guestManage: gmOk,
            guestAdd: gaOk,
        };

        // If we’re gating, don’t let raw eventParticipant pass by itself.
        const keysToEval = needsEPGate ? allow.filter(k => k !== "eventParticipant") : allow;

        for (const key of keysToEval) {
            if (checks[key]) return next();
        }

        errs.forbidden();
    };
}

/* -------------------- Two variants (API / Expected) -------------------- */
export const permissionAPI = (opts: PermissionOptions) => makePermission(apiErrors, opts);
export const permissionExpected = (opts: PermissionOptions) => makePermission(expectedErrors, opts);

/* -------------------- Optional convenience wrappers (drop-in replacements) -------------------- */
// isEventPermitted (owner only, with event toggle & 400 when disabled)
export const isEventPermittedAPI = (useEvent: boolean, getResource: GetResource = defaultGetResource) =>
    permissionAPI({allow: ["owner"], useEvent, getResource});
export const isEventPermitted = (useEvent: boolean, getResource: GetResource = defaultGetResource) =>
    permissionExpected({allow: ["owner"], useEvent, getResource});

// requireOwner
export const requireOwnerAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionAPI({allow: ["owner"], getResource, getAdditional});
export const requireOwner = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionExpected({allow: ["owner"], getResource, getAdditional});

// requireManageRight (owner OR eventParticipant OR guestManage)
export const requireManageRightAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionAPI({allow: ["owner", "eventParticipant", "guestManage"], getResource, getAdditional});
export const requireManageRight = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionExpected({allow: ["owner", "eventParticipant", "guestManage"], getResource, getAdditional});

// requireAddRight (owner OR eventParticipant OR guestManage OR guestAdd)
export const requireAddRightAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionAPI({allow: ["owner", "eventParticipant", "guestManage", "guestAdd"], getResource, getAdditional});
export const requireAddRight = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionExpected({allow: ["owner", "eventParticipant", "guestManage", "guestAdd"], getResource, getAdditional});

// requireEventParticipant (owner OR eventParticipant)
export const requireEventParticipantAPI = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionAPI({allow: ["owner", "eventParticipant"], getResource, getAdditional});
export const requireEventParticipant = (getResource: GetResource = defaultGetResource, getAdditional: GetAdditional = defaultGetAdditional) =>
    permissionExpected({allow: ["owner", "eventParticipant"], getResource, getAdditional});

/* -------------------- Unchanged auth redirect middleware -------------------- */
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    if (req.session.user) return next();
    req.flash("info", "You must be logged in to access this site.");
    res.redirect("/users/login");
}
