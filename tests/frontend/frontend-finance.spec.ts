// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import type {components} from '../../src/types/api/v1';
import FinanceSection from '../../src/frontend/features/finance/FinanceSection.vue';
import FinanceSubmission from '../../src/frontend/features/finance/FinanceSubmission.vue';
import FinanceCoverage from '../../src/frontend/features/finance/FinanceCoverage.vue';
import FinanceShares from '../../src/frontend/features/finance/FinanceShares.vue';
import FinanceHistory from '../../src/frontend/features/finance/FinanceHistory.vue';
import StatusNotice from '../../src/frontend/components/StatusNotice.vue';
import {ApiFailure} from '../../src/frontend/app/transport';
import {eventKeys} from '../../src/frontend/app/queryKeys';
import {createFrontendEventSession, frontendEventId as eventId} from '../factories/frontendEventFactory';
import {frontendEventButton as button, frontendEventJson as json, mountFrontendEvent} from '../keywords/frontendEventKeywords';

const poolId = '22222222-2222-4222-8222-222222222222';
const pool: components['schemas']['FinancePool'] = {id: poolId, name: '<Saved pool>', description: 'Saved costs', status: 'OPEN',
    isDefault: true, needsRecalculation: false, hasPendingTakeovers: false, revision: 7, canSubmit: true, summary: null,
    calculation: null, exampleCalculation: null, coverageKnown: true, coverageGroups: [], pendingCoverageGroups: [], assignedCount: 1, assignAll: true};
const invoice: components['schemas']['FinanceInvoice'] = {id: '12', poolId, poolName: pool.name, revision: 7, status: 'NEW',
    amount: '10.00', description: '<Original evidence>', correctedAmount: null, correctedDescription: null, rejectionReason: null,
    createdAt: '2026-10-20T10:00:00Z', organizerRecorded: false, recordedByName: null, participantName: 'Payer',
    participantEmail: null, proofOriginalName: 'proof.pdf', proofUrl: '/api/proof-output', canRetract: true, canClose: false};
const share: components['schemas']['FinanceShare'] = {id: '2', poolId, poolName: pool.name, payerName: 'Payer', notes: ['<Saved note>'],
    needsRecalculation: true, amount: '-4.00', status: 'refund', statusLabel: 'Refund due', isPaid: false, caption: 'Refund to receive',
    settledShareNotice: null, coveredNames: [], coverageKnown: true};
const snapshot: components['schemas']['FinanceView'] = {audience: 'participant', registrationId: '7', pools: [pool], invoices: [invoice], shares: [share]};
const breakdown: components['schemas']['FinanceBreakdown'] = {components: [{key: 'shareAmount', label: 'Calculated balance', amount: '-4.00'}],
    calculation: {title: 'Your saved calculation', sections: [{key: 'own', title: '<Saved participant>', metrics: [{label: 'Attendance', value: '2'}]}]},
    notes: ['<Saved note>'], statusLabel: 'Refund due', needsRecalculation: true, settledShareNotice: null};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Mount the real admitted Vue read/command owners. Only server delivery is
 * supplied; generated response decoding remains production behavior. */
async function mountFinance(handler: (request: Request) => Promise<Response>, admin = false) {
    const mounted = await mountFrontendEvent(FinanceSection, handler, {eventId, admin, enabled: true});
    cleanups.push(mounted.dispose);
    await vi.waitFor(() => expect(mounted.context.queryClient.isFetching()).toBe(0));
    await flushPromises();
    return mounted;
}

/** Choose actual file bytes without replacing the input or component; the form's
 * native validity engine is outside happy-dom's file-control implementation. */
async function fillInvoice(wrapper: Awaited<ReturnType<typeof mountFrontendEvent>>['wrapper']) {
    await wrapper.get('input[name="amount"]').setValue('12.34');
    await wrapper.get('input[name="description"]').setValue('Retained receipt');
    const file = new File(['same proof bytes'], 'receipt.pdf', {type: 'application/pdf'});
    const chooser = wrapper.get<HTMLInputElement>('input[name="proof"]');
    Object.defineProperty(chooser.element, 'files', {value: [file], configurable: true});
    await chooser.trigger('change');
    vi.spyOn(wrapper.get('form').element, 'reportValidity').mockReturnValue(true);
    return {file, chooser: chooser.element};
}

