import {get} from '../core/http';
import {isEntityArchivePending} from './entity-archive';

// Bootstrap is provided by the shared layout, as for the other page modules. Describe only the existing
// dropdown instance operation used here; Bootstrap retains ownership of menu creation and positioning.
declare const bootstrap: {
    Dropdown: {
        getInstance(element: HTMLElement): {update(): void; dispose(): void} | null;
    };
};

/**
 * Enhance one server-rendered collection without changing which region owns an entity.
 * module_unified_entity_cards.pug supplies independent .js-entity-section regions for main/archived cards;
 * their data attributes are searchable presentation fields, not a source of authorization or archive state.
 */
class EntityOverview {
    constructor(private root: HTMLElement) {
        this.init();
    }

    private init() {
        // Each filter region owns only its cards; an archived region is independent of its collection.
        const sections = this.root.querySelectorAll<HTMLElement>(".js-entity-section");

        for (const section of sections) {
            this.initSection(section);
        }
        // Nested Bootstrap collapse events bubble to the collection. Wait for the final geometry before
        // updating menus opened during expansion; an update during the animation would still be stale.
        this.root.addEventListener('shown.bs.collapse', this.refreshOpenDropdowns);
    }

    private refreshOpenDropdowns(event: Event): void {
        // This named listener is attached without rebinding `this`; currentTarget identifies its collection.
        // Closed menus need no work: Bootstrap measures them when they are next opened.
        const root = event.currentTarget as HTMLElement;
        const toggles = root.querySelectorAll<HTMLElement>('[data-bs-toggle="dropdown"][aria-expanded="true"]');
        for (const toggle of toggles) {
            // Keyboard users can open a menu while its ancestor is still expanding. Preserve focus,
            // bring its trigger into view, and let Bootstrap recalculate the completed layout.
            if (toggle.parentElement?.contains(document.activeElement)) {
                toggle.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
            }
            bootstrap.Dropdown.getInstance(toggle)?.update();
        }
    }

    private initSection(section: HTMLElement): void {
        // Each region has its own search, type buttons, count, and empty status. Empty regions omit these
        // controls, so all lookups and listener registration must also tolerate a region with no cards.
        const search = section.querySelector<HTMLInputElement>(".js-search");
        const items = Array.from(section.querySelectorAll<HTMLElement>(".js-item"));
        const count = section.querySelector<HTMLElement>(".js-count");
        const filterButtons = section.querySelectorAll<HTMLButtonElement>(".js-filter-type [data-type]");
        const overview = this;
        // Keep the selected type local to the region so searching Archived and hidden cannot filter the
        // main grid (or another overview collection). Both named handlers reuse the same filtering path.
        let activeType = "all";

        function filterByType(event: Event): void {
            const button = event.currentTarget as HTMLButtonElement;
            activeType = button.dataset.type || "all";
            for (const filter of filterButtons) {
                // Expose the single active type to assistive technology as well as the filter predicate.
                filter.setAttribute('aria-pressed', String(filter === button));
            }
            overview.applyFilter(section, items, search?.value || "", activeType, count);
        }

        function filterBySearch(): void {
            overview.applyFilter(section, items, search?.value || "", activeType, count);
        }

        for (const button of filterButtons) {
            button.addEventListener("click", filterByType);
        }
        search?.addEventListener("input", filterBySearch);
        // Initialize counts and the no-match status consistently, including a region with zero cards.
        this.applyFilter(section, items, "", "all", count);
    }

