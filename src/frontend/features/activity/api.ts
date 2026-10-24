import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotEventPickerQuery, PilotEventPickerSource, PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import type {PilotInputField} from '../../../types/FrontendFeedbackTypes';
import {activityKeys} from '../../app/queryKeys';
import {createMultipartForm, generatedInputError} from '../../app/transport';
import {validateActivityView} from '../../../../.generated/api/v1/browser/validateActivityView.mjs';
import {validateActivityMetadata} from '../../../../.generated/api/v1/browser/validateActivityMetadata.mjs';
import {validateActivityMetadataPatch} from '../../../../.generated/api/v1/browser/validateActivityMetadataPatch.mjs';
import {validateActivitySettings} from '../../../../.generated/api/v1/browser/validateActivitySettings.mjs';
import {validateActivityDuplicate} from '../../../../.generated/api/v1/browser/validateActivityDuplicate.mjs';
import {validateActivityCreateInput} from '../../../../.generated/api/v1/browser/validateActivityCreateInput.mjs';
import {validateActivityCreated} from '../../../../.generated/api/v1/browser/validateActivityCreated.mjs';
import {validateActivityRoleInput} from '../../../../.generated/api/v1/browser/validateActivityRoleInput.mjs';
import {validateActivityTextFieldPatch} from '../../../../.generated/api/v1/browser/validateActivityTextFieldPatch.mjs';
import {validateActivityNewSlot} from '../../../../.generated/api/v1/browser/validateActivityNewSlot.mjs';
import {validateActivitySlotPatch} from '../../../../.generated/api/v1/browser/validateActivitySlotPatch.mjs';
import {validateEventPickerOptions} from '../../../../.generated/api/v1/browser/validateEventPickerOptions.mjs';
import {validatePackingEventChanged} from '../../../../.generated/api/v1/browser/validatePackingEventChanged.mjs';
import {validatePackingProfileOptions} from '../../../../.generated/api/v1/browser/validatePackingProfileOptions.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {validateActivityCreateEntry} from '../../../../.generated/api/v1/browser/validateActivityCreateEntry.mjs';
import {validateActivityResourceEntry} from '../../../../.generated/api/v1/browser/validateActivityResourceEntry.mjs';
import {validateActivityWarningPreview} from '../../../../.generated/api/v1/browser/validateActivityWarningPreview.mjs';
import {validateActivityTextFieldInput} from '../../../../.generated/api/v1/browser/validateActivityTextFieldInput.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateActivityRequirements} from '../../../../.generated/api/v1/browser/validateActivityRequirements.mjs';
import {validateActivityRequirementsInput} from '../../../../.generated/api/v1/browser/validateActivityRequirementsInput.mjs';
import {validateActivityRecommendations} from '../../../../.generated/api/v1/browser/validateActivityRecommendations.mjs';
import {validateActivityRecommendationReview} from '../../../../.generated/api/v1/browser/validateActivityRecommendationReview.mjs';
import {validateActivityRecommendationApplication} from '../../../../.generated/api/v1/browser/validateActivityRecommendationApplication.mjs';
import {validateActivityRecommendationPreview} from '../../../../.generated/api/v1/browser/validateActivityRecommendationPreview.mjs';
import {validateActivityRecommendationApplyResult} from '../../../../.generated/api/v1/browser/validateActivityRecommendationApplyResult.mjs';
import {validateActivityRecommendationQueued} from '../../../../.generated/api/v1/browser/validateActivityRecommendationQueued.mjs';
import {validateActivityRecommendationJobResult} from '../../../../.generated/api/v1/browser/validateActivityRecommendationJobResult.mjs';