describe('P7 finance saved reads and participant invoices', () => {
    it.each([false, true])('sorts equal balances by case-insensitive displayed name and names each breakdown action (admin=%s)', async admin => {
        const rows = ['beta', 'ALPHA', 'alpha'].map((name, index) => ({...share, id: String(index + 20),
            poolName: `${name} pool`, payerName: `${name} payer`}));
        const mounted = await mountFrontendEvent(FinanceShares, async () => json(snapshot), {shares: rows, admin});
        cleanups.push(mounted.dispose);
        for (const sort of ['amount-desc', 'amount-asc']) {
            await mounted.wrapper.get('select[id$="-sort"]').setValue(sort);
            expect(mounted.wrapper.findAll('[data-finance-share]').map(row => row.attributes('data-finance-share'))).toEqual(['21', '22', '20']);
        }
        const name = admin ? 'ALPHA payer' : 'ALPHA pool';
        expect(mounted.wrapper.get(`[data-finance-share="21"] button`).attributes('aria-label')).toBe(`View breakdown for ${name}`);
        if (admin) expect(mounted.wrapper.get('caption').text()).toBe('Calculated payer shares and settlement status');
    });

    it('retains organizer fallback attribution, original proof names and recorded/submitted audit wording', async () => {
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json(snapshot), {admin: true, invoices: [
            {...invoice, organizerRecorded: true, recordedByName: null, participantName: null},
            {...invoice, id: '13', proofUrl: '/api/legacy-proof', proofOriginalName: null},
        ]});
        cleanups.push(mounted.dispose);
        const recorded = mounted.wrapper.get('[data-finance-invoice="12"]');
        const submitted = mounted.wrapper.get('[data-finance-invoice="13"]');
        expect(recorded.text()).toContain('Recorded by Organizer');
        expect(recorded.text()).toContain('Recorded Oct 20, 2026');
        expect(submitted.text()).toContain('Submitted Oct 20, 2026');
        expect(recorded.get('a').attributes('title')).toBe('proof.pdf');
        expect(submitted.get('a').attributes('title')).toBe('Invoice proof');
        await mounted.wrapper.get('input[type="search"]').setValue('Organizer');
        expect(mounted.wrapper.find('[data-finance-invoice="12"]').exists()).toBe(true);
        expect(mounted.wrapper.find('[data-finance-invoice="13"]').exists()).toBe(false);
        await mounted.wrapper.get('input[type="search"]').setValue('Pool expense');
        expect(mounted.wrapper.find('[data-finance-invoice="12"]').exists()).toBe(true);
    });

    it('confirms the captured invoice identity and corrected amount before closing its participant history row', async () => {
        let closed = false;
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const mounted = await mountFinance(async req => {
            if (req.method === 'POST') {
                expect(new URL(req.url).pathname).toBe(`/api/v1/events/${eventId}/finance/pools/${poolId}/invoices/12/close`);
                closed = true;
                return json({changed: true});
            }
            return json({...snapshot, invoices: [{...invoice, correctedAmount: '11.25',
                status: closed ? 'CLOSED' : 'APPROVED', canRetract: false, canClose: !closed}]});
        });
        await button(mounted.wrapper, 'Invoice pools & payments').trigger('click');
        await button(mounted.wrapper, 'Submit an invoice & history').trigger('click');
        await button(mounted.wrapper, 'Close').trigger('click');
        expect(confirm).toHaveBeenCalledWith('Invoice #12\nClose this accepted invoice for 11.25?');
        expect(closed).toBe(false);
        confirm.mockReturnValue(true);
        await button(mounted.wrapper, 'Close').trigger('click'); await flushPromises();
        expect(closed).toBe(true);
        expect(mounted.request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
    });

    it('searches an organizer invoice by its admitted participant email without requesting another projection', async () => {
        const mounted = await mountFrontendEvent(FinanceHistory, async () => json(snapshot), {
            invoices: [{...invoice, participantEmail: 'receipt.owner@example.test'}], admin: true,
        });
        cleanups.push(mounted.dispose);
        await mounted.wrapper.get('input[type="search"]').setValue('receipt.owner@example.test');
        expect(mounted.wrapper.find(`[data-finance-invoice="${invoice.id}"]`).exists()).toBe(true);
        await mounted.wrapper.get('input[type="search"]').setValue('No admitted invoice');
        expect(mounted.wrapper.find(`[data-finance-invoice="${invoice.id}"]`).exists()).toBe(false);
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it.each([
        {admin: false, label: 'personal pool descriptions', needle: 'Saved source keyword'},
        {admin: true, label: 'organizer applied covered names', needle: 'Covered person keyword'},
    ])('searches $label from the admitted saved projection', async ({admin, needle}) => {
        const mounted = await mountFrontendEvent(FinanceShares, async () => json(snapshot), {
            shares: [{...share, coveredNames: ['Covered person keyword']},
                ...(admin ? [{...share, id: '999', payerName: 'Another payer', coveredNames: [], notes: []}] : [])], admin,
            pools: [{id: poolId, description: 'Saved source keyword'}],
        });
        cleanups.push(mounted.dispose);
        await mounted.wrapper.get('input[type="search"]').setValue(needle);
        expect(mounted.wrapper.find(`[data-finance-share="${share.id}"]`).exists()).toBe(true);
        if (admin) {
            expect(mounted.wrapper.findAll('[data-finance-share]')).toHaveLength(1);
            expect(mounted.wrapper.get('[data-finance-payer-count]').text()).toBe('2 payers');
        }
        await mounted.wrapper.get('input[type="search"]').setValue('No saved match');
        expect(mounted.wrapper.find(`[data-finance-share="${share.id}"]`).exists()).toBe(false);
        if (admin) expect(mounted.wrapper.get('[data-finance-payer-count]').text()).toBe('2 payers');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('preserves native amount spelling through change, blur, rejection and later render while submitting its numeric value', async () => {
        const mounted = await mountFrontendEvent(FinanceSubmission, async () => json(snapshot), {
            eventId, pools: [pool], active: true, refresh: vi.fn(async () => {}),
        });
        cleanups.push(mounted.dispose);
        const upload = vi.spyOn(mounted.context.api, 'uploadJson').mockImplementation(async (_operation, _path, form) => {
            expect(JSON.parse(form.get('data') as string)).toEqual({amount: '13.5', description: 'Changed before submission'});
            throw new ApiFailure(400, null, null, 'Rejected proof', true);
        });
        const {file, chooser} = await fillInvoice(mounted.wrapper);
        const amount = mounted.wrapper.get<HTMLInputElement>('input[name="amount"]');
        await amount.setValue('013.50');
        await amount.trigger('change');
        await amount.trigger('blur');
        expect(amount.element.value).toBe('013.50');
        await mounted.wrapper.get('input[name="description"]').setValue('Changed before submission');
        expect(amount.element.value).toBe('013.50');
        await mounted.wrapper.get('form').trigger('submit'); await flushPromises();
        expect(upload).toHaveBeenCalledTimes(1);
        expect(amount.element.value).toBe('013.50');
        expect(chooser.files?.[0]).toBe(file);
        await mounted.wrapper.get('input[name="description"]').setValue('Changed after rejection');
        expect(amount.element.value).toBe('013.50');
    });

    it('retains the live invoice draft after new-language delivery and releases it on a validated finance denial', async () => {
        let mode: 'held' | 'saved' | 'denied' = 'held';
        const delayed: Array<() => void> = [];
        const localized = {...snapshot, pools: [{...pool, description: 'Localized saved costs'}]};
        const mounted = await mountFinance(async req => {
            if (new URL(req.url).pathname === '/api/v1/locale') return json({...createFrontendEventSession(), locale: 'de'});
            if (req.headers.get('X-Surveyor-Locale') !== 'de') return json(snapshot);
            if (mode === 'denied') return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403,
                detail: 'Not allowed', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}, requestId: 'finance-denial'}),
            {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': createFrontendEventSession().context}});
            if (mode === 'saved') return json(localized);
            return new Promise<Response>(resolve => delayed.push(() => resolve(json(localized))));
        });
        const {wrapper, context} = mounted;
        await button(wrapper, 'Invoice pools & payments').trigger('click');
        await button(wrapper, 'Submit an invoice & history').trigger('click');
        const {file, chooser} = await fillInvoice(wrapper);
        await wrapper.get('input[name="amount"]').setValue('12.340');
        const form = wrapper.get('form').element;
        const switching = context.changeLocale('de');
        await vi.waitFor(() => expect(delayed.length).toBeGreaterThan(0));
        mode = 'saved';
        for (const finish of delayed.splice(0)) finish();
        await switching;
        await vi.waitFor(() => expect(context.queryClient.isFetching()).toBe(0));
        await flushPromises();
        expect(wrapper.get('form').element).toBe(form);
        expect(wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('12.340');
        expect(chooser.files?.[0]).toBe(file);
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
        mode = 'denied';
        await wrapper.get(`button[aria-label="${context.messages.value.t('common.refresh')}"]`).trigger('click');
        await vi.waitFor(() => expect(context.queryClient.isFetching()).toBe(0));
        await flushPromises();
        expect(wrapper.find('[data-finance-submission]').exists()).toBe(false);
        expect(chooser.isConnected).toBe(false);
    });

    it('keeps the exact invoice File and lexical draft through delayed and failed locale reads, prolonged outage and explicit cache retirement', async () => {
        let localeDelivery: 'held' | 'unavailable' = 'held';
        const delayed: Array<() => void> = [];
        const unavailable = () => new Response(JSON.stringify({type: 'about:blank', title: 'Unavailable', status: 503,
            detail: 'Temporarily unavailable', requestId: 'locale-read-failure'}), {status: 503,
            headers: {'Content-Type': 'application/problem+json', 'Retry-After': '600', 'X-Surveyor-Context': createFrontendEventSession().context}});
        const mounted = await mountFinance(async req => {
            if (new URL(req.url).pathname === '/api/v1/locale') return json({...createFrontendEventSession(), locale: 'de'});
            if (req.headers.get('X-Surveyor-Locale') === 'de') {
                if (localeDelivery === 'unavailable') return unavailable();
                return new Promise<Response>(resolve => delayed.push(() => resolve(unavailable())));
            }
            return json(snapshot);
        });
        const {wrapper, context, request} = mounted;
        await button(wrapper, 'Invoice pools & payments').trigger('click');
        await button(wrapper, 'Submit an invoice & history').trigger('click');
        const {file, chooser} = await fillInvoice(wrapper);
        await wrapper.get('input[name="amount"]').setValue('12.340');
        const form = wrapper.get('form').element;
        const switching = context.changeLocale('de');
        await vi.waitFor(() => expect(delayed.length).toBeGreaterThan(0));
        await flushPromises();
        expect(wrapper.get('form').element).toBe(form);
        expect(wrapper.get<HTMLInputElement>('input[name="proof"]').element).toBe(chooser);
        expect(chooser.files?.[0]).toBe(file);
        expect(wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('12.340');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();

        const previousKey = [...eventKeys.finance(context.session.value?.context, eventId), 'en'];
        const lastUpdatedAt = context.queryClient.getQueryState(previousKey)?.dataUpdatedAt;
        expect(lastUpdatedAt).toBeGreaterThan(0);
        expect(wrapper.text()).toContain(context.messages.value.t('finance.choosePool'));

        localeDelivery = 'unavailable';
        for (const finish of delayed.splice(0)) finish();
        await switching;
        await vi.waitFor(() => expect(context.queryClient.isFetching()).toBe(0));
        await flushPromises();
        expect(wrapper.get('form').element).toBe(form);
        expect(chooser.files?.[0]).toBe(file);
        expect(wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('12.340');
        expect(wrapper.get<HTMLInputElement>('input[name="description"]').element.value).toBe('Retained receipt');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(wrapper.findAllComponents(StatusNotice).some(notice => notice.props('lastUpdatedAt') === lastUpdatedAt)).toBe(true);

        // A prolonged outage may outlast inactive-query GC. The disabled cache
        // lease retains this same Query/File without issuing another GET.
        context.visible.value = false;
        await flushPromises();
        const reads = request.mock.calls.length;
        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(61_000);
        expect(request).toHaveBeenCalledTimes(reads);
        expect(wrapper.get('form').element).toBe(form);
        expect(chooser.files?.[0]).toBe(file);
        expect(context.queryClient.getQueryData(previousKey)).toEqual(snapshot);

        // Actual authority eviction is different from GC: its registered Query
        // removal must immediately retire the fallback and mounted private draft.
        context.queryClient.removeQueries({queryKey: previousKey, exact: true});
        await flushPromises();
        expect(wrapper.find('[data-finance-submission]').exists()).toBe(false);
        expect(chooser.isConnected).toBe(false);
    });

    it('keeps whole coverage groups searchable beyond the six-name preview without sending a mutation', async () => {
        const beneficiaries = Array.from({length: 8}, (_, index) => ({id: String(index + 10), name: `Covered ${index + 1}`}));
        const mounted = await mountFrontendEvent(FinanceCoverage, async () => json(snapshot), {
            groups: [{payerId: '7', payerName: 'Saved payer', beneficiaries}], known: true, registrationId: '7',
        });
        cleanups.push(mounted.dispose);
        expect(mounted.wrapper.findAll('.coverage-name-chip')).toHaveLength(6);
        await button(mounted.wrapper, 'Show all 8').trigger('click');
        expect(mounted.wrapper.findAll('.coverage-name-chip')).toHaveLength(8);
        await mounted.wrapper.get('select').setValue('25');
        expect(mounted.wrapper.findAll('.coverage-name-chip')).toHaveLength(8);
        await mounted.wrapper.get('input[type="search"]').setValue('Covered 8');
        expect(mounted.wrapper.findAll('.coverage-name-chip')).toHaveLength(1);
        expect(mounted.wrapper.find('.coverage-name-chip').text()).toBe('Covered 8');
        expect(mounted.wrapper.text()).toContain('Saved payer');
        expect(mounted.request).not.toHaveBeenCalled();
    });

    it('reads one personal projection, retains full history evidence and lazily reads only the selected saved share', async () => {
        let current = structuredClone(snapshot);
        const {wrapper, request} = await mountFinance(async req => json(new URL(req.url).pathname.includes('/shares/') ? breakdown : current));
        expect(request.mock.calls.filter(([req]) => new URL((req as Request).url).pathname.includes('/shares/'))).toHaveLength(0);
        expect(request.mock.calls.some(([req]) => new URL((req as Request).url).pathname.endsWith('/organizer'))).toBe(false);
        await button(wrapper, 'Invoice pools & payments').trigger('click');
        await button(wrapper, 'Submit an invoice & history').trigger('click');
        expect(wrapper.text()).toContain('<Original evidence>');
        expect(wrapper.find('[data-finance-history] script').exists()).toBe(false);
        expect(wrapper.get('a[href="/api/proof-output"]').attributes('target')).toBe('_blank');
        await button(wrapper, 'View breakdown').trigger('click'); await flushPromises();
        expect(request.mock.calls.filter(([req]) => new URL((req as Request).url).pathname.includes('/shares/'))).toHaveLength(1);
        expect(document.body.textContent).toContain('<Saved participant>');
        // Read-only selection follows the current admitted row after refresh,
        // while the explanation itself participates in explicit Refresh.
        current = {...current, shares: [{...share, poolName: 'Renamed saved pool'}]};
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        await flushPromises();
        expect(document.body.textContent).toContain('Renamed saved pool');
        expect(request.mock.calls.filter(([req]) => new URL((req as Request).url).pathname.includes('/shares/'))).toHaveLength(2);
    });

    it('uses a distinct organizer projection with source totals and no participant submission or lifecycle commands', async () => {
        const organizer = {...snapshot, audience: 'organizer', registrationId: null,
            pools: [{...pool, status: 'CLOSED', canSubmit: false,
                summary: {primary: [{key: 'totalAmount', label: 'Invoice costs', amount: '20.00'}], details: [], saved: []}}],
            invoices: [{...invoice, organizerRecorded: true, participantName: null, recordedByName: 'Recorder', proofUrl: null, proofOriginalName: null}]} as components['schemas']['FinanceView'];
        const {wrapper, request} = await mountFinance(async () => json(organizer), true);
        expect(new URL((request.mock.calls[0]![0] as Request).url).pathname).toBe(`/api/v1/events/${eventId}/finance/organizer`);
        await wrapper.get('[data-finance-pool] .accordion-button').trigger('click');
        expect(wrapper.text()).toContain('Invoice costs');
        expect(wrapper.text()).toContain('Pool expense');
        expect(wrapper.text()).toContain('Recorded by Recorder');
        expect(wrapper.get('[data-finance-shares]').text()).toContain('Payment status describes the payer named in each row. The calculated balance stays visible after payment or refund.');
        expect(wrapper.find('[data-finance-submission]').exists()).toBe(false);
        expect(wrapper.findAll('button').some(item => item.text().trim() === 'Retract')).toBe(false);
        expect(wrapper.find('a[href$="/admin#invoicePoolAccordion"]').exists()).toBe(true);
    });

    it('captures reviewed retraction revision and preserves confirmed lifecycle outcome through failed refresh', async () => {
        let readCount = 0;
        const {wrapper, request} = await mountFinance(async req => {
            if (req.method === 'POST') {
                expect(new URL(req.url).pathname).toBe(`/api/v1/events/${eventId}/finance/pools/${poolId}/invoices/12/retract`);
                expect(await req.json()).toEqual({confirmed: true, expectedRevision: 7});
                return json({changed: true});
            }
            if (++readCount > 1) throw new Error('saved read unavailable');
            return json(snapshot);
        });
        await button(wrapper, 'Invoice pools & payments').trigger('click');
        await button(wrapper, 'Submit an invoice & history').trigger('click');
        await button(wrapper, 'Retract').trigger('click'); await flushPromises();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Invoice #12 · 10.00');
        const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent?.trim() === 'Confirm retraction');
        expect(confirm).toBeDefined(); confirm!.click(); await flushPromises();
        await vi.waitFor(() => expect(document.body.textContent).toContain('Your change was saved, but the refreshed data could not be loaded.'), {timeout: 10000});
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('separates upload progress from save and retains the exact draft/file after definite rejection', async () => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(FinanceSubmission, async () => json(snapshot), {eventId, pools: [pool], active: true, refresh});
        cleanups.push(mounted.dispose);
        const upload = vi.spyOn(mounted.context.api, 'uploadJson');
        let reject: ((reason: unknown) => void) | undefined;
        upload.mockImplementation(async (_operation, _path, _form, _validate, _scope, progress) => {
            progress(5, 10);
            return new Promise((_resolve, rejectPromise) => {reject = rejectPromise;});
        });
        const {file, chooser} = await fillInvoice(mounted.wrapper);
        await mounted.wrapper.get('form').trigger('submit');
        expect(mounted.wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50');
        expect(button(mounted.wrapper, 'Submitting…').attributes('disabled')).toBeDefined();
        await mounted.wrapper.get('form').trigger('submit');
        expect(upload).toHaveBeenCalledTimes(1);
        reject!(new ApiFailure(400, null, null, 'Rejected fields', true)); await flushPromises();
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('12.34');
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="description"]').element.value).toBe('Retained receipt');
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="proof"]').element).toBe(chooser);
        expect(chooser.files?.[0]).toBe(file);
        expect(button(mounted.wrapper, 'Submit invoice').attributes('disabled')).toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('locks unknown submission until history inspection and explicit review, without replay', async () => {
        const refresh = vi.fn(async () => {});
        const mounted = await mountFrontendEvent(FinanceSubmission, async () => json(snapshot), {eventId, pools: [pool], active: true, refresh});
        cleanups.push(mounted.dispose);
        const upload = vi.spyOn(mounted.context.api, 'uploadJson').mockRejectedValue(new Error('Delivery lost'));
        const {chooser, file} = await fillInvoice(mounted.wrapper);
        await mounted.wrapper.get('form').trigger('submit'); await flushPromises();
        expect(button(mounted.wrapper, 'Submission unconfirmed').attributes('disabled')).toBeDefined();
        expect(chooser.files?.[0]).toBe(file);
        await button(mounted.wrapper, 'Check invoice history').trigger('click'); await flushPromises();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(button(mounted.wrapper, 'Submission unconfirmed').attributes('disabled')).toBeDefined();
        await button(mounted.wrapper, 'I have checked the invoice history').trigger('click'); await flushPromises();
        expect(button(mounted.wrapper, 'Submit invoice').attributes('disabled')).toBeUndefined();
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('');
        expect(mounted.wrapper.get<HTMLSelectElement>('select[name="poolId"]').element.value).toBe(poolId);
        expect(upload).toHaveBeenCalledTimes(1);
    });

    it('releases completed inputs after confirmed save even if the following saved read fails', async () => {
        const refresh = vi.fn(async () => {throw new Error('Read failed after save');});
        const mounted = await mountFrontendEvent(FinanceSubmission, async () => json(snapshot), {eventId, pools: [pool], active: true, refresh});
        cleanups.push(mounted.dispose);
        const upload = vi.spyOn(mounted.context.api, 'uploadJson').mockResolvedValue({changed: true});
        await fillInvoice(mounted.wrapper);
        await mounted.wrapper.get('form').trigger('submit'); await flushPromises();
        expect(upload).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="amount"]').element.value).toBe('');
        expect(mounted.wrapper.get<HTMLInputElement>('input[name="description"]').element.value).toBe('');
        expect(mounted.wrapper.get<HTMLSelectElement>('select[name="poolId"]').element.value).toBe(poolId);
        expect(mounted.wrapper.text()).not.toContain('Submission unconfirmed');
    });
});