    private applyFilter(
        section: HTMLElement,
        items: HTMLElement[],
        query: string,
        type: string,
        count?: HTMLElement | null
    ) {
        // Search is a local, case-insensitive view over cards already admitted by the server. It never
        // changes a saved personal preference or moves cards between the main and archived regions.
        const q = query.trim().toLowerCase();

        let visible = 0;

        for (const el of items) {
            const title = (el.dataset.title || "").toLowerCase();
            const description = (el.dataset.description || "").toLowerCase();
            const itemType = el.dataset.type || "";

            const matchesSearch =
                !q ||
                title.includes(q) ||
                description.includes(q) ||
                itemType.toLowerCase().includes(q);

            const matchesType =
                type === "all" || itemType === type;

            const show = matchesSearch && matchesType;

            // .js-item sits inside a Bootstrap .col. Hide that wrapper so a filtered-out card does not
            // leave an empty grid slot, while retaining its DOM/actions for a later search change.
            el.parentElement?.classList.toggle("d-none", !show);

            if (show) visible++;
        }

        if (count) {
            // The nearby aria-live wrapper announces the result count without rebuilding the card grid.
            count.textContent = String(visible);
        }
        const empty = section.querySelector<HTMLElement>('.js-no-matches');
        if (empty) {
            // This is a search-result message; the template separately handles a truly empty collection.
            empty.hidden = visible !== 0;
        }
    }
}


/**
 * Personal dashboards use server-rendered bounded regions. Each stable region root owns its navigation;
 * no card metadata cache or client-side membership calculation is retained between pages.
 */
class PagedEntityOverview {
    private regions: PagedOverviewRegion[];

    constructor(private root: HTMLElement) {
        this.regions = Array.from(root.querySelectorAll<HTMLElement>('.js-overview-region'), region => new PagedOverviewRegion(region));
        this.root.addEventListener('shown.bs.collapse', this.refreshOpenDropdowns);
    }

    private refreshOpenDropdowns = (): void => {
        const toggles = this.root.querySelectorAll<HTMLElement>('[data-bs-toggle="dropdown"][aria-expanded="true"]');
        for (const toggle of toggles) {
            if (toggle.parentElement?.contains(document.activeElement)) {
                toggle.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
            }
            bootstrap.Dropdown.getInstance(toggle)?.update();
        }
    };

    dispose(): void {
        this.root.removeEventListener('shown.bs.collapse', this.refreshOpenDropdowns);
        for (const region of this.regions) region.dispose();
    }
}

class PagedOverviewRegion {
    private readonly prefix: string;
    private readonly hiddenContainer: HTMLElement | null;
    private generation = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private retryUrl?: string;
    private retryHistory: 'push' | 'replace' | 'none' = 'replace';
    private retryAction?: string;
    private navigationUrl?: string;
    private returnPosition?: {eventId: string; query: string; scrollY: number};

    constructor(private root: HTMLElement) {
        this.prefix = root.dataset.queryPrefix || '';
        this.hiddenContainer = root.closest<HTMLElement>('.js-overview-hidden');
        root.addEventListener('click', this.onClick);
        root.addEventListener('submit', this.onSubmit);
        root.addEventListener('input', this.onSearch);
        this.hiddenContainer?.addEventListener('show.bs.collapse', this.onHiddenOpen);
        this.hiddenContainer?.addEventListener('hide.bs.collapse', this.onHiddenClose);
        window.addEventListener('popstate', this.onHistory);
    }

    private content(): HTMLElement | null {
        return this.root.querySelector<HTMLElement>('.js-overview-content');
    }

    /** Copy only this region's namespaced parameters; another region may have changed since rendering. */
    private mergeUrl(value: string): URL {
        const desired = new URL(value, window.location.href);
        const merged = new URL(window.location.href);
        for (const key of Array.from(merged.searchParams.keys())) {
            if (key.startsWith(this.prefix)) merged.searchParams.delete(key);
        }
        for (const [key, value] of desired.searchParams) {
            if (key.startsWith(this.prefix)) merged.searchParams.set(key, value);
        }
        merged.hash = this.root.id;
        return merged;
    }

