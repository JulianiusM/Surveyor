import {describe, expect, it} from 'vitest';
import {initTakeoverOverviews} from '../../src/public/js/modules/invoice-takeovers';

class ElementStub extends EventTarget {
    dataset: Record<string, string> = {};
    hidden = false;
    disabled = false;
    value = '';
    textContent = '';
    scrollTop = 0;
    attributes = new Map<string, string>();
    selectors = new Map<string, ElementStub[]>();
    querySelector(selector: string) { return this.selectors.get(selector)?.[0] ?? null; }
    querySelectorAll(selector: string) { return this.selectors.get(selector) ?? []; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    scrollIntoView() {}
    add(selector: string, ...elements: ElementStub[]) { this.selectors.set(selector, elements); return elements[0]; }
    trigger(type: string) { this.dispatchEvent(new Event(type)); }
}

function fixture(payerCount = 12, beneficiaryCount = 2) {
    const root = new ElementStub();
    const overview = root.add('[data-takeover-overview]', new ElementStub());
    const search = overview.add('[data-takeover-overview-search]', new ElementStub());
    const size = overview.add('[data-takeover-page-size]', new ElementStub());
    size.value = '10';
    const previous = overview.add('[data-takeover-previous]', new ElementStub());
    const next = overview.add('[data-takeover-next]', new ElementStub());
    const summary = overview.add('[data-takeover-page-summary]', new ElementStub());
    const empty = overview.add('[data-takeover-empty]', new ElementStub());
    const rows = Array.from({length: payerCount}, (_, payerIndex) => {
        const element = new ElementStub();
        element.dataset.payerName = `Payer ${payerIndex + 1}`;
        const chips = Array.from({length: beneficiaryCount}, (_, index) => {
            const chip = new ElementStub();
            chip.dataset.beneficiaryName = `Guest ${payerIndex + 1}-${String(index + 1).padStart(3, '0')}`;
            return chip;
        });
        element.dataset.searchText = `${element.dataset.payerName} ${chips.map(chip => chip.dataset.beneficiaryName).join(' ')}`.toLowerCase();
        element.add('[data-takeover-beneficiary]', ...chips);
        const list = element.add('[data-takeover-beneficiaries]', new ElementStub());
        const controls = element.add('[data-takeover-beneficiary-controls]', new ElementStub());
        const summary = element.add('[data-takeover-beneficiary-summary]', new ElementStub());
        const expand = element.add('[data-takeover-expand]', new ElementStub());
        return {element, chips, list, controls, summary, expand};
    });
    overview.add('[data-takeover-overview-row]', ...rows.map(row => row.element));
    initTakeoverOverviews(root as unknown as HTMLElement);
    return {root, search, size, previous, next, summary, empty, rows};
}

describe('takeover overview', () => {
    it('pages by payer, resets the page after filtering and handles empty results', () => {
        const view = fixture();
        expect(view.rows.filter(row => !row.element.hidden)).toHaveLength(10);
        expect(view.summary.textContent).toBe('1–10 of 12 payers');
        expect(view.previous.disabled).toBe(true);
        view.next.trigger('click');
        expect(view.rows.filter(row => !row.element.hidden)).toHaveLength(2);
        expect(view.summary.textContent).toBe('11–12 of 12 payers');
        expect(view.next.disabled).toBe(true);
        view.search.value = 'Payer 4';
        view.search.trigger('input');
        expect(view.rows[3].element.hidden).toBe(false);
        expect(view.summary.textContent).toBe('1–1 of 1 payer matching “Payer 4”');
        expect(view.previous.disabled).toBe(true);
        view.search.value = 'Not assigned';
        view.search.trigger('input');
        expect(view.empty.hidden).toBe(false);
        expect(view.rows.every(row => row.element.hidden)).toBe(true);
        expect(view.summary.textContent).toBe('0 payers');
        expect(view.next.disabled).toBe(true);
    });

    it('expands many beneficiaries and finds someone outside the collapsed preview', () => {
        const view = fixture(1, 100);
        const row = view.rows[0];
        expect(row.chips.filter(chip => !chip.hidden)).toHaveLength(6);
        expect(row.expand.textContent).toBe('Show all 100');
        row.expand.trigger('click');
        expect(row.chips.every(chip => !chip.hidden)).toBe(true);
        expect(row.expand.textContent).toBe('Show fewer');
        expect(row.expand.attributes.get('aria-expanded')).toBe('true');
        row.list.scrollTop = 200;
        row.expand.trigger('click');
        expect(row.list.scrollTop).toBe(0);
        expect(row.chips.filter(chip => !chip.hidden)).toHaveLength(6);
        view.search.value = '  gUeSt 1-099  ';
        view.search.trigger('input');
        expect(row.chips[98].hidden).toBe(false);
        expect(row.chips.filter(chip => !chip.hidden)).toHaveLength(1);
        expect(row.summary.textContent).toBe('1 of 1 matching participant');
        expect(row.expand.hidden).toBe(true);
        view.search.value = '';
        view.search.trigger('input');
        expect(row.chips.filter(chip => !chip.hidden)).toHaveLength(6);
        expect(row.expand.attributes.get('aria-expanded')).toBe('false');
    });

    it('resizes pages without losing payers or installing duplicate expansion handlers', () => {
        const view = fixture(30, 8);
        view.next.trigger('click');
        view.size.value = '25';
        view.size.trigger('change');
        expect(view.summary.textContent).toBe('1–25 of 30 payers');
        expect(view.rows.filter(row => !row.element.hidden)).toHaveLength(25);
        initTakeoverOverviews(view.root as unknown as HTMLElement);
        view.rows[0].expand.trigger('click');
        expect(view.rows[0].chips.filter(chip => !chip.hidden)).toHaveLength(8);
        expect(view.rows[0].expand.attributes.get('aria-expanded')).toBe('true');
    });
});
