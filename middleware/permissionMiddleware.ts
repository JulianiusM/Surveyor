/*
 * lib/permissionMiddleware.js
 */
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'APIError'.
const {APIError} = require("../modules/lib/errors");

// Require guest_manage or owner
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'requireMan... Remove this comment to see the full error message
function requireManageRight(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
    return (req: any, res: any, next: any) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        const guestAllow = resource.guest_manage && (req.session.guest || req.session.user);
        if (!own && !guestAllow) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

// Require allow_guest_add, guest_manage or owner
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'requireAdd... Remove this comment to see the full error message
function requireAddRight(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
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
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'requireOwn... Remove this comment to see the full error message
function requireOwner(getResource = (req: any) => req.resource, getAdditional = (req: any) => req.additional) {
    return (req: any, res: any, next: any) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        if (!own) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

function isOwner(req: any, resource: any, additional = []) {
    const own = req.session.user && req.session.user.id === resource.owner_id;
    let itemOwner = false;
    for (let item of additional) {
        // @ts-expect-error TS(2362): The left-hand side of an arithmetic operation must... Remove this comment to see the full error message
        itemOwner |= (req.session.user && req.session.user.id === item.user_id) ||
            // @ts-expect-error TS(2339): Property 'guest_id' does not exist on type 'never'... Remove this comment to see the full error message
            (req.session.guest && req.session.guest.id === item.guest_id);
    }
    return own || itemOwner;
}

// Middleware für Authentifizierung
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'isAuthenti... Remove this comment to see the full error message
function isAuthenticated(req: any, res: any, next: any) {
    if (req.session.user) {
        return next();
    }
    req.flash('info', 'You must be logged in to access this site.');
    res.redirect('/users/login');
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {requireManageRight, requireAddRight, requireOwner, isAuthenticated};
