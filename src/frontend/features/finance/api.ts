import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {InvalidInputError} from '../../app/transport';
import {validateFinanceView} from '../../../../.generated/api/v1/browser/validateFinanceView.mjs';
import {validateFinanceBreakdown} from '../../../../.generated/api/v1/browser/validateFinanceBreakdown.mjs';
import {validateFinanceInvoiceInput} from '../../../../.generated/api/v1/browser/validateFinanceInvoiceInput.mjs';
import {validateFinanceRetractionInput} from '../../../../.generated/api/v1/browser/validateFinanceRetractionInput.mjs';
import {validateFinanceMutationResult} from '../../../../.generated/api/v1/browser/validateFinanceMutationResult.mjs';

/** Finance selects authored operations; shared transport owns actor admission,
 * generated delivery checks and progress without automatic command replay. */
export class FinanceApi {
    constructor(private transport: PilotApi) {}

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
        // Finance's required proof is its own named part; the existing creation
        // serializer intentionally handles optional header images instead.
        const form = new FormData();
        form.append('data', JSON.stringify(input));
        form.append('proof', proof);
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
