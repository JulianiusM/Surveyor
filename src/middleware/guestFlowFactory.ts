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

import express, {NextFunction, Request, Response} from 'express';
import fs from "node:fs";
import path from "node:path";
import {canAccessEntityView, getArchivePresentations, getEntityPropertyPresentation} from "../controller/entityAdminController";
import {authorizeEventLink, projectEventLinkOption} from "../controller/eventController";
import {archiveKey} from "../modules/archive/policy";
import * as userService from "../modules/database/services/UserService";
import mailer, {resolveEmailRecipientName} from '../modules/email';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';
import {checkNewImage, prepareFileUploader, removeImage} from "../modules/lib/fileCommons";
import {getGuestRegistrationNags} from "../modules/lib/guestRegistrationNags";
import {PERM} from "../modules/lib/permissions";
import {persistSession} from "../modules/lib/session";
import {buildGuestLink, getItemFromEntityPermFct, getResource} from "../modules/lib/util";

import renderer from '../modules/renderer';
import settings from "../modules/settings";
import type {EntityDescriptor, EntityGetter, GetResource, ItemGetter} from "../types/PermissionTypes";
import type {EntityBase, GuestFlowConfig, GuestFlowDb} from "../types/UserTypes";
import {paramHandler} from "./paramHandler";
import {
    attachAdminData,
    attachPermBundle,
    attachPermMeta,
    isAuthenticated,
    requireOwner,
    requirePermission
} from "./permissionMiddleware";

