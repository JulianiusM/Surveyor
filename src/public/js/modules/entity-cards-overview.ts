class EntityOverview {
    private typeFilter: Map<HTMLElement, string> = new Map();

    constructor(private root: HTMLElement) {
        this.init();
    }

    private init() {
        const sections = this.root.querySelectorAll<HTMLElement>(".accordion-item");

        sections.forEach(section => {
            const search = section.querySelector<HTMLInputElement>(".js-search");
            const items = Array.from(section.querySelectorAll<HTMLElement>(".js-item"));
            const count = section.querySelector<HTMLElement>(".js-count");
            const filterButtons = section.querySelectorAll<HTMLButtonElement>(".js-filter-type [data-type]");

            let activeType = "all";

            // TYPE FILTER
            filterButtons.forEach(btn => {
                btn.addEventListener("click", () => {
                    activeType = btn.dataset.type || "all";
                    this.applyFilter(section, items, search?.value || "", activeType, count);
                });
            });

            // SEARCH FILTER
            if (search) {
                search.addEventListener("input", () => {
                    this.applyFilter(section, items, search.value, activeType, count);
                });
            }

            // initial state
            this.applyFilter(section, items, "", "all", count);
        });
    }

    private applyFilter(
        section: HTMLElement,
        items: HTMLElement[],
        query: string,
        type: string,
        count?: HTMLElement | null
    ) {
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

            el.parentElement?.classList.toggle("d-none", !show);

            if (show) visible++;
        }

        if (count) {
            count.textContent = String(visible);
        }
    }
}


export function initEntityOverview(selector: string) {
    const root = document.querySelector(selector);
    if (root) new EntityOverview(root as HTMLElement);
}