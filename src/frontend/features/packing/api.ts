import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotEventPickerQuery, PilotEventPickerSource, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {packingKeys} from '../../app/queryKeys';
import {InvalidInputError} from '../../app/transport';
import {validatePackingListView} from '../../../../.generated/api/v1/browser/validatePackingListView.mjs';
import {validatePackingMetadata} from '../../../../.generated/api/v1/browser/validatePackingMetadata.mjs';
import {validatePackingMetadataPatch} from '../../../../.generated/api/v1/browser/validatePackingMetadataPatch.mjs';
import {validatePackingAssignmentResult} from '../../../../.generated/api/v1/browser/validatePackingAssignmentResult.mjs';
import {validatePackingSettings} from '../../../../.generated/api/v1/browser/validatePackingSettings.mjs';
import {validatePackingCreateContext} from '../../../../.generated/api/v1/browser/validatePackingCreateContext.mjs';
import {validatePackingDuplicate} from '../../../../.generated/api/v1/browser/validatePackingDuplicate.mjs';
import {validatePackingCreateInput} from '../../../../.generated/api/v1/browser/validatePackingCreateInput.mjs';
import {validatePackingCreated} from '../../../../.generated/api/v1/browser/validatePackingCreated.mjs';
import {validatePackingNewItem} from '../../../../.generated/api/v1/browser/validatePackingNewItem.mjs';
import {validatePackingItemPatch} from '../../../../.generated/api/v1/browser/validatePackingItemPatch.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateEventPickerOptions} from '../../../../.generated/api/v1/browser/validateEventPickerOptions.mjs';
import {validatePackingEventChanged} from '../../../../.generated/api/v1/browser/validatePackingEventChanged.mjs';
import {validatePackingProfileOptions} from '../../../../.generated/api/v1/browser/validatePackingProfileOptions.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {validatePackingCreateEntry} from '../../../../.generated/api/v1/browser/validatePackingCreateEntry.mjs';
import {validatePackingResourceEntry} from '../../../../.generated/api/v1/browser/validatePackingResourceEntry.mjs';

