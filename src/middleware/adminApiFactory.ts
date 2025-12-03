import express, {Request, Response, Router} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {requirePermissionApi} from './permissionMiddleware';
import {
    addAdmin,
    removeAdmin,
    requiredAdminManagePerm,
    searchUsers,
    updateAdmin
} from '../controller/entityAdminController';
import {EntityGetter} from "../types/PermissionTypes";
import {CombEntityType} from "../types/UtilTypes";
import renderer from "../modules/renderer";
import rateLimit from "express-rate-limit";

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
 *   POST   /:id/admins            { userId, preset?, perms?[], mask? }
 *   PATCH  /:id/admins/:userId    { perms?[], mask? }
 *   DELETE /:id/admins/:userId
 */
export function createEntityAdminApiRouter(app: Router, entityType: CombEntityType, getEntity: EntityGetter) {
    const REQ = requiredAdminManagePerm();

    // Add
    app.post(
        '/:id/admins',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await addAdmin(entityType, req.params.id, req.body);
            renderer.respondWithSuccessJson(res, msg);
        })
    );

    // Update mask/keys
    app.patch(
        '/:id/admins/:userId',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await updateAdmin(entityType, req.params.id, req.params.userId, req.body);
            renderer.respondWithSuccessJson(res, msg);
        })
    );

    // Remove
    app.delete(
        '/:id/admins/:userId',
        requirePermissionApi(getEntity, REQ),
        asyncHandler(async (req: Request, res: Response) => {
            const msg = await removeAdmin(entityType, req.params.id, req.params.userId);
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