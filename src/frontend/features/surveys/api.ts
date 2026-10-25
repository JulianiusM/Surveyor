import type {components} from '../../../types/api/v1';
import type {FrontendContext, FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import {createMultipartForm, generatedInputError, InvalidInputError} from '../../app/transport';
import {validateSurveyView} from '../../../../.generated/api/v1/browser/validateSurveyView.mjs';
import {validateSurveyCreateEntry} from '../../../../.generated/api/v1/browser/validateSurveyCreateEntry.mjs';
import {validateSurveyResourceEntry} from '../../../../.generated/api/v1/browser/validateSurveyResourceEntry.mjs';
import {validateSurveyDuplicate} from '../../../../.generated/api/v1/browser/validateSurveyDuplicate.mjs';
import {validateSurveyCreateInput} from '../../../../.generated/api/v1/browser/validateSurveyCreateInput.mjs';
import {validateSurveyCreated} from '../../../../.generated/api/v1/browser/validateSurveyCreated.mjs';
import {validateSurveyMetadata} from '../../../../.generated/api/v1/browser/validateSurveyMetadata.mjs';
import {validateSurveyMetadataPatch} from '../../../../.generated/api/v1/browser/validateSurveyMetadataPatch.mjs';
import {validateSurveySettings} from '../../../../.generated/api/v1/browser/validateSurveySettings.mjs';
import {validateSurveyBallotInput} from '../../../../.generated/api/v1/browser/validateSurveyBallotInput.mjs';
import {validateSurveyCombinationInput} from '../../../../.generated/api/v1/browser/validateSurveyCombinationInput.mjs';
import {validateMutationResult} from '../../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateGuestEntry} from '../../../../.generated/api/v1/browser/validateGuestEntry.mjs';
import {combinationIdentity} from './presentation';

type Survey = components['schemas']['SurveyView'];
type Metadata = components['schemas']['SurveyMetadata'];

/** Survey selects authored operations and their generated validation. The shared
 * transport owns actor scope, cancellation, cooldown and outcome classification;
 * existing server controllers remain the only business/authorization owners. */
export class SurveysApi {
    constructor(private readonly transport: FrontendApi) {}

    /** A conditional detail read stays bound to its caller's actor/resource key. */
    async survey(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                 previous?: FrontendRead<Survey>): Promise<FrontendRead<Survey>> {
        const transport = this.transport;
        async function readSurvey() {
            // Carry the previous representation's validator through the same
            // captured actor and cancellation scope as this network read.
            const result = await transport.client.GET('/surveys/{surveyId}', {
                params: {path: {surveyId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getSurvey', {...result, signal}, validateSurveyView, scope, previous);
        }
        return transport.allowedRead(`survey/${surveyId}`, scope, readSurvey, signal);
    }

    /** Creation is an account-only journey, independently admitted from reading
     * a duplication source. Preserve the exact requested return destination. */
    async createEntry(scope: FrontendRequestScope, signal?: AbortSignal, returnTo?: string) {
        const transport = this.transport;
        async function readEntry() {
            // The server chooses render/login/denied; the browser validates that
            // outcome instead of deriving account admission from cached identity.
            const result = await transport.client.GET('/surveys/create-entry', {
                params: {query: {returnTo}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveyCreateEntry', {...result, signal}, validateSurveyCreateEntry, scope).data;
        }
        return transport.allowedRead('survey/create-entry/' + (returnTo ?? ''), scope, readEntry, signal);
    }

    /** Explicit guest and detail URLs retain their distinct native admission.
     * A private detail grant cannot stand in for the public guest exception. */
    async resourceEntry(surveyId: string, view: 'detail' | 'guest', scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readEntry() {
            // Carry route intent and actor through the same cancelable read.
            const result = await transport.client.GET('/surveys/{surveyId}/entry', {
                params: {path: {surveyId}, query: {view}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveyResourceEntry', {...result, signal}, validateSurveyResourceEntry, scope).data;
        }
        return transport.allowedRead(`survey/${surveyId}/entry/${view}`, scope, readEntry, signal);
    }

    /** Copy only the admitted metadata and recurring choices. Votes, uploaded
     * files and ownership are never part of this independent creation draft. */
    async duplicate(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readDuplicate() {
            // Reading a copy does not authorize its later creation command.
            const result = await transport.client.GET('/surveys/{surveyId}/duplicate', {
                params: {path: {surveyId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveyDuplicate', {...result, signal}, validateSurveyDuplicate, scope).data;
        }
        return transport.allowedRead(`survey/${surveyId}/duplicate`, scope, readDuplicate, signal);
    }

    /** Capture generated machine data and optional bytes in the native multipart
     * boundary. A validated receipt confirms creation; no failure replays it. */
    async createSurvey(input: components['schemas']['SurveyCreateInput'], image: File | null, scope: FrontendRequestScope) {
        // Reject malformed local values before allocating or dispatching bytes.
        // Admission and business validation remain with the server controller.
        if (!validateSurveyCreateInput(input)) {
            throw generatedInputError(validateSurveyCreateInput.errors, (path, error) => {
                if (path === '/combinations' && error.keyword === 'minItems') return 'survey.combinationsRequired';
                if (path === '/title') return 'survey.titleInvalid';
                if (path === '/description') return 'survey.descriptionInvalid';
                if (path.startsWith('/combinations/')) return 'survey.combinationInvalid';
                return undefined;
            });
        }
        // The saved combination has a unique weekday/occurrence identity. Keep
        // duplicate local rows editable, but explain their conflict before any
        // multipart write rather than exposing a database rejection as uncertainty.
        const identities = input.combinations.map(combinationIdentity);
        if (new Set(identities).size !== identities.length) {
            throw new InvalidInputError('Duplicate survey combination.', 'survey.combinationAlreadyPresent');
        }

        const form = createMultipartForm(input, image);

        // Send the captured draft once. Shared decoding distinguishes a confirmed
        // creation from rejected or uncertain delivery without replaying it.
        const result = await this.transport.client.POST('/surveys', {
            params: {header: this.transport.headers(scope)}, body: {data: input}, bodySerializer: () => form, cache: 'no-store',
        });
        return this.transport.read('createSurvey', result, validateSurveyCreated, scope).data;
    }

    /** Replace only the captured profile's displayed ballot. The shared command
     * owner decides when a confirmed result releases its local personal draft. */
    async submitBallot(surveyId: string, input: components['schemas']['SurveyBallotInput'], scope: FrontendRequestScope) {
        // Structural validation precedes dispatch; the server checks that every
        // answer belongs to this Survey before its unchanged replacement write.
        if (!validateSurveyBallotInput(input)) throw generatedInputError(validateSurveyBallotInput.errors, () => undefined);

        const result = await this.transport.client.PUT('/surveys/{surveyId}/ballot', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        });
        return this.transport.read('submitSurveyBallot', result, validateMutationResult, scope).data;
    }

    /** Submit one collaborative recurring choice. A missing reply does not
     * identify a created row and cannot authorize automatic creation replay. */
    async addCombination(surveyId: string, input: components['schemas']['SurveyCombinationInput'], scope: FrontendRequestScope) {
        // Generated validation owns the finite weekday/occurrence wire values.
        if (!validateSurveyCombinationInput(input)) {
            throw generatedInputError(validateSurveyCombinationInput.errors, () => 'survey.combinationInvalid');
        }

        const result = await this.transport.client.POST('/surveys/{surveyId}/combinations', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        });
        return this.transport.read('addSurveyCombination', result, validateMutationResult, scope).data;
    }

    /** ETags identify admitted representations for shared draft reconciliation.
     * They do not introduce a new server write precondition for legacy Surveys. */
    async metadata(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal,
                   previous?: FrontendRead<Metadata>): Promise<FrontendRead<Metadata>> {
        const transport: FrontendApi = this.transport;
        async function readMetadata() {
            // The returned identity belongs to this admitted metadata baseline,
            // independently of public results and another profile's ballot.
            const result = await transport.client.GET('/surveys/{surveyId}/metadata', {
                params: {path: {surveyId}, header: transport.headers(scope, previous?.etag)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveyMetadata', {...result, signal}, validateSurveyMetadata, scope, previous);
        }
        const result = await transport.allowedRead(`survey/${surveyId}/metadata`, scope, readMetadata, signal);

        // The shared editor requires a representation identity to reconcile
        // refreshes; this is not an optimistic server write precondition.
        transport.requireComparison(result.etag);
        return result;
    }

    /** Preserve the existing blind metadata operation. The shared editor token
     * stays local comparison evidence and is deliberately not sent as If-Match. */
    async saveMetadata(surveyId: string, patch: components['schemas']['SurveyMetadataPatch'], _token: string,
                       scope: FrontendRequestScope): Promise<FrontendRead<Metadata>> {
        // Keep the generated sparse patch distinct from its local baseline token.
        if (!validateSurveyMetadataPatch(patch)) {
            throw generatedInputError(validateSurveyMetadataPatch.errors, path => path === '/title' ? {label: 'survey.title'}
                : path === '/description' ? {label: 'survey.description'} : undefined);
        }

        const result = this.transport.read('updateSurveyMetadata', await this.transport.client.PATCH('/surveys/{surveyId}/metadata', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, body: patch, cache: 'no-store',
        }), validateSurveyMetadata, scope);
        this.transport.requireComparison(result.etag);
        return result;
    }

    /** Read the owner's applicable settings separately from public participation.
     * The projection supplies no event, administrator or permission controls. */
    async settings(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readSettings() {
            // The generated projection, rather than the detail's edit button,
            // decides which shared settings panels may be rendered.
            const result = await transport.client.GET('/surveys/{surveyId}/settings', {
                params: {path: {surveyId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveySettings', {...result, signal}, validateSurveySettings, scope).data;
        }
        return transport.allowedRead(`survey/${surveyId}/settings`, scope, readSettings, signal);
    }

    /** Fetch authorized image bytes through the shared binary/error decoder.
     * Cancellation and cooldown share the JSON read's captured identity. */
    async header(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<Blob> {
        const transport = this.transport;
        async function readHeader() {
            // Successful media becomes a Blob; Problems retain normal JSON
            // validation rather than entering a second image-only error path.
            const result = await transport.client.GET('/surveys/{surveyId}/header', {
                params: {path: {surveyId}, header: transport.headers(scope)}, signal, cache: 'no-store', parseAs: 'blob',
            });
            return transport.headerImage(result, scope, signal);
        }
        return transport.allowedRead(`survey/${surveyId}/header`, scope, readHeader, signal);
    }

    /** Selected bytes retain their file draft but keep native unversioned image
     * semantics. Settings tokens identify client baselines, never new DB locks. */
    async uploadHeader(surveyId: string, image: File, _token: string, scope: FrontendRequestScope) {
        // Capture the selected bytes without placing them in a query cache or
        // sending the local comparison token as new write authority.
        const form = createMultipartForm(null, image);

        return this.transport.read('uploadSurveyHeader', await this.transport.client.PUT('/surveys/{surveyId}/header', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, body: {image: image.name}, bodySerializer: () => form, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Remove the current image through the existing owner-only operation.
     * Local settings comparison evidence does not strengthen its write contract. */
    async removeHeader(surveyId: string, _token: string, scope: FrontendRequestScope) {
        // Decode the invariant acknowledgement before the caller releases image
        // state; uncertain delivery stays with its existing shared command owner.
        return this.transport.read('deleteSurveyHeader', await this.transport.client.DELETE('/surveys/{surveyId}/header', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Select the desired archive state without inferring eligibility or dates.
     * The shared lifecycle/controller owners retain authorization and idempotence. */
    async archive(surveyId: string, restore: boolean, scope: FrontendRequestScope) {
        const options = {params: {path: {surveyId}, header: this.transport.headers(scope)}, cache: 'no-store' as const};

        // Both generated operations share transport/result handling while keeping
        // their explicit archive-versus-restore command identity.
        const result = restore ? await this.transport.client.POST('/surveys/{surveyId}/restore', options)
            : await this.transport.client.POST('/surveys/{surveyId}/archive', options);
        return this.transport.read(restore ? 'restoreSurvey' : 'archiveSurvey', result, validateMutationResult, scope).data;
    }

    /** Permanently remove an owned Survey independently of archival. Confirmed
     * destination delivery is handled by the existing shared removal command. */
    async deleteSurvey(surveyId: string, scope: FrontendRequestScope) {
        // Send no browser-selected profile, lifecycle timestamp or deletion state.
        return this.transport.read('deleteSurvey', await this.transport.client.DELETE('/surveys/{surveyId}', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateMutationResult, scope).data;
    }

    /** Public guest entry exposes only its title and admission information.
     * Registering an identity remains a separate explicit command below. */
    async guestEntry(surveyId: string, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readGuest() {
            // Keep the title surface independent from private ballots/settings.
            const result = await transport.client.GET('/surveys/{surveyId}/guest', {
                params: {path: {surveyId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getSurveyGuestEntry', {...result, signal}, validateGuestEntry, scope).data;
        }
        return transport.allowedRead(`survey/${surveyId}/guest`, scope, readGuest, signal);
    }

    /** Register the explicitly submitted guest through the existing identity
     * completion boundary; a title/admission read can never issue this command. */
    async registerGuest(surveyId: string, input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) {
        // Shared identity decoding installs only the validated captured completion.
        // Its command owner retains input and uncertainty after failed delivery.
        return this.transport.identity('registerSurveyGuest', await this.transport.client.POST('/surveys/{surveyId}/guest', {
            params: {path: {surveyId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), scope);
    }
}

const owners = new WeakMap<FrontendApi, SurveysApi>();

/** One wrapper per request/application transport avoids sharing actors or drafts
 * globally while allowing mounted matching components to reuse their API owner. */
export function useSurveysApi(context: FrontendContext): SurveysApi {
    let owner = owners.get(context.api);
    if (!owner) {
        owner = new SurveysApi(context.api);
        owners.set(context.api, owner);
    }
    return owner;
}
