import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {validateEventCreatedRegistrationLink} from '../../../../.generated/api/v1/browser/validateEventCreatedRegistrationLink.mjs';
import {validateEventRegistrationLinkInput} from '../../../../.generated/api/v1/browser/validateEventRegistrationLinkInput.mjs';
import {validateEventRegistrationDates} from '../../../../.generated/api/v1/browser/validateEventRegistrationDates.mjs';
import {validateEventRegistrationInput} from '../../../../.generated/api/v1/browser/validateEventRegistrationInput.mjs';
import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import type {PilotInputField} from '../../../types/FrontendFeedbackTypes';
import {createMultipartForm, generatedInputError} from '../../app/transport';
import {validateEventCreateEntry} from '../../../../.generated/api/v1/browser/validateEventCreateEntry.mjs';
import {validateEventCreateInput} from '../../../../.generated/api/v1/browser/validateEventCreateInput.mjs';
import {validateEventCreated} from '../../../../.generated/api/v1/browser/validateEventCreated.mjs';
import {validateEventDuplicate} from '../../../../.generated/api/v1/browser/validateEventDuplicate.mjs';
import {validateEventMetadata} from '../../../../.generated/api/v1/browser/validateEventMetadata.mjs';
import {validateEventMetadataPatch} from '../../../../.generated/api/v1/browser/validateEventMetadataPatch.mjs';
import {validateEventResourceEntry} from '../../../../.generated/api/v1/browser/validateEventResourceEntry.mjs';
import {validateEventSettings} from '../../../../.generated/api/v1/browser/validateEventSettings.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validatePackingProfileOptions} from '../../../../.generated/api/v1/browser/validatePackingProfileOptions.mjs';
import {validateEventView} from '../../../../.generated/api/v1/browser/validateEventView.mjs';
import {validateEventParticipants} from '../../../../.generated/api/v1/browser/validateEventParticipants.mjs';
import {validateEventRegistrationLinks} from '../../../../.generated/api/v1/browser/validateEventRegistrationLinks.mjs';
import {validateEventThingsToDo} from '../../../../.generated/api/v1/browser/validateEventThingsToDo.mjs';

type Metadata = components['schemas']['EventMetadata'];

