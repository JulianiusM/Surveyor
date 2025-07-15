/*
 * lib/permissionMiddleware.js
 */
const {APIError} = require("../modules/lib/errors");

// Require guest_manage or owner
function requireManageRight(getResource = req => req.resource, getAdditional = req => req.additional) {
    return (req, res, next) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        const guestAllow = resource.guest_manage && (req.session.guest || req.session.user);
        if (!own && !guestAllow) throw new APIError('Not allowed', {}, 403);
        next();
    };
}

// Require allow_guest_add, guest_manage or owner
function requireAddRight(getResource = req => req.resource, getAdditional = req => req.additional) {
    return (req, res, next) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        const identified = req.session.guest || req.session.user;
        const guestManage = resource.guest_manage && identified;
        const allowAdd = resource.allow_guest_add && identified;
        if (!own && !guestManage && !allowAdd) throw new APIError('Not allowed', {}, 403);
        next();
    }
}

// Require owner
function requireOwner(getResource = req => req.resource, getAdditional = req => req.additional) {
    return (req, res, next) => {
        const resource = getResource(req);
        const own = isOwner(req, resource, getAdditional(req));
        if (!own) throw new APIError('Not allowed', {}, 403);
        next();
    }
}

function isOwner(req, resource, additional = []) {
    const own = req.session.user && req.session.user.id === resource.owner_id;
    let itemOwner = false;
    for (let item of additional) {
        itemOwner |= (req.session.user && req.session.user.id === item.user_id) ||
            (req.session.guest && req.session.guest.id === item.guest_id);
    }
    return own || itemOwner;
}

// Middleware für Authentifizierung
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    req.flash('info', 'You must be logged in to access this site.');
    res.redirect('/users/login');
}

module.exports = {requireManageRight, requireAddRight, requireOwner, isAuthenticated};
