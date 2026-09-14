import {afterEach, describe, expect, it, vi} from 'vitest';
import {initShareLedgers, restoreInvoicePaidState, runInvoiceAdminAction} from '../../src/public/js/events';

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
    matches: Record<string, ElementStub> = {};
    listeners = new Map<string, () => void>();
    get textContent(): string { return this.text + this.childNodes.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.text = value; this.childNodes = []; }
    querySelector(selector: string) { return this.matches[selector] || null; }
    querySelectorAll(_selector: string): ElementStub[] { return []; }
    closest(_selector: string): ElementStub | null { return null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    replaceChildren(...children: ElementStub[]) { this.text = ''; this.childNodes = children; }
    append(child: ElementStub) { this.childNodes = this.childNodes.filter(existing => existing !== child); this.childNodes.push(child); }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    trigger(name: string) { this.listeners.get(name)?.(); }
}

const element = () => new ElementStub();
const html = (node: ElementStub) => node as unknown as HTMLElement;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function actionFixture() {
    vi.useFakeTimers();
    vi.stubGlobal('window', {setTimeout, clearTimeout});
    vi.stubGlobal('document', {
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
        const options = {scope: html(scope), trigger: html(trigger), pending: 'Saving changes…', success: 'Changes saved.', request, onSuccess: applied};
        const pending = runInvoiceAdminAction(options);
        expect(trigger.disabled).toBe(true);
        expect(field.disabled).toBe(true);
        expect(trigger.textContent).toContain('Working');
        expect(status.attributes.get('role')).toBe('status');
        expect(scope.attributes.get('aria-busy')).toBe('true');
        expect(await runInvoiceAdminAction(options)).toBe(false);
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(status.textContent).toContain('server has not confirmed');
        expect(applied).not.toHaveBeenCalled();
        finish({status: 'success'});
        expect(await pending).toBe(true);
        expect(applied).toHaveBeenCalledOnce();
        expect(status.textContent).toBe('Changes saved.');
        expect(status.attributes.get('role')).toBe('alert');
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
        const ledger = element();
        const body = element();
        const rows = Array.from({length: 28}, (_, index) => {
            const row = element();
            row.dataset = {shareName: `Payer ${String(index + 1).padStart(2, '0')}`, shareSearch: `payer ${index + 1} ${index === 0 ? 'train refund' : 'food'}`,
                shareAmount: String(index === 0 ? -10 : index + 1), shareStatus: index === 0 ? 'refund' : index === 27 ? 'settled' : 'due'};
            return row;
        });
        const selectors = ['input[data-share-search]', '[data-share-filter]', '[data-share-sort]', '[data-share-page-size]',
            '[data-share-previous]', '[data-share-next]', '[data-share-page-summary]', '[data-share-empty]'];
        selectors.forEach(selector => ledger.matches[selector] = element());
        ledger.matches['[data-share-body]'] = body;
        ledger.matches['[data-share-page-size]'].value = '25';
        ledger.querySelectorAll = () => rows;
        vi.stubGlobal('document', {querySelectorAll: () => [ledger]});
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
        expect(visible()).toHaveLength(0);
        expect(body.childNodes).toHaveLength(28);
    });
});
