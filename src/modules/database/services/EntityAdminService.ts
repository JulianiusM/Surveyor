// src/modules/database/services/EntityAdminService.ts
import {AppDataSource} from '../dataSource';
import {EntityAdminAssignment as ACL} from '../entities/permissions/EntityAdminAssignment';
import {EntityPermissions} from "../entities/permissions/EntityPermissions";
import {Audience, PermData} from "../../../types/PermissionTypes";
import {CombEntityType} from "../../../types/UtilTypes";

export async function addAdmin(entityType: CombEntityType, entityId: string, userId: number, perms: number, createdBy?: number) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.save(repo.create({entityType, entityId, user: {id: userId}, perms, createdBy: createdBy ?? null}));
}

export async function upsertAdmin(entityType: CombEntityType, entityId: string, userId: number, perms: number) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.upsert(
        repo.create({entityType, entityId, user: {id: userId}, perms}),
        ['entityType', 'entityId', 'user']
    );
}

export async function removeAdmin(entityType: CombEntityType, entityId: string, userId: number) {
    const repo = AppDataSource.getRepository(ACL);
    await repo.delete({entityType, entityId, user: {id: userId}});
}

export async function listAdmins(entityType: CombEntityType, entityId: string) {
    const repo = AppDataSource.getRepository(ACL);
    // join users if you want to render names/emails
    return await repo.find({where: {entityType, entityId}, relations: ['user']});
}

export async function updateAdminPerms(entityType: CombEntityType, entityId: string, userId: number, perms: number) {
    await AppDataSource.getRepository(ACL).update({entityType, entityId, user: {id: userId}}, {perms});
}

export async function getUserPerms(entityType: CombEntityType, entityId: string, userId: number): Promise<number> {
    const row = await AppDataSource.getRepository(ACL).findOne({where: {entityType, entityId, user: {id: userId}}});
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

    await repo.upsert(rows, {
        // matches UNIQUE(entity_type, entity_id, audience)
        conflictPaths: ['entityType', 'entityId', 'audience'],
        skipUpdateIfNoValuesChanged: true,
    });
}

export async function getIdsForUser(entityType: CombEntityType, userId: number, mask: number = 0): Promise<Array<string>> {
    const repo = AppDataSource.getRepository(ACL);
    const ids = await repo.createQueryBuilder("e")
        .where('(e.perms & :mask) = :mask', {mask})
        .andWhere('e.user_id = :userId', {userId})
        .andWhere('e.entity_type = :entityType', {entityType})
        .select("e.entity_id").getRawMany();
    return (ids ?? []).map(i => i.entity_id);
}
