import type {EntityManager} from 'typeorm';
import type {EntityBase} from '../../../types/UserTypes';
import type {ListPersistenceType} from '../../../types/ListPersistenceTypes';
import type {BasicEntityPropertyField, BasicEntityPropertyPatch, BasicEntityPropertyValues} from '../../../types/EntityPropertyTypes';
import type {LockedArchiveContext} from '../../../types/ArchiveTypes';
import type {PermEngineCaches, PermView, SessionLike} from '../../../types/PermissionTypes';
import type {components} from '../../../types/api/v1';
import type {DirectListMetadataContext, VersionedListMetadataContext, DescriptionListMetadataContext,
    ListMetadataContext, ListMetadataPatches, ListMetadataResult, ListMetadataViews} from '../../../types/ListMetadataTypes';
import {comparisonActor, comparisonToken, requireFieldComparison} from '../api/transport';
import {ApiProblem} from '../api/problem';
import {sameUuid, uuidKey} from '../lib/util';
import {entityPropertyPermission, evaluateSubject} from '../permissionEngine';
import {assertEntityPropertyContext} from '../event/linkage';
import {withListRootLock} from '../database/services/ListService';
import {withLockedArchiveTarget} from '../database/services/EntityLifecycleService';
import {getPackingSnapshotRoot, updatePackingListProperties} from '../database/services/PackingService';
import {getDriversSnapshotRoot, updateDriversListProperties} from '../database/services/DriverService';

type ListRoot = EntityBase & {archivedAt?: Date | null; event?: {archivedAt?: Date | null} | null};
const readRoot = {packing: getPackingSnapshotRoot, drivers: getDriversSnapshotRoot};
const writeProperties = {packing: updatePackingListProperties, drivers: updateDriversListProperties};

/** Root fields retain the existing direct property policy, independent of item/method grants. */
export function mayEditListMetadataField(type: ListPersistenceType, permissions: PermView, field: BasicEntityPropertyField): boolean {
    return permissions.has(entityPropertyPermission(type, field)!);
}

/** Disclose only fields granted by the shared property policy, in their existing order. */
export function listMetadataProjection<Type extends ListPersistenceType>(type: Type, list: ListRoot,
    permissions: PermView): ListMetadataViews[Type] {
    const values: BasicEntityPropertyValues = {};
    const editableFields: BasicEntityPropertyField[] = [];
    // The metadata grant controls each value and its edit affordance together.
    for (const field of ['title', 'description'] as const) {
        if (!mayEditListMetadataField(type, permissions, field)) continue;
        editableFields.push(field);
        if (field === 'title') values.title = list.title;
        else values.description = list.description ?? null;
    }
    // Both authored feature projections have this same field shape; the caller's
    // discriminator selects its exact generated result rather than an intersection.
    return {entityType: type, id: list.id, values, editableFields, currentEventId: list.eventId ?? null,
        archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt)} as ListMetadataViews[Type];
}

/** Conditional reads hash presentation context; sparse writes compare only submitted fields. */
export function listMetadataResult<Type extends ListPersistenceType>(type: Type, list: ListRoot,
    permissions: PermView, session: SessionLike): ListMetadataResult<Type> {
    const data = listMetadataProjection(type, list, permissions);
    const etag = comparisonToken(`${type}-meta`, list.id, session, {...data.values,
        currentEventId: data.currentEventId, archived: data.archived, inheritedArchived: data.inheritedArchived});
    return {data, etag};
}

/** Description-only methods expose their own existing token domain and field subset. */
export function listDescriptionBaseline(type: ListPersistenceType, list: EntityBase,
    session: SessionLike): components['schemas']['EntityDescriptionBaseline'] {
    const description = list.description ?? null;
    return {description, editToken: comparisonToken(`${type}-meta`, list.id, session, {description})};
}

/** Reject a disappeared or reassociated root after its existing parent/root locks. */
export function assertListContext(context: LockedArchiveContext): void {
    if (!context.root) throw new ApiProblem('NOT_FOUND');
    if (context.initialEventId !== context.root.eventId && !sameUuid(context.initialEventId, context.root.eventId)
        || (context.root.eventId && !context.parents.has(uuidKey(context.root.eventId)))) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
}

