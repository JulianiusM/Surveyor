/**
 * Entity picker initializer (TypeScript)
 * Mirrors the previous JS behavior but with strong typing and zero external deps.
 */

/**
 * Initialize a searchable single-select entity picker bound to DOM elements
 * created by the Pug mixin (hidden input, button label, modal with list).
 *
 * @param id id-prefix used by the mixin (hidden input has id=id)
 * @param opts   optional configuration ({ value, placeholderLabel })
 * @param entities array of entity items ({ id, title, description? })
 */
interface EntityOption {
    id: string | number;
    title?: string;
    description?: string;
    dateIso?: string;
    name?: string;
}

interface BootstrapModalCtor {
    getInstance: (element: Element) => BootstrapModalInstance | null;
    new(element: Element): BootstrapModalInstance;
}

interface BootstrapModalInstance {
    hide: () => void;
}

declare global {
    interface Window {
        bootstrap?: { Modal: BootstrapModalCtor };
    }
}

export function initEntitySelect(
    id: string,
    entities: EntityOption[],
    opts: { value?: unknown; placeholderLabel?: string },
): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const btnLabel = document.getElementById(`${id}-btn-label`) as HTMLElement | null;
    const list = document.getElementById(`${id}-list`) as HTMLUListElement | null;
    const search = document.getElementById(`${id}-search`) as HTMLInputElement | null;
    const empty = document.getElementById(`${id}-empty`) as HTMLElement | null;
    const sr = document.getElementById(`${id}-sr`) as HTMLElement | null;
    const modalEl = document.getElementById(`${id}-modal`);

    if (!input || !btnLabel || !list || !search || !modalEl) {
        // Fail safe without throwing; developer hint only.
        // eslint-disable-next-line no-console
        console.warn(`[entity-select] Missing elements for baseId=${id}`, {
            input: !!input, btnLabel: !!btnLabel, list: !!list, search: !!search, modalEl: !!modalEl
        });
        return;
    }

    // Normalize data and options
    const data: EntityOption[] = Array.isArray(entities) ? entities.slice() : [];
    const placeholder = opts.placeholderLabel || "Select entity";
    let selectedId: string = resolveStringId(input.value || opts.value);

    // ---- Helpers -------------------------------------------------------------

    function resolveStringId(id: unknown): string {
        if (id === null || id === undefined) return "";
        return String(id);
    }

    function findEventById(id: string): any | undefined {
        return data.find(e => resolveStringId(e.id) === id);
    }

    function setButtonLabelById(id: string): void {
        if (!id) {
            btnLabel.textContent = placeholder;
            return;
        }
        const ev = findEventById(id);
        btnLabel.textContent = ev?.title || placeholder;
    }

    function announceResultCount(n: number): void {
        if (sr) sr.textContent = `${n} result${n === 1 ? "" : "s"}.`;
    }

    function render(items: any[]): void {
        list.innerHTML = "";

        if (!items.length) {
            empty?.classList.remove("d-none");
            announceResultCount(0);
            return;
        }

        empty?.classList.add("d-none");
        announceResultCount(items.length);

        for (const ev of items) {
            const li = document.createElement("li");
            li.className = "list-group-item text-bg-dark";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn w-100 text-start text-truncate btn-outline-light";
            btn.setAttribute("role", "option");
            btn.dataset.eventId = resolveStringId(ev.id);

            if (btn.dataset.eventId === selectedId) {
                btn.classList.add("active");
            }

            const title = document.createElement("div");
            title.className = "fw-semibold";
            title.textContent = ev.title ?? `(untitled #${ev.id})`;
            btn.appendChild(title);

            const metaParts: string[] = [];
            if (ev.dateIso) metaParts.push(String(ev.dateIso));
            if (ev.description) metaParts.push(String(ev.description));

            if (metaParts.length) {
                const meta = document.createElement("div");
                meta.className = "small text-secondary text-truncate";
                meta.textContent = metaParts.join(" · ");
                btn.appendChild(meta);
            }

            li.appendChild(btn);
            list.appendChild(li);
        }
    }

    function closeModalIfBootstrapPresent(): void {
        const bs = window.bootstrap;
        const Ctor = bs?.Modal;
        if (!Ctor) return;
        const inst = Ctor.getInstance(modalEl) ?? new Ctor(modalEl);
        inst.hide();
    }

    function select(id: string): void {
        selectedId = id;
        input.value = selectedId;
        setButtonLabelById(selectedId);

        // Update active state in list
        list.querySelectorAll<HTMLButtonElement>("button[data-event-id]").forEach(b => {
            if (b.dataset.eventId === selectedId) b.classList.add("active");
            else b.classList.remove("active");
        });

        // Close via Bootstrap if available
        closeModalIfBootstrapPresent();
    }

    function filterByTitle(query: string): any[] {
        const q = query.trim().toLowerCase();
        if (!q) return data;
        return data.filter(ev => (ev.title || "").toLowerCase().includes(q) || (ev.description || "").toLowerCase().includes(q) || (ev.name || "").toLowerCase().includes(q));
    }

    // ---- Wire up interactions -----------------------------------------------

    list.addEventListener("click", (e: MouseEvent) => {
        const target = e.target as Element | null;
        const btn = target?.closest("button[data-event-id]") as HTMLButtonElement | null;
        if (!btn) return;
        const id = btn.dataset.eventId ? String(btn.dataset.eventId) : "";
        select(id);
    });

    search.addEventListener("input", () => {
        render(filterByTitle(search.value));
    });

    // If Bootstrap is present, focus the search field when the modal opens
    modalEl.addEventListener("shown.bs.modal" as any, () => {
        // Delay focus slightly to ensure rendering is settled even without transitions
        setTimeout(() => search.focus(), 10);
    });

    // ---- Initialize ----------------------------------------------------------

    setButtonLabelById(selectedId);
    render(data);
}