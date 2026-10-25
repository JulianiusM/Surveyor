import type {FrontendEventPickerSelection, FrontendEventPickerSource, FrontendImageRead, FrontendPlainMessageKey,
    FrontendRequestScope} from './FrontendUiTypes';

/** One displayed entity header receives only its feature's admitted presentation.
 * The exact query key supplies successful read receipts; it grants no image or
 * settings authority. Parent URLs retain their existing feature-owned destination. */
export interface EntityHeaderProps {
    resourceId: string;
    title: string;
    icon: string;
    imageVersion?: string | null;
    imageQueryKey: readonly unknown[];
    readImage: FrontendImageRead;
    imageEnabled?: boolean;
    parentUrl?: string | null;
    settingsAvailable?: boolean;
    settingsDisabled?: boolean;
}

/** The feature selects the existing lifecycle operations; this shared contract
 * has no endpoint, permission, draft, persistence or command-state ownership. */
export interface EntityLifecycleOperations {
    archive(id: string, restore: boolean, scope: FrontendRequestScope): Promise<unknown>;
    automate?: (id: string, paused: boolean, scope: FrontendRequestScope) => Promise<unknown>;
}

/** Permanent deletion shares whole-page departure consent and delivery recovery.
 * The feature supplies its captured operation and established catalog wording. */
export interface EntityRemovalRequest {
    operation(scope: FrontendRequestScope): Promise<unknown>;
    confirmation: FrontendPlainMessageKey;
    success: FrontendPlainMessageKey;
}

/** Callers may preserve feature-specific wording without copying action policy. */
export interface EntityAutomationMessages {
    confirmResume: FrontendPlainMessageKey;
    pausedSuccess: FrontendPlainMessageKey;
    resumedSuccess: FrontendPlainMessageKey;
}

/** Feature-owned wording for the shared header editor; all values come from the catalog. */
export interface EntityHeaderLabels {
    title: string;
    choose: string;
    hint: string;
    upload: string;
    remove: string;
}

/** Presentation only: the feature retains its file draft, token and admitted commands. */
export interface EntityHeaderEditorProps {
    inputId: string;
    labels: EntityHeaderLabels;
    /** The feature owns selected bytes. Null explicitly releases the chooser;
     * background reads and uncertain commands keep the same File reference. */
    selectedFile: File | null;
    hasImage: boolean;
    expanded: boolean;
    conflict: boolean;
    disabled: boolean;
    reading: boolean;
    /** Only the initiating header command owns its button's temporary focus. */
    uploadPending?: boolean;
    removePending?: boolean;
}

/** A shared event editor displays the feature's original/local/current relationship. */
export interface EntityEventEditorProps {
    modelValue: string | null;
    original: string | null;
    current: FrontendEventPickerSelection | null;
    source: FrontendEventPickerSource;
    prefix: string;
    title: string;
    hint: string;
    extraHint?: string;
    submitLabel: string;
    active: boolean;
    conflict: boolean;
    disabled: boolean;
    pending?: boolean;
}

/** Feature-specific lifecycle explanations supplement the shared action labels. */
export interface EntityLifecycleLabels {
    activeHint: string;
    archivedHint: string;
    inheritedHint: string;
    openEvent: string;
    otherActions: string;
    deletePermanently: string;
}

/** Already admitted display/actions; these booleans never supply server authorization. */
export interface EntityLifecycleActionsProps {
    labels: EntityLifecycleLabels;
    direct: boolean;
    inherited: boolean;
    eventUrl: string | null;
    manageArchive: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canDuplicate: boolean;
    canRemove: boolean;
    duplicateTo: string;
    disabled: boolean;
    /** Permanent deletion additionally needs the shared delivery slot. */
    removeDisabled?: boolean;
    /** Broader dialog blocking stays separate from this initiating operation. */
    pendingAction?: 'archive' | 'automation' | 'remove' | null;
    contextHint?: string;
    exportLink?: {url: string; label: string};
    /** Only entities with an admitted automatic schedule expose this distinct action. */
    automation?: {paused: boolean; pauseLabel: string; resumeLabel: string; pausedHint: string};
}