// Default DB functions if none provided in config
function initConfig(): GuestFlowDb {
    return {
        getById: () => {
            throw new Error('getById not implemented');
        },
        getItems: () => {
            throw new Error('getItems not implemented');
        },
        registerGuest: userService.createGuest,
        getGuestInternal: userService.getGuestInternal,
        getGuestByToken: userService.getGuestByToken,
        getGuestLinkToken: userService.getGuestLinkToken
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
    }: GuestFlowDb = Object.assign(initConfig(), db);

    const guest = 'users/register-guest';
    const headerImgUpload = prepareFileUploader(settings.value.headerImgDir);

    const router = express.Router();

    // Preload entity for any route containing :id
    const resFct: GetResource = (req: Request) => getResource(req, entityType);
    const eventResFn: GetResource = (req: Request) => getResource(req, 'event');
    const permFct: EntityGetter = (req: Request): EntityDescriptor => {
        const resource = getResource(req, entityType);
        return {
            entityType: entityType,
            entityId: resource?.id,
            ownerId: resource?.ownerId,
            eventId: entityType === "event" ? resource?.id : resource?.eventId,
        };
    }
    const itemPermFct: ItemGetter = getItemFromEntityPermFct(getItems, resFct, entityItemType);

    paramHandler('id', router, getById, entityType);

    router.use(attachPermMeta(entityType));

    /**
     * Build the creation form's event choices and optional archival context in one place.
     * First display, duplication and validation recovery all use this renderer-data contract;
     * templates never need to depend on optional feature properties in res.locals.
     * An eventId query selects context, but permission to attach content is still checked.
     */
    async function getCreationData(req: Request) {
        // Search results are loaded by the shared picker endpoint. Only a permitted initial
        // choice is rendered here, including on validation recovery; historical state never
        // excludes a destination. A posted choice supersedes a contextual URL preselection.
        const submitted = req.body && Object.hasOwn(req.body, 'event_id') ? req.body.event_id : req.query.eventId;
        const selectedId = typeof submitted === 'string' ? submitted : undefined;
        let selected = null;
        if (addToEvent && selectedId) {
            try { selected = await authorizeEventLink(selectedId, req.session); }
            catch (error) {
                if (!(error instanceof APIError)) throw error;
                // Do not leak a forbidden selection's label into recovery HTML. Submission
                // performs its own mandatory check after feature field normalization.
            }
        }
        if (!selected) return {eventId: undefined, events: [], archive: null};
        const ref = {type: 'event' as const, id: selected.id};
        const archives = await getArchivePresentations([ref], req.session);
        return {eventId: selected.id, events: [projectEventLinkOption(selected)], archive: archives.get(archiveKey(ref)) ?? null};
    }

    /** Render the initial form through the same data path used after validation failures. */
    async function showCreatePage(req: Request, res: Response) {
        renderer.renderWithData(res, create, await getCreationData(req));
    }

    /**
     * Preserve the existing entity creation workflow while supplying complete recovery data.
     * Only ValidationError carries form state; unexpected failures continue through the
     * established error handler instead of being treated as a recoverable user-input error.
     */
    async function submitCreatePage(req: Request, res: Response) {
        // Capture choices/context before parsing so image and field validation failures can
        // render the same form, including a selected archived event's title and explanation.
        const creationData = await getCreationData(req);
        try {
            checkNewImage(req.file);
            req.body.headerImg = req.file ? path.relative(process.cwd(), req.file.path) : undefined;
            let selectedEventId: string | undefined;
            if (addToEvent) {
                // Multipart parsing necessarily precedes body-target authorization. Validate
                // that actual field before feature parsing so malformed and forbidden targets
                // both discard only this request's fresh upload, never a persisted image.
                try {
                    const target = await authorizeEventLink(req.body.event_id, req.session);
                    selectedEventId = target?.id;
                } catch (error) {
                    if (req.file) removeImage(path.relative(process.cwd(), req.file.path));
                    throw error;
                }
            }
            const parsed = preprocessCreate(req.body);
            if (parsed.error) {
                throw new ValidationError(create, parsed.error.msg, parsed.error.data);
            }
            // A query-string event is only a preselection. Use exactly the authorized body
            // relationship, including an explicit empty choice, in the creation service.
            if (addToEvent) parsed.eventId = selectedEventId;
            parsed._body = req.body;
            parsed._file = req.file;
            if (!parsed.headerImg && req.file) {
                parsed.headerImg = req.body.headerImg;
            }

            let id;
            try {
                // Creation and child-item initialization retain their existing domain hooks.
                // Archival context is presentation data and never alters the submitted entity.
                id = await createEntity(req.session.profile!.id, parsed);
                await afterCreateItems(id, parsed);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to create the resource.';
                throw new ValidationError(create, message, parsed);
            }
            req.flash('success', `${entityType} created`);
            res.redirect(buildRedirect(id));
        } catch (error) {
            if (error instanceof ValidationError) {
                // The error renderer receives data only. Preserve submitted fields, then replace
                // picker choices/archive state with server-owned values. The posted selection
                // wins over URL preselection and retains a label only when it is authorized.
                const submittedData = error.data as {eventId?: unknown};
                error.data = {
                    ...error.data,
                    ...creationData,
                    eventId: creationData.eventId ?? submittedData.eventId,
                };
            }
            throw error;
        }
    }

    // GET+POST /create
    router.route('/create')
        .get(isAuthenticated,
            asyncHandler(showCreatePage))
        .post(isAuthenticated,
            headerImgUpload.single("headerImg"),
            asyncHandler(submitCreatePage));

    router.use("/:id", attachPermBundle(permFct, itemPermFct), attachPermMeta(entityType, (req) => req.params['id'] as string), attachAdminData(entityType, (req) => req.params['id'] as string));

    // GET+POST /:id/guest
    router.route('/:id/guest')
        .get(asyncHandler(async (req: Request, res: Response) => {
            const {id, title} = resFct(req);
            if (req.session.profile) return res.redirect(buildRedirect(id))
            renderer.renderWithData(res, guest, {
                entityType,
                entityId: id,
                title,
                guestRegistrationNags: getGuestRegistrationNags(entityType),
            });
        }))
        .post(asyncHandler(async (req: Request, res: Response) => {
            const entityId = resFct(req).id;
            const {username, email} = req.body;
            const normEmail = email?.trim().toLowerCase();
            if (!username) {
                throw new ValidationError(guest, 'Username required', {
                    entityType,
                    entityId,
                    title: resFct(req).title,
                    guestRegistrationNags: getGuestRegistrationNags(entityType),
                    username,
                    email
                });
            }
            const newGuest = await registerGuest(username, normEmail);
            req.session.auth = {guest: newGuest};
            req.session.profile = newGuest.profile;
            await persistSession(req.session);
            const link = buildGuestLink(newGuest.id, newGuest.token);
            if (normEmail) await mailer.sendLinkEmail({name: resolveEmailRecipientName(newGuest.username, newGuest.profile?.name), address: normEmail}, link);
            req.flash('success', `Login successful. Use ${link} to edit later.`);
            res.redirect(buildRedirect(entityId));
        }));

    // GET /:id/duplicate
    router.get('/:id/duplicate', requirePermission(permFct, PERM.DATA_DUPLICATE), asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForDuplicate(resFct(req), req.session);
        // Duplicating copies form content, not lifecycle state. Any archive notice belongs
        // to the explicitly selected target event, independently of the source entity.
        const creationData = await getCreationData(req);
        renderer.renderWithData(res, create, {
            title: `Copy of ${resFct(req).title}`,
            entity: resFct(req),
            data: data,
            ...creationData,
            isDuplicate: true
        });
    }));

    // POST /:id/delete
    router.post('/:id/delete', requireOwner(resFct), asyncHandler(async (req: Request, res: Response) => {
        const entity: EntityBase = resFct(req);
        await deleteEntity(entity, req.session);
        if (entity.headerImg) {
            removeImage(entity.headerImg);
        }
        req.flash('success', `${entityType} deleted`);
        res.redirect('/users/dashboard');
    }));

    // Serve header image files securely
    router.get("/:id/header", asyncHandler(async (req: Request, res: Response) => {
        const entity = resFct(req);
        if (!entity?.headerImg) {
            throw new APIError('No image available', {}, 404)
        }

        // Sanitize and validate the path to prevent directory traversal
        const uploadsDir = path.resolve(process.cwd(), settings.value.headerImgDir);
        const fullPath = path.resolve(process.cwd(), entity.headerImg);

        // Use path.relative to ensure the resolved path is within uploads directory
        const relativePath = path.relative(uploadsDir, fullPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new APIError('No image available', {}, 400);
        }

        // Check if file exists (async)
        try {
            await fs.promises.access(fullPath, fs.constants.R_OK);
        } catch {
            throw new APIError('No image available', {}, 404);
        }

        // Serve the file
        res.sendFile(fullPath);
    }));

    // SAFE-ZONE middleware before accessing /:id routes
    async function requireAccess(req: Request, res: Response, next: NextFunction) {
        const entity = resFct(req);
        const event = eventResFn(req);
        if (addToEvent && event) {
            // The controller shares this rule with the event-link command's post-save
            // navigation. The middleware retains transport-specific error/guest redirects.
            if (await canAccessEntityView(entityType, {...entity, eventId: event.id}, req.session)) return next();

            // No valid registration
            throw new ExpectedError('You must be registered for the event to access this resource');
        }
        // Active session
        if (req.session.profile) return next();

        // No session → redirect to guest registration
        res.redirect(`${buildRedirect(entity.id)}/guest`);
    }

    router.use('/:id', asyncHandler(requireAccess));

    // GET /:id (view)
    router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
        const data = await fetchForView(resFct(req), req);
        if (!data) {
            throw new ValidationError(view, `${entityType} not found`, {});
        }
        // Event controllers already project the event and its attached cards together.
        // Preserve that snapshot; simpler entity pages receive their root projection here.
        // A missing projection is explicit null so the page mixin can omit the optional notice.
        const ref = {type: entityType, id: resFct(req).id};
        const archive = data.archive ?? (await getArchivePresentations([ref], req.session)).get(archiveKey(ref)) ?? null;
        const entityProperties = await getEntityPropertyPresentation(entityType, resFct(req), req.session);
        renderer.renderWithData(res, view, {...data, archive, entityProperties});
    }));

    return router;
}
