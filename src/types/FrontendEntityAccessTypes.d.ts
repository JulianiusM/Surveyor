import type {components} from './api/v1';
import type {FrontendRequestScope} from './FrontendUiTypes';
import type {useCommand} from '../frontend/composables/command';

/** Entity root settings use the same admitted ACL presentation. */
export interface EntityAccessProjection {
    settingsToken: string;
    access: components['schemas']['PackingAccess'] | null;
}

/** Inject existing feature operations; shared controls never select endpoints or grants. */
export interface EntityAccessOperations {
    profiles(id: string, query: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingProfileOptions']>;
    setDefaults(id: string, patch: components['schemas']['PermissionDefaultsPatch'], token: string, scope: FrontendRequestScope): Promise<unknown>;
    addAdmin(id: string, input: components['schemas']['PackingAdminInput'], token: string, scope: FrontendRequestScope): Promise<unknown>;
    updateAdmin(id: string, profileId: string, mask: number, token: string, scope: FrontendRequestScope): Promise<unknown>;
    removeAdmin(id: string, profileId: string, token: string, scope: FrontendRequestScope): Promise<unknown>;
}

/** The parent owns complete-dialog locking, dismissal and causal fresh reads. */
export interface EntityAccessEditorProps {
    resourceId: string;
    settings: EntityAccessProjection;
    operations: EntityAccessOperations;
    command: ReturnType<typeof useCommand>;
    profileKey: (query: string) => readonly unknown[];
    profileFamily: readonly unknown[];
    blocked: boolean;
    controlsPending: boolean;
}
