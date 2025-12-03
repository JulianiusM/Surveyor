// src/controller/entityAdminController.ts
import Joi from 'joi';
import * as entityAdminService from '../modules/database/services/EntityAdminService';
import * as userService from '../modules/database/services/UserService';
import {getPresetMask, PERM, toMask} from "../modules/lib/permissions";
import type {CombEntityType} from "../types/UtilTypes";

const REQ_PERM = PERM.MANAGE_PERMISSIONS;

export function requiredAdminManagePerm() {
    return REQ_PERM;
}

/** POST /admins — add admin (create or upsert) */
export async function addAdmin(entityType: CombEntityType, entityId: string, body: any) {
    const schema = Joi.object({
        userId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().trim().min(1)).required(),
        preset: Joi.string().trim().optional(),
        perms: Joi.array().items(Joi.string()).optional(),     // explicit keys override preset
        mask: Joi.number().integer().min(0).optional(),        // optional direct mask
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    // Resolve userId: numeric is used directly; string could be username/email (optional)
    let userId: number | null = null;
    if (typeof value.userId === 'number') {
        userId = value.userId;
    } else {
        // Try to resolve by search if your service supports it; otherwise force numeric
        const found = await userService.findUserByNameOrEmail?.(value.userId);
        if (!found) throw new Error('User not found');
        userId = found.id;
    }

    // Choose mask: explicit mask > perms keys > preset > 0
    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else if (value.preset) {
        const presetMask = (getPresetMask(value.preset)) ?? 0;
        mask = presetMask;
    }

    await entityAdminService.upsertAdmin(entityType, entityId, userId!, mask);
    return 'Admin added';
}

/** PATCH /admins/:userId — update admin perms */
export async function updateAdmin(entityType: CombEntityType, entityId: string, pathUserId: string, body: any) {
    const schema = Joi.object({
        perms: Joi.array().items(Joi.string()).optional(),
        mask: Joi.number().integer().min(0).optional(),
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    const userId = Number(pathUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('Invalid userId');

    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else throw new Error('Either mask or perms must be provided');

    await entityAdminService.upsertAdmin(entityType, entityId, userId, mask);
    return 'Permissions updated';
}

/** DELETE /admins/:userId — remove admin */
export async function removeAdmin(entityType: CombEntityType, entityId: string, pathUserId: string) {
    const userId = Number(pathUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('Invalid userId');

    await entityAdminService.removeAdmin(entityType, entityId, userId);
    return 'Admin removed';
}

/** Optional: GET /users/search?q=… — simple typeahead */
export async function searchUsers(q: string, limit: number = 10) {
    const query = String(q || '').trim();
    if (!query) return [];
    return await userService.searchUsersSecure(query, limit) ?? [];
}
