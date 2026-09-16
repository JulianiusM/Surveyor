// Bootstrap is provided by the shared layout, as for the other page modules. Describe only the existing
// dropdown instance operation used here; Bootstrap retains ownership of menu creation and positioning.
declare const bootstrap: {
    Dropdown: {
        getInstance(element: HTMLElement): {update(): void} | null;
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


/** Called once by the owning page module for each collection; absent optional collections are harmless. */
export function initEntityOverview(selector: string) {
    const root = document.querySelector(selector);
    if (root) new EntityOverview(root as HTMLElement);
}
