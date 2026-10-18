import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {initEntitySelect} from '../../src/public/js/modules/entity-select';
import {initTimezoneSelect} from '../../src/public/js/modules/timezone-select';
import type {EntityPickerOption, EventLinkOption} from '../../src/types/EventTypes';

// Model the DOM operations needed by the production picker; requests use the real HTTP helper.
// Modal layout/focus trapping belongs to the built-browser workflow, not this lightweight fixture.
class ElementStub extends EventTarget {
    id = '';
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    classes = new Set<string>();
    children: ElementStub[] = [];
    parentElement: ElementStub | null = null;
    form: ElementStub | null = null;
    value = '';
    textContent = '';
    className = '';
    type = '';
    disabled = false;
    hidden = false;
    defaultSelected = false;
    focused = false;
    classList = {
        add: (name: string) => this.classes.add(name),
        remove: (name: string) => this.classes.delete(name),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, state: boolean) => state ? this.classes.add(name) : this.classes.delete(name),
    };
    constructor(public tagName = 'div') { super(); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    appendChild(child: ElementStub) { child.parentElement = this; this.children.push(child); return child; }
    replaceChildren() { this.children = []; }
    contains(element: ElementStub): boolean { return element === this || this.children.some(child => child.contains(element)); }
    focus() { this.focused = true; }
    matches(selector: string): boolean {
        if (selector === '.modal') return this.classes.has('modal');
        if (selector === '[data-entity-settings-panel]') return this.dataset.entitySettingsPanel !== undefined;
        if (selector === 'button[data-event-id]') return this.tagName === 'button' && this.dataset.eventId !== undefined;
        if (selector === 'button[data-zone]') return this.tagName === 'button' && this.dataset.zone !== undefined;
        return false;
    }
    closest(selector: string): ElementStub | null {
        if (this.matches(selector)) return this;
        return this.parentElement?.closest(selector) ?? null;
    }
    querySelectorAll(selector: string): ElementStub[] {
        const found: ElementStub[] = [];
        for (const child of this.children) {
            if (child.matches(selector)) found.push(child);
            found.push(...child.querySelectorAll(selector));
        }
        return found;
    }
    trigger(type: string, target: ElementStub = this) {
        const event = new Event(type);
        Object.defineProperty(event, 'target', {value: target});
        this.dispatchEvent(event);
    }
}

const fetchMock = vi.fn<typeof fetch>();
const hide = vi.fn();
let dispose: (() => void) | undefined;
let refreshAvailability: () => void;

/** Explicitly deliver the native attribute observation after the host finishes a lock transition. */
class MutationObserverStub {
    constructor(callback: () => void) { refreshAvailability = callback; }
    observe() {}
    disconnect() {}
}

function fixture(seeds: EntityPickerOption[] = [], selected = '', standalone = false, tabbed = false) {
    const elements = new Map<string, ElementStub>();
    const parts = ['', '-content', '-list', '-search', '-from', '-to', '-period', '-archive', '-deadline',
        '-clear', '-reset', '-more', '-previous', '-retry', '-summary', '-selection', '-archive-hint', '-error', '-loading', '-btn-label'];
    for (const part of parts) elements.set(`picker${part}`, new ElementStub());
    const modal = new ElementStub();
    modal.classes.add('modal');
    if (standalone) elements.set('picker-modal', modal);
    const panel = new ElementStub();
    panel.id = 'event-settings-panel';
    if (tabbed) {
        panel.dataset.entitySettingsPanel = 'event';
        modal.appendChild(panel);
        panel.appendChild(elements.get('picker-content')!);
    } else modal.appendChild(elements.get('picker-content')!);
    const input = elements.get('picker')!;
    input.value = selected;
    input.form = new ElementStub('form');
    for (const filter of ['period', 'archive', 'deadline']) elements.get(`picker-${filter}`)!.value = 'all';
    vi.stubGlobal('document', {
        getElementById: (id: string) => elements.get(id) ?? null,
        createElement: (tag: string) => new ElementStub(tag),
    });
    vi.stubGlobal('window', {bootstrap: {Modal: {getInstance: () => ({hide})}}});
    dispose = initEntitySelect('picker', seeds, {mode: standalone ? 'modal' : 'inline'});
    function part(name: string): ElementStub { return elements.get(`picker-${name}`)!; }
    return {elements, input, modal, panel, part};
}

