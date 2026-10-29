import {createFeatureApiResolver} from '../../app/api';
import type {components} from '../../../types/api/v1';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendInputField} from '../../../types/FrontendFeedbackTypes';
import type {FrontendApi} from '../../app/api';
import {createMultipartForm, generatedInputError} from '../../app/transport';
import {validateFinanceView} from '../../../../.generated/api/v1/browser/validateFinanceView.mjs';
import {validateFinanceBreakdown} from '../../../../.generated/api/v1/browser/validateFinanceBreakdown.mjs';
import {validateFinanceInvoiceInput} from '../../../../.generated/api/v1/browser/validateFinanceInvoiceInput.mjs';
import {validateFinanceRetractionInput} from '../../../../.generated/api/v1/browser/validateFinanceRetractionInput.mjs';
import {validateFinanceMutationResult} from '../../../../.generated/api/v1/browser/validateFinanceMutationResult.mjs';
import {validateFinancePoolCreateInput} from '../../../../.generated/api/v1/browser/validateFinancePoolCreateInput.mjs';
import {validateFinancePoolSettingsInput} from '../../../../.generated/api/v1/browser/validateFinancePoolSettingsInput.mjs';
import {validateFinanceSubmissionStateInput} from '../../../../.generated/api/v1/browser/validateFinanceSubmissionStateInput.mjs';
import {validateFinanceOrganizerInvoiceInput} from '../../../../.generated/api/v1/browser/validateFinanceOrganizerInvoiceInput.mjs';
import {validateFinanceAcceptanceInput} from '../../../../.generated/api/v1/browser/validateFinanceAcceptanceInput.mjs';
import {validateFinanceDeclineInput} from '../../../../.generated/api/v1/browser/validateFinanceDeclineInput.mjs';
import {validateFinanceRevisionInput} from '../../../../.generated/api/v1/browser/validateFinanceRevisionInput.mjs';
import {validateFinanceAcceptedRejectionInput} from '../../../../.generated/api/v1/browser/validateFinanceAcceptedRejectionInput.mjs';
import {validateFinanceAssignmentsInput} from '../../../../.generated/api/v1/browser/validateFinanceAssignmentsInput.mjs';
import {validateFinanceAdjustmentInput} from '../../../../.generated/api/v1/browser/validateFinanceAdjustmentInput.mjs';
import {validateFinanceTakeoverInput} from '../../../../.generated/api/v1/browser/validateFinanceTakeoverInput.mjs';
import {validateFinancePreview} from '../../../../.generated/api/v1/browser/validateFinancePreview.mjs';
import {validateFinanceCalculationInput} from '../../../../.generated/api/v1/browser/validateFinanceCalculationInput.mjs';
import {validateFinanceRollbackResult} from '../../../../.generated/api/v1/browser/validateFinanceRollbackResult.mjs';
import {validateFinanceNotificationResult} from '../../../../.generated/api/v1/browser/validateFinanceNotificationResult.mjs';
import {validateFinanceSettlementInput} from '../../../../.generated/api/v1/browser/validateFinanceSettlementInput.mjs';

/** Finance selects authored operations; shared transport owns actor admission,
 * generated delivery checks and progress without automatic command replay. */
export class FinanceApi {
    constructor(private readonly transport: FrontendApi) {}

