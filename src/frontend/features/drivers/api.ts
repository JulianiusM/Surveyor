import {createFeatureApiResolver} from '../../app/api';
import type {components} from '../../../types/api/v1';
import type {FrontendEventPickerQuery, FrontendEventPickerSource, FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import type {FrontendInputField} from '../../../types/FrontendFeedbackTypes';
import {driversKeys} from '../../app/queryKeys';
import {createMultipartForm, generatedInputError} from '../../app/transport';
import {validateDriversListView} from '../../../../.generated/api/v1/browser/validateDriversListView.mjs';
import {validateDriversMetadata} from '../../../../.generated/api/v1/browser/validateDriversMetadata.mjs';
import {validateDriversMetadataPatch} from '../../../../.generated/api/v1/browser/validateDriversMetadataPatch.mjs';
import {validateDriversAssignmentResult} from '../../../../.generated/api/v1/browser/validateDriversAssignmentResult.mjs';
import {validateDriversSettings} from '../../../../.generated/api/v1/browser/validateDriversSettings.mjs';
import {validateDriversDuplicate} from '../../../../.generated/api/v1/browser/validateDriversDuplicate.mjs';
import {validateDriversCreateInput} from '../../../../.generated/api/v1/browser/validateDriversCreateInput.mjs';
import {validateDriversCreated} from '../../../../.generated/api/v1/browser/validateDriversCreated.mjs';
import {validateDriversNewItem} from '../../../../.generated/api/v1/browser/validateDriversNewItem.mjs';
import {validateDriversItemPatch} from '../../../../.generated/api/v1/browser/validateDriversItemPatch.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateEventPickerOptions} from '../../../../.generated/api/v1/browser/validateEventPickerOptions.mjs';
import {validateDriversEventChanged} from '../../../../.generated/api/v1/browser/validateDriversEventChanged.mjs';
import {validateDriversProfileOptions} from '../../../../.generated/api/v1/browser/validateDriversProfileOptions.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {validateDriversCreateEntry} from '../../../../.generated/api/v1/browser/validateDriversCreateEntry.mjs';
import {validateDriversResourceEntry} from '../../../../.generated/api/v1/browser/validateDriversResourceEntry.mjs';

type List = components['schemas']['DriversListView'];
type Metadata = components['schemas']['DriversMetadata'];
type Assignment = components['schemas']['DriversAssignmentResult'];

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class DriversApi {
    constructor(private transport: FrontendApi) {}

    // The feature owns discovery authorization and cache families. The shared picker only
    // renders and selects the supplied options, so another feature can reuse its behavior.
    readonly eventPicker: FrontendEventPickerSource = {
        search: (query, scope, signal) => this.events(query, scope, signal),
        pageKey: driversKeys.eventPage,
        filterKey: driversKeys.eventFilters,
    };

    /** Read the captured list with its caller-supplied conditional snapshot.
     * The transport validates actor scope before accepting a 304; the feature
     * query owner ensures that previous belongs to this same resource family. */
    async drivers(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                  previous?: FrontendRead<List>): Promise<FrontendRead<List>> {
        const transport = this.transport;
        function readDrivers() {
            return transport.client.GET('/drivers-lists/{listId}', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
        }
        return transport.readJson(`drivers/${listId}`, scope, readDrivers, 'getDriversList', validateDriversListView, signal, previous);
    }

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                   previous?: FrontendRead<Metadata>): Promise<FrontendRead<Metadata>> {
        const transport = this.transport;
        function readMetadata() {
            return transport.client.GET('/drivers-lists/{listId}/metadata', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
        }
        const result = await transport.readJson(`drivers/${listId}/metadata`, scope, readMetadata, 'getDriversMetadata', validateDriversMetadata, signal, previous);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(listId: string, patch: components['schemas']['DriversMetadataPatch'], etag: string,
                       scope: FrontendRequestScope): Promise<FrontendRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validateDriversMetadataPatch(patch)) throw generatedInputError(validateDriversMetadataPatch.errors, driversInputField);

        const result = this.transport.read('updateDriversMetadata', await this.transport.client.PATCH('/drivers-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validateDriversMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: FrontendRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.transport.client.PUT('/drivers-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.transport.client.DELETE('/drivers-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.transport.read(assigned ? 'assignDriversItem' : 'unassignDriversItem', result, validateDriversAssignmentResult, scope).data;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(listId: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['DriversSettings']> {
        const transport = this.transport;
        function readSettings() {
            return transport.client.GET('/drivers-lists/{listId}/settings', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`drivers/${listId}/settings`, scope, readSettings, 'getDriversSettings', validateDriversSettings, signal)).data;
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: FrontendRequestScope, signal?: AbortSignal,
                      returnTo?: string, eventId?: string): Promise<components['schemas']['DriversCreateEntry']> {
        const transport = this.transport;
        function readCreationEntry() {
            return transport.client.GET('/drivers-lists/create-entry', {
                params: {query: {returnTo, eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('drivers/create-entry/' + (returnTo ?? '') + '/' + (eventId ?? ''), scope, readCreationEntry, 'getDriversCreateEntry', validateDriversCreateEntry, signal)).data;
    }

    /** Detail and explicit guest routes deliberately have different admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(listId: string, view: 'detail' | 'guest', scope: FrontendRequestScope,
                        signal?: AbortSignal): Promise<components['schemas']['DriversResourceEntry']> {
        const transport = this.transport;
        function readResourceEntry() {
            return transport.client.GET('/drivers-lists/{listId}/entry', {
                params: {path: {listId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`drivers/${listId}/entry/${view}`, scope, readResourceEntry, 'getDriversResourceEntry', validateDriversResourceEntry, signal)).data;
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                    eventId?: string): Promise<components['schemas']['DriversDuplicate']> {
        const transport = this.transport;
        function readDuplicate() {
            return transport.client.GET('/drivers-lists/{listId}/duplicate', {
                params: {path: {listId}, query: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`drivers/${listId}/duplicate/${eventId ?? ''}`, scope, readDuplicate, 'getDriversDuplicate', validateDriversDuplicate, signal)).data;
    }

    /** Submit the generated creation contract and optional image as one multipart command.
     * The JSON field retains its authored shape; file bytes use the existing upload boundary.
     * Only a validated creation receipt confirms success, and uncertain delivery is left to
     * the shared command owner without replaying this non-idempotent request. */
    async createDrivers(input: components['schemas']['DriversCreateInput'], image: File | null,
                        scope: FrontendRequestScope): Promise<components['schemas']['DriversCreated']> {
        // Validate machine data before adapting it to the established multipart envelope.
        // The image is a separate part rather than a second handwritten creation schema.
        if (!validateDriversCreateInput(input)) throw generatedInputError(validateDriversCreateInput.errors, driversInputField);

        const form = createMultipartForm(input, image);

        // Preserve captured actor/CSRF context through upload and response classification.
        // A lost response cannot be treated as proof that no list was created.
        return this.transport.read('createDriversList', await this.transport.client.POST('/drivers-lists', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validateDriversCreated, scope).data;
    }

    async addItem(listId: string, input: components['schemas']['DriversNewItem'], scope: FrontendRequestScope) {
        if (!validateDriversNewItem(input)) throw generatedInputError(validateDriversNewItem.errors, driversInputField);
        return this.transport.read('createDriversItem', await this.transport.client.POST('/drivers-lists/{listId}/items', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateDriversCreated, scope).data;
    }

    async updateItem(listId: string, itemId: string, patch: components['schemas']['DriversItemPatch'], token: string,
                     scope: FrontendRequestScope) {
        if (!validateDriversItemPatch(patch)) throw generatedInputError(validateDriversItemPatch.errors, driversInputField);
        return this.transport.read('updateDriversItem', await this.transport.client.PATCH('/drivers-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: patch, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteItem(listId: string, itemId: string, scope: FrontendRequestScope) {
        return this.transport.read('deleteDriversItem', await this.transport.client.DELETE('/drivers-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(listId: string, itemIds: string[], token: string, scope: FrontendRequestScope) {
        return this.transport.read('reorderDriversItems', await this.transport.client.PUT('/drivers-lists/{listId}/item-order', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {itemIds}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(listId: string, assignmentId: string, scope: FrontendRequestScope) {
        return this.transport.read('deleteDriversAssignment', await this.transport.client.DELETE('/drivers-lists/{listId}/assignments/{assignmentId}', {
            params: {path: {listId, assignmentId: String(assignmentId)}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Read the feature-owned event options for this exact filter/selection page.
     * The picker receives validated presentation only; eligibility and the final
     * relationship change remain independently checked by existing server owners. */
    async events(query: FrontendEventPickerQuery,
                  scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        function readEventOptions() {
            return transport.client.GET('/drivers-lists/events', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`drivers/events/${JSON.stringify(query)}`, scope, readEventOptions, 'searchDriversEvents', validateEventPickerOptions, signal)).data;
    }

    async linkEvent(listId: string, input: components['schemas']['DriversEventChange'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('changeDriversEvent', await this.transport.client.PUT('/drivers-lists/{listId}/event', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateDriversEventChanged, scope).data;
    }

    async setDefaults(listId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('updateDriversDefaults', await this.transport.client.PUT('/drivers-lists/{listId}/default-permissions', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(listId: string, q: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        function readProfileOptions() {
            return transport.client.GET('/drivers-lists/{listId}/profiles', {
                params: {path: {listId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`drivers/${listId}/profiles/${q}`, scope, readProfileOptions, 'searchDriversProfiles', validateDriversProfileOptions, signal)).data;
    }

    async addAdmin(listId: string, input: components['schemas']['DriversAdminInput'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('addDriversAdmin', await this.transport.client.POST('/drivers-lists/{listId}/admins', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(listId: string, profileId: string, mask: number, token: string, scope: FrontendRequestScope) {
        return this.transport.read('updateDriversAdmin', await this.transport.client.PATCH('/drivers-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(listId: string, profileId: string, token: string, scope: FrontendRequestScope) {
        return this.transport.read('deleteDriversAdmin', await this.transport.client.DELETE('/drivers-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async header(listId: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<Blob> {
        const transport = this.transport;

        /** openapi-fetch uses blob decoding only for success. Error bodies retain its
         * ordinary JSON/text decoder and the shared validated rejection policy.
         * Binary recovery therefore observes the same actor and Retry-After owner
         * as JSON reads instead of introducing a second error parser or deadline. */
        function readHeader() {
            return transport.client.GET('/drivers-lists/{listId}/header', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
        }

        return transport.readHeaderImage(`drivers/${listId}/header`, scope, readHeader, signal);
    }

    /** Replace the header using the file draft's reviewed comparison token.
     * Multipart serialization transports bytes while generated operation metadata still
     * identifies the request. The controller owns image admission, locked comparison and
     * committed cleanup; this adapter confirms only a validated mutation receipt. */
    async uploadHeader(listId: string, image: File, token: string, scope: FrontendRequestScope) {
        // Keep the chosen bytes separate from their generated filename placeholder.
        // The serializer supplies the actual multipart body without copying upload policy.
        const form = createMultipartForm(null, image);

        // Send the token captured when this file was chosen, never a newer settings token
        // obtained while the draft was waiting. The shared command owner handles recovery.
        return this.transport.read('uploadDriversHeader', await this.transport.client.PUT('/drivers-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(listId: string, token: string, scope: FrontendRequestScope) {
        return this.transport.read('deleteDriversHeader', await this.transport.client.DELETE('/drivers-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(listId: string, restore: boolean, scope: FrontendRequestScope) {
        const options = {params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restoreDriversList' : 'archiveDriversList', restore ? await this.transport.client.POST('/drivers-lists/{listId}/restore', options)
            : await this.transport.client.POST('/drivers-lists/{listId}/archive', options), validateMutationResult, scope).data;
    }

    async deleteDrivers(listId: string, scope: FrontendRequestScope) {
        return this.transport.read('deleteDriversList', await this.transport.client.DELETE('/drivers-lists/{listId}', {
            params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }


    /** Read the public guest-entry surface without fetching private detail/setup.
     * This operation supplies entry presentation only; registering a guest is a
     * separate identity command with its own confirmed context and destination. */
    async guestEntry(listId: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        function readGuestEntry() {
            return transport.client.GET('/drivers-lists/{listId}/guest', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('drivers/' + listId + '/guest', scope, readGuestEntry, 'getDriversGuestEntry', validateGuestEntry, signal)).data;
    }

    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) {
        return this.transport.identity("registerDriversGuest", await this.transport.client.POST('/drivers-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

/** Matching creation, quick-add and property controls share field diagnostics;
 * their generated contracts retain their deliberately distinct constraints. */
function driversInputField(path: string): FrontendInputField | undefined {
    if (path === '/title') return {label: 'packing.title'};
    if (path === '/description') return {label: 'packing.description'};
    if (path === '/maxAssignees') return {label: 'packing.maxNumber'};
    if (path === '/eventId') return {label: 'eventPicker.currentEvent'};
    if (path.startsWith('/defaultPermissions')) return {label: 'packing.groupPermissions'};
    return undefined;
}

/** Reuse this feature adapter for its application-local transport. */
export const useDriversApi = createFeatureApiResolver(DriversApi);