    private queryKey(url: URL): string {
        return JSON.stringify([url.searchParams.get(`${this.prefix}q`) || '', url.searchParams.get(`${this.prefix}type`) || 'all']);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private canNavigate(): boolean {
        if (!isEntityArchivePending()) return true;
        this.setStatus('Please wait for the archival change to finish.');
        return false;
    }

    private onClick = (event: Event): void => {
        const target = event.target as Element | null;
        if (target?.closest('.js-overview-retry')) {
            if (this.retryUrl && this.canNavigate()) void this.navigate(this.retryUrl, this.retryHistory, this.retryAction);
            return;
        }
        const link = target?.closest<HTMLAnchorElement>('a.js-overview-link');
        if (!link || !this.root.contains(link)) return;
        const click = event as MouseEvent;
        // Keep ordinary link semantics for opening another tab/window and for the no-script fallback.
        if (click.button || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
        event.preventDefault();
        if (!this.canNavigate()) return;
        const action = link.dataset.overviewAction;
        if (action === 'expand') {
            this.returnPosition = {
                eventId: link.dataset.eventId || '',
                query: this.queryKey(new URL(this.content()?.dataset.overviewUrl || window.location.href, window.location.href)),
                scrollY: window.scrollY,
            };
        }
        void this.navigate(link.href, 'push', action);
    };

    private formUrl(form: HTMLFormElement, submitter?: HTMLElement | null): URL {
        // Controls remain usable while a read is pending. Apply edits to the latest requested view,
        // so typing immediately after Back cannot reopen the event in the still-rendered old body.
        const url = this.mergeUrl(this.navigationUrl || this.content()?.dataset.overviewUrl || window.location.href);
        const search = form.querySelector<HTMLInputElement>('.js-search');
        const type = submitter?.getAttribute('data-type') || url.searchParams.get(`${this.prefix}type`) || 'all';
        url.searchParams.set(`${this.prefix}q`, search?.value || '');
        url.searchParams.set(`${this.prefix}type`, type);
        url.searchParams.delete(`${this.prefix}page`);
        url.searchParams.delete(`${this.prefix}childPage`);
        return url;
    }

    private onSubmit = (event: Event): void => {
        const form = (event.target as Element | null)?.closest<HTMLFormElement>('.js-overview-search');
        if (!form) return;
        event.preventDefault();
        if (!this.canNavigate()) return;
        void this.navigate(this.formUrl(form, (event as SubmitEvent).submitter).href, 'replace', 'filter');
    };

    private onSearch = (event: Event): void => {
        const input = event.target as HTMLInputElement | null;
        if (!input?.matches('.js-search') || !input.form || !this.canNavigate()) return;
        this.clearTimer();
        // Invalidate immediately, before the debounce expires: a slower previous request must not
        // replace what the user is typing merely because the next request has not started yet.
        this.generation++;
        const url = this.formUrl(input.form).href;
        this.timer = setTimeout(() => { void this.navigate(url, 'replace', 'filter'); }, 300);
    };

    private onHiddenOpen = (event: Event): void => {
        if (event.target !== this.hiddenContainer) return;
        if (!this.canNavigate()) { event.preventDefault(); return; }
        // Closing/history can discard a body from a later navigation. Reopen the recorded URL state,
        // not stale attributes retained on that empty shell.
        const url = new URL(window.location.href);
        url.searchParams.set(`${this.prefix}open`, '1');
        void this.navigate(url.href, 'push', 'open');
    };

    private onHiddenClose = (event: Event): void => {
        if (event.target !== this.hiddenContainer) return;
        if (!this.canNavigate()) { event.preventDefault(); return; }
        this.releaseHidden();
        const url = new URL(window.location.href);
        url.searchParams.delete(`${this.prefix}open`);
        // An event selection also denotes an open deep link on a full-page request. Remove it when
        // deliberately closing this region so a later mutation reload does not reopen discarded cards.
        url.searchParams.delete(`${this.prefix}event`);
        url.searchParams.delete(`${this.prefix}childPage`);
        window.history.pushState(null, '', url);
    };

    private releaseHidden(): void {
        this.clearTimer();
        this.generation++;
        this.navigationUrl = undefined;
        this.clearError();
        this.disposeDropdowns();
        const content = this.content();
        if (content) {
            content.replaceChildren();
            content.dataset.loaded = 'false';
        }
        this.root.removeAttribute('aria-busy');
        this.setStatus('');
    }

    private onHistory = (): void => {
        // History may return to the content already on screen while a newer request is still pending.
        // Revoke its authority before checking the mutation lock: a failed mutation must not later
        // allow an older GET to overwrite the user's Back/Forward navigation.
        this.clearTimer();
        this.generation++;
        this.navigationUrl = undefined;
        this.clearError();
        this.root.removeAttribute('aria-busy');
        this.setStatus('');
        if (isEntityArchivePending()) return;
        const url = new URL(window.location.href);
        if (this.hiddenContainer) {
            const open = url.searchParams.get(`${this.prefix}open`) === '1' || !!url.searchParams.get(`${this.prefix}event`);
            // Restore recorded visibility without launching a second Bootstrap navigation. Its toggle
            // ARIA state is kept in sync; subsequent user actions resume normal Bootstrap animation.
            this.hiddenContainer.classList.toggle('show', open);
            const toggle = document.querySelector<HTMLElement>(`[aria-controls="${this.hiddenContainer.id}"]`);
            toggle?.setAttribute('aria-expanded', String(open));
            toggle?.classList.toggle('collapsed', !open);
            if (!open) { this.releaseHidden(); return; }
        }
        const rendered = new URL(this.content()?.dataset.overviewUrl || window.location.href, window.location.href);
        const desired = this.mergeUrl(url.href);
        if (this.regionState(rendered) !== this.regionState(desired) || this.content()?.dataset.loaded !== 'true') {
            void this.navigate(desired.href, 'none', 'history');
        }
    };

    private regionState(url: URL): string {
        const values = Array.from(url.searchParams).filter(([key]) => key.startsWith(this.prefix));
        values.sort(([left], [right]) => left.localeCompare(right));
        return JSON.stringify(values);
    }

    private setStatus(message: string, announceOnly = false): void {
        const status = this.root.querySelector<HTMLElement>('.js-overview-status');
        if (status) {
            status.textContent = message;
            status.hidden = !message;
            status.classList.toggle('visually-hidden', announceOnly);
        }
    }

    private clearError(): void {
        this.retryUrl = undefined;
        const error = this.root.querySelector<HTMLElement>('.js-overview-error');
        if (error) error.hidden = true;
    }

    private updateCollectionCounts(content: HTMLElement): void {
        // Membership/visibility can change in another tab between reads. Scalar totals belong to the
        // same server projection as the replacement cards; keep the stable collection badges aligned.
        const collection = this.root.closest<HTMLElement>('.entity-overview');
        const total = collection?.querySelector<HTMLElement>('.js-overview-total');
        const hidden = collection?.querySelector<HTMLElement>('.js-overview-hidden-total');
        if (total && content.dataset.totalEntities !== undefined) total.textContent = content.dataset.totalEntities;
        if (hidden && content.dataset.hiddenEntities !== undefined) hidden.textContent = content.dataset.hiddenEntities;
    }

    private disposeDropdowns(): void {
        for (const toggle of this.root.querySelectorAll<HTMLElement>('[data-bs-toggle="dropdown"]')) {
            bootstrap.Dropdown.getInstance(toggle)?.dispose();
        }
    }

    private restoreFocus(action: string | undefined, focusedSearch: boolean, selection: [number | null, number | null]): void {
        if (focusedSearch) {
            const input = this.root.querySelector<HTMLInputElement>('.js-search');
            input?.focus({preventScroll: true});
            if (input && selection[0] !== null && selection[1] !== null) input.setSelectionRange(...selection as [number, number]);
            return;
        }
        if (action === 'back' && this.returnPosition) {
            const position = this.returnPosition;
            const card = Array.from(this.root.querySelectorAll<HTMLAnchorElement>('[data-overview-action="expand"]'))
                .find(link => link.dataset.eventId === position.eventId);
            if (card) {
                card.focus({preventScroll: true});
                const url = new URL(this.content()?.dataset.overviewUrl || window.location.href, window.location.href);
                if (position.query === this.queryKey(url)) window.scrollTo({top: position.scrollY, behavior: 'instant'});
                else card.scrollIntoView({block: 'nearest'});
                return;
            }
        }
        if (action && action !== 'open') this.root.querySelector<HTMLElement>('.js-overview-heading')?.focus();
    }

    private async navigate(value: string, history: 'push' | 'replace' | 'none', action?: string): Promise<void> {
        this.clearTimer();
        if (!this.canNavigate()) return;
        const generation = ++this.generation;
        const desired = this.mergeUrl(value);
        this.navigationUrl = desired.href;
        const api = new URL('/api/users/overview', window.location.origin);
        api.search = desired.search;
        api.searchParams.set('collection', this.root.dataset.collection || '');
        api.searchParams.set('region', this.root.dataset.region || '');
        this.retryUrl = desired.href;
        this.retryHistory = history;
        this.retryAction = action;
        this.root.setAttribute('aria-busy', 'true');
        this.setStatus('Loading entities…');
        const errorBox = this.root.querySelector<HTMLElement>('.js-overview-error');
        if (errorBox) errorBox.hidden = true;
        let completed = false;
        try {
            const response = await get(api.pathname + api.search);
            if (generation !== this.generation || isEntityArchivePending()) return;
            if (response?.status !== 'success' || response.data?.regionId !== this.root.id || typeof response.data.html !== 'string' || typeof response.data.url !== 'string') {
                throw new Error('The overview could not be loaded. Please sign in again if your session expired.');
            }
            const active = document.activeElement as HTMLInputElement | null;
            const focusedSearch = !!active && this.root.contains(active) && active.matches('.js-search');
            const selection: [number | null, number | null] = focusedSearch ? [active!.selectionStart, active!.selectionEnd] : [null, null];
            const template = document.createElement('template');
            // Only the authenticated same-origin endpoint supplies this Pug-rendered fragment. Reject
            // login pages/wrong regions before insertion; user content is escaped by the shared mixins.
            template.innerHTML = response.data.html;
            const content = template.content.querySelector<HTMLElement>('.js-overview-content');
            if (!content) throw new Error('The overview response was incomplete. Please try again.');
            this.disposeDropdowns();
            this.content()?.replaceWith(content);
            this.updateCollectionCounts(content);
            const canonical = this.mergeUrl(response.data.url);
            this.navigationUrl = canonical.href;
            if (history === 'push') window.history.pushState(null, '', canonical);
            else if (history === 'replace') window.history.replaceState(null, '', canonical);
            this.restoreFocus(action, focusedSearch, selection);
            this.retryUrl = undefined;
            completed = true;
        } catch (error) {
            if (generation !== this.generation) return;
            this.navigationUrl = undefined;
            const message = this.root.querySelector<HTMLElement>('.js-overview-error-message');
            if (message) message.textContent = error instanceof Error ? error.message : 'Could not load this overview. Please try again.';
            if (errorBox) errorBox.hidden = false;
        } finally {
            if (generation === this.generation) {
                this.root.removeAttribute('aria-busy');
                // Announce through the stable status node: a newly inserted aria-live count may not
                // announce its initial text. The visible result count stays beside the search controls.
                const count = this.root.querySelector<HTMLElement>('.js-count')?.textContent || '0';
                this.setStatus(completed ? `${count} matching entities` : '', completed);
            }
        }
    }

    dispose(): void {
        this.clearTimer();
        this.generation++;
        this.root.removeEventListener('click', this.onClick);
        this.root.removeEventListener('submit', this.onSubmit);
        this.root.removeEventListener('input', this.onSearch);
        this.hiddenContainer?.removeEventListener('show.bs.collapse', this.onHiddenOpen);
        this.hiddenContainer?.removeEventListener('hide.bs.collapse', this.onHiddenClose);
        window.removeEventListener('popstate', this.onHistory);
        this.disposeDropdowns();
    }
}

/** Pages explicitly choose transport mode; shared event collections retain their existing local filter. */
export function initEntityOverview(selector: string, options?: {paged: boolean}): (() => void) | undefined {
    const root = document.querySelector(selector);
    if (!root) return undefined;
    if (options?.paged) {
        const overview = new PagedEntityOverview(root as HTMLElement);
        return () => overview.dispose();
    }
    new EntityOverview(root as HTMLElement);
    return undefined;
}
