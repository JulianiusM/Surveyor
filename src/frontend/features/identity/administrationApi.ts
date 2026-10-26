import type {components, operations} from '../../../types/api/v1';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import {validateProfileSettings} from '../../../../.generated/api/v1/browser/validateProfileSettings.mjs';
import {validateProfileManagement} from '../../../../.generated/api/v1/browser/validateProfileManagement.mjs';
import {validatePageEntryOutcome} from '../../../../.generated/api/v1/browser/validatePageEntryOutcome.mjs';
import {validateProfileMigrationPreviewOutcome} from '../../../../.generated/api/v1/browser/validateProfileMigrationPreviewOutcome.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateProfileWorkflowEntry} from '../../../../.generated/api/v1/browser/validateProfileWorkflowEntry.mjs';
import {validateProfileMigrationToken} from '../../../../.generated/api/v1/browser/validateProfileMigrationToken.mjs';

/** Administration owns its generated projections; cookie admission and identity completion stay shared. */
export class IdentityAdministrationApi {
    constructor(private readonly transport: FrontendApi) {}

    /** Admit a warm workflow visit without issuing a token or executing a command.
     * Read retries and Query refresh therefore remain free of mutation effects. */
    async workflowEntry(kind: operations['getProfileWorkflowEntry']['parameters']['query']['kind'], returnTo: string,
                        scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileWorkflowEntry']> {
        const transport = this.transport;
        function readWorkflowEntry() {
            return transport.client.GET('/profiles/workflow-entry', {
                params: {query: {kind, returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`identity/workflow-entry/${kind}`, scope, readWorkflowEntry, 'getProfileWorkflowEntry', validateProfileWorkflowEntry, signal)).data;
    }

    /** Issue only from an explicit action; secrets stay in this mounted feature,
     * never in a query key, URL, browser history payload or automatic read retry. */
    async migrationToken(scope: FrontendRequestScope): Promise<components['schemas']['ProfileMigrationToken']> {
        return this.transport.read('requestProfileMigrationToken', await this.transport.client.POST('/profiles/migration/token', {
            params: {header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateProfileMigrationToken, scope).data;
    }

    /** Execute the existing transfer once, retaining its partial outcomes. */
    async transfer(token: string, scope: FrontendRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('executeIdentityProfileMigration', await this.transport.client.POST('/profiles/migration/execute', {
            params: {header: this.transport.headers(scope)}, body: {token}, cache: 'no-store',
        }), scope);
    }

    /** Deactivation retains the shared controller's selection and cleanup order. */
    async deactivate(name: string, scope: FrontendRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('deactivateIdentityProfile', await this.transport.client.POST('/profiles/current/deactivate', {
            params: {header: this.transport.headers(scope)}, body: {name}, cache: 'no-store',
        }), scope);
    }

    /** Full and guest account deletion share the existing server-selected owner. */
    async deleteAccount(username: string, scope: FrontendRequestScope): Promise<components['schemas']['ProfileWorkflowCompletion']> {
        return this.transport.workflow('deleteIdentityAccount', await this.transport.client.DELETE('/account', {
            params: {header: this.transport.headers(scope)}, body: {username}, cache: 'no-store',
        }), scope);
    }

    /** Read a token-holder preview explicitly, without consuming the token or caching its secret. */
    async preview(token: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileMigrationPreviewOutcome']> {
        const transport = this.transport;
        function readMigrationPreview() {
            // POST keeps the bearer value out of URLs; this operation remains a
            // read with captured actor/cancellation and the existing cooldown owner.
            return transport.client.POST('/profiles/migration/preview', {
                params: {header: transport.headers(scope)}, body: {token}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('identity/profile-migration-preview', scope, readMigrationPreview, 'previewIdentityProfileMigration', validateProfileMigrationPreviewOutcome, signal)).data;
    }

    /** Resolve page admission before requesting private account/profile projections. */
    async entry(view: operations['getProfileAdministrationEntry']['parameters']['query']['view'], returnTo: string, scope: FrontendRequestScope,
                signal?: AbortSignal): Promise<components['schemas']['PageEntryOutcome']> {
        const transport = this.transport;
        function readProfileEntry() {
            // An account-only redirect is navigation, not authentication loss for a valid guest.
            return transport.client.GET('/profiles/entry', {
                params: {query: {view, returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`identity/profile-entry/${view}`, scope, readProfileEntry, 'getProfileAdministrationEntry', validatePageEntryOutcome, signal)).data;
    }

    /** Read only the captured actor's active profile, preserving cancellation and read cooldown. */
    async current(scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileSettings']> {
        const transport = this.transport;
        function readCurrentProfile() {
            // This private projection supplies no account, token or unrelated profile data.
            return transport.client.GET('/profiles/current', {
                params: {header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('identity/current-profile', scope, readCurrentProfile, 'getIdentityProfile', validateProfileSettings, signal)).data;
    }

    /** Obtain the account-owned roster; the server retains account versus guest admission. */
    async profiles(scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['ProfileManagement']> {
        const transport = this.transport;
        function readOwnedProfiles() {
            // Another tab's actor change cannot publish this older roster into the new identity.
            return transport.client.GET('/profiles', {
                params: {header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('identity/profiles', scope, readOwnedProfiles, 'getIdentityProfiles', validateProfileManagement, signal)).data;
    }

    /** Confirm the standalone creation independently of later session/roster display reads. */
    async create(name: string, scope: FrontendRequestScope): Promise<components['schemas']['MutationResult']> {
        // This operation preserves the actor and returns only its prepared acknowledgement.
        return this.transport.read('createIdentityProfile', await this.transport.client.POST('/profiles', {
            params: {header: this.transport.headers(scope)}, body: {name}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Submit the name/default fields without inventing a revision or coercing either value. */
    async update(input: components['schemas']['ProfileUpdateInput'], scope: FrontendRequestScope): Promise<components['schemas']['MutationResult']> {
        // Name/default/session-save behavior remains in the shared controller.
        return this.transport.read('updateIdentityProfile', await this.transport.client.PATCH('/profiles/current', {
            params: {header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }
}
