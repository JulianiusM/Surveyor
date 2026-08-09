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
    removeAdmin,
    requiredAdminManagePerm,
    searchUsers,
    updateAdmin
} from '../controller/entityAdminController';
import {asyncHandler} from '../modules/lib/asyncHandler';
import renderer from "../modules/renderer";
import type {EntityGetter} from "../types/PermissionTypes";
import type {CombEntityType} from "../types/UtilTypes";
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