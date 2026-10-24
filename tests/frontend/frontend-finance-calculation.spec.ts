// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DOMWrapper, flushPromises} from '@vue/test-utils';
import type {components} from '../../src/types/api/v1';
import FinanceCalculationReview from '../../src/frontend/features/finance/FinanceCalculationReview.vue';
import FinancePoolOutputs from '../../src/frontend/features/finance/FinancePoolOutputs.vue';
import {frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const poolId = '22222222-2222-4222-8222-222222222222';
const pool: components['schemas']['FinancePool'] = {id: poolId, name: 'Reviewed pool', description: '', status: 'OPEN',
    isDefault: false, assignAll: true, assignedCount: 1, registrationIds: ['7'], revision: 7, canSubmit: false,
    needsRecalculation: false, hasPendingTakeovers: false, coverageKnown: true, coverageGroups: [], pendingCoverageGroups: [],
    calculation: null, exampleCalculation: null, summary: null,
    settings: {distribution: 'EQUAL', roundUpShares: true, sendCalculationEmails: false, subtractPersonalInvoices: true}};
const calculation = {title: 'Factual saved basis', sections: [{key: 'basis', title: 'Saved cost', metrics: [{label: 'Invoice total', value: '10.00'}]}]};
const preview: components['schemas']['FinancePreview'] = {revision: 7, roundUpShares: true, calculation,
    exampleCalculation: {title: 'Anonymous example', sections: []},
    columns: [{key: 'baseShareAmount', label: 'Base'}, {key: 'shareAmount', label: 'Balance'}],
    shares: [{registrationId: '7', payerName: '<Reviewed payer>', baseShareAmount: '10.00', extraAmount: '0.00',
        invoiceCreditAmount: '0.00', paymentCreditAmount: '0.00', shareAmount: '10.00', calculatedAmount: '10.00',
        isPaid: false, notes: ['<Original audit note>'], statusLabel: 'Payment due'}],
    totals: {invoiceAmount: '10.00', redistributedAmount: '0.00', distributableAmount: '10.00', allocatedBaseAmount: '10.00',
        roundingDifference: '0.00', adjustmentAmount: '0.00', grossAmount: '10.00', invoiceCreditAmount: '0.00',
        expectedNetAmount: '10.00', calculatedAmount: '10.00', paymentCreditAmount: '0.00', outstandingAmount: '10.00', creditAmount: '0.00'}};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

/** Mount the actual dialog, generated validator and shared command state. Only
 * HTTP delivery is supplied so malformed and unknown responses stay observable. */
async function mountReview(handler = async (request: Request) => json(request.method === 'GET' ? preview : {changed: true}),
                           props: Record<string, unknown> = {}) {
    const mounted = await mountFrontendEvent(FinanceCalculationReview, handler, {eventId, pool, savedShares: [],
        open: true, active: true, hasPendingEdits: () => false, refresh: vi.fn(async () => {}), ...props});
    cleanups.push(mounted.dispose);
    return {...mounted, dialog: new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!)};
}