/** Read current grants on this supplied snapshot independently of page/profile admission. */
export function listPermissions(type: ListPersistenceType, manager: EntityManager, list: EntityBase,
    session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    comparisonActor(session);
    return evaluateSubject({kind: 'entity', entity: {entityType: type, entityId: list.id,
            ownerId: list.ownerId, eventId: list.eventId}}, session, caches, manager);
}

/** One actual feature operation owns matching metadata decisions for both list domains. */
export function saveListMetadata<Type extends ListPersistenceType>(type: Type, id: string,
    patch: BasicEntityPropertyPatch, context: DirectListMetadataContext): Promise<void>;
export function saveListMetadata<Type extends ListPersistenceType>(type: Type, id: string,
    patch: ListMetadataPatches[Type], context: VersionedListMetadataContext<Type>): Promise<ListMetadataResult<Type>>;
export function saveListMetadata<Type extends ListPersistenceType>(type: Type, id: string,
    patch: components['schemas']['EntityDescriptionPatch'], context: DescriptionListMetadataContext): Promise<components['schemas']['EntityDescriptionBaseline']>;
/** Retain each adapter's admission and completion timing around the original DBAL owners.
 * Direct edits lock the root only. Versioned edits retain parent/root coordination;
 * optional Drivers preparation remains inside the same transaction before commit. */
export async function saveListMetadata<Type extends ListPersistenceType>(type: Type, id: string,
    patch: BasicEntityPropertyPatch, context: ListMetadataContext<Type>): Promise<void | ListMetadataResult<Type>
        | components['schemas']['EntityDescriptionBaseline']> {
    /** Interpret locked evidence, check exactly the requested fields, then perform sparse persistence. */
    async function persistMetadata(manager: EntityManager, row: EntityBase | null) {
        let permissions: PermView | undefined;
        if (context.kind === 'direct') {
            assertEntityPropertyContext(row, context.expectedEventId);
        } else {
            const list = requireRoot(row);
            permissions = await listPermissions(type, manager, list, context.session);
            // Independently granted description and mixed property editing retain
            // their separate method/field and disclosure/comparison contracts.
            if (context.kind === 'description') {
                if (!context.mayPerform(permissions, 'editDescription')) throw new ApiProblem('FORBIDDEN');
                requireFieldComparison(context.ifMatch, listDescriptionBaseline(type, list, context.session).editToken, ['description']);
            } else {
                for (const field of Object.keys(patch) as BasicEntityPropertyField[]) {
                    if (!mayEditListMetadataField(type, permissions, field)) throw new ApiProblem('FORBIDDEN');
                }
                requireFieldComparison(context.ifMatch, listMetadataResult(type, list, permissions, context.session).etag, Object.keys(patch));
            }
        }

        // Keep the exact existing write/readback order on this manager. The direct
        // path has no result read; a prepared Drivers response may still roll back.
        await writeProperties[type](id, patch, manager);
        if (context.kind !== 'direct') {
            const saved = requireRoot(await readRoot[type](manager, id));
            if (context.kind === 'description') {
                const result = listDescriptionBaseline(type, saved, context.session);
                context.prepare?.(result);
                return result;
            }
            const result = listMetadataResult(type, saved, permissions!, context.session);
            context.prepare?.(result);
            return result;
        }
    }
    if (context.kind === 'direct') return withListRootLock(type, id, persistMetadata);

    /** Preserve parent association validation before the same feature snapshot read. */
    async function updateLocked(manager: EntityManager, locked: LockedArchiveContext) {
        assertListContext(locked);
        return persistMetadata(manager, await readRoot[type](manager, id));
    }
    return withLockedArchiveTarget({type, id}, updateLocked);
}

/** Missing evidence remains a feature rejection rather than a DBAL request error. */
function requireRoot(row: EntityBase | null): EntityBase {
    if (!row) throw new ApiProblem('NOT_FOUND');
    return row;
}
