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
import {Brackets, In, type EntityManager, type FindOptionsWhere, type ObjectLiteral, type Repository, type SelectQueryBuilder, type WhereExpressionBuilder} from "typeorm";
import type {Audience, EntityDescriptor, EntityPermissionQueryScope, PermData} from "../../../types/PermissionTypes";
import type {CombEntityType, EntityType} from "../../../types/UtilTypes";
import {AppDataSource} from '../dataSource';
import {EntityAdminAssignment as ACL} from '../entities/permissions/EntityAdminAssignment';
import {EntityPermissions} from "../entities/permissions/EntityPermissions";
import {EventRegistration} from "../entities/event/EventRegistration";
import {Event} from "../entities/event/Event";

/**
 * Share overview membership between full discovery and a single-target visibility write.
 * An assignment places a card in administration; it does not authorize lifecycle actions.
 * Those still require the permission engine's effective EDIT_META grant.
 * Return a query builder using the stable alias "entity" so callers can add a target ID
 * or choose their own result shape. Use the supplied repository's manager to preserve any
 * caller transaction rather than silently switching membership checks to the global manager.
 */
export function createManagedEntityQuery<T extends ObjectLiteral>(repo: Repository<T>, entityType: EntityType, profileId: string) {
    const query = repo.createQueryBuilder('entity');
    // Group owner OR assignment before callers append conditions; an ID restriction must
    // apply to both membership routes, not only to the final side of the OR expression.
    query.where(new Brackets(where => {
        where.where('entity.owner_id = :overviewProfileId', {overviewProfileId: profileId});
        // Surveys deliberately remain owner-only; their peer features' ACLs do not apply.
        if (entityType !== 'survey') {
            // EXISTS answers membership without multiplying root rows through an ACL join.
            // Include both type and ID because assignments address several entity tables.
            const assignments = repo.manager.getRepository(ACL).createQueryBuilder('overviewAdmin')
                .select('1')
                .where('overviewAdmin.entity_id = entity.id')
                .andWhere('overviewAdmin.entity_type = :overviewEntityType', {overviewEntityType: entityType})
                .andWhere('overviewAdmin.profile_id = :overviewProfileId', {overviewProfileId: profileId});
            where.orWhere(`EXISTS (${assignments.getQuery()})`, assignments.getParameters());
        }
    }));
    return query;
}

/**
 * Load permission inputs in batches, without introducing another authorization rule.
 * The existing permission engine still combines owner, individual and audience grants.
 * Event registration is needed for participant-audience grants on linked entities too.
 * Return raw grants, registrations and parent-event ownership for request-local caches.
 * Root ownership already lives in descriptors; parent ownership needs its own batched read
 * because a child can be owned by another profile and still use event membership defaults.
 */
export async function getEntityPermissionInputs(entities: EntityDescriptor[], profileId?: string | null, manager: EntityManager = AppDataSource.manager) {
    if (!entities.length) {
        // An empty TypeORM where-array must never become an unrestricted permission-table read.
        return {individual: [], defaults: [], registrations: [], ownedEvents: []};
    }
    const targets: FindOptionsWhere<EntityPermissions>[] = [];
    const profileTargets: FindOptionsWhere<ACL>[] = [];
    const eventIds = new Set<string>();
    // TypeORM treats each where-array element as an alternative. Keep type and ID together
    // in each element so an ID from one entity kind cannot select another kind's grants.
    // A Set collapses the repeated event membership input from multiple attached roots.
    for (const entity of entities) {
        const target = {entityType: entity.entityType, entityId: entity.entityId};
        targets.push(target);
        if (profileId) {
            profileTargets.push({...target, profile: {id: profileId}});
        }
        if (entity.eventId) {
            eventIds.add(entity.eventId);
        }
    }

    // The independent inputs can load together. Anonymous viewers still need audience
    // defaults, but have no individual grants or event registrations to look up. Registration
    // projection includes the event ID because that, not the registration ID, keys the cache.
    // Event ownership is a separate raw input: the permission engine decides how ownership
    // contributes to membership, including for children owned by another profile.
    const [individual, defaults, registrations, ownedEvents] = await Promise.all([
        profileId ? manager.getRepository(ACL).find({where: profileTargets}) : [],
        manager.getRepository(EntityPermissions).find({where: targets}),
        profileId && eventIds.size ? manager.getRepository(EventRegistration).find({
            where: {profile: {id: profileId}, event: {id: In(Array.from(eventIds))}},
            select: {id: true, event: {id: true}},
            relations: {event: true},
        }) : [],
        profileId && eventIds.size ? manager.getRepository(Event).find({
            where: {id: In(Array.from(eventIds)), owner: {id: profileId}}, select: {id: true},
        }) : [],
    ]);
    return {individual, defaults, registrations, ownedEvents};
}

/**
 * Translate engine-provided candidate scope to SQL before LIMIT. No session or audience
 * policy is inferred here. EXISTS preserves one root row even when multiple ACL rows match;
 * all polymorphic lookups constrain both type and ID. The event expression is an internal
 * schema expression supplied by a service, never request text or an authorization decision.
 */
export function addEntityPermissionCandidates<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, type: EntityType, scope: EntityPermissionQueryScope, eventIdExpression: string): void {
    const alias = query.alias;
    const manager = query.connection.manager;
    // One requested permission bit means a matching grant row is sufficient. Numeric masks
    // and active-profile identity come from the engine, while these clauses only read storage.
    const assignments = manager.getRepository(ACL).createQueryBuilder('permissionAssignment')
        .select('1').where(`permissionAssignment.entity_id = ${alias}.id`)
        .andWhere('permissionAssignment.entity_type = :permissionEntityType')
        .andWhere('permissionAssignment.profile_id = :permissionProfileId')
        .andWhere('(permissionAssignment.perms & :permissionMask) <> 0');
    const registrations = manager.getRepository(EventRegistration).createQueryBuilder('permissionRegistration')
        .select('1').where(`permissionRegistration.event_id = ${eventIdExpression}`)
        .andWhere('permissionRegistration.profile_id = :permissionProfileId');
    const defaults = manager.getRepository(EntityPermissions).createQueryBuilder('permissionDefault')
        .select('1').where(`permissionDefault.entity_id = ${alias}.id`)
        .andWhere('permissionDefault.entity_type = :permissionEntityType')
        .andWhere('(permissionDefault.perms & :permissionMask) <> 0');
    const audiencePredicate = 'permissionDefault.audience IN (:...permissionAudiences)';
    // Nonparticipant audiences are already selected by the engine. Participant rows also
    // need a matching registration; its EXISTS uses the same profile and current event ID.
    defaults.andWhere(scope.profileId
        ? `(${audiencePredicate} OR (permissionDefault.audience = 'participant' AND EXISTS (${registrations.getQuery()})))`
        : audiencePredicate);
    function alternatives(where: WhereExpressionBuilder): void {
        where.where(`EXISTS (${defaults.getQuery()})`);
        if (scope.profileId) {
            where.orWhere(`${alias}.owner_id = :permissionProfileId`);
            where.orWhere(`EXISTS (${assignments.getQuery()})`);
        }
    }
    // Group alternatives before search/date conditions are appended, so no owner/grant
    // alternative can accidentally bypass a filter. All values use bound parameters.
    query.andWhere(new Brackets(alternatives)).setParameters({permissionEntityType: type,
        permissionProfileId: scope.profileId, permissionMask: scope.requiredMask, permissionAudiences: scope.audiences});
}

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
