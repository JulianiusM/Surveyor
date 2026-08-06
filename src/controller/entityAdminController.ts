// src/controller/entityAdminController.ts
import Joi from 'joi';
import {Profile} from "../modules/database/entities/user/Profile";
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
        profileId: Joi.string().uuid().required(),
        preset: Joi.string().trim().optional(),
        perms: Joi.array().items(Joi.string()).optional(),     // explicit keys override preset
        mask: Joi.number().integer().min(0).optional(),        // optional direct mask
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    const profile: Profile | null = await userService.getProfileById(value.profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    // Choose mask: explicit mask > perms keys > preset > 0
    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else if (value.preset) {
        const presetMask = (getPresetMask(value.preset)) ?? 0;
        mask = presetMask;
    }

    await entityAdminService.upsertAdmin(entityType, entityId, profile.id, mask);
    return 'Admin added';
}

export async function updateAdmin(entityType: CombEntityType, entityId: string, profileId: string, body: any) {
    const schema = Joi.object({
        perms: Joi.array().items(Joi.string()).optional(),
        mask: Joi.number().integer().min(0).optional(),
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    const profile: Profile | null = await userService.getProfileById(profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else throw new Error('Either mask or perms must be provided');

    await entityAdminService.upsertAdmin(entityType, entityId, profileId, mask);
    return 'Permissions updated';
}

export async function removeAdmin(entityType: CombEntityType, entityId: string, profileId: string) {
    const profile: Profile | null = await userService.getProfileById(profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    await entityAdminService.removeAdmin(entityType, entityId, profileId);
    return 'Admin removed';
}

/** Optional: GET /users/search?q=… — simple typeahead */
export async function searchUsers(q: string, limit: number = 10) {
    const query = String(q || '').trim();
    if (!query) return [];
    return await userService.searchUsersSecure(query, limit) ?? [];
}
