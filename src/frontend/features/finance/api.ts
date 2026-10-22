import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {createMultipartForm, InvalidInputError} from '../../app/transport';
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
    constructor(private transport: PilotApi) {}

    /** Read a fresh saved-input preview. Each dialog owns its captured revision;
     * this read never commits shares or reuses a cached financial review. */
    async preview(eventId: string, poolId: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinancePreview']> {
        const transport = this.transport;
        async function readPreview() {
            const result = await transport.client.GET('/events/{eventId}/finance/pools/{poolId}/preview', {
                params: {path: {eventId, poolId}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            // Cancellation/locale fencing belongs inside transport too: a retired
            // response cannot publish identity/cooldown effects while decoding.
            return transport.read('previewEventFinancePool', {...result, signal}, validateFinancePreview, scope, undefined, true).data;
        }
        return transport.allowedRead(`event/${eventId}/finance/${poolId}/preview/${scope.locale}`, scope, readPreview, signal);
    }

    /** Apply exactly the reviewed revision through the existing calculation
     * owner. An uncertain response must be inspected, never replayed. */
    async calculate(eventId: string, poolId: string, input: components['schemas']['FinanceCalculationInput'], recalculate: boolean, scope: PilotRequestScope) {
        if (!validateFinanceCalculationInput(input)) throw new InvalidInputError();
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
    async rollback(eventId: string, poolId: string, scope: PilotRequestScope) {
        return this.transport.read('rollbackEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/rollback', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceRollbackResult, scope).data;
    }

    /** Deliberately request existing saved settlement emails once. The result
     * counts eligible recipients and does not promise external delivery. */
    async notify(eventId: string, poolId: string, scope: PilotRequestScope) {
        return this.transport.read('notifyEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/notify', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceNotificationResult, scope).data;
    }

    /** Record or reverse the captured saved share's complete settlement. The
     * existing owner validates its sign and identity without a new protocol. */
    async settlement(eventId: string, poolId: string, shareId: string, input: components['schemas']['FinanceSettlementInput'], scope: PilotRequestScope) {
        if (!validateFinanceSettlementInput(input)) throw new InvalidInputError();
        return this.transport.read('settleEventFinanceShare', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/shares/{shareId}/settlement', {
            params: {path: {eventId, poolId, shareId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Create once through the generated contract; callers reconcile by reading rather than replaying uncertain writes. */
    async createPool(eventId: string, input: components['schemas']['FinancePoolCreateInput'], scope: PilotRequestScope) {
        if (!validateFinancePoolCreateInput(input)) throw new InvalidInputError();
        return this.transport.read('createEventFinancePool', await this.transport.client.POST('/events/{eventId}/finance/pools', {
            params: {path: {eventId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Save only editable pool settings through their shared backend owner. */
    async settings(eventId: string, poolId: string, input: components['schemas']['FinancePoolSettingsInput'], scope: PilotRequestScope) {
        if (!validateFinancePoolSettingsInput(input)) throw new InvalidInputError();
        return this.transport.read('updateEventFinanceSettings', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/settings', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Submission access retains its own revision and never calculates saved shares. */
    async submissionState(eventId: string, poolId: string, input: components['schemas']['FinanceSubmissionStateInput'], scope: PilotRequestScope) {
        if (!validateFinanceSubmissionStateInput(input)) throw new InvalidInputError();
        return this.transport.read('changeEventFinanceSubmissionState', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/submission-state', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Record an organizer expense, preserving the distinction between absent optional proof and an uploaded file. */
    async record(eventId: string, poolId: string, input: components['schemas']['FinanceOrganizerInvoiceInput'], proof: File | null,
        scope: PilotRequestScope, progress: (loaded: number, total: number | null, complete?: boolean) => void) {
        if (!validateFinanceOrganizerInvoiceInput(input)) throw new InvalidInputError();
        // Share serialization with participant invoices and image consumers;
        // this operation alone decides that its proof is optional.
        const form = createMultipartForm(input, proof, 'proof');
        return this.transport.uploadJson('recordEventOrganizerInvoice', `/events/${encodeURIComponent(eventId)}/finance/pools/${encodeURIComponent(poolId)}/invoices/organizer`,
            form, validateFinanceMutationResult, scope, progress);
    }

    /** Accept submitted evidence with optional separate organizer corrections. */
    async approve(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceAcceptanceInput'], scope: PilotRequestScope) {
        if (!validateFinanceAcceptanceInput(input)) throw new InvalidInputError();
        return this.transport.read('approveEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/approve', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Reject an unreviewed invoice without deleting its history or retained proof. */
    async decline(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceDeclineInput'], scope: PilotRequestScope) {
        if (!validateFinanceDeclineInput(input)) throw new InvalidInputError();
        return this.transport.read('declineEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/decline', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Organizer invoice closure uses its independent method grant, without changing payer settlement. */
    async organizerClose(eventId: string, poolId: string, invoiceId: string, scope: PilotRequestScope) {
        return this.transport.read('closeEventOrganizerInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/organizer-close', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Carry the captured confirmation and pool revision into the existing accepted-cost correction. */
    async revise(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceRevisionInput'], scope: PilotRequestScope) {
        if (!validateFinanceRevisionInput(input)) throw new InvalidInputError();
        return this.transport.read('reviseEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/revise', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Remove an accepted cost from future calculation while retaining its original evidence. */
    async rejectAccepted(eventId: string, poolId: string, invoiceId: string, input: components['schemas']['FinanceAcceptedRejectionInput'], scope: PilotRequestScope) {
        if (!validateFinanceAcceptedRejectionInput(input)) throw new InvalidInputError();
        return this.transport.read('rejectAcceptedEventFinanceInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/reject-accepted', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Save complete assignment inputs while the backend preserves its saved settlement snapshot. */
    async assignments(eventId: string, poolId: string, input: components['schemas']['FinanceAssignmentsInput'], scope: PilotRequestScope) {
        if (!validateFinanceAssignmentsInput(input)) throw new InvalidInputError();
        return this.transport.read('updateEventFinanceAssignments', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/assignments', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Submit the explicit signed adjustment and redistribution choice as one validated operation. */
    async addAdjustment(eventId: string, poolId: string, input: components['schemas']['FinanceAdjustmentInput'], scope: PilotRequestScope) {
        if (!validateFinanceAdjustmentInput(input)) throw new InvalidInputError();
        return this.transport.read('addEventFinanceAdjustment', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/adjustments', {
            params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Remove one admitted adjustment through its existing idempotent backend operation. */
    async removeAdjustment(eventId: string, poolId: string, surchargeId: string, scope: PilotRequestScope) {
        return this.transport.read('removeEventFinanceAdjustment', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/adjustments/{surchargeId}/remove', {
            params: {path: {eventId, poolId, surchargeId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Select the distinct self-payer or organizer coverage operation without inferring authority in the shared chooser. */
    async takeovers(eventId: string, poolId: string, input: components['schemas']['FinanceTakeoverInput'], organizer: boolean, scope: PilotRequestScope) {
        if (!validateFinanceTakeoverInput(input)) throw new InvalidInputError();
        // The generated paths remain explicit; the backend independently enforces the selected operation's method grant.
        const options = {params: {path: {eventId, poolId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store' as const};
        const result = organizer
            ? await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/takeovers/manage', options)
            : await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/takeovers', options);
        return this.transport.read(organizer ? 'updateEventOrganizerFinanceTakeovers' : 'updateEventParticipantFinanceTakeovers',
            result, validateFinanceMutationResult, scope).data;
    }

    /** Personal and organizer projections have distinct server grants and reads. */
    async read(eventId: string, admin: boolean, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinanceView']> {
        const transport = this.transport;
        async function readFinance() {
            const options = {params: {path: {eventId}, header: transport.headers(scope)}, signal, cache: 'no-store' as const};
            // Never request the organizer representation on a participant page.
            const result = admin ? await transport.client.GET('/events/{eventId}/finance/organizer', options)
                : await transport.client.GET('/events/{eventId}/finance', options);
            return transport.read(admin ? 'getEventOrganizerFinance' : 'getEventFinance', {...result, signal}, validateFinanceView, scope, undefined, true).data;
        }
        return transport.allowedRead(`event/${eventId}/finance/${admin}/${scope.locale}`, scope, readFinance, signal);
    }

    /** One selected saved row is read lazily; no calculation/preview command runs. */
    async breakdown(eventId: string, poolId: string, shareId: string, admin: boolean, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['FinanceBreakdown']> {
        const transport = this.transport;
        async function readBreakdown() {
            const result = await transport.client.GET('/events/{eventId}/finance/pools/{poolId}/shares/{shareId}', {
                params: {path: {eventId, poolId, shareId}, query: {audience: admin ? 'organizer' : 'participant'}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getEventFinanceBreakdown', {...result, signal}, validateFinanceBreakdown, scope, undefined, true).data;
        }
        return transport.allowedRead(`event/${eventId}/finance/${admin}/${poolId}/${shareId}/${scope.locale}`, scope, readBreakdown, signal);
    }

    /** Submit the exact chosen proof once, retaining progress separately from
     * confirmation. File and draft lifetime remain with the participant form. */
    async submit(eventId: string, poolId: string, input: components['schemas']['FinanceInvoiceInput'], proof: File,
                 scope: PilotRequestScope, progress: (loaded: number, total: number | null, complete?: boolean) => void) {
        if (!validateFinanceInvoiceInput(input)) throw new InvalidInputError();
        // Required participant proof retains its generated validation and draft
        // lifetime while sharing the existing multipart serialization owner.
        const form = createMultipartForm(input, proof, 'proof');
        return this.transport.uploadJson('submitEventInvoice', `/events/${encodeURIComponent(eventId)}/finance/pools/${encodeURIComponent(poolId)}/invoices`,
            form, validateFinanceMutationResult, scope, progress);
    }

    /** A captured revision preserves the native participant retraction review. */
    async retract(eventId: string, poolId: string, invoiceId: string, revision: number, scope: PilotRequestScope) {
        const input = {confirmed: true as const, expectedRevision: revision};
        if (!validateFinanceRetractionInput(input)) throw new InvalidInputError();
        return this.transport.read('retractEventInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/retract', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, body: input, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }

    /** Closing changes only invoice lifecycle; it never settles a payer balance. */
    async close(eventId: string, poolId: string, invoiceId: string, scope: PilotRequestScope) {
        return this.transport.read('closeEventInvoice', await this.transport.client.POST('/events/{eventId}/finance/pools/{poolId}/invoices/{invoiceId}/close', {
            params: {path: {eventId, poolId, invoiceId}, header: this.transport.headers(scope)}, cache: 'no-store',
        }), validateFinanceMutationResult, scope).data;
    }
}

const instances = new WeakMap<PilotContext['api'], FinanceApi>();
/** Keep operation selection attached to the existing application transport. */
export function useFinanceApi(context: PilotContext): FinanceApi {
    let api = instances.get(context.api);
    if (!api) { api = new FinanceApi(context.api); instances.set(context.api, api); }
    return api;
}
