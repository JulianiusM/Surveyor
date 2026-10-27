import type {ComputedRef, Ref} from 'vue';
import type {useCommand} from '../frontend/composables/command';
import type {FrontendRead, FrontendRequestScope} from './FrontendUiTypes';
import type {FrontendEventPickerSource, FrontendPlainMessageKey} from './FrontendUiTypes';
import type {components} from './api/v1';

/** Features select their own operation and actor/resource query families. Shared
 * list reads own request retirement and stale presentation, never business grants. */
export interface FrontendListSource<T> {
    resourceId: ComputedRef<string>;
    queryKey: ComputedRef<readonly unknown[]>;
    resourceFamily(): readonly unknown[];
    read(id: string, scope: FrontendRequestScope, signal: AbortSignal, previous?: FrontendRead<T>): Promise<FrontendRead<T>>;
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

/** Matching list actions need only the admitted row's identity and self membership. */
export interface FrontendListActionItem {
    id: string;
    selfAssigned: boolean;
}

/** Share list-action orchestration without copying feature drafts or selecting endpoints.
 * The existing command remains the only dispatch, confirmation and recovery owner. */
export interface FrontendListActionSource {
    command: Pick<ReturnType<typeof useCommand>, 'action' | 'run'>;
    pendingControl: Ref<FrontendListPendingControl | null>;
    assign(itemId: string, assigned: boolean, scope: FrontendRequestScope): Promise<unknown>;
    removeItem(itemId: string, scope: FrontendRequestScope): Promise<unknown>;
    removeAssignment(assignmentId: string, scope: FrontendRequestScope): Promise<unknown>;
    addItem(scope: FrontendRequestScope): Promise<unknown>;
    resetItem(): void;
    messages: {
        assigned: FrontendPlainMessageKey;
        unassigned: FrontendPlainMessageKey;
        confirmDelete: FrontendPlainMessageKey;
        deleted: FrontendPlainMessageKey;
    };
}

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
export interface FrontendListCreationCopy {
    title: string;
    description: string | null;
    defaultPermissions: components['schemas']['PermissionDefaults'];
    formContext: components['schemas']['EntityCreationContext'];
    selectedEvent?: components['schemas']['EventPickerOption'] | null;
}

/** One feature supplies generated operations, scoped keys and its item
 * collector. The shared form has no endpoint construction or business checks. */
export interface FrontendListCreationSource<TCopy extends FrontendListCreationCopy> {
    creationKey(context: string | null | undefined, eventId?: string): readonly unknown[];
    duplicateKey(context: string | null | undefined, id: string | null, eventId?: string): readonly unknown[];
    eventPicker: FrontendEventPickerSource;
    initialContext?: components['schemas']['EntityCreationContext'];
    initialSelectedEvent?: components['schemas']['EventPickerOption'] | null;
    initialDuplicate?: TCopy;
    initialError?: FrontendPlainMessageKey;
    createEntry(scope: FrontendRequestScope, signal?: AbortSignal, returnTo?: string, eventId?: string): Promise<components['schemas']['EntityCreationEntry']>;
    duplicate(id: string, scope: FrontendRequestScope, signal?: AbortSignal, eventId?: string): Promise<TCopy>;
    initialize?(copy?: TCopy): void;
    reset?(): void;
    draft?(): unknown;
    destination(result: components['schemas']['EntityCreationResult']): string;
    prepare(values: FrontendListCreationValues, image: File | null):
        {error: FrontendPlainMessageKey} | {operation(scope: FrontendRequestScope): Promise<components['schemas']['EntityCreationResult']>};
}