function option(id: string, archived = false): EventLinkOption {
    return {id, title: `Event ${id}`, startDate: '2026-01-01', endDate: '2026-01-04', archived, deadlinePassed: true};
}

function response(items: EventLinkOption[], nextCursor: string | null = null): Response {
    return new Response(JSON.stringify({status: 'success', data: {items, nextCursor}}), {
        headers: {'content-type': 'application/json'},
    });
}

async function settle() { await vi.advanceTimersByTimeAsync(0); }

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    hide.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('MutationObserver', MutationObserverStub);
});

afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('authorized event picker', () => {
    it('loads only when its settings tab is first shown and reuses the loaded page on later visits', async () => {
        fetchMock.mockResolvedValue(response([option('first')]));
        const view = fixture([], '', false, true);
        view.modal.trigger('shown.bs.modal');
        expect(fetchMock).not.toHaveBeenCalled();
        const tab = new ElementStub('button');
        tab.setAttribute('aria-controls', 'another-settings-panel');
        view.modal.trigger('shown.bs.tab', tab);
        expect(fetchMock).not.toHaveBeenCalled();
        view.panel.classes.add('active');
        tab.setAttribute('aria-controls', view.panel.id);
        view.modal.trigger('shown.bs.tab', tab);
        await settle();
        expect(fetchMock).toHaveBeenCalledOnce();
        view.modal.trigger('shown.bs.tab', tab);
        view.modal.trigger('shown.bs.modal');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('defaults to every state, preserves a filtered selection, and clears only on explicit choice', async () => {
        const current = option('saved', true);
        fetchMock.mockResolvedValue(response([]));
        const view = fixture([current], current.id);
        const changed = vi.fn();
        view.input.addEventListener('change', changed);
        expect(fetchMock).not.toHaveBeenCalled();
        view.modal.trigger('shown.bs.modal');
        await settle();
        const query = new URL(fetchMock.mock.calls[0][0] as string, 'https://example.test').searchParams;
        expect(Object.fromEntries(query)).toEqual({period: 'all', archive: 'all', deadline: 'all', selectedId: 'saved'});
        expect(view.part('selection').textContent).toContain('Event saved');
        expect(view.part('archive-hint').classes.has('d-none')).toBe(false);

        view.part('archive').value = 'active';
        view.part('archive').trigger('change');
        await settle();
        expect(view.input.value).toBe('saved');
        expect(changed).not.toHaveBeenCalled();
        view.part('clear').trigger('click');
        expect(view.input.value).toBe('');
        expect(changed).toHaveBeenCalledOnce();
        expect(view.part('archive-hint').classes.has('d-none')).toBe(true);
        expect(hide).not.toHaveBeenCalled();

        // The host modal restores the saved field on Cancel and dispatches change, without a loop.
        view.input.value = 'saved';
        view.input.trigger('change');
        expect(view.part('selection').textContent).toContain('Event saved');
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it('continues an empty authorized batch, deduplicates pages, and closes only its own standalone modal', async () => {
        fetchMock.mockResolvedValueOnce(response([], 'opaque-next'));
        fetchMock.mockResolvedValueOnce(response([option('late'), option('late')], null));
        const view = fixture([], '', true);
        view.modal.trigger('shown.bs.modal');
        await settle();
        expect(view.part('summary').textContent).toContain('More results are available to search');
        expect(view.part('more').classes.has('d-none')).toBe(false);
        view.part('more').trigger('click');
        view.part('more').trigger('click');
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=opaque-next');
        const buttons = view.part('list').querySelectorAll('button[data-event-id]');
        expect(buttons).toHaveLength(1);
        view.part('list').trigger('click', buttons[0]);
        expect(view.input.value).toBe('late');
        expect(hide).toHaveBeenCalledOnce();
    });

    it('ignores stale responses during search debounce and resets filters without resetting selection', async () => {
        let resolveOld!: (value: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        fetchMock.mockResolvedValue(response([option('new')]));
        const view = fixture([{id: 'saved'}], 'saved');
        view.modal.trigger('shown.bs.modal');
        view.part('search').value = 'new';
        view.part('search').trigger('input');
        resolveOld(response([option('old')]));
        await settle();
        expect(view.part('list').querySelectorAll('button[data-event-id]')).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(200);
        expect(view.part('list').querySelectorAll('button[data-event-id]')[0].dataset.eventId).toBe('new');
        expect(view.part('selection').textContent).toBe('Current selection: Current event');
        view.part('period').value = 'ended';
        view.part('from').value = '2026-01-01';
        view.part('reset').trigger('click');
        await settle();
        expect(view.part('period').value).toBe('all');
        expect(view.part('from').value).toBe('');
        expect(view.part('search').value).toBe('');
        expect(view.input.value).toBe('saved');
    });

    it('keeps failed queries retryable, rejects reversed date ranges, and preserves selection', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Access changed'));
        fetchMock.mockResolvedValue(response([option('recovered')]));
        const view = fixture([], 'saved');
        view.modal.trigger('shown.bs.modal');
        await settle();
        expect(view.part('error').textContent).toBe('Access changed');
        expect(view.part('retry').classes.has('d-none')).toBe(false);
        expect(view.input.value).toBe('saved');
        view.part('retry').trigger('click');
        await settle();
        expect(view.part('error').textContent).toBe('');
        expect(view.part('list').querySelectorAll('button[data-event-id]')).toHaveLength(1);
        view.part('from').value = '2026-09-20';
        view.part('to').value = '2026-09-01';
        view.part('to').trigger('change');
        expect(view.part('error').textContent).toContain('From must be on or before To');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(view.input.value).toBe('saved');
    });

    it('keeps late search results locked during a command and unlocks after its failure', async () => {
        let completeSearch!: (value: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { completeSearch = resolve; }));
        const view = fixture([], 'saved');
        view.modal.trigger('shown.bs.modal');
        view.input.disabled = true;
        refreshAvailability();
        completeSearch(response([option('later')], 'next-page'));
        await settle();
        const choice = view.part('list').querySelectorAll('button[data-event-id]')[0];
        expect(choice.disabled).toBe(true);
        expect(view.part('more').disabled).toBe(true);
        view.part('list').trigger('click', choice);
        view.part('clear').trigger('click');
        view.part('more').trigger('click');
        expect(view.input.value).toBe('saved');
        expect(fetchMock).toHaveBeenCalledOnce();

        // Failed writes restore the input. New result nodes and stale host snapshots must recover.
        view.input.disabled = false;
        refreshAvailability();
        expect(choice.disabled).toBe(false);
        expect(view.part('more').disabled).toBe(false);
        view.part('list').trigger('click', choice);
        expect(view.input.value).toBe('later');
    });

    it('resumes a debounced search after a failed write releases the draft lock', async () => {
        let completeOld!: (value: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
        fetchMock.mockResolvedValueOnce(response([option('searched')]));
        const view = fixture([], 'saved');
        view.modal.trigger('shown.bs.modal');
        // Typing invalidates the in-flight page immediately, then the host locks the input before
        // the debounce expires. Neither that stale page nor the lock may strand the loading state.
        view.part('search').value = 'searched';
        view.part('search').trigger('input');
        view.input.disabled = true;
        refreshAvailability();
        await vi.advanceTimersByTimeAsync(200);
        completeOld(response([option('stale')]));
        await settle();
        expect(fetchMock).toHaveBeenCalledOnce();
        view.input.disabled = false;
        refreshAvailability();
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toContain('q=searched');
        expect(view.part('list').querySelectorAll('button[data-event-id]')[0].dataset.eventId).toBe('searched');
        expect(view.input.value).toBe('saved');
    });

    it('replaces pages across thousands of results and preserves both draft and saved selections', async () => {
        function pagedResponse(url: string): Promise<Response> {
            const query = new URL(url, 'https://example.test').searchParams;
            const page = Number(query.get('cursor') || 0);
            const items: EventLinkOption[] = [];
            for (let index = 0; index < 25; index++) items.push(option(`${page}-${index}`));
            return Promise.resolve(response(items, page < 104 ? String(page + 1) : null));
        }
        fetchMock.mockImplementation(pagedResponse as typeof fetch);
        const view = fixture([option('saved')], 'saved');
        view.modal.trigger('shown.bs.modal');
        await settle();
        const first = view.part('list').querySelectorAll('button[data-event-id]')[0];
        view.part('list').trigger('click', first);
        for (let page = 1; page <= 104; page++) {
            view.part('more').trigger('click');
            await settle();
            const buttons = view.part('list').querySelectorAll('button[data-event-id]');
            expect(buttons).toHaveLength(25);
            expect(buttons[0].dataset.eventId).toBe(`${page}-0`);
        }
        expect(view.part('selection').textContent).toContain('Event 0-0');
        expect(view.part('more').classes.has('d-none')).toBe(true);
        view.part('previous').trigger('click');
        await settle();
        expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('cursor=103');
        expect(view.part('list').querySelectorAll('button[data-event-id]')[0].dataset.eventId).toBe('103-0');
        view.input.value = 'saved';
        view.input.trigger('change');
        expect(view.part('selection').textContent).toContain('Event saved');
        view.part('reset').trigger('click');
        await settle();
        expect(view.part('previous').classes.has('d-none')).toBe(true);
    });
});

describe('shared picker hosts', () => {
    it('renders inline content without nested modals and safely serializes stored event text', () => {
        const require = createRequire(resolve('package.json'));
        const pug = require('pug');
        const eventSource = readFileSync('src/views/modules/module_entity_select.pug', 'utf8');
        const eventHtml: string = pug.render(eventSource + '\n+entityPicker("event_id", seeds, {mode:"inline"})', {
            seeds: [{id: 'event', title: '</script><script>alert(1)</script>'}],
        });
        expect(eventHtml).not.toContain('class="modal');
        expect(eventHtml).not.toContain('</script><script>alert');
        expect(eventHtml).toContain('\\u003c/script>');
        const timezoneSource = readFileSync('src/views/modules/module_timezone_select.pug', 'utf8');
        const timezoneHtml: string = pug.render(timezoneSource + '\n+timezonePicker("deadlineTz", {mode:"inline",value:"UTC"})');
        expect(timezoneHtml).toContain('Search time zones');
        expect(timezoneHtml).toContain('Common time zones');
        expect(timezoneHtml).toContain('Use my time zone');
        expect(timezoneHtml).toContain('id="deadlineTz-panel" hidden');
        expect(timezoneHtml).not.toContain('class="modal');
    });

    it('preserves search, common zones, offsets, aliases, guessing and reset in an inline host', async () => {
        const input = new ElementStub('input');
        input.value = 'US/Eastern';
        input.form = new ElementStub('form');
        const elements = new Map([['tz', input]]);
        for (const part of ['btn', 'btn-label', 'guess', 'chips', 'search', 'list', 'panel', 'close', 'summary']) {
            elements.set(`tz-${part}`, new ElementStub());
        }
        function part(name: string): ElementStub { return elements.get(`tz-${name}`)!; }
        part('panel').hidden = true;
        vi.stubGlobal('document', {
            getElementById: (id: string) => elements.get(id) ?? null,
            createElement: (tag: string) => new ElementStub(tag),
        });
        const changed = vi.fn();
        input.addEventListener('change', changed);
        initTimezoneSelect('tz', {mode: 'inline', value: 'US/Eastern', common: ['UTC', 'US/Eastern'], refDateIso: '2026-01-01'});
        expect(part('btn-label').textContent).toContain('US/Eastern');
        expect(part('btn-label').textContent).toContain('UTC-05:00');
        expect(changed).not.toHaveBeenCalled();
        part('btn').trigger('click');
        expect(part('panel').hidden).toBe(false);
        expect(part('search').focused).toBe(true);
        part('search').value = 'Tokyo';
        part('search').trigger('input');
        const result = part('list').querySelectorAll('button[data-zone]');
        expect(result).toHaveLength(1);
        expect(result[0].textContent).toContain('UTC+09:00');
        const utc = part('chips').querySelectorAll('button[data-zone]')[0];
        part('chips').trigger('click', utc);
        expect(input.value).toBe('UTC');
        expect(changed).toHaveBeenCalledOnce();
        expect(part('btn').classes.has('btn-outline-success')).toBe(true);
        await vi.advanceTimersByTimeAsync(300);
        expect(part('btn').classes.has('btn-outline-success')).toBe(false);
        expect(part('panel').hidden).toBe(true);
        expect(part('btn').focused).toBe(true);
        input.value = 'US/Eastern';
        input.trigger('change');
        expect(part('btn-label').textContent).toContain('US/Eastern');
        input.disabled = true;
        part('guess').trigger('click');
        expect(input.value).toBe('US/Eastern');
        input.disabled = false;
        part('guess').trigger('click');
        expect(input.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        input.form.trigger('reset');
        await settle();
        expect(input.value).toBe('US/Eastern');
        expect(part('btn-label').textContent).toContain('US/Eastern');
    });
});
