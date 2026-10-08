import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotEventPickerQuery, PilotEventPickerSource, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {packingKeys} from '../../app/queryKeys';
import {InvalidInputError, UnconfirmedResponseError} from '../../app/transport';
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
import {validatePackingEventOptions} from '../../../../.generated/api/v1/browser/validatePackingEventOptions.mjs';
import {validatePackingEventChanged} from '../../../../.generated/api/v1/browser/validatePackingEventChanged.mjs';
import {validatePackingProfileOptions} from '../../../../.generated/api/v1/browser/validatePackingProfileOptions.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';

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

    async packing(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                  previous?: PilotRead<List>): Promise<PilotRead<List>> {
        return this.transport.allowedRead(`packing/${listId}`, scope, async () => this.transport.read('getPackingList', await this.transport.client.GET('/packing-lists/{listId}', {
            params: {path: {listId}, header: this.transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
        }), validatePackingListView, scope, previous));
    }

    async metadata(listId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const result = await this.transport.allowedRead(`packing/${listId}/metadata`, scope, async () => this.transport.read('getPackingMetadata', await this.transport.client.GET('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: this.transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
        }), validatePackingMetadata, scope, previous));
        if (!result.etag || !/^"[^"\r\n]+"$/u.test(result.etag)) throw new UnconfirmedResponseError();
        return result;
    }

    async saveMetadata(listId: string, patch: components['schemas']['PackingMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        if (!validatePackingMetadataPatch(patch)) throw new InvalidInputError('Invalid metadata patch.');
        const result = this.transport.read('updatePackingMetadata', await this.transport.client.PATCH('/packing-lists/{listId}/metadata', {
            params: {path: {listId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validatePackingMetadata, scope);
        if (!result.etag || !/^"[^"\r\n]+"$/u.test(result.etag)) throw new UnconfirmedResponseError();
        return result;
    }

    async assign(listId: string, itemId: string, assigned: boolean, scope: PilotRequestScope): Promise<Assignment> {
        const options = {params: {path: {listId, itemId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = assigned
            ? await this.transport.client.PUT('/packing-lists/{listId}/items/{itemId}/self-assignment', options)
            : await this.transport.client.DELETE('/packing-lists/{listId}/items/{itemId}/self-assignment', options);
        return this.transport.read(assigned ? 'assignPackingItem' : 'unassignPackingItem', result, validatePackingAssignmentResult, scope).data;
    }

    async settings(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingSettings']> {
        return this.transport.allowedRead(`packing/${listId}/settings`, scope, async () => this.transport.read('getPackingSettings', await this.transport.client.GET('/packing-lists/{listId}/settings', {
            params: {path: {listId}, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingSettings, scope).data);
    }

    async createContext(scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingCreateContext']> {
        return this.transport.allowedRead('packing/create-context', scope, async () => this.transport.read('getPackingCreateContext', await this.transport.client.GET('/packing-lists/create-context', {
            params: {header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingCreateContext, scope).data);
    }

    async duplicate(listId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingDuplicate']> {
        return this.transport.allowedRead(`packing/${listId}/duplicate`, scope, async () => this.transport.read('getPackingDuplicate', await this.transport.client.GET('/packing-lists/{listId}/duplicate', {
            params: {path: {listId}, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingDuplicate, scope).data);
    }

    async createPacking(input: components['schemas']['PackingCreateInput'], image: File | null,
                        scope: PilotRequestScope): Promise<components['schemas']['PackingCreated']> {
        if (!validatePackingCreateInput(input)) throw new InvalidInputError('Invalid packing creation.');
        const form = new FormData();
        form.append('data', JSON.stringify(input));
        if (image) form.append('image', image);
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

    async events(query: PilotEventPickerQuery,
                 scope: PilotRequestScope, signal?: AbortSignal) {
        return this.transport.allowedRead(`packing/events/${JSON.stringify(query)}`, scope, async () => this.transport.read('searchPackingEvents', await this.transport.client.GET('/packing-lists/events', {
            params: {query, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingEventOptions, scope).data);
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

    async profiles(listId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.transport.allowedRead(`packing/${listId}/profiles/${q}`, scope, async () => this.transport.read('searchPackingProfiles', await this.transport.client.GET('/packing-lists/{listId}/profiles', {
            params: {path: {listId}, query: {q}, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validatePackingProfileOptions, scope).data);
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
        const result = await this.transport.client.GET('/packing-lists/{listId}/header', {
            params: {path: {listId}, header: this.transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
        });
        this.transport.checkScope(result.response, scope);
        if (!result.response.ok) this.transport.read('getPackingHeader', result, validatePackingSettings, scope);
        if (result.response.status !== 200 || !(result.data instanceof Blob)
            || !['application/octet-stream', 'image/jpeg', 'image/png', 'image/gif'].includes(result.data.type)) throw new UnconfirmedResponseError();
        return result.data;
    }

    async uploadHeader(listId: string, image: File, token: string, scope: PilotRequestScope) {
        const form = new FormData(); form.append('image', image);
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


    async guestEntry(listId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.transport.allowedRead('packing/' + listId + '/guest', scope, async () => this.transport.read('getPackingGuestEntry', await this.transport.client.GET('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validateGuestEntry, scope).data);
    }

    async registerGuest(listId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
        return this.transport.identity("registerPackingGuest", await this.transport.client.POST('/packing-lists/{listId}/guest', {
            params: {path: {listId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

// usePilot creates a translation binding per component. Its API transport is stable for
// the application/request, so wrappers reuse one owner without sharing it between requests or apps.
const owners = new WeakMap<PilotApi, PackingApi>();
export function usePackingApi(context: PilotContext): PackingApi {
    let owner = owners.get(context.api);
    if (!owner) { owner = new PackingApi(context.api); owners.set(context.api, owner); }
    return owner;
}
