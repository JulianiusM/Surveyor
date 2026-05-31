import express, {NextFunction, Request, Response} from 'express';

import renderer from '../modules/renderer';
import mailer from '../modules/email';
import settings from '../modules/settings';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {ExpectedError, ValidationError} from '../modules/lib/errors';
import {paramHandler, queryHandler} from "./paramHandler";
import {
    attachAdminData,
    attachPermBundle,
    attachPermMeta,
    isAuthenticated,
    optionalPermission,
    requireOwner,
    requirePermission
} from "./permissionMiddleware";
import {getItemFromEntityPermFct, getResource} from "../modules/lib/util";
import * as userService from "../modules/database/services/UserService";
import * as eventService from "../modules/database/services/EventService";
import type {GuestFlowConfig, GuestFlowDb} from "../types/UserTypes";
import {PERM} from "../modules/lib/permissions";
import type {EntityDescriptor, EntityGetter, GetResource, ItemGetter} from "../types/PermissionTypes";
import {persistSession} from "../modules/lib/session";
import {getGuestRegistrationNags} from "../modules/lib/guestRegistrationNags";

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
        getItems: () => {
            throw new Error('getItems not implemented');
        },
        registerGuest: userService.registerGuest,
        getGuestInternal: userService.getGuestInternal,
        getGuestByToken: userService.getGuestByToken,
        getGuestLinkToken: userService.getGuestLinkToken,
        createGuestLink: userService.createGuestLink,
        getGuestLinksByEmail: userService.getGuestLinksByEmail
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
        entityItemType,
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
        getItems,
        registerGuest,
        getGuestInternal,
        getGuestByToken,
        getGuestLinkToken,
        createGuestLink,
        getGuestLinksByEmail,
    }: GuestFlowDb = Object.assign(initConfig(), db);

    const guest = 'users/register-guest';

    const router = express.Router();

    // Preload entity for any route containing :id
    const resFct: GetResource = (req: Request) => getResource(req, entityType);
    const eventResFn: GetResource = (req: Request) => getResource(req, 'event');
    const eventNewResFn: GetResource = (req: Request) => getResource(req, 'eventNew');
    const permFct: EntityGetter = (req: Request): EntityDescriptor => {
        const resource = getResource(req, entityType);
        return {
            entityType: entityType,
            entityId: resource?.id,
            ownerUserId: resource?.ownerId,
            eventId: entityType === "event" ? resource?.id : resource?.eventId,
        };
    }
    const eventPermFct: EntityGetter = (req: Request): EntityDescriptor => {
        const resource = eventNewResFn(req);
        return {
            entityType: 'event',
            entityId: resource.id,
            ownerUserId: resource.ownerId
        };
    }
    const itemPermFct: ItemGetter = getItemFromEntityPermFct(getItems, resFct, entityItemType);

    paramHandler('id', router, getById, entityType);
    queryHandler("eventId", router, eventService.getEventById, 'eventNew');

    router.use(attachPermMeta(entityType));

    // GET+POST /create
    router.route('/create')
        .get(isAuthenticated, optionalPermission(eventPermFct, PERM.MANAGE_ASSIGNMENTS, eventNewResFn), asyncHandler(async (req: Request, res: Response) => {
            renderer.renderWithData(res, create, {
                eventId: req.query.eventId,
                events: await eventService.getActiveManagedEventsForUser(req.session.user!.id)
            });
        }))
        .post(isAuthenticated, optionalPermission(eventPermFct, PERM.MANAGE_ASSIGNMENTS, eventNewResFn), asyncHandler(async (req: Request, res: Response) => {
            const parsed = preprocessCreate(req.body);
            if (parsed.error) {
                throw new ValidationError(create, parsed.error.msg, parsed.error.data);
            }
            if (addToEvent) {
                parsed._injectedEventId = req.query.eventId;
            }
            parsed._body = req.body;
            let id;
            try {
                id = await createEntity(req.session.user!.id, parsed);
                await afterCreateItems(id, parsed);
            } catch (e) {
                const message = e instanceof Error ? e.message : 'Failed to create the resource.';
                throw new ValidationError(create, message, parsed);
            }
            req.flash('success', `${entityType} created`);
            res.redirect(buildRedirect(id));
        }));

    router.use("/:id", attachPermBundle(permFct, itemPermFct), attachPermMeta(entityType, (req) => req.params['id']), attachAdminData(entityType, (req) => req.params['id']));

    // GET+POST /:id/guest
    router.route('/:id/guest')
        .get(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            if (req.session.user || req.session.guest) return res.redirect(buildRedirect(id))
            renderer.renderWithData(res, guest, {
                entityType,
                entityId: id,
                title,
                guestRegistrationNags: getGuestRegistrationNags(entityType),
                recoveryPath: `${buildRedirect(id)}/guest/recover`,
            });
        }))
        .post(asyncHandler(async (req: Request, res: Response) => {
            const entityId = resFct(req).id;
            const {username, email = ''} = req.body;
            if (!username) {
                throw new ValidationError(guest, 'Username required', {
                    entityType,
                    entityId,
                    title: resFct(req).title,
                    guestRegistrationNags: getGuestRegistrationNags(entityType),
                    recoveryPath: `${buildRedirect(entityId)}/guest/recover`,
                    username,
                    email
                });
            }
            const {guestId, token, existingGuest} = await registerGuest(entityType, entityId, username, email);
            if (existingGuest) {
                req.flash('info', 'If this e-mail is linked to a guest account, you can recover links on the next page.');
                const recoverUrl = `${buildRedirect(entityId)}/guest/recover?email=${encodeURIComponent(String(email || '').trim())}`;
                return res.redirect(recoverUrl);
            }
            if (!token) {
                throw new ExpectedError('Guest link token missing', 'error', 500);
            }
            req.session.guest = await getGuestInternal(guestId);
            const link = buildGuestLink(entityType, entityId, token);
            if (email) await mailer.sendLinkEmail(email, link);
            req.flash('success', `Login successful. Use ${link} to edit later.`);
            res.redirect(buildRedirect(entityId));
        }));

    router.route('/:id/guest/recover')
        .get(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            renderer.renderWithData(res, 'users/recover-guest-links', {
                entityType,
                entityId: id,
                title,
                email: String(req.query.email || ''),
            });
        }))
        .post(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            const email = String(req.body.email || '').trim();
            if (!email) {
                throw new ValidationError('users/recover-guest-links', 'E-mail is required', {
                    entityType,
                    entityId: id,
                    title,
                    email,
                });
            }

            const links = await getGuestLinksByEmail(email);
            if (links.length > 0) {
                const fullLinks = links.map((link) => buildGuestLink(link.entityType, link.entityId, link.token));
                await mailer.sendGuestRecoveryEmail(email, fullLinks);
            }
            req.flash('success', 'If a guest account with this e-mail exists, the recovery links have been sent.');
            res.redirect(`${buildRedirect(id)}/guest`);
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
        await persistSession(req.session);

        req.flash('info', 'Switched to guest edit');
        res.redirect(buildRedirect(entityId));
    }));

    // GET /:id/duplicate
    router.get('/:id/duplicate', requirePermission(permFct, PERM.DATA_DUPLICATE), asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForDuplicate(resFct(req), req.session);
        renderer.renderWithData(res, create, {
            title: `Copy of ${resFct(req).title}`,
            entity: resFct(req),
            data: data,
            eventId: req.query.eventId,
            events: await eventService.getActiveManagedEventsForUser(req.session.user!.id),
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
        const entity = resFct(req);
        const event = eventResFn(req);
        if (addToEvent && event) {
            if (await eventService.isRegisteredForEvent({
                userId: req.session.user?.id,
                guestId: req.session.guest?.id
            }, event.id)) {
                // We have a valid registration --> Don't need to check in more detail.
                return next();
            }

            // No valid registration
            throw new ExpectedError('You must be registered for the event to access this resource');
        }
        // Registered user
        if (req.session.user) return next();
        // Guest session
        if (req.session.guest) {
            let token = await getGuestLinkToken(entityType, entity.id, req.session.guest.id);
            if (!token) {
                token = await createGuestLink(entityType, entity.id, req.session.guest.id);
                const link = buildGuestLink(entityType, entity.id, token);
                req.flash('success', `Login successful. Use ${link} to edit later.`);
                if (req.session.guest.email) {
                    await mailer.sendLinkEmail(req.session.guest.email, link);
                }
            }
            return next();
        }
        // No session → redirect to guest registration
        req.flash('info', 'Register as a guest to participate');
        res.redirect(`${buildRedirect(entity.id)}/guest`);
    }

    router.use('/:id', asyncHandler(requireAccess));

    // GET /:id (view)
    router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForView(resFct(req), req);
        if (!data) {
            throw new ValidationError(view, `${entityType} not found`, {});
        }
        renderer.renderWithData(res, view, data);
    }));

    return router;
}
