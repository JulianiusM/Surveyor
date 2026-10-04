import {afterEach, describe, expect, it, vi} from 'vitest';
import {initInvoiceAdmin, initInvoiceCommandConfirmation, initShareLedgers, invoiceChangePayload, postOrganizerExpense, protectInvoiceNumberFromScroll, requestInvoiceConfirmation, restoreInvoicePaidState, runInvoiceAdminAction} from '../../src/public/js/events';
import {invoiceLabels} from '../../src/modules/invoice/wording';
import {invoicePresentation} from '../../src/modules/invoice/presentation';

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
    append(...children: ElementStub[]) {
        for (const child of children) {
            this.childNodes = this.childNodes.filter(existing => existing !== child);
            this.childNodes.push(child);
            child.parentElement = this;
        }
    }
    appendChild(child: ElementStub) { this.append(child); return child; }
    remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    removeEventListener(name: string, listener: () => void) {
        if (this.listeners.get(name) === listener) this.listeners.delete(name);
    }
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

/** Bind the real delegated click handler with an explicit modal and HTTP boundary, without a browser or database. */
function notificationFixture(action: 'notify' | 'rollback' = 'notify') {
    const {scope: modal, trigger, status} = actionFixture();
    const clicks: ((event: Event) => Promise<void>)[] = [];
    trigger.dataset.id = 'pool-1';
    Object.assign(trigger.classList, {contains: (name: string) => name === `pool-${action}`});
    trigger.closest = selector => selector === 'button' ? trigger : selector === '.modal' ? modal : null;
    modal.closest = selector => selector === '.modal' ? modal : null;
    const hide = vi.fn(function hideNotificationModal() {
        // Bootstrap would reject dismissal while the shared request guard is still installed.
        expect(modal.listeners.has('hide.bs.modal')).toBe(false);
        modal.hidden = true;
    });
    const getOrCreateInstance = vi.fn(() => ({hide}));
    vi.stubGlobal('window', {...window, addEventListener: vi.fn(),
        Surveyor: {eventId: 'event-1', permissions: {entity: {has: () => true}}},
        bootstrap: {Modal: {getOrCreateInstance}},
    });
    vi.stubGlobal('document', {...document, querySelectorAll: () => [],
        addEventListener(name: string, listener: (event: Event) => Promise<void>) {
            if (name === 'click') clicks.push(listener);
        },
    });
    // The production initializer owns command selection and permission checks; tests never call a private submit helper.
    initInvoiceAdmin();
    /** Dispatch the selected button through each production document click listener and await its completion. */
    async function clickNotification(): Promise<void> {
        const event = {target: trigger} as unknown as Event;
        for (const listener of clicks) await listener(event);
    }
    return {modal, trigger, status, hide, getOrCreateInstance, click: clickNotification};
}