type List = components['schemas']['PackingListView'];
type Metadata = components['schemas']['PackingMetadata'];
type Assignment = components['schemas']['PackingAssignmentResult'];

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class PackingApi {
    constructor(private transport: PilotApi) {}

    // The feature owns discovery authorization and cache families. The shared picker only
    // renders and selects the supplied options, so another feature can reuse its behavior.
    readonly eventPicker: PilotEventPickerSource = {
        search: (query, scope, signal) => this.events(query, scope, signal),
        pageKey: packingKeys.eventPage,
        filterKey: packingKeys.eventFilters,
    };

    /** Read the captured list with its caller-supplied conditional snapshot.
     * The transport validates actor scope before accepting a 304; the feature
     * query owner ensures that previous belongs to this same resource family. */
    async packing(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                  previous?: PilotRead<List>): Promise<PilotRead<List>> {
        const transport = this.transport;
        async function readPacking(): Promise<PilotRead<List>> {
            const response = await transport.client.GET('/packing-lists/{listId}', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingList', {...response, signal}, validatePackingListView, scope, previous);
        }
        return transport.allowedRead(`packing/${listId}`, scope, readPacking, signal);
    }

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const transport = this.transport;
        async function readMetadata(): Promise<PilotRead<Metadata>> {
            const response = await transport.client.GET('/packing-lists/{listId}/metadata', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingMetadata', {...response, signal}, validatePackingMetadata, scope, previous);
        }
        const result = await transport.allowedRead(`packing/${listId}/metadata`, scope, readMetadata, signal);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(listId: string, patch: components['schemas']['PackingMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validatePackingMetadataPatch(patch)) throw new InvalidInputError('Invalid metadata patch.');

        const result = this.transport.read('updatePackingMetadata', await this.transport.client.PATCH('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validatePackingMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: PilotRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.transport.client.PUT('/packing-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.transport.client.DELETE('/packing-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.transport.read(assigned ? 'assignPackingItem' : 'unassignPackingItem', result, validatePackingAssignmentResult, scope).data;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingSettings']> {
        const transport = this.transport;
        async function readSettings(): Promise<components['schemas']['PackingSettings']> {
            const response = await transport.client.GET('/packing-lists/{listId}/settings', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingSettings', {...response, signal}, validatePackingSettings, scope).data;
        }
        return transport.allowedRead(`packing/${listId}/settings`, scope, readSettings, signal);
    }

    /** Fetch creation definitions through the account-only creation boundary.
     * Public duplicate admission never substitutes for this operation's actor
     * policy, and recovering the read must not submit a new Packing list. */
    async createContext(scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingCreateContext']> {
        const transport = this.transport;
        async function readCreationContext(): Promise<components['schemas']['PackingCreateContext']> {
            const response = await transport.client.GET('/packing-lists/create-context', {
                params: {header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingCreateContext', {...response, signal}, validatePackingCreateContext, scope).data;
        }
        return transport.allowedRead('packing/create-context', scope, readCreationContext, signal);
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: PilotRequestScope, signal?: AbortSignal,
                      returnTo?: string, eventId?: string): Promise<components['schemas']['PackingCreateEntry']> {
        const transport = this.transport;
        async function readCreationEntry(): Promise<components['schemas']['PackingCreateEntry']> {
            const response = await transport.client.GET('/packing-lists/create-entry', {
                params: {query: {returnTo, eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingCreateEntry', {...response, signal}, validatePackingCreateEntry, scope).data;
        }
        return transport.allowedRead('packing/create-entry/' + (returnTo ?? '') + '/' + (eventId ?? ''), scope, readCreationEntry, signal);
    }

    /** Detail and explicit guest routes deliberately have different native admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(listId: string, view: 'detail' | 'guest', scope: PilotRequestScope,
                        signal?: AbortSignal): Promise<components['schemas']['PackingResourceEntry']> {
        const transport = this.transport;
        async function readResourceEntry(): Promise<components['schemas']['PackingResourceEntry']> {
            const response = await transport.client.GET('/packing-lists/{listId}/entry', {
                params: {path: {listId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingResourceEntry', {...response, signal}, validatePackingResourceEntry, scope).data;
        }
        return transport.allowedRead(`packing/${listId}/entry/${view}`, scope, readResourceEntry, signal);
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                    eventId?: string): Promise<components['schemas']['PackingDuplicate']> {
        const transport = this.transport;
        async function readDuplicate(): Promise<components['schemas']['PackingDuplicate']> {
            const response = await transport.client.GET('/packing-lists/{listId}/duplicate', {
                params: {path: {listId}, query: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingDuplicate', {...response, signal}, validatePackingDuplicate, scope).data;
        }
        return transport.allowedRead(`packing/${listId}/duplicate/${eventId ?? ''}`, scope, readDuplicate, signal);
    }

    /** Submit the generated creation contract and optional image as one multipart command.
     * The JSON field retains its authored shape; file bytes use the existing upload boundary.
     * Only a validated creation receipt confirms success, and uncertain delivery is left to
     * the shared command owner without replaying this non-idempotent request. */
    async createPacking(input: components['schemas']['PackingCreateInput'], image: File | null,
                        scope: PilotRequestScope): Promise<components['schemas']['PackingCreated']> {
        // Validate machine data before adapting it to the established multipart envelope.
        // The image is a separate part rather than a second handwritten creation schema.
        if (!validatePackingCreateInput(input)) throw new InvalidInputError('Invalid packing creation.');

        const form = new FormData();
        form.append('data', JSON.stringify(input));
        if (image) form.append('image', image);

        // Preserve captured actor/CSRF context through upload and response classification.
        // A lost response cannot be treated as proof that no list was created.
        return this.transport.read('createPackingList', await this.transport.client.POST('/packing-lists', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validatePackingCreated, scope).data;
    }

    async addItem(listId: string, input: components['schemas']['PackingNewItem'], scope: PilotRequestScope) {
        if (!validatePackingNewItem(input)) throw new InvalidInputError('Invalid packing item.');
        return this.transport.read('createPackingItem', await this.transport.client.POST('/packing-lists/{listId}/items', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validatePackingCreated, scope).data;
    }

    async updateItem(listId: string, itemId: string, patch: components['schemas']['PackingItemPatch'], token: string,
                     scope: PilotRequestScope) {
        if (!validatePackingItemPatch(patch)) throw new InvalidInputError('Invalid packing item patch.');
        return this.transport.read('updatePackingItem', await this.transport.client.PATCH('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: patch, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteItem(listId: string, itemId: string, scope: PilotRequestScope) {
        return this.transport.read('deletePackingItem', await this.transport.client.DELETE('/packing-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(listId: string, itemIds: string[], token: string, scope: PilotRequestScope) {
        return this.transport.read('reorderPackingItems', await this.transport.client.PUT('/packing-lists/{listId}/item-order', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {itemIds}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(listId: string, assignmentId: string, scope: PilotRequestScope) {
        return this.transport.read('deletePackingAssignment', await this.transport.client.DELETE('/packing-lists/{listId}/assignments/{assignmentId}', {
            params: {path: {listId, assignmentId: String(assignmentId)}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Read the feature-owned event options for this exact filter/selection page.
     * The picker receives validated presentation only; eligibility and the final
     * relationship change remain independently checked by existing server owners. */
    async events(query: PilotEventPickerQuery,
                  scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readEventOptions(): Promise<components['schemas']['EventPickerOptions']> {
            const response = await transport.client.GET('/packing-lists/events', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchPackingEvents', {...response, signal}, validateEventPickerOptions, scope).data;
        }
        return transport.allowedRead(`packing/events/${JSON.stringify(query)}`, scope, readEventOptions, signal);
    }

    async linkEvent(listId: string, input: components['schemas']['PackingEventChange'], token: string, scope: PilotRequestScope) {
        return this.transport.read('changePackingEvent', await this.transport.client.PUT('/packing-lists/{listId}/event', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validatePackingEventChanged, scope).data;
    }

    async setDefaults(listId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updatePackingDefaults', await this.transport.client.PUT('/packing-lists/{listId}/default-permissions', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(listId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readProfileOptions(): Promise<components['schemas']['PackingProfileOptions']> {
            const response = await transport.client.GET('/packing-lists/{listId}/profiles', {
                params: {path: {listId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchPackingProfiles', {...response, signal}, validatePackingProfileOptions, scope).data;
        }
        return transport.allowedRead(`packing/${listId}/profiles/${q}`, scope, readProfileOptions, signal);
    }

    async addAdmin(listId: string, input: components['schemas']['PackingAdminInput'], token: string, scope: PilotRequestScope) {
        return this.transport.read('addPackingAdmin', await this.transport.client.POST('/packing-lists/{listId}/admins', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(listId: string, profileId: string, mask: number, token: string, scope: PilotRequestScope) {
        return this.transport.read('updatePackingAdmin', await this.transport.client.PATCH('/packing-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(listId: string, profileId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deletePackingAdmin', await this.transport.client.DELETE('/packing-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async header(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<Blob> {
        const transport = this.transport;

        /** openapi-fetch uses blob decoding only for success. Error bodies retain its
         * ordinary JSON/text decoder and the shared validated rejection policy.
         * Binary recovery therefore observes the same actor and Retry-After owner
         * as JSON reads instead of introducing a second error parser or deadline. */
        async function readHeader(): Promise<Blob> {
            const result = await transport.client.GET('/packing-lists/{listId}/header', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
            return transport.headerImage(result, scope, signal);
        }

        return transport.allowedRead(`packing/${listId}/header`, scope, readHeader, signal);
    }

    /** Replace the header using the file draft's reviewed comparison token.
     * Multipart serialization transports bytes while generated operation metadata still
     * identifies the request. The controller owns image admission, locked comparison and
     * committed cleanup; this adapter confirms only a validated mutation receipt. */
    async uploadHeader(listId: string, image: File, token: string, scope: PilotRequestScope) {
        // Keep the chosen bytes separate from their generated filename placeholder.
        // The serializer supplies the actual multipart body without copying upload policy.
        const form = new FormData();
        form.append('image', image);

        // Send the token captured when this file was chosen, never a newer settings token
        // obtained while the draft was waiting. The shared command owner handles recovery.
        return this.transport.read('uploadPackingHeader', await this.transport.client.PUT('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(listId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deletePackingHeader', await this.transport.client.DELETE('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(listId: string, restore: boolean, scope: PilotRequestScope) {
        const options = {params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restorePackingList' : 'archivePackingList', restore ? await this.transport.client.POST('/packing-lists/{listId}/restore', options)
            : await this.transport.client.POST('/packing-lists/{listId}/archive', options), validateMutationResult, scope).data;
    }

    async deletePacking(listId: string, scope: PilotRequestScope) {
        return this.transport.read('deletePackingList', await this.transport.client.DELETE('/packing-lists/{listId}', {
            params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }


    /** Read the public guest-entry surface without fetching private detail/setup.
     * This operation supplies entry presentation only; registering a guest is a
     * separate identity command with its own confirmed context and destination. */
    async guestEntry(listId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readGuestEntry(): Promise<components['schemas']['GuestEntry']> {
            const response = await transport.client.GET('/packing-lists/{listId}/guest', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getPackingGuestEntry', {...response, signal}, validateGuestEntry, scope).data;
        }
        return transport.allowedRead('packing/' + listId + '/guest', scope, readGuestEntry, signal);
    }

    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
        return this.transport.identity("registerPackingGuest", await this.transport.client.POST('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

const owners = new WeakMap<PilotApi, PackingApi>();

/** Reuse one Packing transport wrapper for this application/request's API owner.
 * Component-local translation bindings may create context wrappers, but they retain the
 * same transport. A WeakMap preserves that ownership without sharing actors across apps. */
export function usePackingApi(context: PilotContext): PackingApi {
    let owner = owners.get(context.api);

    // Construct lazily for this transport identity; component remounts reuse the wrapper
    // while disposal releases it when the application-local API is no longer referenced.
    if (!owner) {
        owner = new PackingApi(context.api);
        owners.set(context.api, owner);
    }
    return owner;
}
