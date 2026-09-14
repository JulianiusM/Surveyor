import {afterEach, describe, expect, it, vi} from 'vitest';
import {initShareLedgers, invoiceChangePayload, postOrganizerExpense, restoreInvoicePaidState, runInvoiceAdminAction} from '../../src/public/js/events';

class ElementStub {
    tagName = 'DIV';
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    className = '';
    classList = {add: vi.fn(), remove: vi.fn()};
    childNodes: ElementStub[] = [];
    text = '';
    value = '';
    disabled = false;
    hidden = false;
    checked = false;
    defaultChecked = false;
    parentElement: ElementStub | null = null;
    focus = vi.fn();
    scrollIntoView = vi.fn();
    get role() { return this.attributes.get('role') || ''; }
    set role(value: string) { this.attributes.set('role', value); }
    matches: Record<string, ElementStub> = {};
    listeners = new Map<string, () => void>();
    get textContent(): string { return this.text + this.childNodes.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.text = value; this.childNodes = []; }
    querySelector(selector: string) { return this.matches[selector] || null; }
    querySelectorAll(selector: string): ElementStub[] { return selector === '.alert' ? this.childNodes.filter(child => child.role === 'alert') : []; }
    closest(_selector: string): ElementStub | null { return null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    replaceChildren(...children: ElementStub[]) { this.text = ''; this.childNodes = children; }
    append(child: ElementStub) { this.childNodes = this.childNodes.filter(existing => existing !== child); this.childNodes.push(child); child.parentElement = this; }
    appendChild(child: ElementStub) { this.append(child); return child; }
    remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    trigger(name: string) { this.listeners.get(name)?.(); }
}

const element = () => new ElementStub();
const html = (node: ElementStub) => node as unknown as HTMLElement;

describe('confirmed invoice changes', () => {
    const fields = (values: Record<string, string>) => ({get: (name: string) => values[name] ?? null}) as unknown as FormData;

    it('captures both reviewed correction fields with explicit confirmation and the saved revision', () => {
        expect(invoiceChangePayload('revise', 7, fields({correctedAmount: '90.25', correctedDescription: ' Updated cost '})))
            .toEqual({confirmed: true, expectedRevision: 7, correctedAmount: 90.25, correctedDescription: 'Updated cost'});
        expect(invoiceChangePayload('revise', 7, fields({correctedAmount: '90.25', correctedDescription: ' '})))
            .toMatchObject({correctedDescription: null});
    });

    it('requires a reason before preparing a rejection and refuses unknown pool revisions', () => {
        expect(invoiceChangePayload('reject-accepted', 8, fields({rejectionReason: ' Duplicate invoice '})))
            .toEqual({confirmed: true, expectedRevision: 8, rejectionReason: 'Duplicate invoice'});
        expect(() => invoiceChangePayload('reject-accepted', 8, fields({rejectionReason: ' '}))).toThrow('rejection reason');
        expect(() => invoiceChangePayload('revise', NaN, fields({correctedAmount: '10'}))).toThrow('revision');
        expect(() => invoiceChangePayload('revise', 9, fields({correctedAmount: '10.123'}))).toThrow('two decimal places');
    });
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function actionFixture() {
    vi.useFakeTimers();
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {reload: vi.fn()}});
    vi.stubGlobal('location', window.location);
    vi.stubGlobal('document', {
        getElementById: () => null,
        createElement: element,
        createTextNode: (text: string) => { const node = element(); node.textContent = text; return node; },
    });
    const scope = element();
    const trigger = element();
    trigger.tagName = 'BUTTON';
    trigger.textContent = 'Save changes';
    const field = element();
    const initiallyDisabled = element();
    initiallyDisabled.disabled = true;
    const status = element();
    scope.matches['.pool-form-status'] = status;
    scope.querySelectorAll = () => [trigger, field, initiallyDisabled];
    return {scope, trigger, field, initiallyDisabled, status};
}

describe('invoice administrator action feedback', () => {
    it('locks duplicate actions immediately and keeps slow progress until confirmed, then expires only the result', async () => {
        const {scope, trigger, field, initiallyDisabled, status} = actionFixture();
        let finish!: (value: unknown) => void;
        const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const applied = vi.fn();
        const options = {scope: html(scope), trigger: html(trigger), pending: 'Saving changes…', success: 'Changes saved.', request, onSuccess: applied, subject: 'Payer name'};
        const pending = runInvoiceAdminAction(options);
        expect(trigger.disabled).toBe(true);
        expect(field.disabled).toBe(true);
        expect(trigger.textContent).toContain('Working');
        expect(status.attributes.get('role')).toBe('status');
        expect(status.textContent).toContain('Payer name:');
        expect(scope.attributes.get('aria-busy')).toBe('true');
        expect(await runInvoiceAdminAction(options)).toBe(false);
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(status.textContent).toContain('server has not confirmed');
        expect(applied).not.toHaveBeenCalled();
        finish({status: 'success'});
        expect(await pending).toBe(true);
        expect(applied).toHaveBeenCalledOnce();
        expect(status.textContent).toBe('Payer name: Changes saved.');
        expect(status.childNodes[0].role).toBe('alert');
        expect(status.childNodes[0].classList.add).toHaveBeenCalledWith('alert', 'alert-success', 'alert-dismissible', 'fade', 'show');
        expect(status.childNodes[0].focus).toHaveBeenCalledOnce();
        expect(status.scrollIntoView).toHaveBeenCalledWith(true);
        expect(trigger.disabled).toBe(false);
        expect(field.disabled).toBe(false);
        expect(initiallyDisabled.disabled).toBe(true);
        expect(scope.attributes.has('aria-busy')).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(status.textContent).toBe('');
        expect(status.attributes.has('role')).toBe(false);
    });

    it.each(['rejected', 'unconfirmed'])('does not apply financial UI state after a %s request', async outcome => {
        const {scope, trigger, status} = actionFixture();
        const applied = vi.fn();
        const request = outcome === 'rejected' ? async () => { throw new Error('Changes could not be saved'); }
            : async () => '<html>Login required</html>';
        expect(await runInvoiceAdminAction({scope: html(scope), trigger: html(trigger), pending: 'Saving…', success: 'Saved.', request, onSuccess: applied})).toBe(false);
        expect(applied).not.toHaveBeenCalled();
        expect(status.textContent).not.toBe('Saved.');
        expect(trigger.disabled).toBe(false);
        expect(scope.dataset.saving).toBeUndefined();
    });

    it.each(['network failure', 'server error', 'malformed response', 'unconfirmed response'])(
        'keeps an organizer expense locked after %s with a persistent ledger recovery action', async failure => {
            const {scope, trigger, field, status} = actionFixture();
            field.value = 'Receipt description';
            const fetchRequest = failure === 'network failure'
                ? vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
                : vi.fn().mockResolvedValue(failure === 'malformed response'
                    ? new Response('<html>Proxy response</html>', {status: 200})
                    : new Response(JSON.stringify({status: failure === 'server error' ? 'error' : 'unknown', message: 'Server response'}),
                        {status: failure === 'server error' ? 500 : 200}));
            vi.stubGlobal('fetch', fetchRequest);
            const payload = new FormData();
            payload.set('description', 'Receipt description');
            const options = {
                scope: html(scope), trigger: html(trigger), pending: 'Adding expense…', success: 'Added.',
                request: () => postOrganizerExpense('/expenses', payload), lockOnUncertainFailure: true,
            };

            expect(await runInvoiceAdminAction(options)).toBe(false);
            expect(trigger.disabled).toBe(true);
            expect(field.disabled).toBe(true);
            expect(field.value).toBe('Receipt description');
            expect(scope.dataset.saving).toBe('true');
            expect(scope.attributes.has('aria-busy')).toBe(false);
            expect(status.attributes.get('role')).toBe('status');
            expect(status.textContent).toContain('may already be in the pool');
            const recovery = status.childNodes[1];
            expect(recovery.textContent).toBe('Reload and check saved invoices');
            expect(recovery.disabled).toBe(false);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(status.childNodes[1]).toBe(recovery);
            expect(await runInvoiceAdminAction(options)).toBe(false);
            expect(fetchRequest).toHaveBeenCalledOnce();
            recovery.trigger('click');
            expect(window.location.reload).toHaveBeenCalledOnce();
        },
    );

    it('allows correction after a confirmed organizer API rejection and sends the new payload on retry', async () => {
        const {scope, trigger, field, status} = actionFixture();
        field.value = '0';
        const fetchRequest = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({status: 'error', message: 'Enter a positive amount'}), {status: 400}))
            .mockResolvedValueOnce(new Response(JSON.stringify({status: 'success', data: {id: 42}}), {status: 200}));
        vi.stubGlobal('fetch', fetchRequest);
        const options = {
            scope: html(scope), trigger: html(trigger), pending: 'Adding expense…', success: 'Added.',
            request: () => {
                const payload = new FormData();
                payload.set('amount', field.value);
                return postOrganizerExpense('/expenses', payload);
            }, lockOnUncertainFailure: true,
        };
        expect(await runInvoiceAdminAction(options)).toBe(false);
        expect(status.textContent).toBe('Enter a positive amount');
        expect(status.childNodes[0].role).toBe('alert');
        expect(field.value).toBe('0');
        expect(field.disabled).toBe(false);
        expect(trigger.disabled).toBe(false);
        expect(scope.dataset.saving).toBeUndefined();

        field.value = '25.50';
        expect(await runInvoiceAdminAction(options)).toBe(true);
        expect(status.textContent).toBe('Added.');
        expect(fetchRequest).toHaveBeenCalledTimes(2);
        const request = fetchRequest.mock.calls[1][1] as RequestInit;
        expect(request.method).toBe('POST');
        expect(request.credentials).toBe('same-origin');
        expect(request.headers).toEqual({'X-Requested-With': 'XMLHttpRequest'});
        expect((request.body as FormData).get('amount')).toBe('25.50');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(status.textContent).toBe('');
    });