describe('settlement email modal completion', () => {
    it('closes only after the send is confirmed and the pending dismissal guard is released', async () => {
        const {modal, trigger, status, hide, getOrCreateInstance, click} = notificationFixture();
        let finish!: (response: Response) => void;
        const request = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
        vi.stubGlobal('fetch', request);
        const pending = click();
        expect(trigger.disabled).toBe(true);
        expect(modal.listeners.has('hide.bs.modal')).toBe(true);
        expect(modal.hidden).toBe(false);
        expect(hide).not.toHaveBeenCalled();
        // A slow response retains the modal and progress rather than treating elapsed time as success.
        await vi.advanceTimersByTimeAsync(6000);
        expect(status.textContent).toContain('server has not confirmed');
        expect(hide).not.toHaveBeenCalled();
        finish(new Response(JSON.stringify({status: 'success', message: 'Settlement emails requested.'}),
            {status: 200, headers: {'Content-Type': 'application/json'}}));
        await pending;
        expect(request).toHaveBeenCalledWith('/api/event/event-1/invoice-pools/pool-1/notify', expect.objectContaining({method: 'POST'}));
        expect(getOrCreateInstance).toHaveBeenCalledWith(modal);
        expect(hide).toHaveBeenCalledOnce();
        expect(modal.hidden).toBe(true);
        expect(status.textContent).toBe('Settlement emails requested.');
        // Closing still locks duplicate clicks; a subsequent explicit opening can request another update.
        expect(trigger.disabled).toBe(true);
        modal.trigger('hidden.bs.modal');
        expect(trigger.disabled).toBe(false);
    });

    it.each(['rejected', 'network failure', 'unconfirmed response'])('retains the dialog and feedback after %s', async outcome => {
        const {modal, trigger, status, hide, click} = notificationFixture();
        const request = outcome === 'network failure'
            ? vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
            : vi.fn().mockResolvedValue(new Response(JSON.stringify(outcome === 'rejected'
                ? {status: 'error', message: 'Emails could not be requested.'} : {status: 'unknown'}),
                {status: outcome === 'rejected' ? 500 : 200, headers: {'Content-Type': 'application/json'}}));
        vi.stubGlobal('fetch', request);
        await click();
        expect(hide).not.toHaveBeenCalled();
        expect(modal.hidden).toBe(false);
        expect(status.textContent).not.toBe('');
        expect(status.childNodes[0].classList.add).toHaveBeenCalledWith('alert', 'alert-danger', 'alert-dismissible', 'fade', 'show');
        expect(trigger.disabled).toBe(false);
        expect(modal.dataset.saving).toBeUndefined();
    });

    it('keeps a successful rollback result visible for its separate return workflow', async () => {
        const {modal, status, hide, click} = notificationFixture('rollback');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({status: 'success', message: 'Pool changes restored.'}),
            {status: 200, headers: {'Content-Type': 'application/json'}})));
        await click();
        expect(hide).not.toHaveBeenCalled();
        expect(modal.hidden).toBe(false);
        expect(status.textContent).toBe('Pool changes restored.');
        expect(modal.listeners.has('hidden.bs.modal')).toBe(true);
    });
});

