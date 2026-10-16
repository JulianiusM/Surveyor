import type {components, operations} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {validateProfileSettings} from '../../../../.generated/api/v1/browser/validateProfileSettings.mjs';
import {validateProfileManagement} from '../../../../.generated/api/v1/browser/validateProfileManagement.mjs';
import {validatePageEntryOutcome} from '../../../../.generated/api/v1/browser/validatePageEntryOutcome.mjs';
import {validateProfileMigrationPreviewOutcome} from '../../../../.generated/api/v1/browser/validateProfileMigrationPreviewOutcome.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateProfileWorkflowEntry} from '../../../../.generated/api/v1/browser/validateProfileWorkflowEntry.mjs';
import {validateProfileMigrationToken} from '../../../../.generated/api/v1/browser/validateProfileMigrationToken.mjs';

/** Administration owns its generated projections; cookie admission and identity completion stay shared. */
export class IdentityAdministrationApi {
    constructor(private readonly transport: PilotApi) {}

    /** Admit a warm workflow visit without issuing a token or executing a command.
     * Read retries and Query refresh therefore remain free of mutation effects. */
    async workflowEntry(kind: operations['getProfileWorkflowEntry']['parameters']['query']['kind'], returnTo: string,
                        scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileWorkflowEntry']> {
        const transport = this.transport;
        async function readWorkflowEntry(): Promise<components['schemas']['ProfileWorkflowEntry']> {
            const response = await transport.client.GET('/profiles/workflow-entry', {
                params: {query: {kind, returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getProfileWorkflowEntry', {...response, signal}, validateProfileWorkflowEntry, scope).data;
        }
        return transport.allowedRead(`identity/workflow-entry/${kind}`, scope, readWorkflowEntry, signal);
    }

    /** Issue only from an explicit action; secrets stay in this mounted feature,
     * never in a query key, URL, browser history payload or automatic read retry. */
    async migrationToken(scope: PilotRequestScope): Promise<components['schemas']['ProfileMigrationToken']> {
        return this.transport.read('requestProfileMigrationToken', await this.transport.client.POST('/profiles/migration/token', {
            params: {header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateProfileMigrationToken, scope).data;
    }

    /** Execute the existing transfer once, retaining its native partial outcomes. */
    async transfer(token: string, scope: PilotRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('executeIdentityProfileMigration', await this.transport.client.POST('/profiles/migration/execute', {
            params: {header: this.transport.headers(scope)}, body: {token}, cache: 'no-store',
        }), scope);
    }

    /** Deactivation retains the shared controller's selection and cleanup order. */
    async deactivate(name: string, scope: PilotRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('deactivateIdentityProfile', await this.transport.client.POST('/profiles/current/deactivate', {
            params: {header: this.transport.headers(scope)}, body: {name}, cache: 'no-store',
        }), scope);
    }

    /** Full and guest account deletion share the existing server-selected owner. */
    async deleteAccount(username: string, scope: PilotRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('deleteIdentityAccount', await this.transport.client.DELETE('/account', {
            params: {header: this.transport.headers(scope)}, body: {username}, cache: 'no-store',
        }), scope);
    }

    /** Read a token-holder preview explicitly, without consuming the token or caching its secret. */
    async preview(token: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileMigrationPreviewOutcome']> {
        const transport = this.transport;
        async function readMigrationPreview(): Promise<components['schemas']['ProfileMigrationPreviewOutcome']> {
            // POST keeps the bearer value out of URLs; this operation remains a
            // read with captured actor/cancellation and the existing cooldown owner.
            const response = await transport.client.POST('/profiles/migration/preview', {
                params: {header: transport.headers(scope)}, body: {token}, signal, cache: 'no-store',
            });
            return transport.read('previewIdentityProfileMigration', {...response, signal}, validateProfileMigrationPreviewOutcome, scope).data;
        }
        return transport.allowedRead('identity/profile-migration-preview', scope, readMigrationPreview, signal);
    }

    /** Resolve native page admission before requesting private account/profile projections. */
    async entry(view: operations['getProfileAdministrationEntry']['parameters']['query']['view'], returnTo: string, scope: PilotRequestScope,
                signal?: AbortSignal): Promise<components['schemas']['PageEntryOutcome']> {
        const transport = this.transport;
        async function readProfileEntry(): Promise<components['schemas']['PageEntryOutcome']> {
            // An account-only redirect is navigation, not authentication loss for a valid guest.
            const response = await transport.client.GET('/profiles/entry', {
                params: {query: {view, returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getProfileAdministrationEntry', {...response, signal}, validatePageEntryOutcome, scope).data;
        }
        return transport.allowedRead(`identity/profile-entry/${view}`, scope, readProfileEntry, signal);
    }

    /** Read only the captured actor's active profile, preserving cancellation and read cooldown. */
    async current(scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileSettings']> {
        const transport = this.transport;
        async function readCurrentProfile(): Promise<components['schemas']['ProfileSettings']> {
            // This private projection supplies no account, token or unrelated profile data.
            const response = await transport.client.GET('/profiles/current', {
                params: {header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getIdentityProfile', {...response, signal}, validateProfileSettings, scope).data;
        }
        return transport.allowedRead('identity/current-profile', scope, readCurrentProfile, signal);
    }

    /** Obtain the account-owned roster; the server retains account versus guest admission. */
    async profiles(scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileManagement']> {
        const transport = this.transport;
        async function readOwnedProfiles(): Promise<components['schemas']['ProfileManagement']> {
            // Another tab's actor change cannot publish this older roster into the new identity.
            const response = await transport.client.GET('/profiles', {
                params: {header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getIdentityProfiles', {...response, signal}, validateProfileManagement, scope).data;
        }
        return transport.allowedRead('identity/profiles', scope, readOwnedProfiles, signal);
    }

    /** Confirm the native creation independently of later session/roster display reads. */
    async create(name: string, scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        // This operation preserves the actor and returns only its prepared acknowledgement.
        return this.transport.read('createIdentityProfile', await this.transport.client.POST('/profiles', {
            params: {header: this.transport.headers(scope)}, body: {name}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Submit the native name/default fields without inventing a revision or coercing either value. */
    async update(input: components['schemas']['ProfileUpdateInput'], scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        // Native name/default/session-save behavior remains in the shared controller.
        return this.transport.read('updateIdentityProfile', await this.transport.client.PATCH('/profiles/current', {
            params: {header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }
}
