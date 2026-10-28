import type {components} from './api/v1';
import type {ListPersistenceType} from './ListPersistenceTypes';
import type {PermView, SessionLike} from './PermissionTypes';

/** Wire projections remain owned by the authored feature schemas. */
export interface ListMetadataViews {
    packing: components['schemas']['PackingMetadata'];
    drivers: components['schemas']['DriversMetadata'];
}
export interface ListMetadataPatches {
    packing: components['schemas']['BasicEntityMetadataPatch'];
    drivers: components['schemas']['DriversMetadataPatch'];
}
export interface ListMetadataResult<Type extends ListPersistenceType> {
    data: ListMetadataViews[Type];
    etag: string;
}

/** Direct callers keep their captured association and root-only persistence scope. */
export interface DirectListMetadataContext {
    kind: 'direct';
    expectedEventId?: string | null;
}
export interface VersionedListMetadataContext<Type extends ListPersistenceType> {
    kind: 'versioned';
    ifMatch?: string;
    session: SessionLike;
    prepare?: (result: ListMetadataResult<Type>) => void;
}
export interface DescriptionListMetadataContext {
    kind: 'description';
    ifMatch?: string;
    session: SessionLike;
    mayPerform(permissions: PermView, method: 'editDescription'): boolean;
    prepare?: (result: components['schemas']['EntityDescriptionBaseline']) => void;
}
export type ListMetadataContext<Type extends ListPersistenceType> = DirectListMetadataContext
    | VersionedListMetadataContext<Type> | DescriptionListMetadataContext;
