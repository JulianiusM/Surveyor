import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotEventPickerQuery, PilotEventPickerSource, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import type {PilotInputField} from '../../../types/FrontendFeedbackTypes';
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
    constructor(private transport: PilotApi) {}

    // The feature owns discovery authorization and cache families. The shared picker only
    // renders and selects the supplied options, so another feature can reuse its behavior.
    readonly eventPicker: PilotEventPickerSource = {
        search: (query, scope, signal) => this.events(query, scope, signal),
        pageKey: driversKeys.eventPage,
        filterKey: driversKeys.eventFilters,
    };

    /** Read the captured list with its caller-supplied conditional snapshot.
     * The transport validates actor scope before accepting a 304; the feature
     * query owner ensures that previous belongs to this same resource family. */
    async drivers(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                  previous?: PilotRead<List>): Promise<PilotRead<List>> {
        const transport = this.transport;
        async function readDrivers(): Promise<PilotRead<List>> {
            const response = await transport.client.GET('/drivers-lists/{listId}', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversList', {...response, signal}, validateDriversListView, scope, previous);
        }
        return transport.allowedRead(`drivers/${listId}`, scope, readDrivers, signal);
    }

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const transport = this.transport;
        async function readMetadata(): Promise<PilotRead<Metadata>> {
            const response = await transport.client.GET('/drivers-lists/{listId}/metadata', {
                params: {path: {listId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversMetadata', {...response, signal}, validateDriversMetadata, scope, previous);
        }
        const result = await transport.allowedRead(`drivers/${listId}/metadata`, scope, readMetadata, signal);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(listId: string, patch: components['schemas']['DriversMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validateDriversMetadataPatch(patch)) throw generatedInputError(validateDriversMetadataPatch.errors, driversInputField);

        const result = this.transport.read('updateDriversMetadata', await this.transport.client.PATCH('/drivers-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validateDriversMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: PilotRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.transport.client.PUT('/drivers-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.transport.client.DELETE('/drivers-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.transport.read(assigned ? 'assignDriversItem' : 'unassignDriversItem', result, validateDriversAssignmentResult, scope).data;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['DriversSettings']> {
        const transport = this.transport;
        async function readSettings(): Promise<components['schemas']['DriversSettings']> {
            const response = await transport.client.GET('/drivers-lists/{listId}/settings', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversSettings', {...response, signal}, validateDriversSettings, scope).data;
        }
        return transport.allowedRead(`drivers/${listId}/settings`, scope, readSettings, signal);
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: PilotRequestScope, signal?: AbortSignal,
                      returnTo?: string, eventId?: string): Promise<components['schemas']['DriversCreateEntry']> {
        const transport = this.transport;
        async function readCreationEntry(): Promise<components['schemas']['DriversCreateEntry']> {
            const response = await transport.client.GET('/drivers-lists/create-entry', {
                params: {query: {returnTo, eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversCreateEntry', {...response, signal}, validateDriversCreateEntry, scope).data;
        }
        return transport.allowedRead('drivers/create-entry/' + (returnTo ?? '') + '/' + (eventId ?? ''), scope, readCreationEntry, signal);
    }

    /** Detail and explicit guest routes deliberately have different native admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(listId: string, view: 'detail' | 'guest', scope: PilotRequestScope,
                        signal?: AbortSignal): Promise<components['schemas']['DriversResourceEntry']> {
        const transport = this.transport;
        async function readResourceEntry(): Promise<components['schemas']['DriversResourceEntry']> {
            const response = await transport.client.GET('/drivers-lists/{listId}/entry', {
                params: {path: {listId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversResourceEntry', {...response, signal}, validateDriversResourceEntry, scope).data;
        }
        return transport.allowedRead(`drivers/${listId}/entry/${view}`, scope, readResourceEntry, signal);
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                    eventId?: string): Promise<components['schemas']['DriversDuplicate']> {
        const transport = this.transport;
        async function readDuplicate(): Promise<components['schemas']['DriversDuplicate']> {
            const response = await transport.client.GET('/drivers-lists/{listId}/duplicate', {
                params: {path: {listId}, query: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversDuplicate', {...response, signal}, validateDriversDuplicate, scope).data;
        }
        return transport.allowedRead(`drivers/${listId}/duplicate/${eventId ?? ''}`, scope, readDuplicate, signal);
    }

    /** Submit the generated creation contract and optional image as one multipart command.
     * The JSON field retains its authored shape; file bytes use the existing upload boundary.
     * Only a validated creation receipt confirms success, and uncertain delivery is left to
     * the shared command owner without replaying this non-idempotent request. */
    async createDrivers(input: components['schemas']['DriversCreateInput'], image: File | null,
                        scope: PilotRequestScope): Promise<components['schemas']['DriversCreated']> {
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

    async addItem(listId: string, input: components['schemas']['DriversNewItem'], scope: PilotRequestScope) {
        if (!validateDriversNewItem(input)) throw generatedInputError(validateDriversNewItem.errors, driversInputField);
        return this.transport.read('createDriversItem', await this.transport.client.POST('/drivers-lists/{listId}/items', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateDriversCreated, scope).data;
    }

    async updateItem(listId: string, itemId: string, patch: components['schemas']['DriversItemPatch'], token: string,
                     scope: PilotRequestScope) {
        if (!validateDriversItemPatch(patch)) throw generatedInputError(validateDriversItemPatch.errors, driversInputField);
        return this.transport.read('updateDriversItem', await this.transport.client.PATCH('/drivers-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: patch, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteItem(listId: string, itemId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteDriversItem', await this.transport.client.DELETE('/drivers-lists/{listId}/items/{itemId}', {
            params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(listId: string, itemIds: string[], token: string, scope: PilotRequestScope) {
        return this.transport.read('reorderDriversItems', await this.transport.client.PUT('/drivers-lists/{listId}/item-order', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {itemIds}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(listId: string, assignmentId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteDriversAssignment', await this.transport.client.DELETE('/drivers-lists/{listId}/assignments/{assignmentId}', {
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
            const response = await transport.client.GET('/drivers-lists/events', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchDriversEvents', {...response, signal}, validateEventPickerOptions, scope).data;
        }
        return transport.allowedRead(`drivers/events/${JSON.stringify(query)}`, scope, readEventOptions, signal);
    }

    async linkEvent(listId: string, input: components['schemas']['DriversEventChange'], token: string, scope: PilotRequestScope) {
        return this.transport.read('changeDriversEvent', await this.transport.client.PUT('/drivers-lists/{listId}/event', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateDriversEventChanged, scope).data;
    }

    async setDefaults(listId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updateDriversDefaults', await this.transport.client.PUT('/drivers-lists/{listId}/default-permissions', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(listId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readProfileOptions(): Promise<components['schemas']['DriversProfileOptions']> {
            const response = await transport.client.GET('/drivers-lists/{listId}/profiles', {
                params: {path: {listId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchDriversProfiles', {...response, signal}, validateDriversProfileOptions, scope).data;
        }
        return transport.allowedRead(`drivers/${listId}/profiles/${q}`, scope, readProfileOptions, signal);
    }

    async addAdmin(listId: string, input: components['schemas']['DriversAdminInput'], token: string, scope: PilotRequestScope) {
        return this.transport.read('addDriversAdmin', await this.transport.client.POST('/drivers-lists/{listId}/admins', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(listId: string, profileId: string, mask: number, token: string, scope: PilotRequestScope) {
        return this.transport.read('updateDriversAdmin', await this.transport.client.PATCH('/drivers-lists/{listId}/admins/{profileId}', {
            params: {path: {listId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(listId: string, profileId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteDriversAdmin', await this.transport.client.DELETE('/drivers-lists/{listId}/admins/{profileId}', {
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
            const result = await transport.client.GET('/drivers-lists/{listId}/header', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
            return transport.headerImage(result, scope, signal);
        }

        return transport.allowedRead(`drivers/${listId}/header`, scope, readHeader, signal);
    }

    /** Replace the header using the file draft's reviewed comparison token.
     * Multipart serialization transports bytes while generated operation metadata still
     * identifies the request. The controller owns image admission, locked comparison and
     * committed cleanup; this adapter confirms only a validated mutation receipt. */
    async uploadHeader(listId: string, image: File, token: string, scope: PilotRequestScope) {
        // Keep the chosen bytes separate from their generated filename placeholder.
        // The serializer supplies the actual multipart body without copying upload policy.
        const form = createMultipartForm(null, image);

        // Send the token captured when this file was chosen, never a newer settings token
        // obtained while the draft was waiting. The shared command owner handles recovery.
        return this.transport.read('uploadDriversHeader', await this.transport.client.PUT('/drivers-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(listId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteDriversHeader', await this.transport.client.DELETE('/drivers-lists/{listId}/header', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(listId: string, restore: boolean, scope: PilotRequestScope) {
        const options = {params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restoreDriversList' : 'archiveDriversList', restore ? await this.transport.client.POST('/drivers-lists/{listId}/restore', options)
            : await this.transport.client.POST('/drivers-lists/{listId}/archive', options), validateMutationResult, scope).data;
    }

    async deleteDrivers(listId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteDriversList', await this.transport.client.DELETE('/drivers-lists/{listId}', {
            params: {path: {listId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }


    /** Read the public guest-entry surface without fetching private detail/setup.
     * This operation supplies entry presentation only; registering a guest is a
     * separate identity command with its own confirmed context and destination. */
    async guestEntry(listId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readGuestEntry(): Promise<components['schemas']['GuestEntry']> {
            const response = await transport.client.GET('/drivers-lists/{listId}/guest', {
                params: {path: {listId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getDriversGuestEntry', {...response, signal}, validateGuestEntry, scope).data;
        }
        return transport.allowedRead('drivers/' + listId + '/guest', scope, readGuestEntry, signal);
    }

    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
        return this.transport.identity("registerDriversGuest", await this.transport.client.POST('/drivers-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

/** Matching creation, quick-add and property controls share field diagnostics;
 * their generated contracts retain their deliberately distinct constraints. */
function driversInputField(path: string): PilotInputField | undefined {
    if (path === '/title') return {label: 'packing.title'};
    if (path === '/description') return {label: 'packing.description'};
    if (path === '/maxAssignees') return {label: 'packing.maxNumber'};
    if (path === '/eventId') return {label: 'eventPicker.currentEvent'};
    if (path.startsWith('/defaultPermissions')) return {label: 'packing.groupPermissions'};
    return undefined;
}

const owners = new WeakMap<PilotApi, DriversApi>();

/** Reuse one Drivers transport wrapper for this application/request's API owner.
 * Component-local translation bindings may create context wrappers, but they retain the
 * same transport. A WeakMap preserves that ownership without sharing actors across apps. */
export function useDriversApi(context: PilotContext): DriversApi {
    let owner = owners.get(context.api);

    // Construct lazily for this transport identity; component remounts reuse the wrapper
    // while disposal releases it when the application-local API is no longer referenced.
    if (!owner) {
        owner = new DriversApi(context.api);
        owners.set(context.api, owner);
    }
    return owner;
}
