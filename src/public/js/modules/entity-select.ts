import {get} from '../core/http';
import type {EntityPickerOption, EntityPickerOptions, EventLinkOptionsResult} from '../../../types/EventTypes';

// A single binding prevents duplicate requests/listeners when page and Pug initializers meet.
const initialized = new WeakMap<HTMLElement, () => void>();

/**
 * The hidden input owns the draft selection: filters, failed requests, and pagination never change
 * it. Inline mode shares its host dialog; the creation picker closes after an explicit choice.
 * Returning cleanup also lets dynamic hosts release listeners when their content is removed.
 */
export function initEntitySelect(
    id: string,
    entities: EntityPickerOption[],
    opts: EntityPickerOptions = {},
): () => void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const content = document.getElementById(`${id}-content`);
    if (!input || !content) return function disposeMissingPicker() {};
    const existing = initialized.get(content);
    if (existing) return existing;

    const list = document.getElementById(`${id}-list`)!;
    const search = document.getElementById(`${id}-search`) as HTMLInputElement;
    const from = document.getElementById(`${id}-from`) as HTMLInputElement;
    const to = document.getElementById(`${id}-to`) as HTMLInputElement;
    const period = document.getElementById(`${id}-period`) as HTMLSelectElement;
    const archive = document.getElementById(`${id}-archive`) as HTMLSelectElement;
    const deadline = document.getElementById(`${id}-deadline`) as HTMLSelectElement;
    const clear = document.getElementById(`${id}-clear`) as HTMLButtonElement | null;
    const reset = document.getElementById(`${id}-reset`) as HTMLButtonElement;
    const more = document.getElementById(`${id}-more`) as HTMLButtonElement;
    const previous = document.getElementById(`${id}-previous`) as HTMLButtonElement;
    const retry = document.getElementById(`${id}-retry`) as HTMLButtonElement;
    const summary = document.getElementById(`${id}-summary`)!;
    const selection = document.getElementById(`${id}-selection`)!;
    const archiveHint = document.getElementById(`${id}-archive-hint`)!;
    const error = document.getElementById(`${id}-error`)!;
    const loading = document.getElementById(`${id}-loading`)!;
    const buttonLabel = document.getElementById(`${id}-btn-label`);
    const ownModal = document.getElementById(`${id}-modal`);
    const hostModal = ownModal ?? content.closest<HTMLElement>('.modal');
    const hostPanel = content.closest<HTMLElement>('[data-entity-settings-panel]');
    const endpoint = opts.endpoint === undefined ? '/api/event/link-options' : opts.endpoint;
    const seeds = Array.isArray(entities) ? entities : [];
    const originalId = input.value;
    let originalOption = seeds.find(matchesOriginal);
    const known = new Map<string, EntityPickerOption>();
    if (originalOption) known.set(originalId, originalOption);

    let results: EntityPickerOption[] = [];
    let nextCursor: string | null = null;
    let requestGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let deferredSearch = false;
    let loaded = false;
    let retryDirection: 'reset' | 'next' | 'previous' = 'reset';
    let pageNumber = 1;
    // Cursor history contains no event data. Keep a fixed previous-page window while allowing
    // forward navigation through an arbitrarily large collection without growing browser memory.
    const history: {cursor: string | null; page: number}[] = [];
    const maxHistory = 100;
    const localPageSize = 25;
    let disposed = false;
    const bindings: {target: EventTarget; type: string; handler: EventListener}[] = [];

    function matchesOriginal(option: EntityPickerOption): boolean { return String(option.id) === originalId; }

    function bind(target: EventTarget | null, type: string, handler: EventListener): void {
        if (!target) return;
        target.addEventListener(type, handler);
        bindings.push({target, type, handler});
    }

    function showError(message = ''): void {
        error.textContent = message;
        error.classList.toggle('d-none', !message);
    }

    function syncSelection(): void {
        const selectedId = input!.value;
        const option = known.get(selectedId);
        const label = selectedId ? option?.title || 'Current event' : opts.placeholderLabel || 'No event';
        if (buttonLabel) buttonLabel.textContent = label;
        selection.textContent = `Current selection: ${label}`;
        clear?.setAttribute('aria-pressed', String(!selectedId));
        archiveHint.classList.toggle('d-none', !option?.archived);
        for (const button of list.querySelectorAll<HTMLButtonElement>('button[data-event-id]')) {
            const selected = button.dataset.eventId === selectedId;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        }
    }

    function periodLabel(option: EntityPickerOption): string {
        if (!option.startDate || !option.endDate) return '';
        const today = new Date().toISOString().slice(0, 10);
        if (option.startDate > today) return 'Upcoming';
        return option.endDate < today ? 'Ended' : 'Ongoing';
    }

    function renderResults(): void {
        list.replaceChildren();
        for (const option of results) {
            const item = document.createElement('li');
            item.className = 'list-group-item text-bg-dark px-0';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn w-100 text-start btn-outline-light';
            button.dataset.eventId = String(option.id);
            const title = document.createElement('span');
            title.className = 'd-block fw-semibold text-break';
            title.textContent = option.title || 'Untitled event';
            button.appendChild(title);
            const detail: string[] = [];
            if (option.startDate && option.endDate) detail.push(`${option.startDate} – ${option.endDate}`, periodLabel(option));
            else if (option.dateIso) detail.push(option.dateIso);
            if (option.archived !== undefined) detail.push(option.archived ? 'Archived' : 'Active');
            if (option.deadlinePassed) detail.push('Registration deadline passed');
            if (option.description) detail.push(option.description);
            if (detail.length) {
                const meta = document.createElement('span');
                meta.className = 'd-block small text-secondary text-break';
                meta.textContent = detail.join(' · ');
                button.appendChild(meta);
            }
            item.appendChild(button);
            list.appendChild(item);
        }
        more.classList.toggle('d-none', !nextCursor);
        previous.classList.toggle('d-none', history.length < 2);
        if (results.length) summary.textContent = `Page ${pageNumber} · ${results.length} event${results.length === 1 ? '' : 's'}.${nextCursor ? ' More results are available.' : ''}`;
        else summary.textContent = nextCursor ? 'No events in this batch. More results are available to search.' : 'No events match these filters.';
        syncSelection();
        syncAvailability();
    }

    /**
     * The containing command host can lock the submitted input while an existing search finishes.
     * Derive button state from that input so replaced results remain locked and recover after an
     * unsuccessful command; the host's original button snapshot cannot include these new nodes.
     */
    function syncAvailability(): void {
        const locked = input!.disabled;
        // A debounced search may fall inside a write's lock window. Resume it after a failed
        // write unlocks the unchanged dialog, rather than leaving an invalidated request pending.
        if (!locked && deferredSearch) {
            deferredSearch = false;
            void loadResults();
            return;
        }
        more.disabled = pending || locked;
        previous.disabled = pending || locked;
        retry.disabled = pending || locked;
        for (const button of list.querySelectorAll<HTMLButtonElement>('button[data-event-id]')) {
            button.disabled = locked;
        }
    }

    function setPending(value: boolean): void {
        pending = value;
        syncAvailability();
        loading.classList.toggle('d-none', !value);
        list.setAttribute('aria-busy', String(value));
    }

    function buildQuery(cursor?: string | null): URLSearchParams {
        const query = new URLSearchParams();
        if (search.value.trim()) query.set('q', search.value.trim());
        if (from.value) query.set('from', from.value);
        if (to.value) query.set('to', to.value);
        query.set('period', period.value);
        query.set('archive', archive.value);
        query.set('deadline', deadline.value);
        if (cursor) query.set('cursor', cursor);
        if (input!.value) query.set('selectedId', input!.value);
        return query;
    }

    function matchesLocal(option: EntityPickerOption): boolean {
        const term = search.value.trim().toLowerCase();
        if (term && !`${option.title || ''} ${option.description || ''} ${option.name || ''}`.toLowerCase().includes(term)) return false;
        if (from.value && (!option.endDate || option.endDate < from.value)) return false;
        if (to.value && (!option.startDate || option.startDate > to.value)) return false;
        if (period.value !== 'all' && periodLabel(option).toLowerCase() !== period.value) return false;
        if (archive.value !== 'all' && !!option.archived !== (archive.value === 'archived')) return false;
        return deadline.value === 'all' || !!option.deadlinePassed === (deadline.value === 'passed');
    }

    /** Retain only the saved/current selection and this page; browsing must not become a cache. */
    function replaceOptions(options: EntityPickerOption[], selected?: EntityPickerOption | null): void {
        const current = known.get(input!.value);
        known.clear();
        if (selected && String(selected.id) === originalId) originalOption = selected;
        if (originalOption) known.set(originalId, originalOption);
        if (current) known.set(String(current.id), current);
        if (selected) known.set(String(selected.id), selected);
        results = [];
        const displayed = new Set<string>();
        for (const option of options) {
            const optionId = String(option.id);
            known.set(optionId, option);
            if (!displayed.has(optionId)) results.push(option);
            displayed.add(optionId);
        }
    }

    /**
     * Filters start a new cursor history. Next/Previous replace only the displayed page after a
     * successful response, so a failed navigation can retry the same direction from the intact
     * current page. A generation check covers requests superseded by typing or another filter.
     * Selection is independent of that navigation and is never inferred from the result page.
     */
    async function loadResults(direction: 'reset' | 'next' | 'previous' = 'reset'): Promise<void> {
        if (disposed || input!.disabled) return;
        const generation = ++requestGeneration;
        const priorPage = history[history.length - 2];
        const cursor = direction === 'next' ? nextCursor : direction === 'previous' ? priorPage?.cursor ?? null : null;
        const requestedPage = direction === 'next' ? pageNumber + 1 : direction === 'previous' ? priorPage?.page ?? 1 : 1;
        showError();
        retry.classList.add('d-none');
        if (direction === 'reset') {
            history.length = 0;
            pageNumber = 1;
            replaceOptions([]);
            nextCursor = null;
            renderResults();
        }
        if (from.value && to.value && from.value > to.value) {
            setPending(false);
            showError('From must be on or before To.');
            return;
        }
        if (!endpoint) {
            // Legacy local callers share the bounded presentation; remote events arrive already
            // bounded by the API's authorized page size and are never appended to earlier pages.
            const matching = seeds.filter(matchesLocal);
            const start = (requestedPage - 1) * localPageSize;
            replaceOptions(matching.slice(start, start + localPageSize));
            nextCursor = start + localPageSize < matching.length ? String(requestedPage + 1) : null;
            rememberPage(direction, cursor, requestedPage);
            loaded = true;
            renderResults();
            return;
        }
        setPending(true);
        try {
            const response = await get(`${endpoint}?${buildQuery(cursor).toString()}`);
            if (disposed || generation !== requestGeneration) return;
            const data: EventLinkOptionsResult | undefined = response?.data;
            if (response?.status !== 'success' || !data || !Array.isArray(data.items)) {
                throw new Error('The event list could not be loaded. Please try again.');
            }
            replaceOptions(data.items, data.selected);
            nextCursor = data.nextCursor || null;
            rememberPage(direction, cursor, requestedPage);
            loaded = true;
            renderResults();
        } catch (failure) {
            if (disposed || generation !== requestGeneration) return;
            retryDirection = direction;
            showError(failure instanceof Error ? failure.message : 'Unable to load events.');
            retry.classList.remove('d-none');
        } finally {
            if (!disposed && generation === requestGeneration) setPending(false);
        }
    }

    /** Store cursors only after success; failed requests and stale responses never advance history. */
    function rememberPage(direction: 'reset' | 'next' | 'previous', cursor: string | null, page: number): void {
        if (direction === 'previous') history.pop();
        else history.push({cursor, page});
        if (history.length > maxHistory) history.shift();
        pageNumber = page;
    }

    function runSearch(): void {
        timer = undefined;
        if (input!.disabled) {
            deferredSearch = true;
            setPending(false);
            return;
        }
        void loadResults();
    }

    function handleSearch(): void {
        if (input!.disabled) return;
        // Invalidate during debounce too, so an older response cannot replace the new query's state.
        requestGeneration++;
        clearTimeout(timer);
        timer = setTimeout(runSearch, 200);
    }

    function handleFilter(): void {
        clearTimeout(timer);
        void loadResults();
    }

    function handleResetFilters(): void {
        if (input!.disabled) return;
        search.value = '';
        from.value = '';
        to.value = '';
        period.value = 'all';
        archive.value = 'all';
        deadline.value = 'all';
        handleFilter();
    }

    function choose(selectedId: string): void {
        if (input!.disabled) return;
        if (input!.value !== selectedId) {
            input!.value = selectedId;
            input!.dispatchEvent(new Event('change', {bubbles: true}));
        }
        syncSelection();
        if (ownModal) window.bootstrap?.Modal.getInstance(ownModal)?.hide();
    }

    function handleChoice(event: Event): void {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-event-id]');
        if (button && list.contains(button)) choose(button.dataset.eventId || '');
    }

    function handleClear(): void { choose(''); }
    function handleMore(): void { if (!pending && nextCursor) void loadResults('next'); }
    function handlePrevious(): void { if (!pending && history.length > 1) void loadResults('previous'); }
    function handleRetry(): void { if (!pending) void loadResults(retryDirection); }

    function handleOpen(): void {
        syncSelection();
        if (hostPanel && !hostPanel.classList.contains('active')) return;
        if (!loaded && !pending) void loadResults();
        if (ownModal) search.focus();
    }

    /** Bootstrap emits the event from its trigger, so match aria-controls to this picker's pane. */
    function handleTab(event: Event): void {
        const trigger = event.target as HTMLElement;
        if (hostPanel && trigger.getAttribute('aria-controls') === hostPanel.id) handleOpen();
    }

    function handleFormReset(): void {
        // Native reset restores hidden inputs after this event; refresh labels once that is complete.
        queueMicrotask(syncSelection);
    }

    function preventSearchSubmit(event: Event): void {
        if ((event as KeyboardEvent).key === 'Enter') event.preventDefault();
    }

    function dispose(): void {
        disposed = true;
        requestGeneration++;
        clearTimeout(timer);
        availabilityObserver.disconnect();
        for (const binding of bindings) binding.target.removeEventListener(binding.type, binding.handler);
        initialized.delete(content!);
    }

    const availabilityObserver = new MutationObserver(syncAvailability);
    availabilityObserver.observe(input, {attributes: true, attributeFilter: ['disabled']});
    bind(search, 'input', handleSearch);
    bind(search, 'keydown', preventSearchSubmit);
    for (const field of [from, to, period, archive, deadline]) bind(field, 'change', handleFilter);
    bind(reset, 'click', handleResetFilters);
    bind(clear, 'click', handleClear);
    bind(more, 'click', handleMore);
    bind(previous, 'click', handlePrevious);
    bind(retry, 'click', handleRetry);
    bind(list, 'click', handleChoice);
    bind(input, 'change', syncSelection);
    bind(input.form, 'reset', handleFormReset);
    bind(hostModal, 'shown.bs.modal', handleOpen);
    bind(hostModal, 'shown.bs.tab', handleTab);
    initialized.set(content, dispose);
    syncSelection();
    if (!hostModal) void loadResults();
    return dispose;
}