/** Events select generated operations while the existing transport owns captured actor admission. */
export class EventApi {
    constructor(private transport: PilotApi) {}

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(eventId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const transport = this.transport;
        async function readMetadata(): Promise<PilotRead<Metadata>> {
            const response = await transport.client.GET('/events/{eventId}/metadata', {
                params: {path: {eventId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getEventMetadata', {...response, signal}, validateEventMetadata, scope, previous);
        }
        const result = await transport.allowedRead(`event/${eventId}/metadata`, scope, readMetadata, signal);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(eventId: string, patch: components['schemas']['EventMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validateEventMetadataPatch(patch)) throw generatedInputError(validateEventMetadataPatch.errors, eventInputField);

        const result = this.transport.read('updateEventMetadata', await this.transport.client.PATCH('/events/{eventId}/metadata', {
            params: {path: {eventId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validateEventMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(eventId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['EventSettings']> {
        const transport = this.transport;
        async function readSettings(): Promise<components['schemas']['EventSettings']> {
            const response = await transport.client.GET('/events/{eventId}/settings', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventSettings', {...response, signal}, validateEventSettings, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/settings`, scope, readSettings, signal);
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: PilotRequestScope, signal?: AbortSignal,
                      returnTo?: string): Promise<components['schemas']['EventCreateEntry']> {
        const transport = this.transport;
        async function readCreationEntry(): Promise<components['schemas']['EventCreateEntry']> {
            const response = await transport.client.GET('/events/create-entry', {
                params: {query: {returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventCreateEntry', {...response, signal}, validateEventCreateEntry, scope).data;
        }
        return transport.allowedRead('event/create-entry/' + (returnTo ?? ''), scope, readCreationEntry, signal);
    }

    /** Adapt the generated Event draft to multipart without changing its native
     * parsing/order. Only the declared JSON receipt confirms this creation. */
    async createEvent(input: components['schemas']['EventCreateInput'], image: File | null,
                      scope: PilotRequestScope): Promise<components['schemas']['EventCreated']> {
        if (!validateEventCreateInput(input)) throw generatedInputError(validateEventCreateInput.errors, eventInputField);
        const form = createMultipartForm(input, image);

        // Captured actor/CSRF proof covers both file delivery and response
        // classification; losing that response never authorizes a second POST.
        return this.transport.read('createEvent', await this.transport.client.POST('/events', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validateEventCreated, scope).data;
    }

    /** Detail and explicit guest routes deliberately have different native admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(eventId: string, view: 'detail' | 'guest' | 'admin', scope: PilotRequestScope,
                        signal?: AbortSignal, regToken?: string): Promise<components['schemas']['EventResourceEntry']> {
        const transport = this.transport;
        async function readResourceEntry(): Promise<components['schemas']['EventResourceEntry']> {
            const response = await transport.client.GET('/events/{eventId}/entry', {
                params: {path: {eventId}, query: {view, regToken}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventResourceEntry', {...response, signal}, validateEventResourceEntry, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/entry/${view}`, scope, readResourceEntry, signal);
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(eventId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['EventDuplicate']> {
        const transport = this.transport;
        async function readDuplicate(): Promise<components['schemas']['EventDuplicate']> {
            const response = await transport.client.GET('/events/{eventId}/duplicate', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventDuplicate', {...response, signal}, validateEventDuplicate, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/duplicate`, scope, readDuplicate, signal);
    }

    async setDefaults(eventId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updateEventDefaults', await this.transport.client.PUT('/events/{eventId}/default-permissions', {
            params: {path: {eventId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(eventId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readProfileOptions(): Promise<components['schemas']['PackingProfileOptions']> {
            const response = await transport.client.GET('/events/{eventId}/profiles', {
                params: {path: {eventId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchEventProfiles', {...response, signal}, validatePackingProfileOptions, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/profiles/${q}`, scope, readProfileOptions, signal);
    }

    async addAdmin(eventId: string, input: components['schemas']['PackingAdminInput'], token: string, scope: PilotRequestScope) {
        return this.transport.read('addEventAdmin', await this.transport.client.POST('/events/{eventId}/admins', {
            params: {path: {eventId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(eventId: string, profileId: string, mask: number, token: string, scope: PilotRequestScope) {
        return this.transport.read('updateEventAdmin', await this.transport.client.PATCH('/events/{eventId}/admins/{profileId}', {
            params: {path: {eventId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(eventId: string, profileId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteEventAdmin', await this.transport.client.DELETE('/events/{eventId}/admins/{profileId}', {
            params: {path: {eventId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async header(eventId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<Blob> {
        const transport = this.transport;

        /** openapi-fetch uses blob decoding only for success. Error bodies retain its
         * ordinary JSON/text decoder and the shared validated rejection policy.
         * Binary recovery therefore observes the same actor and Retry-After owner
         * as JSON reads instead of introducing a second error parser or deadline. */
        async function readHeader(): Promise<Blob> {
            const result = await transport.client.GET('/events/{eventId}/header', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
            return transport.headerImage(result, scope, signal);
        }

        return transport.allowedRead(`event/${eventId}/header`, scope, readHeader, signal);
    }

    /** Replace the header using the file draft's reviewed comparison token.
     * Multipart serialization transports bytes while generated operation metadata still
     * identifies the request. The controller owns image admission, locked comparison and
     * committed cleanup; this adapter confirms only a validated mutation receipt. */
    async uploadHeader(eventId: string, image: File, token: string, scope: PilotRequestScope) {
        // Keep the chosen bytes separate from their generated filename placeholder.
        // The serializer supplies the actual multipart body without copying upload policy.
        const form = createMultipartForm(null, image);

        // Send the token captured when this file was chosen, never a newer settings token
        // obtained while the draft was waiting. The shared command owner handles recovery.
        return this.transport.read('uploadEventHeader', await this.transport.client.PUT('/events/{eventId}/header', {
            params: {path: {eventId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(eventId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteEventHeader', await this.transport.client.DELETE('/events/{eventId}/header', {
            params: {path: {eventId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(eventId: string, restore: boolean, scope: PilotRequestScope) {
        const options = {params: {path: {eventId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restoreEvent' : 'archiveEvent', restore ? await this.transport.client.POST('/events/{eventId}/restore', options)
            : await this.transport.client.POST('/events/{eventId}/archive', options), validateMutationResult, scope).data;
    }

    async deleteEvent(eventId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteEvent', await this.transport.client.DELETE('/events/{eventId}', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Read this independently admitted Event projection without broadening sibling access. */
    async event(eventId: string, scope: PilotRequestScope, signal?: AbortSignal, admin = false): Promise<components['schemas']['EventView']> {
        const transport = this.transport;
        async function readProjection(): Promise<components['schemas']['EventView']> {
            const response = await transport.client.GET('/events/{eventId}', {
                params: {path: {eventId}, query: {view: admin ? 'admin' : 'detail'}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEvent', {...response, signal}, validateEventView, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/${admin}`, scope, readProjection, signal);
    }

    /** Read this independently admitted Event projection without broadening sibling access. */
    async participants(eventId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['EventParticipants']> {
        const transport = this.transport;
        async function readProjection(): Promise<components['schemas']['EventParticipants']> {
            const response = await transport.client.GET('/events/{eventId}/participants', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventParticipants', {...response, signal}, validateEventParticipants, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/participants`, scope, readProjection, signal);
    }

    /** Read this independently admitted Event projection without broadening sibling access. */
    async links(eventId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['EventRegistrationLinks']> {
        const transport = this.transport;
        async function readProjection(): Promise<components['schemas']['EventRegistrationLinks']> {
            const response = await transport.client.GET('/events/{eventId}/links', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('listEventRegistrationLinks', {...response, signal}, validateEventRegistrationLinks, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/links`, scope, readProjection, signal);
    }

    /** Read this independently admitted Event projection without broadening sibling access. */
    async thingsToDo(eventId: string, scope: PilotRequestScope, signal?: AbortSignal, admin = false): Promise<components['schemas']['EventThingsToDo']> {
        const transport = this.transport;
        async function readProjection(): Promise<components['schemas']['EventThingsToDo']> {
            const response = await transport.client.GET('/events/{eventId}/things-to-do', {
                params: {path: {eventId}, query: {view: admin ? 'admin' : 'detail'}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventThingsToDo', {...response, signal}, validateEventThingsToDo, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/things-to-do/${admin}`, scope, readProjection, signal);
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async saveRegistration(eventId: string, input: components['schemas']['EventRegistrationInput'], scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        if (!validateEventRegistrationInput(input)) throw generatedInputError(validateEventRegistrationInput.errors, () => undefined);
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.PUT('/events/{eventId}/registration', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        });
        return this.transport.read('saveEventRegistration', result, validateMutationResult, scope).data;
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async cancelRegistration(eventId: string, scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.DELETE('/events/{eventId}/registration', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, cache: 'no-store',
        });
        return this.transport.read('cancelEventRegistration', result, validateMutationResult, scope).data;
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async updateRegistrationDates(eventId: string, registrationId: string, input: components['schemas']['EventRegistrationDates'], scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        if (!validateEventRegistrationDates(input)) throw generatedInputError(validateEventRegistrationDates.errors, () => undefined);
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.PATCH('/events/{eventId}/registrations/{registrationId}', {
            params: {path: {eventId, registrationId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        });
        return this.transport.read('updateEventRegistrationDates', result, validateMutationResult, scope).data;
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async removeRegistration(eventId: string, registrationId: string, scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.DELETE('/events/{eventId}/registrations/{registrationId}', {
            params: {path: {eventId, registrationId}, header: this.transport.headers(scope)}, cache: 'no-store',
        });
        return this.transport.read('removeEventRegistration', result, validateMutationResult, scope).data;
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async createLink(eventId: string, input: components['schemas']['EventRegistrationLinkInput'], scope: PilotRequestScope): Promise<components['schemas']['EventCreatedRegistrationLink']> {
        if (!validateEventRegistrationLinkInput(input)) throw generatedInputError(validateEventRegistrationLinkInput.errors, () => undefined);
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.POST('/events/{eventId}/links', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        });
        return this.transport.read('createEventRegistrationLink', result, validateEventCreatedRegistrationLink, scope).data;
    }

    /** Dispatch one deliberate shared operation; an unconfirmed delivery never replays. */
    async revokeLink(eventId: string, linkId: string, scope: PilotRequestScope): Promise<components['schemas']['MutationResult']> {
        // The captured actor/CSRF headers remain identical through response classification.
        const result = await this.transport.client.DELETE('/events/{eventId}/links/{linkId}', {
            params: {path: {eventId, linkId}, header: this.transport.headers(scope)}, cache: 'no-store',
        });
        return this.transport.read('revokeEventRegistrationLink', result, validateMutationResult, scope).data;
    }

    /** Public guest presentation carries a token only into its canonical destination.
     * Reading or prefetching this boundary never spends a registration bypass use. */
    async guestEntry(eventId: string, scope: PilotRequestScope, signal?: AbortSignal, regToken?: string) {
        const transport = this.transport;
        async function readGuestEntry(): Promise<components['schemas']['GuestEntry']> {
            const response = await transport.client.GET('/events/{eventId}/guest', {
                params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventGuestEntry', {...response, signal}, validateGuestEntry, scope).data;
        }
        return transport.allowedRead(`event/${eventId}/guest`, scope, readGuestEntry, signal);
    }

    /** Identity completion is shared; the token remains an unconsumed registration input. */
    async registerGuest(eventId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope, regToken?: string) {
        return this.transport.identity('registerEventGuest', await this.transport.client.POST('/events/{eventId}/guest', {
            params: {path: {eventId}, query: {regToken}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }

    /** Event automatic archival is independent from direct archive and permanent deletion. */
    async automate(eventId: string, paused: boolean, scope: PilotRequestScope) {
        const result = await this.transport.client.PUT('/events/{eventId}/automatic-archive', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, body: {paused}, cache: 'no-store',
        });
        return this.transport.read('setEventAutomaticArchival', result, validateMutationResult, scope).data;
    }

    /** Child lifecycle commands use the current Event view intent and existing shared operation. */
    async archiveChild(eventId: string, entityType: 'packing' | 'activity' | 'drivers', entityId: string,
                       restore: boolean, scope: PilotRequestScope, admin = false) {
        const options = {params: {path: {eventId, entityType, entityId}, query: {view: admin ? 'admin' as const : 'detail' as const},
            header: this.transport.headers(scope)}, cache: 'no-store' as const};
        const result = restore ? await this.transport.client.POST('/events/{eventId}/things-to-do/{entityType}/{entityId}/restore', options)
            : await this.transport.client.POST('/events/{eventId}/things-to-do/{entityType}/{entityId}/archive', options);
        return this.transport.read(restore ? 'restoreEventChild' : 'archiveEventChild', result, validateMutationResult, scope).data;
    }

    /** Delete an owner-managed child only within its admitted parent/type scope.
     * The existing feature operation owns deletion and best-effort file cleanup. */
    async deleteChild(eventId: string, entityType: 'packing' | 'activity' | 'drivers', entityId: string,
                      scope: PilotRequestScope, admin = false): Promise<components['schemas']['MutationResult']> {
        const result = await this.transport.client.DELETE('/events/{eventId}/things-to-do/{entityType}/{entityId}', {
            params: {path: {eventId, entityType, entityId}, query: {view: admin ? 'admin' : 'detail'},
                header: this.transport.headers(scope)}, cache: 'no-store',
        });
        return this.transport.read('deleteEventChild', result, validateMutationResult, scope).data;
    }

    /** Pausing/resuming preserves shared archival state rather than editing personal placement. */
    async automateChild(eventId: string, entityType: 'packing' | 'activity' | 'drivers', entityId: string,
                        paused: boolean, scope: PilotRequestScope, admin = false) {
        const result = await this.transport.client.PUT('/events/{eventId}/things-to-do/{entityType}/{entityId}/automatic-archive', {
            params: {path: {eventId, entityType, entityId}, query: {view: admin ? 'admin' : 'detail'}, header: this.transport.headers(scope)},
            body: {paused}, cache: 'no-store',
        });
        return this.transport.read('setEventChildAutomaticArchival', result, validateMutationResult, scope).data;
    }
}

/** Creation and metadata controls expose the same named Event fields. Their
 * distinct generated contracts remain authoritative for admitted wire values. */
function eventInputField(path: string): PilotInputField | undefined {
    const field = path.slice(1);
    const label = field === 'title' ? 'event.title' : field === 'description' ? 'event.description'
        : field === 'location' ? 'event.locationLabel' : field === 'startDate' ? 'event.startDateLabel'
        : field === 'endDate' ? 'event.endDateLabel' : field === 'maxParticipants' ? 'event.maxParticipantsLabel'
        : field === 'bindingDeadline' ? 'event.deadlineLabel' : field === 'deadlineTz' ? 'event.timezone' : undefined;
    if (label) return {label};
    if (path.startsWith('/defaultPermissions')) return {label: 'packing.groupPermissions'};
    return undefined;
}

const owners = new WeakMap<PilotApi, EventApi>();

/** Keep one feature adapter per application-local transport, without sharing actors. */
export function useEventApi(context: PilotContext): EventApi {
    let owner = owners.get(context.api);
    if (!owner) {
        owner = new EventApi(context.api);
        owners.set(context.api, owner);
    }
    return owner;
}
