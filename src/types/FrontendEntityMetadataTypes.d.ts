import type {FrontendMetadataFieldPolicy, FrontendMetadataSnapshot, FrontendRead, FrontendRequestScope} from './FrontendUiTypes';

/** Scalar presentation drafts; feature-generated declarations retain wire authority. */
export type EntityMetadataValues = Record<string, string | number | boolean | null | undefined>;
export type EntityMetadataSnapshot = FrontendMetadataSnapshot<EntityMetadataValues>;

/** Mounted metadata workflow shared by feature adapters and their settings host.
 * Values are Vue's unwrapped public flags; the editor remains their only owner. */
export interface EntityMetadataEditorHandle {
    mayLeave(): boolean;
    pending: boolean;
    refreshing: boolean;
    unknown: boolean;
    dirty: boolean;
    awaitingAuthority: boolean;
    retryAvailable: boolean;
    refresh(discard?: boolean): Promise<void> | undefined;
    refreshAfterSettings(discard?: boolean): Promise<void> | undefined;
}

/** Inject the feature's generated API selection and normalization into one draft owner. */
export interface EntityMetadataEditorProps {
    resourceId: string;
    resourceTitle?: string;
    formId: string;
    disabled?: boolean;
    busy?: boolean;
    active?: boolean;
    queryKey: readonly unknown[];
    fieldPolicy?: FrontendMetadataFieldPolicy<EntityMetadataValues>;
    preparePatch?: (patch: EntityMetadataValues, values: EntityMetadataValues) => EntityMetadataValues;
    fieldLabel: (field: string) => string;
    read: (id: string, scope: FrontendRequestScope, signal?: AbortSignal,
        previous?: FrontendRead<EntityMetadataSnapshot>) => Promise<FrontendRead<EntityMetadataSnapshot>>;
    save: (id: string, patch: EntityMetadataValues, token: string,
        scope: FrontendRequestScope) => Promise<FrontendRead<EntityMetadataSnapshot>>;
}
