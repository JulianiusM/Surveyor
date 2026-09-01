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

// src/modules/database/services/EntityAdminService.ts
import type {Audience, PermData} from "../../../types/PermissionTypes";
import type {CombEntityType} from "../../../types/UtilTypes";
import {AppDataSource} from '../dataSource';
import {EntityAdminAssignment as ACL} from '../entities/permissions/EntityAdminAssignment';
import {EntityPermissions} from "../entities/permissions/EntityPermissions";

export async function addAdmin(entityType: CombEntityType, entityId: string, profileId: string, perms: number, createdBy?: number) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.save(repo.create({entityType, entityId, profile: {id: profileId}, perms, createdBy: createdBy ?? null}));
}

export async function upsertAdmin(entityType: CombEntityType, entityId: string, profileId: string, perms: number) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.upsert(
        repo.create({entityType, entityId, profile: {id: profileId}, perms}),
        ['entityType', 'entityId', 'profile']
    );
}

export async function removeAdmin(entityType: CombEntityType, entityId: string, profileId: string) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.delete({entityType, entityId, profile: {id: profileId}});
}

export async function listAdmins(entityType: CombEntityType, entityId: string) {
    const repo = AppDataSource.getRepository(ACL);
    // join users if you want to render names/emails
    return await repo.find({
        where: {entityType, entityId}, relations: {
            profile: {
                user: true,
                guest: true,
            }
        }
    });
}

export async function updateAdminPerms(entityType: CombEntityType, entityId: string, profileId: string, perms: number) {
    await AppDataSource.getRepository(ACL).update({entityType, entityId, profile: {id: profileId}}, {perms});
}

export async function isAdmin(entityType: CombEntityType, entityId: string, profileId: string) {
    const repo = AppDataSource.getRepository(ACL);
    return await repo.exists({where: {entityType, entityId, profile: {id: profileId}}});
}

export async function getProfilePerms(entityType: CombEntityType, entityId: string, profileId: string): Promise<number> {
    const row = await AppDataSource.getRepository(ACL).findOne({
        where: {
            entityType,
            entityId,
            profile: {id: profileId}
        }
    });
    return row?.perms ?? 0;
}

export async function getDefaultPerms(entityType: CombEntityType, entityId: string): Promise<PermData> {
    const rows = await AppDataSource.getRepository(EntityPermissions).find({where: {entityType, entityId}});
    const out: Partial<Record<Audience, number>> = {};
    for (const r of rows) out[r.audience] = r.perms;
    return out; // keys: participant, guest, authenticated, public
}

/**
 * Upsert default permissions (bitmask) for the given entity and audience(s).
 * - Only audiences provided in `opts` are touched.
 * - To clear an audience, pass mask 0 for that audience.
 */
export async function updatePerms(
    entityType: CombEntityType,
    entityId: string,
    opts: {
        guest?: number;
        participant?: number;
        authenticated?: number;
        public?: number;
    }
): Promise<void> {
    const repo = AppDataSource.getRepository(EntityPermissions);

    const rows: Array<{ entityType: CombEntityType; entityId: string; audience: Audience; perms: number }> = [];

    const push = (aud: Audience, mask: number | undefined) => {
        if (mask === undefined) return;                  // untouched if not provided
        rows.push({entityType, entityId, audience: aud, perms: mask});
    };

    push('guest', opts.guest);
    push('participant', opts.participant);
    push('authenticated', opts.authenticated);
    push('public', opts.public);

    if (!rows.length) return;

    const current = await getDefaultPerms(entityType, entityId);
    const changedRows = rows.filter((row) => current[row.audience] !== row.perms);
    if (!changedRows.length) return;

    await repo.upsert(changedRows, {
        // matches UNIQUE(entity_type, entity_id, audience)
        conflictPaths: ['entityType', 'entityId', 'audience'],
        skipUpdateIfNoValuesChanged: true,
    });
}

export async function getIds(entityType: CombEntityType, profileId: string, mask: number = 0): Promise<Array<string>> {
    const repo = AppDataSource.getRepository(ACL);
    const ids = await repo.createQueryBuilder("e")
        .where('(e.perms & :mask) = :mask', {mask})
        .andWhere('e.profile_id = :profileId', {profileId})
        .andWhere('e.entity_type = :entityType', {entityType})
        .select("e.entity_id").getRawMany();
    return (ids ?? []).map(i => i.entity_id);
}
