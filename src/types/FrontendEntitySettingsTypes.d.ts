import type {PilotEventPickerSelection, PilotEventPickerSource} from './FrontendPilotUiTypes';

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
    imageName?: string;
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
}
