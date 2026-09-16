import {afterEach, describe, expect, it, vi} from 'vitest';
import {initEntityOverview} from '../../src/public/js/modules/entity-cards-overview';

// The production filter needs DOM selection, attributes, classes, and real event dispatch but no layout.
// Model just those operations here; viewport placement and Bootstrap collapse belong to the E2E test.
class ElementStub extends EventTarget {
    dataset: Record<string, string> = {};
    value = '';
    textContent = '';
    hidden = false;
    classes = new Set<string>();
    classList = {toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    parentElement?: ElementStub;
    attributes = new Map<string, string>();
    selectors = new Map<string, ElementStub[]>();
    querySelector(selector: string) { return this.selectors.get(selector)?.[0] ?? null; }
    querySelectorAll(selector: string) { return this.selectors.get(selector) ?? []; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    add(selector: string, ...elements: ElementStub[]) { this.selectors.set(selector, elements); return elements[0]; }
    trigger(type: string) { this.dispatchEvent(new Event(type)); }
}

function section(values: [string, string, string][]) {
    // Match the mixin's per-region selector contract. Each tuple describes title, type, and description;
    // distinct controls below ensure accidental collection-wide queries fail the independence assertions.
    const element = new ElementStub();
    const search = element.add('.js-search', new ElementStub());
    const count = element.add('.js-count', new ElementStub());
    const empty = element.add('.js-no-matches', new ElementStub());
    const types = ['all', 'event', 'packing'].map(type => {
        const button = new ElementStub();
        button.dataset.type = type;
        return button;
    });
    element.add('.js-filter-type [data-type]', ...types);
    const cards = values.map(([title, type, description]) => {
        const card = new ElementStub();
        card.dataset = {title, type, description};
        // The card's parent represents Bootstrap's grid column, which must disappear with a filtered card.
        card.parentElement = new ElementStub();
        return card;
    });
    element.add('.js-item', ...cards);
    return {element, search, count, empty, types, cards};
}

afterEach(() => vi.unstubAllGlobals());

describe('entity overview filtering', () => {
    it('keeps the main and archived section filters, counts and empty states independent', () => {
        const main = section([['Camp', 'event', 'September'], ['Supplies', 'packing', 'Camp']]);
        const archived = section([['Previous camp', 'event', 'August'], ['Older supplies', 'packing', 'Tents']]);
        const root = new ElementStub();
        root.add('.js-entity-section', main.element, archived.element);
        vi.stubGlobal('document', {querySelector: () => root});
        initEntityOverview('#entityLists');
        expect(main.count.textContent).toBe('2');
        expect(archived.count.textContent).toBe('2');
        expect(main.empty.hidden).toBe(true);

        // Trimming and description search narrow only the archived region; the main region is untouched.
        archived.search.value = ' tents ';
        archived.search.trigger('input');
        expect(archived.count.textContent).toBe('1');
        expect(archived.cards[0].parentElement!.classes.has('d-none')).toBe(true);
        expect(archived.cards[1].parentElement!.classes.has('d-none')).toBe(false);
        expect(main.count.textContent).toBe('2');
        expect(main.cards.every(card => !card.parentElement!.classes.has('d-none'))).toBe(true);

        // Type and text predicates combine. A selected type with no text matches needs an accessible
        // pressed state and the region's no-match notice, without changing the other region's count.
        archived.types[1].trigger('click');
        expect(archived.count.textContent).toBe('0');
        expect(archived.empty.hidden).toBe(false);
        expect(archived.types[1].attributes.get('aria-pressed')).toBe('true');
        expect(archived.types[0].attributes.get('aria-pressed')).toBe('false');

        // Clearing search preserves the selected type, demonstrating that controls share regional state.
        archived.search.value = '';
        archived.search.trigger('input');
        expect(archived.count.textContent).toBe('1');
        expect(archived.empty.hidden).toBe(true);
        expect(main.count.textContent).toBe('2');
    });
});