    it('places page confirmations in the shared alerts and shows pending feedback beside a payment switch', async () => {
        const {scope, trigger, status} = actionFixture();
        const liveAlerts = element();
        vi.stubGlobal('document', {
            ...document,
            getElementById: () => liveAlerts,
        });
        trigger.tagName = 'INPUT';
        trigger.parentElement = element();
        let finish!: (value: unknown) => void;
        const pending = runInvoiceAdminAction({scope: html(scope), trigger: html(trigger), pending: 'Recording settlement…',
            success: 'Marked as paid.', request: () => new Promise(resolve => { finish = resolve; })});
        expect(trigger.parentElement.childNodes[0].attributes.get('aria-label')).toBe('Recording settlement…');
        finish({status: 'success'});
        await pending;
        expect(trigger.parentElement.childNodes).toHaveLength(0);
        expect(status.textContent).toBe('');
        expect(liveAlerts.textContent).toBe('Marked as paid.');
        expect(liveAlerts.childNodes[0].role).toBe('alert');
        expect(liveAlerts.scrollIntoView).toHaveBeenCalledWith(true);
    });

    it('retains a confirmed result for the page reload and waits long enough to read its immediate feedback', async () => {
        const {scope, trigger} = actionFixture();
        vi.stubGlobal('window', {...window, Surveyor: {eventId: 'event-1'}});
        const setItem = vi.fn();
        vi.stubGlobal('sessionStorage', {setItem});
        await runInvoiceAdminAction({scope: html(scope), trigger: html(trigger), pending: 'Saving…', success: 'Takeovers saved.',
            request: async () => ({status: 'success'}), reload: true, reloadPool: 'pool-1'});
        expect(setItem).toHaveBeenCalledWith('surveyor:invoice-feedback:event-1', 'Takeovers saved.');
        expect(window.location.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(window.location.reload).toHaveBeenCalledOnce();
    });
});

