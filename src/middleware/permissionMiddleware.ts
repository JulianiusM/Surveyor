/*
 * lib/permissionMiddleware.js
 */
import {APIError} from "../modules/lib/errors";

// Require guest_manage or owner
export function requireManageRight(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
    return (req: any, res: any, next: any) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        const guestAllow = resource.guest_manage && (req.session.guest || req.session.user);
        if (!own && !guestAllow) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

// Require allow_guest_add, guest_manage or owner
export function requireAddRight(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
    return (req: any, res: any, next: any) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        const identified = req.session.guest || req.session.user;
        const guestManage = resource.guest_manage && identified;
        const allowAdd = resource.allow_guest_add && identified;
        if (!own && !guestManage && !allowAdd) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

// Require owner
export function requireOwner(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
    return (req: any, res: any, next: any) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        if (!own) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

function isOwner(req: any, resource: any, additional: any[] = []): boolean {
    const own = req.session.user && req.session.user.id === resource.owner_id;
    if (own) {
        return true;
    }

    for (let item of additional) {
        if ((req.session.user && req.session.user.id === item.user_id) || (req.session.guest && req.session.guest.id === item.guest_id)) {
            return true;
        }
    }

    return false;
}

// Middleware für Authentifizierung
export function isAuthenticated(req: any, res: any, next: any) {
    if (req.session.user) {
        return next();
    }
    req.flash('info', 'You must be logged in to access this site.');
    res.redirect('/users/login');
}
