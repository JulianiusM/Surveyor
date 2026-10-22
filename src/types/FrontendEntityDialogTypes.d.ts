import type {Component} from 'vue';
import type {components} from './api/v1';
import type {EntityAccessOperations} from './FrontendEntityAccessTypes';
import type {EntityAutomationMessages, EntityLifecycleOperations} from './FrontendEntitySettingsTypes';
import type {PilotEventPickerSource, PilotPlainMessageKey, PilotRequestScope} from './FrontendPilotUiTypes';

/** Shared root settings presentation; standalone roots have no parent selector. */
export type EntitySettingsProjection = Omit<components['schemas']['PackingSettings'], 'currentEvent' | 'capabilities' | 'editableFields' | 'archive'> & {
    editableFields: string[];
    currentEvent?: components['schemas']['PackingSettings']['currentEvent'];
    capabilities: Omit<components['schemas']['PackingSettings']['capabilities'], 'linkEvent'> & {linkEvent?: boolean; manageAutomation?: boolean; export?: boolean};
    archive: components['schemas']['PackingSettings']['archive'] & {hasAutomaticSchedule?: boolean};
};

/** Existing feature adapters retain generated operation and endpoint selection. */
export interface EntitySettingsOperations extends Partial<EntityAccessOperations>, EntityLifecycleOperations {
    settings(id: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<EntitySettingsProjection>;
    uploadHeader(id: string, image: File, token: string, scope: PilotRequestScope): Promise<unknown>;
    removeHeader(id: string, token: string, scope: PilotRequestScope): Promise<unknown>;
    deleteResource(id: string, scope: PilotRequestScope): Promise<unknown>;
    eventPicker?: PilotEventPickerSource;
    linkEvent?: (id: string, input: components['schemas']['PackingEventChange'], token: string,
        scope: PilotRequestScope) => Promise<components['schemas']['PackingEventChanged']>;
}

/** Feature-owned catalog wording for an admitted automatic archival schedule. */
export interface EntityAutomationLabels extends EntityAutomationMessages {
    pause: string;
    resume: string;
    pausedHint: string;
}

/** Feature composition supplies definitions, metadata fields, scoped keys and destinations. */
export interface EntitySettingsDialogProps {
    resourceId: string;
    resourceTitle?: string;
    metadataAvailable?: boolean;
    metadataComponent: Component;
    metadataProps: Record<string, unknown>;
    operations: EntitySettingsOperations;
    settingsKey: readonly unknown[];
    /** Only features with an admitted general access model supply profile discovery. */
    profileKey?: (query: string) => readonly unknown[];
    profileFamily?: readonly unknown[];
    duplicateTo: string;
    deletedKey: PilotPlainMessageKey;
    restoreConfirmation?: PilotPlainMessageKey;
    archiveConfirmation?: PilotPlainMessageKey;
    automationLabels?: EntityAutomationLabels;
    eventExtraHint?: string;
    linkedEventArchiveHint?: string;
    exportLink?: {url: string; label: string};
}