describe('persisted share list', () => {
    it('restores switches from server payment data instead of browser-restored checked values', () => {
        const input = element();
        input.dataset = {paid: 'false'};
        input.checked = true;
        input.defaultChecked = true;
        const row = element();
        row.dataset = {shareAmount: '25', shareStatus: 'settled'};
        row.matches['[data-share-state]'] = element();
        row.matches['[data-share-balance-note]'] = element();
        input.closest = () => row;
        vi.stubGlobal('document', {querySelectorAll: () => [input]});
        restoreInvoicePaidState();
        expect(input.checked).toBe(false);
        expect(input.defaultChecked).toBe(false);
        expect(row.dataset.shareStatus).toBe('due');
        expect(row.matches['[data-share-state]'].textContent).toBe('Due');
        row.dataset.shareAmount = '-5';
        restoreInvoicePaidState();
        expect(row.dataset.shareStatus).toBe('refund');
        input.dataset.paid = 'true';
        restoreInvoicePaidState();
        expect(row.dataset.shareStatus).toBe('settled');
        expect(input.checked).toBe(true);
    });

    it('combines search, status, amount sorting and paging without dropping hidden shares', () => {
        vi.useFakeTimers();
        const ledger = element();
        const body = element();
        const rows = Array.from({length: 28}, (_, index) => {
            const row = element();
            row.dataset = {shareName: `Payer ${String(index + 1).padStart(2, '0')}`, shareSearch: `payer ${index + 1} ${index === 0 ? 'train refund' : 'food'}`,
                shareAmount: String(index === 0 ? -10 : index + 1), shareStatus: index === 0 ? 'refund' : index === 27 ? 'settled' : 'due'};
            return row;
        });
        const selectors = ['input[data-share-search]', '[data-share-filter]', '[data-share-sort]', '[data-share-page-size]',
            '[data-share-previous]', '[data-share-next]', '[data-share-page-summary]', '[data-share-empty]', '[data-share-refresh]'];
        selectors.forEach(selector => ledger.matches[selector] = element());
        ledger.matches['[data-share-body]'] = body;
        ledger.matches['.pool-form-status'] = element();
        ledger.matches['[data-share-page-size]'].value = '25';
        ledger.querySelectorAll = () => rows;
        vi.stubGlobal('document', {querySelectorAll: () => [ledger], getElementById: () => null, createElement: element});
        initShareLedgers();
        const visible = () => body.childNodes.filter(row => !row.hidden);
        expect(visible()).toHaveLength(25);
        expect(ledger.matches['[data-share-page-summary]'].textContent).toBe('1–25 of 28 shares');
        ledger.matches['[data-share-next]'].trigger('click');
        expect(visible()).toHaveLength(3);
        const sort = ledger.matches['[data-share-sort]'];
        sort.value = 'amount-desc'; sort.trigger('change');
        expect(visible()[0].dataset.shareAmount).toBe('28');
        const filter = ledger.matches['[data-share-filter]'];
        filter.value = 'refund'; filter.trigger('change');
        expect(visible()).toEqual([rows[0]]);
        const search = ledger.matches['input[data-share-search]'];
        search.value = 'no match'; search.trigger('input');
        expect(visible()).toHaveLength(0);
        expect(ledger.matches['[data-share-empty]'].hidden).toBe(false);
        search.value = 'TRAIN'; search.trigger('input');
        expect(visible()).toEqual([rows[0]]);
        rows[0].dataset.shareStatus = 'settled'; ledger.trigger('share-state-updated');
        expect(visible()).toEqual([rows[0]]);
        ledger.matches['[data-share-refresh]'].trigger('click');
        expect(visible()).toHaveLength(0);
        expect(body.childNodes).toHaveLength(28);
        const feedback = ledger.matches['.pool-form-status'];
        expect(feedback.textContent).toContain('List refreshed. 0–0 of 0 shares');
        expect(feedback.scrollIntoView).toHaveBeenCalledWith(true);
        const firstAlert = feedback.childNodes[0];
        ledger.matches['[data-share-refresh]'].trigger('click');
        expect(feedback.textContent).toContain('List refreshed. 0–0 of 0 shares');
        expect(feedback.childNodes[0]).not.toBe(firstAlert);
    });
});