describe('persisted share list', () => {
    it('restores the saved balance and action while keeping the saved-detail status synchronized', () => {
        const button = element();
        button.dataset = {paid: 'false', amount: '25'};
        const row = element();
        row.dataset = {shareAmount: '25', shareStatus: 'settled'};
        row.matches['[data-share-state]'] = element();
        row.matches['[data-share-balance]'] = element();
        row.matches['[data-share-balance-note]'] = element();
        const details = element();
        details.matches['[data-share-details-status]'] = element();
        row.matches['template[data-share-details]'] = Object.assign(element(), {content: details});
        row.matches['.share-settlement'] = button;
        button.closest = () => row;
        vi.stubGlobal('document', {
            querySelectorAll: () => [button],
            getElementById: () => ({textContent: JSON.stringify(invoiceLabels)}),
        });
        restoreInvoicePaidState();
        expect(row.dataset.shareStatus).toBe('due');
        expect(row.matches['[data-share-state]'].textContent).toBe('Payment due');
        expect(row.matches['[data-share-balance-note]'].textContent).toBe('Amount to collect');
        expect(details.matches['[data-share-details-status]'].textContent).toBe('Payment due');
        expect(button.textContent).toBe('Record payment');
        button.dataset.amount = '-5';
        restoreInvoicePaidState();
        expect(row.dataset.shareStatus).toBe('refund');
        expect(row.matches['[data-share-balance]'].textContent).toBe('-5.00');
        expect(row.matches['[data-share-balance-note]'].textContent).toBe('Amount to pay out');
        button.dataset.paid = 'true';
        restoreInvoicePaidState();
        expect(row.dataset.shareStatus).toBe('settled');
        expect(row.matches['[data-share-balance]'].textContent).toBe('-5.00');
        expect(row.matches['[data-share-state]'].textContent).toBe('Refunded');
        expect(row.matches['[data-share-balance-note]'].textContent).toBe('Already settled');
        expect(details.matches['[data-share-details-status]'].textContent).toBe('Refunded');
        expect(button.dataset.amount).toBe('-5');
        expect(button.textContent).toBe('Undo refund');
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

    it('renders only the selected personal row in one reusable dialog using text nodes', () => {
        const ledger = element();
        const row = element();
        const button = element();
        const modal = element();
        const content = element();
        const heading = element();
        const saved = {registrationId: 1, payerName: '<img src=x onerror=alert(1)>',
            baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 0, shareAmount: 75};
        const payload = {components: invoicePresentation.components(saved),
            calculation: invoicePresentation.payerCalculation(undefined, saved),
            notes: ['<script>alert(1)</script>'], statusLabel: 'Payment due'};
        row.dataset = {shareName: 'Travel pool', shareAmount: '75', shareStatus: 'due', shareBreakdown: JSON.stringify(payload)};
        button.dataset.bsTarget = '#personal-breakdown';
        button.closest = selector => selector === '.share-details-open' ? button : row;
        ledger.querySelectorAll = () => [row];
        modal.matches['[data-share-details-content]'] = content;
        modal.matches['[data-share-details-payer]'] = heading;
        vi.stubGlobal('document', {querySelectorAll: () => [ledger], querySelector: () => modal,
            createElement: element, getElementById: () => null});
        initShareLedgers();
        expect(content.childNodes).toHaveLength(0);
        const open = ledger.listeners.get('click') as unknown as (event: Event) => void;
        open({target: button} as unknown as Event);
        expect(heading.textContent).toBe('Travel pool');
        expect(content.textContent).toContain(saved.payerName);
        expect(content.textContent).toContain('<script>alert(1)</script>');
        expect(content.textContent).toContain('Calculated balance');
        expect(content.textContent).toContain('75.00');
        expect(row.querySelector('template[data-share-details]')).toBeNull();

        // A second selection replaces the dialog's complete presentation instead of retaining the previous payer's notes.
        const next = {...saved, payerName: 'Second payer', invoiceCreditAmount: 100, shareAmount: -25};
        row.dataset.shareName = 'Rail pool';
        row.dataset.shareBreakdown = JSON.stringify({components: invoicePresentation.components(next),
            calculation: invoicePresentation.payerCalculation(undefined, next), notes: [], statusLabel: 'Refund due'});
        open({target: button} as unknown as Event);
        expect(heading.textContent).toBe('Rail pool');
        expect(content.textContent).toContain('Second payer');
        expect(content.textContent).toContain('-25.00');
        expect(content.textContent).not.toContain('onerror');
        expect(content.textContent).not.toContain('<script>');
    });

    it('reveals the first recorded payment, hides it after undo, and retains negative recorded refunds and saved rounding', () => {
        const pool = element();
        const group = element();
        const values = element();
        group.hidden = true;
        group.dataset.poolSavedRounding = 'null';
        group.matches['[data-pool-saved-settlement-values]'] = values;
        pool.matches['[data-pool-saved-settlement]'] = group;
        const row = element();
        const button = element();
        const saved = {registrationId: 1, baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: 0, shareAmount: 75, isPaid: false};
        row.dataset.shareFinancial = JSON.stringify(saved);
        row.matches['.share-settlement'] = button;
        button.dataset = {paid: 'false', amount: '75'};
        button.closest = selector => selector === '.invoice-pool' ? pool : row;
        pool.querySelectorAll = () => [row];
        vi.stubGlobal('document', {querySelectorAll: () => [button], createElement: element,
            getElementById: () => ({textContent: JSON.stringify(invoiceLabels)})});
        restoreInvoicePaidState();
        expect(group.hidden).toBe(true);
        button.dataset.paid = 'true';
        restoreInvoicePaidState();
        expect(group.hidden).toBe(false);
        expect(values.textContent).toBe('Payments received75.00');
        button.dataset.paid = 'false';
        restoreInvoicePaidState();
        expect(group.hidden).toBe(true);
        expect(values.textContent).toBe('');

        // Refunds keep their signed amount; recording their transfer does not change the original saved allocation evidence.
        row.dataset.shareFinancial = JSON.stringify({...saved, shareAmount: -25});
        button.dataset = {paid: 'true', amount: '-25'};
        group.dataset.poolSavedRounding = JSON.stringify({key: 'roundingDifference', label: 'Rounding difference', amount: 0.01});
        restoreInvoicePaidState();
        expect(values.textContent).toBe('Refunds paid-25.00Rounding difference0.01');
        button.dataset.paid = 'false';
        restoreInvoicePaidState();
        expect(values.textContent).toBe('Rounding difference0.01');
        expect(group.hidden).toBe(false);
    });
});

// Real EventTarget ordering protects the modal hand-off: shown/hidden listeners from both the
// shared dialog helper and the confirmation gate must run, including their one-time listeners.
class ConfirmationElement extends EventTarget {
    dataset: Record<string, string> = {};
    textContent = '';
    disabled = false;
    isConnected = true;
    transitioning = false;
    source: ConfirmationElement | null = null;
    matches: Record<string, ConfirmationElement> = {};
    classes = new Set<string>();
    classList = {contains: (name: string) => this.classes.has(name)};
    focus = vi.fn();
    querySelector(selector: string) { return this.matches[selector] || null; }
    closest(selector: string) { return selector === '.modal' ? this.source : this.matches[selector] || null; }
}

function confirmationFixture({deferShown = false, deferHidden = false} = {}) {
    const modal = new ConfirmationElement();
    const subject = new ConfirmationElement();
    const description = new ConfirmationElement();
    const cancel = new ConfirmationElement();
    const confirm = new ConfirmationElement();
    const opener = new ConfirmationElement();
    modal.matches = {
        '[data-invoice-command-subject]': subject, '[data-invoice-command-description]': description,
        '[data-invoice-command-cancel]': cancel, '[data-invoice-command-confirm]': confirm,
    };
    confirm.matches['[data-invoice-command-confirm]'] = confirm;
    /** Complete an explicit transition so tests can exercise clicks before Bootstrap is ready. */
    function finishShowing(node = modal): void {
        node.transitioning = false;
        node.dispatchEvent(new Event('shown.bs.modal'));
    }
    /** Close the gate only when Bootstrap finishes hiding the modal. */
    function finishHiding(node = modal): void {
        node.transitioning = false;
        node.dispatchEvent(new Event('hidden.bs.modal'));
    }
    function getOrCreateInstance(node: ConfirmationElement) {
        return {
            show() {
                if (node.transitioning || node.classes.has('show')) return;
                node.classes.add('show');
                node.transitioning = true;
                if (!deferShown) finishShowing(node);
            },
            hide() {
                // Bootstrap silently ignores hide during its opening animation; an early acknowledgement must not stick.
                if (node.transitioning || !node.classes.has('show')) return;
                node.classes.delete('show');
                node.transitioning = true;
                if (!deferHidden) finishHiding(node);
            },
        };
    }
    vi.stubGlobal('window', {bootstrap: {Modal: {getOrCreateInstance}}});
    vi.stubGlobal('document', {getElementById: () => modal});
    initInvoiceCommandConfirmation();
    return {modal, subject, description, cancel, confirm, opener, getOrCreateInstance, finishShowing, finishHiding};
}

describe('invoice state confirmation', () => {
    it('defaults dismissal to cancellation and restores focus without authorizing a request', async () => {
        const {modal, cancel, opener, getOrCreateInstance} = confirmationFixture();
        const review = requestInvoiceConfirmation('Payer', 'Calculated balance: -25.00.', 'Record payment', opener as unknown as HTMLButtonElement);
        expect(cancel.focus).toHaveBeenCalled();
        getOrCreateInstance(modal).hide();
        expect(await review).toBe(false);
        expect(opener.focus).toHaveBeenCalled();
    });

    it('requires the explicit action and restores the source dialog with its draft intact', async () => {
        const {modal, subject, description, confirm, opener} = confirmationFixture();
        const source = new ConfirmationElement();
        source.classes.add('show');
        source.dataset.draft = '25.50';
        opener.source = source;
        const review = requestInvoiceConfirmation('Invoice #12', 'Close accepted invoice: 25.50.', 'Close', opener as unknown as HTMLButtonElement);
        expect(source.classes.has('show')).toBe(false);
        expect(subject.textContent).toBe('Invoice #12');
        expect(description.textContent).toContain('25.50');
        expect(await requestInvoiceConfirmation('Duplicate', '', '', opener as unknown as HTMLButtonElement)).toBe(false);
        const click = new Event('click');
        Object.defineProperty(click, 'target', {value: confirm});
        modal.dispatchEvent(click);
        expect(await review).toBe(true);
        expect(source.classes.has('show')).toBe(true);
        expect(source.dataset.draft).toBe('25.50');
        expect(opener.focus).toHaveBeenCalled();
    });

    it('keeps acknowledgement disabled until the review is fully shown and resolves only after it closes', async () => {
        const {modal, cancel, confirm, opener, finishShowing, finishHiding} = confirmationFixture({deferShown: true, deferHidden: true});
        const review = requestInvoiceConfirmation('Payer', 'Calculated balance: 60.00.', 'Record payment', opener as unknown as HTMLButtonElement);
        let decision: boolean | undefined;
        void review.then(result => { decision = result; });
        expect(confirm.disabled).toBe(true);
        expect(cancel.focus).not.toHaveBeenCalled();
        const click = new Event('click');
        Object.defineProperty(click, 'target', {value: confirm});
        modal.dispatchEvent(click);
        await Promise.resolve();
        expect(modal.classes.has('show')).toBe(true);
        expect(decision).toBeUndefined();

        finishShowing();
        expect(confirm.disabled).toBe(false);
        expect(cancel.focus).toHaveBeenCalledOnce();
        modal.dispatchEvent(click);
        expect(confirm.disabled).toBe(true);
        expect(modal.classes.has('show')).toBe(false);
        // Repeated acknowledgements and an unfinished closing animation cannot release the caller's request.
        modal.dispatchEvent(click);
        await Promise.resolve();
        expect(decision).toBeUndefined();
        finishHiding();
        expect(await review).toBe(true);
        expect(opener.focus).toHaveBeenCalled();
    });

    it('keeps a transition-time click cancelled when the ready review is dismissed', async () => {
        const {modal, confirm, opener, getOrCreateInstance, finishShowing} = confirmationFixture({deferShown: true});
        const review = requestInvoiceConfirmation('Payer', 'Calculated balance: 60.00.', 'Record payment', opener as unknown as HTMLButtonElement);
        const click = new Event('click');
        Object.defineProperty(click, 'target', {value: confirm});
        modal.dispatchEvent(click);
        finishShowing();
        getOrCreateInstance(modal).hide();
        expect(await review).toBe(false);
        expect(opener.focus).toHaveBeenCalled();
    });

    it('prevents native wheel stepping in focused invoice number fields without cancelling page scrolling', () => {
        class NumberField {
            type = 'number';
            value = '25.50';
            blur = vi.fn();
            closest = vi.fn(() => ({}));
        }
        const input = new NumberField();
        const preventDefault = vi.fn();
        vi.stubGlobal('HTMLInputElement', NumberField);
        vi.stubGlobal('document', {activeElement: input});
        protectInvoiceNumberFromScroll({target: input, preventDefault} as unknown as WheelEvent);
        expect(input.blur).toHaveBeenCalledOnce();
        expect(input.value).toBe('25.50');
        expect(preventDefault).not.toHaveBeenCalled();
        input.closest.mockReturnValue(null as unknown as object);
        input.blur.mockClear();
        protectInvoiceNumberFromScroll({target: input} as unknown as WheelEvent);
        expect(input.blur).not.toHaveBeenCalled();
    });
});
