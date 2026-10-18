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

import express, {Request, Response, Router} from 'express';
import rateLimit from "express-rate-limit";
import {
    addAdmin,
    archiveEntity,
    changeEntityEvent,
    requireEntityPropertyUpdate,
    removeAdmin,
    requiredAdminManagePerm,
    restoreEntity,
    searchUsers,
    setAutomaticArchival,
    updateAdmin
} from '../controller/entityAdminController';
import type {EntityBase} from '../types/UserTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import renderer from "../modules/renderer";
import type {EntityGetter, GetResource} from "../types/PermissionTypes";
import type {CombEntityType, EntityType} from "../types/UtilTypes";
import {requirePermissionApi} from './permissionMiddleware';

const searchLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 120,                  // 120 searches / 10 min per IP
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Create admin management routes for an entity type.
 * Mount under your entity API router (which already has :id).
 *
 * Routes:
 *   POST   /:id/admins            { userprofileId, preset?, perms?[], mask? }
 *   PATCH  /:id/admins/:profileId    { perms?[], mask? }
 *   DELETE /:id/admins/:profileId
 */
export function createEntityAdminApiRouter(app: Router, entityType: CombEntityType, getEntity: EntityGetter) {
    const REQ = requiredAdminManagePerm();

    // Add
    app.post(
        '/:id/admins',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await addAdmin(entityType, req.params.id as string, req.body, req.session.profile);
            renderer.respondWithSuccessJson(res, msg);
        })
    );

    // Update mask/keys
    app.patch(
        '/:id/admins/:profileId',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await updateAdmin(entityType, req.params.id as string, req.params.profileId as string, req.body);
            renderer.respondWithSuccessJson(res, msg);
        })
    );

    // Remove
    app.delete(
        '/:id/admins/:profileId',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await removeAdmin(entityType, req.params.id as string, req.params.profileId as string);
            renderer.respondWithSuccessJson(res, msg);
        })
    );

    return app;
}

/**
 * Register lifecycle commands alongside shared entity administration routes.
 * Authorization stays in the controller so API commands and rendered capabilities
 * use the same rules, including the owner-only survey exception.
 * The feature router must already register its :id parameter loader; getResource reads
 * that resolved root, rather than trusting a second entity identifier in the request body.
 * Permanent deletion continues through each feature's existing owner-only delete route.
 */
export function createEntityArchiveApiRouter(app: Router, entityType: EntityType, getResource: GetResource) {
    // Keep the public actions finite and explicit. The command controller validates its own
    // body contract, so clients cannot write arbitrary timestamps, ownership or related roots.
    const actions = [
        {path: 'archive', run: archiveEntity, message: 'Archived for everyone'},
        {path: 'restore', run: restoreEntity, message: 'Restored for everyone'},
        {path: 'archive/automation', run: setAutomaticArchival, message: 'Automatic archival updated'},
    ];

    // A separate block-scoped action belongs to each handler. asyncHandler sends validation,
    // authentication and transaction conflicts through the existing structured API error path.
    for (const action of actions) {
        async function handleLifecycleCommand(req: Request, res: Response) {
            const reference = {type: entityType, id: getResource(req).id};
            const archive = await action.run(reference, req.body, req.session);
            // Return the freshly computed shared state; personal overview preferences are
            // handled by the user endpoint and must not become part of this entity mutation.
            renderer.respondWithSuccessDataJson(res, action.message, {archive});
        }

        app.post(`/:id/${action.path}`, asyncHandler(handleLifecycleCommand));
    }
}

/** Share root API authorization while each feature retains normalization and persistence. */
export function createEntityPropertyApiRouter(
    app: Router,
    entityType: EntityType,
    getResource: GetResource,
    updateProperties: (entity: any, body: unknown) => Promise<string>,
    invalidateEventContext?: (id: string) => void,
) {
    async function update(req: Request, res: Response) {
        const entity: EntityBase = getResource(req);
        await requireEntityPropertyUpdate(entityType, entity, req.body, req.session);
        const message = await updateProperties(entity, req.body);
        renderer.respondWithSuccessJson(res, message);
    }
    app.post('/:id/update', asyncHandler(update));
    if (!['activity', 'packing', 'drivers'].includes(entityType)) return;

    async function changeEvent(req: Request, res: Response) {
        const entity: EntityBase = getResource(req);
        const {changed, ...result} = await changeEntityEvent(entityType, entity, req.body, req.session, invalidateEventContext);
        renderer.respondWithSuccessDataJson(res, 'Linked event updated', result);
    }
    app.post('/:id/event', asyncHandler(changeEvent));
}

/** Optional: top-level typeahead */
export function createUserSearchApiRouter(path = '/search') {
    const router = express.Router();
    router.get(path, searchLimiter, asyncHandler(async (req: Request, res: Response) => {
        const q = String(req.query.q ?? '').trim();
        const limit = Number(req.query.limit ?? 10);
        const items = await searchUsers(q, limit);
        renderer.respondWithSuccessDataJson(res, "search result", items);
    }));
    return router;
}