    /** Read a fresh saved-input preview. Each dialog owns its captured revision;
     * this read never commits shares or reuses a cached financial review. */
    async preview(eventId: string, poolId: string, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinancePreview']> {
        const transport = this.transport;
        function readPreview() {
            return transport.client.GET('/events/{eventId}/finance/pools/{poolId}/preview', {
                params: {path: {eventId, poolId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        // Cancellation/locale fencing belongs inside transport too: a retired
        // response cannot publish identity/cooldown effects while decoding.
        return (await transport.readJson(`event/${eventId}/finance/${poolId}/preview/${scope.locale}`, scope, readPreview, 'previewEventFinancePool', validateFinancePreview, signal, undefined, true)).data;
    }

    /** Apply exactly the reviewed revision through the existing calculation
     * owner. An uncertain response must be inspected, never replayed. */
    async calculate(eventId: string, poolId: string, input: components['schemas']['FinanceCalculationInput'], recalculate: boolean, scope: FrontendRequestScope) {
        if (!validateFinanceCalculationInput(input)) throw generatedInputError(validateFinanceCalculationInput.errors, financeInputField);
        const options = {params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store' as const};
        // Explicit generated operations preserve the distinct close/recalculate
        // lifecycle while sharing transport and the backend calculation owner.
        const result = recalculate ? await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/recalculate', options)
            : await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/close', options);
        return this.transport.read(recalculate ? 'recalculateEventFinancePool' : 'closeEventFinancePool',
            result, validateFinanceMutationResult, scope).data;
    }

    /** Restore the last calculated local inputs without reversing saved shares,
     * transfers, attendance or invoice changes. */
    async rollback(eventId: string, poolId: string, scope: FrontendRequestScope) {
        return this.transport.read('rollbackEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/rollback', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceRollbackResult, scope).data;
    }

    /** Deliberately request existing saved settlement emails once. The result
     * counts eligible recipients and does not promise external delivery. */
    async notify(eventId: string, poolId: string, scope: FrontendRequestScope) {
        return this.transport.read('notifyEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/notify', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceNotificationResult, scope).data;
    }

    /** Record or reverse the captured saved share's complete settlement. The
     * existing owner validates its sign and identity without a new protocol. */
    async settlement(eventId: string, poolId: string, shareId: string, input: components['schemas']['FinanceSettlementInput'], scope: FrontendRequestScope) {
        if (!validateFinanceSettlementInput(input)) throw generatedInputError(validateFinanceSettlementInput.errors, financeInputField);
        return this.transport.read('settleEventFinanceShare', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/shares/{shareId}/settlement', {
            params: {path: {eventId, poolId, shareId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Create once through the generated contract; callers reconcile by reading rather than replaying uncertain writes. */
    async createPool(eventId: string, input: components['schemas']['FinancePoolCreateInput'], scope: FrontendRequestScope) {
        if (!validateFinancePoolCreateInput(input)) throw generatedInputError(validateFinancePoolCreateInput.errors, financeInputField);
        return this.transport.read('createEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Save only editable pool settings through their shared backend owner. */
    async settings(eventId: string, poolId: string, input: components['schemas']['FinancePoolSettingsInput'], scope: FrontendRequestScope) {
        if (!validateFinancePoolSettingsInput(input)) throw generatedInputError(validateFinancePoolSettingsInput.errors, financeInputField);
        return this.transport.read('updateEventFinanceSettings', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/settings', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Submission access retains its own revision and never calculates saved shares. */
    async submissionState(eventId: string, poolId: string, input: components['schemas']['FinanceSubmissionStateInput'], scope: FrontendRequestScope) {
        if (!validateFinanceSubmissionStateInput(input)) throw generatedInputError(validateFinanceSubmissionStateInput.errors, financeInputField);
        return this.transport.read('changeEventFinanceSubmissionState', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/submission-state', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Record an organizer expense, preserving the distinction between absent optional proof and an uploaded file. */
    async record(eventId: string, poolId: string, input: components['schemas']['FinanceOrganizerInvoiceInput'], proof: File | null,
        scope: FrontendRequestScope, progress: (loaded: number, total: number | null, complete?: boolean) => void) {
        if (!validateFinanceOrganizerInvoiceInput(input)) throw generatedInputError(validateFinanceOrganizerInvoiceInput.errors, financeInputField);
        // Share serialization with participant invoices and image consumers;
        // this operation alone decides that its proof is optional.
        const form = createMultipartForm(input, proof, 'proof');
        return this.transport.uploadJson('recordEventOrganizerInvoice', `/events/${encodeURIComponent(eventId)}/finance/pools/${encodeURIComponent(poolId)}/invoices/organizer`,
            form, validateFinanceMutationResult, scope, progress);
    }

    /** Accept submitted evidence with optional separate organizer corrections. */
    async approve(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceAcceptanceInput'], scope: FrontendRequestScope) {
        if (!validateFinanceAcceptanceInput(input)) {
            throw generatedInputError(validateFinanceAcceptanceInput.errors, financeAcceptanceField);
        }
        return this.transport.read('approveEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/approve', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Reject an unreviewed invoice without deleting its history or retained proof. */
    async decline(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceDeclineInput'], scope: FrontendRequestScope) {
        if (!validateFinanceDeclineInput(input)) throw generatedInputError(validateFinanceDeclineInput.errors, financeInputField);
        return this.transport.read('declineEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/decline', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Organizer invoice closure uses its independent method grant, without changing payer settlement. */
    async organizerClose(eventId: string, poolId: string, invoiceId: string, scope: FrontendRequestScope) {
        return this.transport.read('closeEventOrganizerInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/organizer-close', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Carry the captured confirmation and pool revision into the existing accepted-cost correction. */
    async revise(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceRevisionInput'], scope: FrontendRequestScope) {
        if (!validateFinanceRevisionInput(input)) throw generatedInputError(validateFinanceRevisionInput.errors, financeInputField);
        return this.transport.read('reviseEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/revise', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Remove an accepted cost from future calculation while retaining its original evidence. */
    async rejectAccepted(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceAcceptedRejectionInput'], scope: FrontendRequestScope) {
        if (!validateFinanceAcceptedRejectionInput(input)) throw generatedInputError(validateFinanceAcceptedRejectionInput.errors, financeInputField);
        return this.transport.read('rejectAcceptedEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/reject-accepted', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Save complete assignment inputs while the backend preserves its saved settlement snapshot. */
    async assignments(eventId: string, poolId: string, input: components['schemas']['FinanceAssignmentsInput'], scope: FrontendRequestScope) {
        if (!validateFinanceAssignmentsInput(input)) throw generatedInputError(validateFinanceAssignmentsInput.errors, financeInputField);
        return this.transport.read('updateEventFinanceAssignments', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/assignments', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Submit the explicit signed adjustment and redistribution choice as one validated operation. */
    async addAdjustment(eventId: string, poolId: string, input: components['schemas']['FinanceAdjustmentInput'], scope: FrontendRequestScope) {
        if (!validateFinanceAdjustmentInput(input)) throw generatedInputError(validateFinanceAdjustmentInput.errors, financeInputField);
        return this.transport.read('addEventFinanceAdjustment', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/adjustments', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Remove one admitted adjustment through its existing idempotent backend operation. */
    async removeAdjustment(eventId: string, poolId: string, surchargeId: string, scope: FrontendRequestScope) {
        return this.transport.read('removeEventFinanceAdjustment', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/adjustments/{surchargeId}/remove', {
            params: {path: {eventId, poolId, surchargeId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Select the distinct self-payer or organizer coverage operation without inferring authority in the shared chooser. */
    async takeovers(eventId: string, poolId: string, input: components['schemas']['FinanceTakeoverInput'], organizer: boolean, scope: FrontendRequestScope) {
        if (!validateFinanceTakeoverInput(input)) throw generatedInputError(validateFinanceTakeoverInput.errors, financeInputField);
        // The generated paths remain explicit; the backend independently enforces the selected operation's method grant.
        const options = {params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store' as const};
        const result = organizer
            ? await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/takeovers/manage', options)
            : await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/takeovers', options);
        return this.transport.read(organizer ? 'updateEventOrganizerFinanceTakeovers' : 'updateEventParticipantFinanceTakeovers',
            result, validateFinanceMutationResult, scope).data;
    }

    /** Personal and organizer projections have distinct server grants and reads. */
    async read(eventId: string, admin: boolean, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinanceView']> {
        const transport = this.transport;
        async function readFinance() {
            const options = {params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store' as const};
            // Never request the organizer representation on a participant page.
            const result = admin ? await transport.client.GET('/events/{eventId}/finance/organizer', options)
                : await transport.client.GET('/events/{eventId}/finance', options);
            return result;
        }
        return (await transport.readJson(`event/${eventId}/finance/${admin}/${scope.locale}`, scope, readFinance, admin ? 'getEventOrganizerFinance' : 'getEventFinance', validateFinanceView, signal, undefined, true)).data;
    }

    /** One selected saved row is read lazily; no calculation/preview command runs. */
    async breakdown(eventId: string, poolId: string, shareId: string, admin: boolean, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinanceBreakdown']> {
        const transport = this.transport;
        function readBreakdown() {
            return transport.client.GET('/events/{eventId}/finance/pools/{poolId}/shares/{shareId}', {
                params: {path: {eventId, poolId, shareId}, query: {audience: admin ? 'organizer' : 'participant'}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
        }
        return (await transport.readJson(`event/${eventId}/finance/${admin}/${poolId}/${shareId}/${scope.locale}`, scope, readBreakdown, 'getEventFinanceBreakdown', validateFinanceBreakdown, signal, undefined, true)).data;
    }

    /** Submit the exact chosen proof once, retaining progress separately from
     * confirmation. File and draft lifetime remain with the participant form. */
    async submit(eventId: string, poolId: string, input: components['schemas']['FinanceInvoiceInput'], proof: File,
                 scope: FrontendRequestScope, progress: (loaded: number, total: number | null, complete?: boolean) => void) {
        if (!validateFinanceInvoiceInput(input)) throw generatedInputError(validateFinanceInvoiceInput.errors, financeInputField);
        // Required participant proof retains its generated validation and draft
        // lifetime while sharing the existing multipart serialization owner.
        const form = createMultipartForm(input, proof, 'proof');
        return this.transport.uploadJson('submitEventInvoice', `/events/${encodeURIComponent(eventId)}/finance/pools/${encodeURIComponent(poolId)}/invoices`,
            form, validateFinanceMutationResult, scope, progress);
    }

    /** A captured revision preserves the participant retraction review. */
    async retract(eventId: string, poolId: string, invoiceId: string, revision: number, scope: FrontendRequestScope) {
        const input = {confirmed: true as const, expectedRevision: revision};
        if (!validateFinanceRetractionInput(input)) throw generatedInputError(validateFinanceRetractionInput.errors, financeInputField);
        return this.transport.read('retractEventInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/retract', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Closing changes only invoice lifecycle; it never settles a payer balance. */
    async close(eventId: string, poolId: string, invoiceId: string, scope: FrontendRequestScope) {
        return this.transport.read('closeEventInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/close', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }
}

/** Finance forms keep their operation-specific fields and generated constraints.
 * Error presentation names the visible control without exposing captured revisions,
 * participant identifiers or arbitrary validator text; decimal spelling and
 * intentionally unbounded pool/participant descriptions remain unchanged. */
function financeInputField(path: string): FrontendInputField | undefined {
    if (path === '/name') return {label: 'finance.poolName2'};
    if (path === '/amount') return {label: 'finance.amount'};
    if (path === '/correctedAmount') return {label: 'finance.amount'};
    if (path === '/description') return {label: 'finance.description'};
    if (path === '/correctedDescription') return {label: 'finance.description'};
    if (path === '/rejectionReason') return {label: 'finance.rejectionReason'};
    if (path === '/note') return {label: 'finance.note'};
    if (path === '/distribution') return {label: 'finance.shareDistributionMode'};
    if (path === '/status') return {label: 'finance.poolSubmissionState'};
    if (path === '/isPaid') return {label: 'validation.fields.settlementStatus'};
    if (path === '/sendEmails') return {label: 'finance.emailParticipantsAfterThisCalculation'};
    if (path === '/registrationId') return {label: 'finance.participant5'};
    if (path === '/payerId') return {label: 'finance.payer'};
    if (path.startsWith('/participantFactors/')) return {label: 'finance.shareFactor'};
    if (path.startsWith('/registrations') || path.startsWith('/exemptions') || path.startsWith('/beneficiaries'))
        return {label: 'finance.participantsFactors'};
    return undefined;
}

/** Initial acceptance names optional corrections explicitly; the later revision
 * form instead presents the amount and description as its editable source input. */
function financeAcceptanceField(path: string): FrontendInputField | undefined {
    if (path === '/correctedAmount') return {label: 'finance.correctedAmount2'};
    if (path === '/correctedDescription') return {label: 'finance.correctedDescription2'};
    return financeInputField(path);
}

/** Reuse this feature adapter for its application-local transport. */
export const useFinanceApi = createFeatureApiResolver(FinanceApi);