describe('P9 saved calculation review', () => {
    it('keeps the empty-pool reason localized and blocks calculation without replaying a rejected preview', async () => {
        const mounted = await mountReview(async () => new Response(JSON.stringify({
            type: 'urn:surveyor:problem:finance-no-participants-assigned-to-this-pool-400',
            title: 'No participants assigned to this pool', detail: 'No participants assigned to this pool',
            status: 400, requestId: 'empty-calculation-pool', params: {},
            code: 'FINANCE_NO_PARTICIPANTS_ASSIGNED_TO_THIS_POOL_400', messageKey: 'finance.noParticipantsAssignedToThisPool',
        }), {status: 400, headers: {'Content-Type': 'application/problem+json'}}));
        for (const locale of ['en', 'de'] as const) {
            mounted.context.locale.value = locale;
            await flushPromises();
            const reason = mounted.context.messages.value.t('finance.noParticipantsAssignedToThisPool');
            expect(mounted.dialog.get('.alert-danger').text()).toContain(reason);
            expect(button(mounted.dialog, mounted.context.messages.value.t('finance.closePoolCalculate')).attributes('disabled')).toBeDefined();
        }
        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(mounted.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('renders escaped adaptive evidence and captures the original revision and explicit mail choice through background reads', async () => {
        const mounted = await mountReview();
        expect(mounted.dialog.text()).toContain('<Reviewed payer>');
        expect(mounted.dialog.find('reviewed').exists()).toBe(false);
        expect(mounted.dialog.find('[data-finance-preview-example]').exists()).toBe(false);
        expect(mounted.dialog.findAll('thead th').map(node => node.text())).toEqual(['Payer', 'Base', 'Balance']);
        await mounted.wrapper.setProps({pool: {...pool, revision: 99}});
        await mounted.dialog.get('input[name="sendEmails"]').setValue(true);
        await button(mounted.dialog, 'Close pool & calculate').trigger('click'); await flushPromises();
        const request = mounted.request.mock.calls.find(([request]) => (request as Request).method === 'POST')![0] as Request;
        expect(await request.clone().json()).toEqual({expectedRevision: 7, sendEmails: true});
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });

    it('blocks previews and consumes apply authority if a sibling becomes dirty after review', async () => {
        let dirty = true;
        const mounted = await mountReview(undefined, {hasPendingEdits: () => dirty});
        expect(mounted.request).not.toHaveBeenCalled();
        expect(mounted.dialog.text()).toContain('Save or discard');
        dirty = false;
        await button(mounted.dialog, 'Refresh preview').trigger('click'); await flushPromises();
        dirty = true;
        await button(mounted.dialog, 'Close pool & calculate').trigger('click'); await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(1);
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
    });

    it('keeps stale review evidence after rejection and requires a fresh preview before another apply', async () => {
        let revision = 7;
        const mounted = await mountReview(async request => {
            if (request.method === 'GET') return json({...preview, revision});
            return new Response(JSON.stringify({type: 'https://surveyor.invalid/problems/resource-conflict', title: 'Conflict',
                status: 409, requestId: 'p9-conflict', code: 'RESOURCE_CONFLICT', messageKey: 'api:errors.RESOURCE_CONFLICT', params: {}, detail: 'Pool changed'}),
            {status: 409, headers: {'Content-Type': 'application/problem+json'}});
        });
        await button(mounted.dialog, 'Close pool & calculate').trigger('click'); await flushPromises();
        expect(mounted.dialog.text()).toContain('<Reviewed payer>');
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
        revision = 9;
        await button(mounted.dialog, 'Refresh preview').trigger('click'); await flushPromises();
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeUndefined();
        expect(mounted.request.mock.calls.filter(([request]) => (request as Request).method === 'POST')).toHaveLength(1);
    });

    it('rejects a malformed revision and late reads after admission retirement', async () => {
        let resolve: (response: Response) => void = () => {};
        const mounted = await mountReview(() => new Promise<Response>(complete => {resolve = complete;}));
        await mounted.wrapper.setProps({active: false});
        resolve(json(preview)); await flushPromises();
        expect(mounted.dialog.find('[data-finance-preview-payer]').exists()).toBe(false);
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
        await mounted.wrapper.setProps({active: true});
        const read = button(mounted.dialog, 'Refresh preview').trigger('click'); await flushPromises();
        resolve(json({...preview, revision: -1})); await read; await flushPromises();
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
    });

    it('rejects malformed decimal evidence before it can authorize a calculation', async () => {
        const mounted = await mountReview(async () => json({...preview,
            shares: [{...preview.shares[0], shareAmount: 'not-money'}]}));
        expect(mounted.dialog.find('[data-finance-preview-payer]').exists()).toBe(false);
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
        expect(mounted.request.mock.calls.filter(([request]) => (request as Request).method === 'POST')).toHaveLength(0);
    });

    it('discards a retired-locale response before its foreign context can expire the current actor', async () => {
        let resolve: (response: Response) => void = () => {};
        const mounted = await mountReview(() => new Promise<Response>(complete => {resolve = complete;}));
        const actor = mounted.context.session.value?.context;
        mounted.context.locale.value = 'de'; await flushPromises();
        const response = json(preview);
        response.headers.set('X-Surveyor-Context', 'obsolete-foreign-context');
        resolve(response); await flushPromises();
        expect(mounted.context.session.value?.context).toBe(actor);
        expect(mounted.dialog.find('[data-finance-preview-payer]').exists()).toBe(false);
        expect(mounted.dialog.get<HTMLButtonElement>('button.btn-warning').element.disabled).toBe(true);
    });

    it('keeps unknown calculation locked during saved inspection and never retries its write', async () => {
        let holdRefresh = false;
        let finishRefresh: (() => void) | undefined;
        const refresh = vi.fn(async () => {
            if (holdRefresh) await new Promise<void>(resolve => {finishRefresh = resolve;});
        });
        const mounted = await mountReview(async request => {
            if (request.method === 'GET') return json(preview);
            throw new Error('Committed response lost');
        }, {refresh});
        await button(mounted.dialog, 'Close pool & calculate').trigger('click'); await flushPromises();
        expect(button(mounted.dialog, 'Close pool & calculate').attributes('disabled')).toBeDefined();
        await button(mounted.dialog, 'Refresh').trigger('click'); await flushPromises();
        expect(mounted.dialog.find('[data-finance-calculation-inspection]').exists()).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
        holdRefresh = true;
        await button(mounted.dialog, 'Refresh').trigger('click'); await flushPromises();
        try {
            const acknowledge = button(mounted.dialog, 'I have checked the saved shares');
            expect(button(mounted.dialog, 'Refresh').attributes('aria-busy')).toBe('true');
            expect(acknowledge.attributes('disabled')).toBeDefined();
            expect(acknowledge.attributes('aria-busy')).toBe('false');
            expect(acknowledge.find('.spinner-border').exists()).toBe(false);
        } finally {finishRefresh?.(); await flushPromises();}
        expect(refresh).toHaveBeenCalledTimes(2);
        await button(mounted.dialog, 'I have checked the saved shares').trigger('click'); await flushPromises();
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
        expect(mounted.request.mock.calls.filter(([request]) => (request as Request).method === 'POST')).toHaveLength(1);
    });

    it('locks a confirmed calculation after its failed following read without offering apply again', async () => {
        const mounted = await mountReview(undefined, {refresh: async () => {throw new Error('Read failed');}});
        await button(mounted.dialog, 'Close pool & calculate').trigger('click'); await flushPromises();
        expect(mounted.dialog.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect(mounted.dialog.findAll('button').some(node => node.text() === 'Close pool & calculate')).toBe(false);
        expect(mounted.wrapper.emitted('close')).toBeUndefined();
        await button(mounted.dialog, 'Close').trigger('click');
        expect(mounted.wrapper.emitted('close')).toHaveLength(1);
    });
});

describe('P9 saved outputs and rollback', () => {
    it.each(['notify', 'rollback'] as const)('keeps local %s acknowledgement blocked without borrowing a repeated saved read', async operation => {
        let holdRefresh = false;
        let finishRefresh: (() => void) | undefined;
        const refresh = vi.fn(async () => {
            if (holdRefresh) await new Promise<void>(resolve => {finishRefresh = resolve;});
        });
        const mounted = await mountFrontendEvent(FinancePoolOutputs, async () => {throw new Error('Lost command response');},
            {eventId, pool: {...pool, status: 'CLOSED', needsRecalculation: true, canRollback: true}, shares: [],
                active: true, hasPendingEdits: () => false, refresh});
        cleanups.push(mounted.dispose);
        await button(mounted.wrapper, operation === 'notify' ? 'Send settlement emails' : 'Roll back pool changes').trigger('click');
        await flushPromises();
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        await button(dialog, operation === 'notify' ? 'Send settlement emails' : 'Restore last calculated settings').trigger('click');
        await flushPromises();
        await button(dialog, 'Refresh').trigger('click'); await flushPromises();
        holdRefresh = true;
        await button(dialog, 'Refresh').trigger('click'); await flushPromises();
        try {
            const acknowledge = button(dialog, 'I have checked the saved shares');
            expect(button(dialog, 'Refresh').attributes('aria-busy')).toBe('true');
            expect(acknowledge.attributes('disabled')).toBeDefined();
            expect(acknowledge.attributes('aria-busy')).toBe('false');
            expect(acknowledge.find('.spinner-border').exists()).toBe(false);
        } finally {finishRefresh?.(); await flushPromises();}
        expect(refresh).toHaveBeenCalledTimes(2);
        await button(dialog, 'I have checked the saved shares').trigger('click'); await flushPromises();
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('reports rollback staleness=%s while keeping the completed command locked', async needsRecalculation => {
        const mounted = await mountFrontendEvent(FinancePoolOutputs, async () => json({needsRecalculation, externalChanges: needsRecalculation}),
            {eventId, pool: {...pool, status: 'CLOSED', needsRecalculation: true, canRollback: true}, shares: [],
                active: true, hasPendingEdits: () => false, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        await button(mounted.wrapper, 'Roll back pool changes').trigger('click'); await flushPromises();
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        await button(dialog, 'Restore last calculated settings').trigger('click'); await flushPromises();
        expect(dialog.text()).toContain(needsRecalculation ? 'A new calculation is still required' : 'Existing shares and payments have been preserved');
        expect(dialog.findAll('button').some(node => node.text() === 'Restore last calculated settings')).toBe(false);
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });

    it('shows the eligible email count and saved-calculation warning without replaying delivery', async () => {
        const mounted = await mountFrontendEvent(FinancePoolOutputs, async () => json({count: 2}),
            {eventId, pool: {...pool, status: 'CLOSED', needsRecalculation: true}, shares: [],
                active: true, hasPendingEdits: () => false, refresh: async () => {}});
        cleanups.push(mounted.dispose);
        await button(mounted.wrapper, 'Send settlement emails').trigger('click'); await flushPromises();
        const dialog = new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!);
        expect(dialog.text()).toContain('These emails describe the previous calculation');
        await button(dialog, 'Send settlement emails').trigger('click'); await flushPromises();
        expect(dialog.text()).toContain('Settlement email delivery requested for 2 payers.');
        expect(dialog.findAll('button').some(node => node.text() === 'Send settlement emails')).toBe(false);
        expect(mounted.request).toHaveBeenCalledTimes(1);
    });
});
