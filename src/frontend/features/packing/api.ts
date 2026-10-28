import {createFeatureApiResolver} from '../../app/api';
import type {components} from '../../../types/api/v1';
import type {FrontendEventPickerQuery, FrontendEventPickerSource, FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import type {FrontendInputField} from '../../../types/FrontendFeedbackTypes';
import {packingKeys} from '../../app/queryKeys';
import {createMultipartForm, generatedInputError} from '../../app/transport';
import {validatePackingListView} from '../../../../.generated/api/v1/browser/validatePackingListView.mjs';
import {validatePackingMetadata} from '../../../../.generated/api/v1/browser/validatePackingMetadata.mjs';
import {validateBasicEntityMetadataPatch} from '../../../../.generated/api/v1/browser/validateBasicEntityMetadataPatch.mjs';
import {validateListAssignmentResult} from '../../../../.generated/api/v1/browser/validateListAssignmentResult.mjs';
import {validateListSettings} from '../../../../.generated/api/v1/browser/validateListSettings.mjs';
import {validatePackingDuplicate} from '../../../../.generated/api/v1/browser/validatePackingDuplicate.mjs';
import {validatePackingCreateInput} from '../../../../.generated/api/v1/browser/validatePackingCreateInput.mjs';
import {validateEntityCreationResult} from '../../../../.generated/api/v1/browser/validateEntityCreationResult.mjs';
import {validatePackingNewItem} from '../../../../.generated/api/v1/browser/validatePackingNewItem.mjs';
import {validatePackingItemPatch} from '../../../../.generated/api/v1/browser/validatePackingItemPatch.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateEventPickerOptions} from '../../../../.generated/api/v1/browser/validateEventPickerOptions.mjs';
import {validateEntityEventChangeResult} from '../../../../.generated/api/v1/browser/validateEntityEventChangeResult.mjs';
import {validateEntityAdministratorProfileOptions} from '../../../../.generated/api/v1/browser/validateEntityAdministratorProfileOptions.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {validateEntityCreationEntry} from '../../../../.generated/api/v1/browser/validateEntityCreationEntry.mjs';
import {validateEntityResourceEntry} from '../../../../.generated/api/v1/browser/validateEntityResourceEntry.mjs';

type List = components['schemas']['PackingListView'];
type Metadata = components['schemas']['PackingMetadata'];
type Assignment = components['schemas']['ListAssignmentResult'];

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class PackingApi {
    constructor(private transport: FrontendApi) {}

    // The feature owns discovery authorization and cache families. The shared picker only
    // renders and selects the supplied options, so another feature can reuse its behavior.
    readonly eventPicker: FrontendEventPickerSource = {
        search: (query, scope, signal) => this.events(query, scope, signal),
        pageKey: packingKeys.eventPage,
        filterKey: packingKeys.eventFilters,
    };

    /** Read the captured list with its caller-supplied conditional snapshot.
     * The transport validates actor scope before accepting a 304; the feature
     * query owner ensures that previous belongs to this same resource family. */
    async packing(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                  previous?: FrontendRead<List>): Promise<FrontendRead<List>> {
        const transport = this.transport;
        function readPacking() {
            return transport.client.GET('/packing-lists/{listId}', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
        }
        return transport.readJson(`packing/${listId}`, scope, readPacking, 'getPackingList', validatePackingListView, signal, previous);
    }

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                   previous?: FrontendRead<Metadata>): Promise<FrontendRead<Metadata>> {
        const transport = this.transport;
        function readMetadata() {
            return transport.client.GET('/packing-lists/{listId}/metadata', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
        }
        const result = await transport.readJson(`packing/${listId}/metadata`, scope, readMetadata, 'getPackingMetadata', validatePackingMetadata, signal, previous);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(listId: string, patch: components['schemas']['BasicEntityMetadataPatch'], etag: string,
                       scope: FrontendRequestScope): Promise<FrontendRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validateBasicEntityMetadataPatch(patch)) throw generatedInputError(validateBasicEntityMetadataPatch.errors, path => packingInputField(path));

        const result = this.transport.read('updatePackingMetadata', await this.transport.client.PATCH('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validatePackingMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: FrontendRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.transport.client.PUT('/packing-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.transport.client.DELETE('/packing-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.transport.read(assigned ? 'assignPackingItem' : 'unassignPackingItem', result, validateListAssignmentResult, scope).data;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(listId: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['ListSettings']> {
        const transport = this.transport;
        function readSettings() {
            return transport.client.GET('/packing-lists/{listId}/settings', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`packing/${listId}/settings`, scope, readSettings, 'getPackingSettings', validateListSettings, signal)).data;
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: FrontendRequestScope, signal?: AbortSignal,
                      returnTo?: string, eventId?: string): Promise<components['schemas']['EntityCreationEntry']> {
        const transport = this.transport;
        function readCreationEntry() {
            return transport.client.GET('/packing-lists/create-entry', {
                params: {query: {returnTo, eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('packing/create-entry/' + (returnTo ?? '') + '/' + (eventId ?? ''), scope, readCreationEntry, 'getPackingCreateEntry', validateEntityCreationEntry, signal)).data;
    }

    /** Detail and explicit guest routes deliberately have different admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(listId: string, view: 'detail' | 'guest', scope: FrontendRequestScope,
                        signal?: AbortSignal): Promise<components['schemas']['EntityResourceEntry']> {
        const transport = this.transport;
        function readResourceEntry() {
            return transport.client.GET('/packing-lists/{listId}/entry', {
                params: {path: {listId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`packing/${listId}/entry/${view}`, scope, readResourceEntry, 'getPackingResourceEntry', validateEntityResourceEntry, signal)).data;
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(listId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                    eventId?: string): Promise<components['schemas']['PackingDuplicate']> {
        const transport = this.transport;
        function readDuplicate() {
            return transport.client.GET('/packing-lists/{listId}/duplicate', {
                params: {path: {listId}, query: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`packing/${listId}/duplicate/${eventId ?? ''}`, scope, readDuplicate, 'getPackingDuplicate', validatePackingDuplicate, signal)).data;
    }

    /** Submit the generated creation contract and optional image as one multipart command.
     * The JSON field retains its authored shape; file bytes use the existing upload boundary.
     * Only a validated creation receipt confirms success, and uncertain delivery is left to
     * the shared command owner without replaying this non-idempotent request. */
    async createPacking(input: components['schemas']['PackingCreateInput'], image: File | null,
                        scope: FrontendRequestScope, itemRows?: readonly number[]): Promise<components['schemas']['EntityCreationResult']> {
        // Validate machine data before adapting it to the established multipart envelope.
        // The image is a separate part rather than a second handwritten creation schema.
        if (!validatePackingCreateInput(input)) {
            throw generatedInputError(validatePackingCreateInput.errors, path => packingInputField(path, itemRows));
        }

        const form = createMultipartForm(input, image);

        // Preserve captured actor/CSRF context through upload and response classification.
        // A lost response cannot be treated as proof that no list was created.
        return this.transport.read('createPackingList', await this.transport.client.POST('/packing-lists', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validateEntityCreationResult, scope).data;
    }

    /** Quick-add keeps its separate generated creation bounds. A rejected row
     * stays editable without dispatch or an uncertain creation receipt. */
    async addItem(listId: string, input: components['schemas']['PackingNewItem'], scope: FrontendRequestScope) {
        if (!validatePackingNewItem(input)) throw generatedInputError(validatePackingNewItem.errors, path => packingInputField(path));
        return this.transport.read('createPackingItem', await this.transport.client.POST('/packing-lists/{listId}/items', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateEntityCreationResult, scope).data;
    }

    /** Existing-item edits retain their own scalar rules and comparison token;
     * field feedback does not replace the shared conflict/draft lifecycle. */
    async updateItem(listId: string, itemId: string, patch: components['schemas']['PackingItemPatch'], token: string,
                     scope: FrontendRequestScope) {
        if (!validatePackingItemPatch(patch)) throw generatedInputError(validatePackingItemPatch.errors, path => packingInputField(path));
        return this.transport.read('updatePackingItem', await this.transport.client.PATCH('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: patch, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteItem(listId: string, itemId: string, scope: FrontendRequestScope) {
        return this.transport.read('deletePackingItem', await this.transport.client.DELETE('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(listId: string, itemIds: string[], token: string, scope: FrontendRequestScope) {
        return this.transport.read('reorderPackingItems', await this.transport.client.PUT('/packing-lists/{listId}/item-order', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {itemIds}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(listId: string, assignmentId: string, scope: FrontendRequestScope) {
        return this.transport.read('deletePackingAssignment', await this.transport.client.DELETE('/packing-lists/{listId}/assignments/{assignmentId}', {
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
            return transport.client.GET('/packing-lists/events', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`packing/events/${JSON.stringify(query)}`, scope, readEventOptions, 'searchPackingEvents', validateEventPickerOptions, signal)).data;
    }

    async linkEvent(listId: string, input: components['schemas']['EntityEventChangeInput'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('changePackingEvent', await this.transport.client.PUT('/packing-lists/{listId}/event', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateEntityEventChangeResult, scope).data;
    }

    async setDefaults(listId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('updatePackingDefaults', await this.transport.client.PUT('/packing-lists/{listId}/default-permissions', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(listId: string, q: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        function readProfileOptions() {
            return transport.client.GET('/packing-lists/{listId}/profiles', {
                params: {path: {listId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`packing/${listId}/profiles/${q}`, scope, readProfileOptions, 'searchPackingProfiles', validateEntityAdministratorProfileOptions, signal)).data;
    }

    async addAdmin(listId: string, input: components['schemas']['EntityAdministratorInput'], token: string, scope: FrontendRequestScope) {
        return this.transport.read('addPackingAdmin', await this.transport.client.POST('/packing-lists/{listId}/admins', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(listId: string, profileId: string, mask: number, token: string, scope: FrontendRequestScope) {
        return this.transport.read('updatePackingAdmin', await this.transport.client.PATCH('/packing-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(listId: string, profileId: string, token: string, scope: FrontendRequestScope) {
        return this.transport.read('deletePackingAdmin', await this.transport.client.DELETE('/packing-lists/{listId}/admins/{profileId}', {
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
            return transport.client.GET('/packing-lists/{listId}/header', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
        }

        return transport.readHeaderImage(`packing/${listId}/header`, scope, readHeader, signal);
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
        return this.transport.read('uploadPackingHeader', await this.transport.client.PUT('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(listId: string, token: string, scope: FrontendRequestScope) {
        return this.transport.read('deletePackingHeader', await this.transport.client.DELETE('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(listId: string, restore: boolean, scope: FrontendRequestScope) {
        const options = {params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restorePackingList' : 'archivePackingList', restore ? await this.transport.client.POST('/packing-lists/{listId}/restore', options)
            : await this.transport.client.POST('/packing-lists/{listId}/archive', options), validateMutationResult, scope).data;
    }

    async deletePacking(listId: string, scope: FrontendRequestScope) {
        return this.transport.read('deletePackingList', await this.transport.client.DELETE('/packing-lists/{listId}', {
            params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }


    /** Read the public guest-entry surface without fetching private detail/setup.
     * This operation supplies entry presentation only; registering a guest is a
     * separate identity command with its own confirmed context and destination. */
    async guestEntry(listId: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        function readGuestEntry() {
            return transport.client.GET('/packing-lists/{listId}/guest', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson('packing/' + listId + '/guest', scope, readGuestEntry, 'getPackingGuestEntry', validateGuestEntry, signal)).data;
    }

    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) {
        return this.transport.identity("registerPackingGuest", await this.transport.client.POST('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

/** Root fields and item rows keep the labels of their actual controls. Visible
 * row numbers may differ from the collected array when blank drafts are omitted. */
function packingInputField(path: string, itemRows?: readonly number[]): FrontendInputField | undefined {
    const item = /^\/items\/(\d+)\/(\w+)$/u.exec(path);
    const field = item ? item[2] : path.slice(1);
    const label = field === 'title' ? 'packing.title' : field === 'description' ? 'packing.description'
        : field === 'maxAssignees' ? 'packing.maxNumber' : undefined;
    if (label) return {label, ...(item ? {row: {label: 'packing.item', number: itemRows?.[Number(item[1])] ?? Number(item[1]) + 1}} : {})};
    if (path === '/items') return {label: 'packing.itemsToPack'};
    if (path === '/eventId') return {label: 'eventPicker.currentEvent'};
    if (path.startsWith('/defaultPermissions')) return {label: 'packing.groupPermissions'};
    return undefined;
}

/** Reuse this feature adapter for its application-local transport. */
export const usePackingApi = createFeatureApiResolver(PackingApi);
