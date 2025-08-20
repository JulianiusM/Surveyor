import express from 'express';

import renderer from '../modules/renderer';
import mailer from '../modules/email';
import settings from '../modules/settings';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {ExpectedError, ValidationError} from '../modules/lib/errors';
import {paramHandler} from "./paramHandler";
import {isAuthenticated, requireOwner} from "./permissionMiddleware";
import {getResource} from "../modules/lib/util";
import * as userService from "../modules/database/services/UserService";

// Builds the guest edit link for emails and redirects using Node.js URL API
function buildGuestLink(entityType: any, entityId: any, token: any) {
    // Construct the path segments and ensure proper encoding
    const pathSegments = [entityType, entityId, 'edit', token]
        .map(segment => encodeURIComponent(String(segment)))
        .join('/');
    // Ensure rootUrl ends with a slash
    const base = settings.rootUrl.endsWith('/') ? settings.rootUrl : settings.rootUrl + '/';
    return new URL(pathSegments, base).toString();
}

// Default DB functions if none provided in config
function initConfig() {
    return {
        getById: () => {
            throw new Error('getById not implemented');
        },
        registerGuest: userService.registerGuest,
        getGuestInternal: userService.getGuestInternal,
        getGuestByToken: userService.getGuestByToken,
        getGuestLinkToken: userService.getGuestLinkToken,
        createGuestLink: userService.createGuestLink
    };
}

/**
 * Factory erzeugt einen Router mit den Standard-Routen
 *   • /create                     (GET, POST)
 *   • /:id/guest                  (GET, POST)
 *   • /:id/edit/:token            (GET)
 *   • /:id/duplicate              (GET)
 *   • /:id/delete                 (POST)
 *   • /:id  (SAFE-ZONE middleware + GET View)
 */
export function createGuestFlowRouter(cfg: any) {
    const {
        entityType,
        db = {},
        templates: {create, view},
        buildRedirect,
        preprocessCreate,
        createEntity,
        afterCreateItems,
        fetchForView,
        fetchForDuplicate,
        deleteEntity
    } = cfg;

    // merge defaults with any overrides
    const {
        getById,
        registerGuest,
        getGuestInternal,
        getGuestByToken,
        getGuestLinkToken,
        createGuestLink,
    } = Object.assign(initConfig(), db);

    const guest = 'users/register-guest';

    const router = express.Router();

    // Preload entity for any route containing :id
    const resFct = (req: any) => getResource(req, entityType);
    paramHandler('id', router, getById, entityType);

    // GET+POST /create
    router.route('/create')
        .get(isAuthenticated, (req: any, res: any) => {
            renderer.render(res, create);
        })
        .post(isAuthenticated, asyncHandler(async (req: any, res: any) => {
            const parsed = preprocessCreate(req.body);
            if (parsed.error) {
                throw new ValidationError(create, parsed.error.msg, parsed.error.data);
            }
            let id;
            try {
                id = await createEntity(req.session.user.id, parsed);
                await afterCreateItems(id, parsed);
            } catch (e) {

                // @ts-expect-error TS(2571): Object is of type 'unknown'.
                throw new ValidationError(create, e.message, parsed);
            }
            req.flash('success', `${entityType} created`);
            res.redirect(buildRedirect(id));
        }));

    // GET+POST /:id/guest
    router.route('/:id/guest')
        .get(asyncHandler(async (req: any, res: any) => {
            const {id, title} = resFct(req);
            if (req.session.user || req.session.guest) return res.redirect(buildRedirect(id))
            renderer.renderWithData(res, guest, {entityType, entityId: id, title});
        }))
        .post(asyncHandler(async (req: any, res: any) => {
            const entityId = resFct(req).id;
            const {username, email} = req.body;
            if (!username) {
                throw new ValidationError(guest, 'Username required', {
                    entityType,
                    entityId,
                    title: resFct(req).title,
                    username,
                    email
                });
            }
            const {guestId, token} = await registerGuest(entityType, entityId, username, email);
            req.session.guest = await getGuestInternal(guestId);
            const link = buildGuestLink(entityType, entityId, token);
            if (email) await mailer.sendLinkEmail(email, link);
            req.flash('success', `Login successful. Use ${link} to edit later.`);
            res.redirect(buildRedirect(entityId));
        }));

    // GET /:id/edit/:token
    router.get('/:id/edit/:token', asyncHandler(async (req: any, res: any) => {
        const {id: entityId, token} = req.params;
        const link = await getGuestByToken(token);
        if (!link || link.entity_type !== entityType || link.entity_id !== entityId) {
            throw new ExpectedError('Invalid or mismatched token', 'error', 401);
        }
        // switch to guest session
        req.session.user = undefined;
        req.session.guest = {id: link.id, username: link.username, email: link.email};
        req.flash('info', 'Switched to guest edit');
        res.redirect(buildRedirect(entityId));
    }));

    // GET /:id/duplicate
    router.get('/:id/duplicate', requireOwner(resFct), asyncHandler(async (req: any, res: any) => {
        const data = await fetchForDuplicate(resFct(req), req.session);
        renderer.renderWithData(res, create, {
            title: `Copy of ${resFct(req).title}`,
            entity: resFct(req),
            data: data,
            isDuplicate: true
        });
    }));

    // POST /:id/delete
    router.post('/:id/delete', requireOwner(resFct), asyncHandler(async (req: any, res: any) => {
        await deleteEntity(resFct(req), req.session);
        req.flash('success', `${entityType} deleted`);
        res.redirect('/users/dashboard');
    }));

    // SAFE-ZONE middleware before accessing /:id routes
    async function requireAccess(req: any, res: any, next: any) {
        const entityId = resFct(req).id;
        // Registered user
        if (req.session.user) return next();
        // Guest session
        if (req.session.guest) {
            let token = await getGuestLinkToken(entityType, entityId, req.session.guest.id);
            if (!token) {
                token = await createGuestLink(entityType, entityId, req.session.guest.id);
                const link = buildGuestLink(entityType, entityId, token);
                req.flash('success', `Login successful. Use ${link} to edit later.`);
                if (req.session.guest.email) {
                    await mailer.sendLinkEmail(req.session.guest.email, link);
                }
            }
            return next();
        }
        // No session → redirect to guest registration
        req.flash('info', 'Register as a guest to participate');
        res.redirect(`${buildRedirect(entityId)}/guest`);
    }

    router.use('/:id', asyncHandler(requireAccess));

    // GET /:id (view)
    router.get('/:id', asyncHandler(async (req: any, res: any) => {
        const data = await fetchForView(resFct(req), req.session);
        if (!data) {
            throw new ValidationError(view, `${entityType} not found`, {});
        }
        renderer.renderWithData(res, view, data);
    }));

    return router;
}

