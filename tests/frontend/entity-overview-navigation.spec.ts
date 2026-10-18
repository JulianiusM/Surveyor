import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {initEntityOverview} from '../../src/public/js/modules/entity-cards-overview';
import {initEntityArchive} from '../../src/public/js/modules/entity-archive';

// Model only the DOM operations used by the production navigator. Pug markup/Bootstrap geometry are
// covered by the browser workflow; these fixtures exercise requests, history, replacement and races.
class PageElement extends EventTarget {
    id = '';
    dataset: Record<string, string> = {};
    value = '';
    href = '';
    textContent = '';
    hidden = false;
    selectionStart = 0;
    selectionEnd = 0;
    parentElement?: PageElement;
    form?: PageElement;
    attributes = new Map<string, string>();
    selectors = new Map<string, PageElement[]>();
    matching = new Set<string>();
    classes = new Set<string>();
    classList = {toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    focus = vi.fn(() => { browserDocument.activeElement = this; });
    scrollIntoView = vi.fn();
    querySelector(selector: string): PageElement | null {
        return this.selectors.get(selector)?.[0] ?? this.selectors.get('.js-overview-content')?.[0]?.querySelector(selector) ?? null;
    }
    querySelectorAll(selector: string): PageElement[] {
        return this.selectors.get(selector) ?? this.selectors.get('.js-overview-content')?.[0]?.querySelectorAll(selector) ?? [];
    }
    add(selector: string, ...children: PageElement[]) {
        for (const child of children) child.parentElement = this;
        this.selectors.set(selector, children);
        return children[0];
    }
    contains(element: PageElement | null): boolean { return element === this || !!element?.parentElement && this.contains(element.parentElement); }
    matches(selector: string) { return this.matching.has(selector); }
    closest(selector: string): PageElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    removeAttribute(name: string) { this.attributes.delete(name); }
    replaceWith(next: PageElement) { this.parentElement!.add('.js-overview-content', next); }
    replaceChildren() { this.selectors.clear(); }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
}

const fetchMock = vi.fn<typeof fetch>();
const fragments = new Map<string, PageElement>();
const browserDocument = {activeElement: null as PageElement | null};
let dispose: (() => void) | undefined;
let disposeArchive: (() => void) | undefined;
let currentUrl: URL;
let browserWindow: EventTarget & {location: URL; history: {pushState: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn>}; scrollY: number; scrollTo: ReturnType<typeof vi.fn>};

function content(url: string, eventId = '', query = '') {
    const element = new PageElement();
    element.dataset = {overviewUrl: url, loaded: 'true', type: 'all', query, eventId};
    element.add('.js-overview-heading', new PageElement());
    const form = element.add('.js-overview-search', new PageElement());
    form.matching.add('.js-overview-search');
    const search = form.add('.js-search', new PageElement());
    search.matching.add('.js-search');
    search.form = form;
    search.value = query;
    element.selectors.set('.js-search', [search]);
    return {element, form, search};
}

function link(surface: PageElement, action: string, href: string, eventId = 'event-1') {
    const item = surface.add('link', new PageElement());
    item.matching.add('a.js-overview-link');
    item.dataset = {overviewAction: action, eventId};
    item.href = href;
    if (action === 'expand') surface.selectors.set('[data-overview-action="expand"]', [item]);
    return item;
}

function trigger(root: PageElement, type: string, target: PageElement, submitter?: PageElement) {
    const event = new Event(type, {cancelable: true});
    Object.defineProperties(event, {target: {value: target}, submitter: {value: submitter}});
    root.dispatchEvent(event);
    return event;
}

function setup(hidden = false) {
    const root = new PageElement();
    const region = root.add('.js-overview-region', new PageElement());
    region.id = hidden ? 'sec-parts-archived' : 'sec-parts-main';
    region.dataset = {collection: 'participant', region: hidden ? 'hidden' : 'main', queryPrefix: hidden ? 'participant_hidden_' : 'participant_main_'};
    const surface = content(currentUrl.href);
    region.add('.js-overview-content', surface.element);
    region.add('.js-overview-status', new PageElement());
    region.add('.js-overview-error', new PageElement());
    region.add('.js-overview-error-message', new PageElement());
    let collapse: PageElement | undefined;
    if (hidden) {
        collapse = new PageElement();
        collapse.id = 'sec-parts-archived-container';
        collapse.matching.add('.js-overview-hidden');
        region.parentElement = collapse;
    }
    vi.stubGlobal('document', {
        get activeElement() { return browserDocument.activeElement; },
        getElementById: () => null,
        querySelector: (selector: string) => selector === '#participationLists' ? root : null,
        createElement: () => {
            let html = '';
            return {
                set innerHTML(value: string) { html = value; },
                content: {querySelector: () => fragments.get(html) ?? null},
            };
        },
    });
    dispose = initEntityOverview('#participationLists', {paged: true});
    return {region, surface, collapse};
}

function response(region: PageElement, body: PageElement, key: string, url: string): Response {
    fragments.set(key, body);
    return new Response(JSON.stringify({status: 'success', data: {regionId: region.id, html: key, url}}), {headers: {'content-type': 'application/json'}});
}

async function settle() { await vi.advanceTimersByTimeAsync(0); }

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fragments.clear();
    browserDocument.activeElement = null;
    currentUrl = new URL('https://surveyor.test/users/dashboard?owner_main_q=keep');
    function record(_state: unknown, _unused: string, value: string | URL) {
        currentUrl = new URL(value, currentUrl);
        browserWindow.location = currentUrl;
    }
    browserWindow = Object.assign(new EventTarget(), {
        location: currentUrl,
        history: {pushState: vi.fn(record), replaceState: vi.fn(record)},
        scrollY: 320,
        scrollTo: vi.fn(),
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('bootstrap', {Dropdown: {getInstance: () => null}});
});

afterEach(() => {
    dispose?.();
    disposeArchive?.();
    disposeArchive = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('paged entity overview navigation', () => {
    it('does not replace controls or navigate while their archival command is pending', () => {
        const {region, surface} = setup();
        const archive = surface.element.add('[data-archive-action]', new PageElement());
        archive.matching.add('button[data-archive-action]');
        archive.dataset = {archiveAction: 'hidden', archiveUrl: '/api/users/overview/event/event-1/visibility'};
        disposeArchive = initEntityArchive(region as unknown as HTMLElement);
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        trigger(region, 'click', archive);
        const expand = link(surface.element, 'expand', '/users/dashboard?participant_main_event=event-1');
        const click = trigger(region, 'click', expand);
        expect(click.defaultPrevented).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(region.querySelector('.js-overview-status')?.textContent).toContain('archival change');
    });

    it('replaces the selected region, preserves other-region state and restores event focus on return', async () => {
        const {region, surface} = setup();
        const selectedUrl = '/users/dashboard?participant_main_event=event-1';
        const expand = link(surface.element, 'expand', selectedUrl);
        const selected = content(selectedUrl, 'event-1');
        fetchMock.mockResolvedValueOnce(response(region, selected.element, 'selected', selectedUrl));
        trigger(region, 'click', expand);
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(selected.element);
        expect(new URL(String(fetchMock.mock.calls[0][0]), currentUrl).searchParams.get('collection')).toBe('participant');
        expect(currentUrl.searchParams.get('owner_main_q')).toBe('keep');
        expect(currentUrl.searchParams.get('participant_main_event')).toBe('event-1');

        const back = link(selected.element, 'back', '/users/dashboard');
        const overview = content('/users/dashboard');
        const restored = link(overview.element, 'expand', selectedUrl);
        fetchMock.mockResolvedValueOnce(response(region, overview.element, 'overview', '/users/dashboard'));
        trigger(region, 'click', back);
        await settle();
        expect(region.querySelectorAll('.js-overview-content')).toEqual([overview.element]);
        expect(restored.focus).toHaveBeenCalled();
        expect(browserWindow.scrollTo).toHaveBeenCalledWith({top: 320, behavior: 'instant'});
        expect(browserWindow.history.pushState).toHaveBeenCalledTimes(2);
    });

    it('debounces search, resets both pages and ignores an older response without losing search focus', async () => {
        const {region, surface} = setup();
        surface.element.dataset.overviewUrl = '/users/dashboard?participant_main_page=3&participant_main_childPage=2';
        let complete!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        surface.search.value = 'old';
        browserDocument.activeElement = surface.search;
        trigger(region, 'input', surface.search);
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledOnce();
        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]), currentUrl);
        expect(requestUrl.searchParams.has('participant_main_page')).toBe(false);
        expect(requestUrl.searchParams.has('participant_main_childPage')).toBe(false);

        surface.search.value = 'new';
        surface.search.selectionStart = surface.search.selectionEnd = 3;
        trigger(region, 'input', surface.search);
        const old = content('/users/dashboard?participant_main_q=old', '', 'old');
        complete(response(region, old.element, 'old', old.element.dataset.overviewUrl));
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(surface.element);
        const latest = content('/users/dashboard?participant_main_q=new', '', 'new');
        fetchMock.mockResolvedValueOnce(response(region, latest.element, 'latest', latest.element.dataset.overviewUrl));
        await vi.advanceTimersByTimeAsync(300);
        expect(region.querySelector('.js-overview-content')).toBe(latest.element);
        expect(latest.search.focus).toHaveBeenCalled();
        expect(latest.search.selectionStart).toBe(3);
        expect(browserWindow.history.replaceState).toHaveBeenCalledOnce();
    });

    it('releases a closed hidden region and rejects a pending child response', async () => {
        currentUrl = new URL('https://surveyor.test/users/dashboard?participant_hidden_open=1&participant_hidden_event=event-1');
        browserWindow.location = currentUrl;
        const {region, surface, collapse} = setup(true);
        const expand = link(surface.element, 'page', '/users/dashboard?participant_hidden_open=1&participant_hidden_event=event-1&participant_hidden_childPage=2');
        let complete!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        trigger(region, 'click', expand);
        trigger(collapse!, 'hide.bs.collapse', collapse!);
        const late = content(expand.href, 'event-1');
        complete(response(region, late.element, 'late', expand.href));
        await settle();
        expect(region.querySelector('.js-overview-content')?.dataset.loaded).toBe('false');
        expect(region.querySelector('.js-overview-content')?.selectors.size).toBe(0);
        expect(currentUrl.searchParams.has('participant_hidden_open')).toBe(false);
        expect(currentUrl.searchParams.has('participant_hidden_event')).toBe(false);
    });

    it('invalidates a pending navigation when browser history restores the already displayed state', async () => {
        const {region, surface} = setup();
        const expand = link(surface.element, 'expand', '/users/dashboard?participant_main_event=event-1');
        let complete!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        trigger(region, 'click', expand);
        browserWindow.dispatchEvent(new Event('popstate'));
        const late = content(expand.href, 'event-1');
        complete(response(region, late.element, 'late', expand.href));
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(surface.element);
        expect(browserWindow.history.pushState).not.toHaveBeenCalled();
        expect(region.attributes.has('aria-busy')).toBe(false);
    });

    it('searches the mixed grid when typing immediately after Back while its response is pending', async () => {
        const {region, surface} = setup();
        surface.element.dataset.overviewUrl = '/users/dashboard?participant_main_event=event-1';
        surface.element.dataset.eventId = 'event-1';
        const back = link(surface.element, 'back', '/users/dashboard');
        let complete!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        trigger(region, 'click', back);
        surface.search.value = 'new search';
        trigger(region, 'input', surface.search);
        const unfiltered = content('/users/dashboard');
        complete(response(region, unfiltered.element, 'unfiltered', '/users/dashboard'));
        const filtered = content('/users/dashboard?participant_main_q=new+search', '', 'new search');
        fetchMock.mockResolvedValueOnce(response(region, filtered.element, 'filtered', filtered.element.dataset.overviewUrl));
        await vi.advanceTimersByTimeAsync(300);
        const requestUrl = new URL(String(fetchMock.mock.calls[1][0]), currentUrl);
        expect(requestUrl.searchParams.has('participant_main_event')).toBe(false);
        expect(requestUrl.searchParams.get('participant_main_q')).toBe('new search');
        expect(region.querySelector('.js-overview-content')).toBe(filtered.element);
    });

    it('restores a different recorded page without adding another history entry', async () => {
        const {region} = setup();
        const restoredUrl = '/users/dashboard?owner_main_q=keep&participant_main_page=2';
        const restored = content(restoredUrl);
        fetchMock.mockResolvedValueOnce(response(region, restored.element, 'history', restoredUrl));
        currentUrl = new URL(restoredUrl, currentUrl);
        browserWindow.location = currentUrl;
        browserWindow.dispatchEvent(new Event('popstate'));
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(restored.element);
        expect(browserWindow.history.pushState).not.toHaveBeenCalled();
        expect(browserWindow.history.replaceState).not.toHaveBeenCalled();
    });

    it('keeps a hidden event deep link open when history has no explicit open marker', () => {
        currentUrl = new URL('https://surveyor.test/users/dashboard?participant_hidden_event=event-1');
        browserWindow.location = currentUrl;
        const {collapse, surface, region} = setup(true);
        browserWindow.dispatchEvent(new Event('popstate'));
        expect(collapse?.classes.has('show')).toBe(true);
        expect(region.querySelector('.js-overview-content')).toBe(surface.element);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reopens a released hidden region from the restored URL instead of a discarded future filter', async () => {
        const {region, surface, collapse} = setup(true);
        surface.element.dataset.overviewUrl = '/users/dashboard?participant_hidden_q=future&participant_hidden_event=event-1&participant_hidden_open=1';
        browserWindow.dispatchEvent(new Event('popstate'));
        const restored = content('/users/dashboard?participant_hidden_open=1');
        fetchMock.mockResolvedValueOnce(response(region, restored.element, 'restored-hidden', restored.element.dataset.overviewUrl));
        trigger(collapse!, 'show.bs.collapse', collapse!);
        await settle();
        const requested = new URL(String(fetchMock.mock.calls[0][0]), currentUrl);
        expect(requested.searchParams.get('participant_hidden_open')).toBe('1');
        expect(requested.searchParams.has('participant_hidden_q')).toBe(false);
        expect(requested.searchParams.has('participant_hidden_event')).toBe(false);
    });

    it('revokes an older read on Back even when an archival mutation subsequently fails', async () => {
        const {region, surface} = setup();
        const expand = link(surface.element, 'expand', '/users/dashboard?participant_main_event=event-1');
        let finishRead!: (response: Response) => void;
        let finishMutation!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishMutation = resolve; }));
        trigger(region, 'click', expand);
        const archive = surface.element.add('[data-archive-action]', new PageElement());
        archive.matching.add('button[data-archive-action]');
        archive.dataset = {archiveAction: 'hidden', archiveUrl: '/api/users/overview/event/event-1/visibility'};
        disposeArchive = initEntityArchive(region as unknown as HTMLElement);
        trigger(region, 'click', archive);
        browserWindow.dispatchEvent(new Event('popstate'));
        finishMutation(new Response(JSON.stringify({status: 'error', message: 'The change failed.'}), {status: 409, headers: {'content-type': 'application/json'}}));
        await settle();
        const late = content(expand.href, 'event-1');
        finishRead(response(region, late.element, 'late-after-mutation', expand.href));
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(surface.element);
        expect(browserWindow.history.pushState).not.toHaveBeenCalled();
    });

    it('retains the current surface on errors and retries the failed navigation', async () => {
        const {region, surface} = setup();
        const expand = link(surface.element, 'expand', '/users/dashboard?participant_main_event=event-1');
        fetchMock.mockResolvedValueOnce(new Response('<html>Login</html>', {headers: {'content-type': 'text/html'}}));
        trigger(region, 'click', expand);
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(surface.element);
        expect(region.querySelector('.js-overview-error')?.hidden).toBe(false);
        expect(region.attributes.has('aria-busy')).toBe(false);
        const retry = new PageElement();
        retry.matching.add('.js-overview-retry');
        const selected = content(expand.href, 'event-1');
        fetchMock.mockResolvedValueOnce(response(region, selected.element, 'retry', expand.href));
        trigger(region, 'click', retry);
        await settle();
        expect(region.querySelector('.js-overview-content')).toBe(selected.element);
    });

    it('discards an obsolete retry after history returns to the rendered page', async () => {
        const {region, surface} = setup();
        const expand = link(surface.element, 'expand', '/users/dashboard?participant_main_event=event-1');
        fetchMock.mockRejectedValueOnce(new Error('Offline'));
        trigger(region, 'click', expand);
        await settle();
        expect(region.querySelector('.js-overview-error')?.hidden).toBe(false);
        browserWindow.dispatchEvent(new Event('popstate'));
        const retry = new PageElement();
        retry.matching.add('.js-overview-retry');
        trigger(region, 'click', retry);
        expect(region.querySelector('.js-overview-error')?.hidden).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
