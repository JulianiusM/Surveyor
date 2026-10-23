import type {ComputedRef} from 'vue';
import type {PilotRead, PilotRequestScope} from './FrontendPilotUiTypes';
import type {PilotEventPickerSource, PilotPlainMessageKey} from './FrontendPilotUiTypes';
import type {components} from './api/v1';

/** Features select their own operation and actor/resource query families. Shared
 * list reads own request retirement and stale presentation, never business grants. */
export interface FrontendListSource<T> {
    resourceId: ComputedRef<string>;
    queryKey: ComputedRef<readonly unknown[]>;
    resourceFamily(): readonly unknown[];
    read(id: string, scope: PilotRequestScope, signal: AbortSignal, previous?: PilotRead<T>): Promise<PilotRead<T>>;
    denied(failure: Error): void;
}

/** A drag gesture captures a reviewed order once. Feature commands still own the
 * server operation, comparison token validation and confirmed refresh. */
export interface FrontendListReorderSource {
    available(): boolean;
    ids(): string[];
    token(): string | undefined;
    submit(ids: string[], token: string): Promise<unknown>;
}

/** Quick Add retains the native number input's number-or-lexical value. Empty
 * or invalid input remains text until the feature's existing submit collector
 * applies its own default; presentation must not replace that draft with zero. */
export interface FrontendListQuickAddValues {
    description: string;
    maxAssignees: number | string;
}

/** Only identify a matching list control's current initiating operation. Actual
 * command authority, pending/unknown receipts and row data stay with their owners. */
export type FrontendListPendingControl = {kind: 'add'} | {kind: 'assign' | 'delete' | 'assignment' | 'required'; id: string};

/** Matching detail workflows supply their actual read and lifetime. The shared
 * command composition owns recovery/status only, never rows, drafts or grants. */
export interface FrontendListCommandSource {
    active(): boolean;
    denied(): boolean;
    reading(): boolean;
    error(): Error | null;
    refresh(): Promise<void>;
}

/** Features choose which editor projections retire and how to identify the live
 * resource. The shared lifetime neither infers grants nor chooses a feature key. */
export interface FrontendListSettingsRetirement {
    resourceId: string;
    currentResource(): string;
    families: readonly (readonly unknown[])[];
}

/** The caller retains recovery semantics and its optional receipt. Retirement
 * waits for completion without interpreting that result as new authority. */
export interface FrontendListSettingsRetirementSource {
    active(): boolean;
    refresh(): Promise<unknown>;
}

/** Matching list creation forms share root fields; feature collections remain
 * in their own draft owner and are read only at the explicit submit boundary. */
export interface FrontendListCreationValues {
    title: string;
    description: string | null;
    eventId: string | null;
    defaultPermissions: components['schemas']['PermissionDefaults'];
}

/** The root copy protocol deliberately excludes rides, assignments and authors.
 * Packing extends this projection with its own copyable collection rows. */
export type FrontendListCreationCopy = Pick<components['schemas']['PackingDuplicate'],
    'title' | 'description' | 'defaultPermissions' | 'formContext' | 'selectedEvent'>;

/** One feature supplies generated operations, scoped keys and its native item
 * collector. The shared form has no endpoint construction or business checks. */
export interface FrontendListCreationSource<TCopy extends FrontendListCreationCopy> {
    creationKey(context: string | null | undefined, eventId?: string): readonly unknown[];
    duplicateKey(context: string | null | undefined, id: string | null, eventId?: string): readonly unknown[];
    eventPicker: PilotEventPickerSource;
    initialContext?: components['schemas']['PackingCreateContext'];
    initialSelectedEvent?: components['schemas']['EventPickerOption'] | null;
    initialDuplicate?: TCopy;
    initialError?: PilotPlainMessageKey;
    createEntry(scope: PilotRequestScope, signal?: AbortSignal, returnTo?: string, eventId?: string): Promise<components['schemas']['PackingCreateEntry']>;
    duplicate(id: string, scope: PilotRequestScope, signal?: AbortSignal, eventId?: string): Promise<TCopy>;
    initialize?(copy?: TCopy): void;
    reset?(): void;
    draft?(): unknown;
    destination(result: components['schemas']['PackingCreated']): string;
    prepare(values: FrontendListCreationValues, image: File | null):
        {error: PilotPlainMessageKey} | {operation(scope: PilotRequestScope): Promise<components['schemas']['PackingCreated']>};
}
