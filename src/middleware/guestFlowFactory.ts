import express, {NextFunction, Request, Response} from 'express';

import renderer from '../modules/renderer';
import mailer from '../modules/email';
import settings from '../modules/settings';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {ExpectedError, ValidationError} from '../modules/lib/errors';
import {paramHandler, queryHandler} from "./paramHandler";
import {isAuthenticated, isEventPermitted, requireEventParticipant, requireOwner} from "./permissionMiddleware";
import {getResource} from "../modules/lib/util";
import * as userService from "../modules/database/services/UserService";
import * as eventService from "../modules/database/services/EventService";
import type {GuestFlowConfig, GuestFlowDb} from "../types/UserTypes";

// Builds the guest edit link for emails and redirects using Node.js URL API
function buildGuestLink(entityType: string, entityId: string, token: string) {
    // Construct the path segments and ensure proper encoding
    const pathSegments = [entityType, entityId, 'edit', token]
        .map(segment => encodeURIComponent(String(segment)))
        .join('/');
    // Ensure rootUrl ends with a slash
    let base = settings.value.rootUrl;
    base = base.endsWith('/') ? base : base + '/';
    return new URL(pathSegments, base).toString();
}

// Default DB functions if none provided in config
function initConfig(): GuestFlowDb {
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
export function createGuestFlowRouter(cfg: GuestFlowConfig) {
    const {
        entityType,
        addToEvent,
        db = {},
        templates: {create, view},
        buildRedirect,
        preprocessCreate,
        createEntity,
        afterCreateItems,
        fetchForView,
        fetchForDuplicate,
        deleteEntity
    }: GuestFlowConfig = cfg;

    // merge defaults with any overrides
    const {
        getById,
        registerGuest,
        getGuestInternal,
        getGuestByToken,
        getGuestLinkToken,
        createGuestLink,
    }: GuestFlowDb = Object.assign(initConfig(), db);

    const guest = 'users/register-guest';

    const router = express.Router();

    // Preload entity for any route containing :id
    const resFct = (req: Request) => getResource(req, entityType);
    const eventResFn = (req: Request) => getResource(req, 'event');
    paramHandler('id', router, getById, entityType);

    if (addToEvent) {
        queryHandler("eventId", router, eventService.getEventById, 'event');
        router.use(requireEventParticipant(eventResFn));
    }

    // GET+POST /create
    router.route('/create')
        .get(isAuthenticated, isEventPermitted(addToEvent, eventResFn), (req: Request, res: Response) => {
            renderer.renderWithData(res, create, {eventId: req.query.eventId});
        })
        .post(isAuthenticated, isEventPermitted(addToEvent, eventResFn), asyncHandler(async (req: Request, res: Response) => {
            const parsed = preprocessCreate(req.body);
            if (parsed.error) {
                throw new ValidationError(create, parsed.error.msg, parsed.error.data);
            }
            if (addToEvent) {
                parsed._injectedEventId = req.query.eventId;
            }
            let id;
            try {
                id = await createEntity(req.session.user!.id, parsed);
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
        .get(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            if (req.session.user || req.session.guest) return res.redirect(buildRedirect(id))
            renderer.renderWithData(res, guest, {entityType, entityId: id, title});
        }))
        .post(asyncHandler(async (req: Request, res: Response) => {
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
    router.get('/:id/edit/:token', asyncHandler(async (req: Request, res: Response) => {
        const {id: entityId, token} = req.params;
        const guest = await getGuestByToken(token, entityType, entityId);
        if (!guest) {
            throw new ExpectedError('Invalid or mismatched token', 'error', 401);
        }
        // switch to guest session
        req.session.user = undefined;
        req.session.guest = guest;
        req.flash('info', 'Switched to guest edit');
        res.redirect(buildRedirect(entityId));
    }));

    // GET /:id/duplicate
    router.get('/:id/duplicate', requireOwner(resFct), asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForDuplicate(resFct(req), req.session);
        renderer.renderWithData(res, create, {
            title: `Copy of ${resFct(req).title}`,
            entity: resFct(req),
            data: data,
            isDuplicate: true
        });
    }));

    // POST /:id/delete
    router.post('/:id/delete', requireOwner(resFct), asyncHandler(async (req: Request, res: Response) => {
        await deleteEntity(resFct(req), req.session);
        req.flash('success', `${entityType} deleted`);
        res.redirect('/users/dashboard');
    }));

    // SAFE-ZONE middleware before accessing /:id routes
    async function requireAccess(req: Request, res: Response, next: NextFunction) {
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
    router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForView(resFct(req), req.session);
        if (!data) {
            throw new ValidationError(view, `${entityType} not found`, {});
        }
        renderer.renderWithData(res, view, data);
    }));

    return router;
}