type List = components['schemas']['ActivityView'];
type Metadata = components['schemas']['ActivityMetadata'];

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class ActivityApi {
    constructor(private transport: PilotApi) {}

    /** Requirements are independently private; reads preserve cancellation and shared cooldowns. */
    async requirements(planId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ActivityRequirements']> {
        const transport = this.transport;
        async function readRequirements(): Promise<components['schemas']['ActivityRequirements']> {
            const response = await transport.client.GET('/activity-plans/{planId}/requirements', {
                params: {path: {planId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityRequirements', {...response, signal}, validateActivityRequirements, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/requirements`, scope, readRequirements, signal);
    }

    /** Submit the generated flat settings draft once through the existing business owner. */
    async saveRequirements(planId: string, input: components['schemas']['ActivityRequirementsInput'], scope: PilotRequestScope) {
        // Zero-valued requirements and explicit nulls survive generated structural validation.
        if (!validateActivityRequirementsInput(input)) {
            throw generatedInputError(validateActivityRequirementsInput.errors, path => activityRequirementField(path, input));
        }
        return this.transport.read('updateActivityRequirements', await this.transport.client.PUT('/activity-plans/{planId}/requirements', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Deliberate workspace entry retains native maintenance and possible automatic dispatch.
     * It is a command, so shared read recovery never repeats it automatically. */
    async recommendationWorkspace(planId: string, scope: PilotRequestScope): Promise<components['schemas']['ActivityRecommendations']> {
        // The caller owns page entry/explicit refresh; ordinary query refresh uses the pure read.
        return this.transport.read('enterActivityRecommendations', await this.transport.client.POST('/activity-plans/{planId}/recommendations/entry', {
            params: {path: {planId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateActivityRecommendations, scope).data;
    }

    /** Observe a safe snapshot for authority/unknown-result recovery without maintaining or enqueuing. */
    async recommendations(planId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ActivityRecommendations']> {
        const transport = this.transport;
        async function readRecommendations(): Promise<components['schemas']['ActivityRecommendations']> {
            const response = await transport.client.GET('/activity-plans/{planId}/recommendations', {
                params: {path: {planId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityRecommendations', {...response, signal}, validateActivityRecommendations, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/recommendations`, scope, readRecommendations, signal);
    }

    /** Preview the submitted batch and retain the digest for its explicit warning acknowledgement. */
    async previewRecommendations(planId: string, input: components['schemas']['ActivityRecommendationReview'], scope: PilotRequestScope, signal?: AbortSignal) {
        // The preview carries the same generated draft that application will submit.
        if (!validateActivityRecommendationReview(input)) throw generatedInputError(validateActivityRecommendationReview.errors, () => undefined);
        return this.transport.read('previewActivityRecommendations', await this.transport.client.POST('/activity-plans/{planId}/recommendations/warnings', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, signal, cache: 'no-store',
        }), validateActivityRecommendationPreview, scope).data;
    }

    /** Apply once with the reviewed batch and optional acknowledgement; uncertainty never replays. */
    async applyRecommendations(planId: string, input: components['schemas']['ActivityRecommendationApplication'], scope: PilotRequestScope) {
        // The server rechecks current sources and warnings before its existing transaction writes.
        if (!validateActivityRecommendationApplication(input)) throw generatedInputError(validateActivityRecommendationApplication.errors, () => undefined);
        return this.transport.read('applyActivityRecommendations', await this.transport.client.POST('/activity-plans/{planId}/recommendations/apply', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateActivityRecommendationApplyResult, scope).data;
    }

    /** Explicit dispatch returns the domain coordinator's identity and coalescing result. */
    async generateRecommendations(planId: string, scope: PilotRequestScope) {
        return this.transport.read('generateActivityRecommendations', await this.transport.client.POST('/activity-plans/{planId}/recommendations/auto', {
            params: {path: {planId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateActivityRecommendationQueued, scope).data;
    }

    /** Poll only a known domain job; transport cooldown/cancellation remain shared. */
    async recommendationJob(planId: string, jobId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ActivityRecommendationJob']> {
        const transport = this.transport;
        async function readJob(): Promise<components['schemas']['ActivityRecommendationJob']> {
            const response = await transport.client.GET('/activity-plans/{planId}/recommendations/auto/{jobId}', {
                params: {path: {planId, jobId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityRecommendationJob', {...response, signal}, validateActivityRecommendationJobResult, scope).data.job;
        }
        return transport.allowedRead(`activity/${planId}/recommendations/jobs/${jobId}`, scope, readJob, signal);
    }

    /** Slot commands adapt existing controller operations. The component supplies only
     * its admitted sparse values; actor, ownership and business policy stay server-owned. */
    async addSlot(planId: string, input: components['schemas']['ActivityNewSlot'], scope: PilotRequestScope) {
        if (!validateActivityNewSlot(input)) throw generatedInputError(validateActivityNewSlot.errors, path => activityInputField(path));
        return this.transport.read('addActivitySlot', await this.transport.client.POST('/activity-plans/{planId}/slots', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Validate the sparse edit before dispatch while preserving the slot's captured
     * comparison token; local rejection leaves draft and conflict ownership intact. */
    async updateSlot(planId: string, slotId: string, input: components['schemas']['ActivitySlotPatch'], token: string, scope: PilotRequestScope) {
        if (!validateActivitySlotPatch(input)) throw generatedInputError(validateActivitySlotPatch.errors, path => activityInputField(path));
        return this.transport.read('updateActivitySlot', await this.transport.client.PATCH('/activity-plans/{planId}/slots/{slotId}', {
            params: {path: {planId, slotId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteSlot(planId: string, slotId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteActivitySlot', await this.transport.client.DELETE('/activity-plans/{planId}/slots/{slotId}', {
            params: {path: {planId, slotId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async reorder(planId: string, order: components['schemas']['ActivityOrderInput']['order'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updateActivityOrder', await this.transport.client.PUT('/activity-plans/{planId}/slot-order', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {order}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** A preview never writes or grants authority. Its opaque digest is retained only
     * by the feature's explicit warning review and submitted with that one intent. */
    async warnings(planId: string, slotId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const response = await this.transport.client.POST('/activity-plans/{planId}/slots/{slotId}/warnings', {
            params: {path: {planId, slotId}, header: this.transport.headers(scope)}, body: {}, signal, cache: 'no-store',
        });
        return this.transport.read('previewActivityAssignment', response, validateActivityWarningPreview, scope).data;
    }

    async assign(planId: string, slotId: string, input: components['schemas']['ActivityAssignmentInput'], scope: PilotRequestScope) {
        return this.transport.read('setActivityAssignment', await this.transport.client.PUT('/activity-plans/{planId}/slots/{slotId}/self-assignment', {
            params: {path: {planId, slotId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAssignment(planId: string, assignmentId: string, scope: PilotRequestScope) {
        return this.transport.read('removeActivityAssignment', await this.transport.client.DELETE('/activity-plans/{planId}/assignments/{assignmentId}', {
            params: {path: {planId, assignmentId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async createRole(planId: string, name: string, scope: PilotRequestScope) {
        // Role suggestions remain editable after a rejected name. Use the same
        // generated bounds as the server before dispatching this creation once.
        if (!validateActivityRoleInput({name})) {
            throw generatedInputError(validateActivityRoleInput.errors, () => ({label: 'activity.role'}));
        }
        return this.transport.read('addActivityRole', await this.transport.client.POST('/activity-plans/{planId}/roles', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: {name}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async saveRoleAssignments(planId: string, slotId: string, input: components['schemas']['ActivityRoleAssignmentsInput'], scope: PilotRequestScope) {
        return this.transport.read('updateActivityRoleAssignments', await this.transport.client.PUT('/activity-plans/{planId}/slots/{slotId}/role-assignments', {
            params: {path: {planId, slotId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Creation requires a nonblank label under the existing controller rule.
     * Project its generated failure locally before allocating a shared field. */
    async addTextField(planId: string, input: components['schemas']['ActivityTextFieldInput'], scope: PilotRequestScope) {
        if (!validateActivityTextFieldInput(input)) throw generatedInputError(validateActivityTextFieldInput.errors, path => activityInputField(path));
        return this.transport.read('addActivityTextField', await this.transport.client.POST('/activity-plans/{planId}/text-fields', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateTextField(planId: string, textFieldId: string, input: components['schemas']['ActivityTextFieldPatch'], token: string, scope: PilotRequestScope) {
        // Saved-title edits deliberately retain their existing empty-title rule;
        // the distinct patch schema, rather than creation, owns this validation.
        if (!validateActivityTextFieldPatch(input)) throw generatedInputError(validateActivityTextFieldPatch.errors, path => activityInputField(path));
        return this.transport.read('updateActivityTextField', await this.transport.client.PUT('/activity-plans/{planId}/text-fields/{textFieldId}', {
            params: {path: {planId, textFieldId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async deleteTextField(planId: string, textFieldId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteActivityTextField', await this.transport.client.DELETE('/activity-plans/{planId}/text-fields/{textFieldId}', {
            params: {path: {planId, textFieldId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    // The feature owns discovery authorization and cache families. The shared picker only
    // renders and selects the supplied options, so another feature can reuse its behavior.
    readonly eventPicker: PilotEventPickerSource = {
        search: (query, scope, signal) => this.events(query, scope, signal),
        pageKey: activityKeys.eventPage,
        filterKey: activityKeys.eventFilters,
    };

    /** Read the captured list with its caller-supplied conditional snapshot.
     * The transport validates actor scope before accepting a 304; the feature
     * query owner ensures that previous belongs to this same resource family. */
    async activity(planId: string, scope: PilotRequestScope, signal?: AbortSignal,
                  previous?: PilotRead<List>): Promise<PilotRead<List>> {
        const transport = this.transport;
        async function readActivity(): Promise<PilotRead<List>> {
            const response = await transport.client.GET('/activity-plans/{planId}', {
                params: {path: {planId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityPlan', {...response, signal}, validateActivityView, scope, previous);
        }
        return transport.allowedRead(`activity/${planId}`, scope, readActivity, signal);
    }

    /** Obtain permitted root fields and usable comparison evidence together.
     * Missing/malformed ETags cannot authorize an editor, even when the body
     * passed its generated shape validator or a previous snapshot is available. */
    async metadata(planId: string, scope: PilotRequestScope, signal?: AbortSignal,
                   previous?: PilotRead<Metadata>): Promise<PilotRead<Metadata>> {
        const transport = this.transport;
        async function readMetadata(): Promise<PilotRead<Metadata>> {
            const response = await transport.client.GET('/activity-plans/{planId}/metadata', {
                params: {path: {planId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityMetadata', {...response, signal}, validateActivityMetadata, scope, previous);
        }
        const result = await transport.allowedRead(`activity/${planId}/metadata`, scope, readMetadata, signal);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Submit a sparse generated metadata patch against its reviewed token.
     * A confirmed response must include newly admitted header evidence as well as
     * valid field data; neither the previous token nor saved values renew authority. */
    async saveMetadata(planId: string, patch: components['schemas']['ActivityMetadataPatch'], etag: string,
                       scope: PilotRequestScope): Promise<PilotRead<Metadata>> {
        // Structural validation precedes transport; business/field checks remain server-owned.
        if (!validateActivityMetadataPatch(patch)) throw generatedInputError(validateActivityMetadataPatch.errors, path => activityInputField(path));

        const result = this.transport.read('updateActivityMetadata', await this.transport.client.PATCH('/activity-plans/{planId}/metadata', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': etag}}, body: patch, cache: 'no-store',
        }), validateActivityMetadata, scope);
        // Response headers use the same generated bound as every field-token body.
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Settings are a separately authorized projection, not authority inherited
     * from detail or metadata. Preserve cancellation and the settings read's own
     * cooldown while its generated validator checks the permitted panels/tokens. */
    async settings(planId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['ActivitySettings']> {
        const transport = this.transport;
        async function readSettings(): Promise<components['schemas']['ActivitySettings']> {
            const response = await transport.client.GET('/activity-plans/{planId}/settings', {
                params: {path: {planId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivitySettings', {...response, signal}, validateActivitySettings, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/settings`, scope, readSettings, signal);
    }

    /** Creation admission is distinct from the public duplication projection. The caller supplies
     * its exact return destination; the server owns account admission and bounded destination policy. */
    async createEntry(scope: PilotRequestScope, signal?: AbortSignal,
                      returnTo?: string, eventId?: string): Promise<components['schemas']['ActivityCreateEntry']> {
        const transport = this.transport;
        async function readCreationEntry(): Promise<components['schemas']['ActivityCreateEntry']> {
            const response = await transport.client.GET('/activity-plans/create-entry', {
                params: {query: {returnTo, eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityCreateEntry', {...response, signal}, validateActivityCreateEntry, scope).data;
        }
        return transport.allowedRead('activity/create-entry/' + (returnTo ?? '') + '/' + (eventId ?? ''), scope, readCreationEntry, signal);
    }

    /** Detail and explicit guest routes deliberately have different native admission. Never
     * infer either route from session presence or from permissions on the other projection. */
    async resourceEntry(planId: string, view: 'detail' | 'guest', scope: PilotRequestScope,
                        signal?: AbortSignal): Promise<components['schemas']['ActivityResourceEntry']> {
        const transport = this.transport;
        async function readResourceEntry(): Promise<components['schemas']['ActivityResourceEntry']> {
            const response = await transport.client.GET('/activity-plans/{planId}/entry', {
                params: {path: {planId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityResourceEntry', {...response, signal}, validateActivityResourceEntry, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/entry/${view}`, scope, readResourceEntry, signal);
    }

    /** Read only the server's permitted duplication surface. Destination selection
     * is independently admitted and part of this read's key. Source assignments,
     * administrator grants and files stay excluded; copied values grant no creation permission. */
    async duplicate(planId: string, scope: PilotRequestScope, signal?: AbortSignal,
                    eventId?: string): Promise<components['schemas']['ActivityDuplicate']> {
        const transport = this.transport;
        async function readDuplicate(): Promise<components['schemas']['ActivityDuplicate']> {
            const response = await transport.client.GET('/activity-plans/{planId}/duplicate', {
                params: {path: {planId}, query: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityDuplicate', {...response, signal}, validateActivityDuplicate, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/duplicate/${eventId ?? ''}`, scope, readDuplicate, signal);
    }

    /** Submit the generated creation contract and optional image as one multipart command.
     * The JSON field retains its authored shape; file bytes use the existing upload boundary.
     * Only a validated creation receipt confirms success, and uncertain delivery is left to
     * the shared command owner without replaying this non-idempotent request. */
    async createActivity(input: components['schemas']['ActivityCreateInput'], image: File | null,
                        scope: PilotRequestScope): Promise<components['schemas']['ActivityCreated']> {
        // Validate machine data before adapting it to the established multipart envelope.
        // The image is a separate part rather than a second handwritten creation schema.
        const slots = input.slots;
        if (!validateActivityCreateInput(input)) {
            throw generatedInputError(validateActivityCreateInput.errors, path => activityInputField(path, slots));
        }

        const form = createMultipartForm(input, image);

        // Preserve captured actor/CSRF context through upload and response classification.
        // A lost response cannot be treated as proof that no list was created.
        return this.transport.read('createActivityPlan', await this.transport.client.POST('/activity-plans', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        }), validateActivityCreated, scope).data;
    }

    /** Read the feature-owned event options for this exact filter/selection page.
     * The picker receives validated presentation only; eligibility and the final
     * relationship change remain independently checked by existing server owners. */
    async events(query: PilotEventPickerQuery,
                  scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readEventOptions(): Promise<components['schemas']['EventPickerOptions']> {
            const response = await transport.client.GET('/activity-plans/events', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchActivityEvents', {...response, signal}, validateEventPickerOptions, scope).data;
        }
        return transport.allowedRead(`activity/events/${JSON.stringify(query)}`, scope, readEventOptions, signal);
    }

    async linkEvent(planId: string, input: components['schemas']['PackingEventChange'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updateActivityEvent', await this.transport.client.PUT('/activity-plans/{planId}/event', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validatePackingEventChanged, scope).data;
    }

    async setDefaults(planId: string, defaults: components['schemas']['PermissionDefaultsPatch'], token: string, scope: PilotRequestScope) {
        return this.transport.read('updateActivityDefaults', await this.transport.client.PUT('/activity-plans/{planId}/default-permissions', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: defaults, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Discover account-profile options under this list's management grant.
     * Keep result shape, cancellation and rate-limit recovery with the existing
     * transport; a displayed username never becomes the acting identity. */
    async profiles(planId: string, q: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readProfileOptions(): Promise<components['schemas']['PackingProfileOptions']> {
            const response = await transport.client.GET('/activity-plans/{planId}/profiles', {
                params: {path: {planId}, query: {q}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('searchActivityProfiles', {...response, signal}, validatePackingProfileOptions, scope).data;
        }
        return transport.allowedRead(`activity/${planId}/profiles/${q}`, scope, readProfileOptions, signal);
    }

    async addAdmin(planId: string, input: components['schemas']['PackingAdminInput'], token: string, scope: PilotRequestScope) {
        return this.transport.read('addActivityAdmin', await this.transport.client.POST('/activity-plans/{planId}/admins', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: input, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async updateAdmin(planId: string, profileId: string, mask: number, token: string, scope: PilotRequestScope) {
        return this.transport.read('updateActivityAdmin', await this.transport.client.PATCH('/activity-plans/{planId}/admins/{profileId}', {
            params: {path: {planId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {mask}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeAdmin(planId: string, profileId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteActivityAdmin', await this.transport.client.DELETE('/activity-plans/{planId}/admins/{profileId}', {
            params: {path: {planId, profileId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async header(planId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<Blob> {
        const transport = this.transport;

        /** openapi-fetch uses blob decoding only for success. Error bodies retain its
         * ordinary JSON/text decoder and the shared validated rejection policy.
         * Binary recovery therefore observes the same actor and Retry-After owner
         * as JSON reads instead of introducing a second error parser or deadline. */
        async function readHeader(): Promise<Blob> {
            const result = await transport.client.GET('/activity-plans/{planId}/header', {
                params: {path: {planId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
            return transport.headerImage(result, scope, signal);
        }

        return transport.allowedRead(`activity/${planId}/header`, scope, readHeader, signal);
    }

    /** Replace the header using the file draft's reviewed comparison token.
     * Multipart serialization transports bytes while generated operation metadata still
     * identifies the request. The controller owns image admission, locked comparison and
     * committed cleanup; this adapter confirms only a validated mutation receipt. */
    async uploadHeader(planId: string, image: File, token: string, scope: PilotRequestScope) {
        // Keep the chosen bytes separate from their generated filename placeholder.
        // The serializer supplies the actual multipart body without copying upload policy.
        const form = createMultipartForm(null, image);

        // Send the token captured when this file was chosen, never a newer settings token
        // obtained while the draft was waiting. The shared command owner handles recovery.
        return this.transport.read('uploadActivityHeader', await this.transport.client.PUT('/activity-plans/{planId}/header', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async removeHeader(planId: string, token: string, scope: PilotRequestScope) {
        return this.transport.read('deleteActivityHeader', await this.transport.client.DELETE('/activity-plans/{planId}/header', {
            params: {path: {planId}, header: {...this.transport.headers(scope), 'If-Match': token}}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    async archive(planId: string, restore: boolean, scope: PilotRequestScope) {
        const options = {params: {path: {planId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};
        return this.transport.read(restore ? 'restoreActivityPlan' : 'archiveActivityPlan', restore ? await this.transport.client.POST('/activity-plans/{planId}/restore', options)
            : await this.transport.client.POST('/activity-plans/{planId}/archive', options), validateMutationResult, scope).data;
    }

    /** Keep the dated plan's scheduler action distinct from manual archival. */
    async automate(planId: string, paused: boolean, scope: PilotRequestScope) {
        const result = await this.transport.client.PUT('/activity-plans/{planId}/automatic-archive', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: {paused}, cache: 'no-store',
        });
        return this.transport.read('setActivityAutomaticArchival', result, validateMutationResult, scope).data;
    }

    async deleteActivity(planId: string, scope: PilotRequestScope) {
        return this.transport.read('deleteActivityPlan', await this.transport.client.DELETE('/activity-plans/{planId}', {
            params: {path: {planId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }


    /** Read the public guest-entry surface without fetching private detail/setup.
     * This operation supplies entry presentation only; registering a guest is a
     * separate identity command with its own confirmed context and destination. */
    async guestEntry(planId: string, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readGuestEntry(): Promise<components['schemas']['GuestEntry']> {
            const response = await transport.client.GET('/activity-plans/{planId}/guest', {
                params: {path: {planId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getActivityGuestEntry', {...response, signal}, validateGuestEntry, scope).data;
        }
        return transport.allowedRead('activity/' + planId + '/guest', scope, readGuestEntry, signal);
    }

    async registerGuest(planId: string, input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
        return this.transport.identity("registerActivityGuest", await this.transport.client.POST('/activity-plans/{planId}/guest', {
            params: {path: {planId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

/** Generated requirement diagnostics retain feature labels and duration identity.
 * Filtered role/override arrays identify their group rather than a misleading
 * compacted row number or an internal participant/role identifier. */
function activityRequirementField(path: string, input: components['schemas']['ActivityRequirementsInput']): PilotInputField | undefined {
    if (path === '/generalRequiredShifts') return {label: 'activity.requirements.baseline'};
    if (path === '/bindingDeadline') return {label: 'activity.requirements.deadline'};
    if (path === '/assignmentMode') return {label: 'activity.requirements.mode'};
    if (path === '/roundingMode') return {label: 'activity.requirements.rounding'};
    const stay = /^\/stayRequirements\/(\d+)\//u.exec(path);
    if (stay) return {label: 'activity.requirements.requiredShifts', row: {label: 'activity.requirements.stays',
        number: input.stayRequirements[Number(stay[1])]?.stayDays ?? Number(stay[1]) + 1}};
    if (path.startsWith('/roleRequirements/')) return {label: 'activity.requirements.roles'};
    if (path.startsWith('/overrides/')) return {label: 'activity.requirements.overrides'};
    return undefined;
}

/** Slot numbering follows its displayed day rather than the flattened wire array.
 * This projection owns visible labels only; generated contracts own validation. */
function activityInputField(path: string, slots?: components['schemas']['ActivityCreateInput']['slots']): PilotInputField | undefined {
    const match = /^\/slots\/(\d+)\/(\w+)$/u.exec(path);
    const field = match ? match[2] : path.slice(1);
    const label = field === 'title' ? 'packing.title' : field === 'description' ? 'packing.description' : field === 'text' ? 'activity.text'
        : field === 'startDate' || field === 'day' ? 'event.startDateLabel' : field === 'endDate' ? 'event.endDateLabel'
        : field === 'startTime' ? 'activity.startTime' : field === 'endTime' ? 'activity.endTime'
        : field === 'maxAssignees' ? 'activity.maxParticipants' : undefined;
    const slot = match ? slots?.[Number(match[1])] : undefined;
    if (label) return {label, ...(slot ? {row: {label: 'validation.slot', number: slot.position + 1, day: slot.day}} : {})};
    if (path === '/eventId') return {label: 'eventPicker.currentEvent'};
    if (path.startsWith('/defaultPermissions')) return {label: 'packing.groupPermissions'};
    return undefined;
}

const owners = new WeakMap<PilotApi, ActivityApi>();

/** Reuse one Activity transport wrapper for this application/request's API owner.
 * Component-local translation bindings may create context wrappers, but they retain the
 * same transport. A WeakMap preserves that ownership without sharing actors across apps. */
export function useActivityApi(context: PilotContext): ActivityApi {
    let owner = owners.get(context.api);

    // Construct lazily for this transport identity; component remounts reuse the wrapper
    // while disposal releases it when the application-local API is no longer referenced.
    if (!owner) {
        owner = new ActivityApi(context.api);
        owners.set(context.api, owner);
    }
    return owner;
}
