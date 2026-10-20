import type {PilotEventPickerSelection, PilotEventPickerSource, PilotImageRead, PilotPlainMessageKey,
    PilotRequestScope} from './FrontendPilotUiTypes';

/** One displayed entity header receives only its feature's admitted presentation.
 * The exact query key supplies successful read receipts; it grants no image or
 * settings authority. Parent URLs retain their existing feature-owned destination. */
export interface EntityHeaderProps {
    resourceId: string;
    title: string;
    icon: string;
    imageVersion?: string | null;
    imageQueryKey: readonly unknown[];
    readImage: PilotImageRead;
    imageEnabled?: boolean;
    parentUrl?: string | null;
    settingsAvailable?: boolean;
    settingsDisabled?: boolean;
}

/** The feature selects the existing lifecycle operations; this shared contract
 * has no endpoint, permission, draft, persistence or command-state ownership. */
export interface EntityLifecycleOperations {
    archive(id: string, restore: boolean, scope: PilotRequestScope): Promise<unknown>;
    automate?: (id: string, paused: boolean, scope: PilotRequestScope) => Promise<unknown>;
}

/** Permanent deletion shares whole-page departure consent and delivery recovery.
 * The feature supplies its captured operation and established catalog wording. */
export interface EntityRemovalRequest {
    operation(scope: PilotRequestScope): Promise<unknown>;
    confirmation: PilotPlainMessageKey;
    success: PilotPlainMessageKey;
}

/** Callers may preserve feature-specific wording without copying action policy. */
export interface EntityAutomationMessages {
    confirmResume: PilotPlainMessageKey;
    pausedSuccess: PilotPlainMessageKey;
    resumedSuccess: PilotPlainMessageKey;
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
}

/** A shared event editor displays the feature's original/local/current relationship. */
export interface EntityEventEditorProps {
    modelValue: string | null;
    original: string | null;
    current: PilotEventPickerSelection | null;
    source: PilotEventPickerSource;
    prefix: string;
    title: string;
    hint: string;
    extraHint?: string;
    submitLabel: string;
    active: boolean;
    conflict: boolean;
    disabled: boolean;
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
    contextHint?: string;
    exportLink?: {url: string; label: string};
    /** Only entities with an admitted automatic schedule expose this distinct action. */
    automation?: {paused: boolean; pauseLabel: string; resumeLabel: string; pausedHint: string};
}
