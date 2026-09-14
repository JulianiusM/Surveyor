const PREVIEW_COUNT = 6;
const initializedOverviews = new WeakSet<HTMLElement>();

/** Keep each payer's coverage together while limiting long lists to a usable page. */
export function initTakeoverOverviews(root: Document | HTMLElement = document): void {
    root.querySelectorAll<HTMLElement>('[data-takeover-overview]').forEach(overview => {
        if (initializedOverviews.has(overview)) return;
        initializedOverviews.add(overview);

        const search = overview.querySelector<HTMLInputElement>('[data-takeover-overview-search]');
        const pageSize = overview.querySelector<HTMLSelectElement>('[data-takeover-page-size]');
        const previous = overview.querySelector<HTMLButtonElement>('[data-takeover-previous]');
        const next = overview.querySelector<HTMLButtonElement>('[data-takeover-next]');
        const summary = overview.querySelector<HTMLElement>('[data-takeover-page-summary]');
        const empty = overview.querySelector<HTMLElement>('[data-takeover-empty]');
        const rows = Array.from(overview.querySelectorAll<HTMLElement>('[data-takeover-overview-row]')).map(element => ({
            element,
            chips: Array.from(element.querySelectorAll<HTMLElement>('[data-takeover-beneficiary]')),
            list: element.querySelector<HTMLElement>('[data-takeover-beneficiaries]'),
            controls: element.querySelector<HTMLElement>('[data-takeover-beneficiary-controls]'),
            summary: element.querySelector<HTMLElement>('[data-takeover-beneficiary-summary]'),
            expand: element.querySelector<HTMLButtonElement>('[data-takeover-expand]'),
            expanded: false,
        }));
        let page = 0;

        const render = () => {
            const query = search?.value.trim().toLocaleLowerCase() || '';
            const size = Number(pageSize?.value) || 10;
            const filtered = rows.filter(row => !query || (row.element.dataset.searchText || '').toLocaleLowerCase().includes(query));
            const pages = Math.max(1, Math.ceil(filtered.length / size));
            page = Math.min(page, pages - 1);
            const visible = new Set(filtered.slice(page * size, (page + 1) * size));

            rows.forEach(row => {
                row.element.hidden = !visible.has(row);
                if (row.element.hidden) return;

                // A beneficiary search must reveal matches even when they were beyond the preview.
                const filterBeneficiaries = !!query && !(row.element.dataset.payerName || '').toLocaleLowerCase().includes(query);
                const matchingChips = filterBeneficiaries
                    ? row.chips.filter(chip => (chip.dataset.beneficiaryName || '').toLocaleLowerCase().includes(query))
                    : row.chips;
                const shownChips = new Set(row.expanded ? matchingChips : matchingChips.slice(0, PREVIEW_COUNT));
                row.chips.forEach(chip => { chip.hidden = !shownChips.has(chip); });
                if (row.list) {
                    row.list.setAttribute('data-expanded', String(row.expanded));
                    row.list.setAttribute('tabindex', row.expanded ? '0' : '-1');
                }
                const canExpand = matchingChips.length > PREVIEW_COUNT;
                if (row.controls) row.controls.hidden = !canExpand && !filterBeneficiaries;
                if (row.summary) row.summary.textContent = filterBeneficiaries
                    ? `${shownChips.size} of ${matchingChips.length} matching participant${matchingChips.length === 1 ? '' : 's'}`
                    : `${shownChips.size} of ${row.chips.length} participants shown`;
                if (row.expand) {
                    row.expand.hidden = !canExpand;
                    row.expand.textContent = row.expanded ? 'Show fewer' : `Show all ${matchingChips.length}`;
                    row.expand.setAttribute('aria-expanded', String(row.expanded));
                    row.expand.setAttribute('aria-label', `${row.expanded ? 'Show fewer covered participants' : `Show all ${matchingChips.length} covered participants`} for ${row.element.dataset.payerName}`);
                }
            });

            if (empty) empty.hidden = filtered.length > 0;
            if (previous) previous.disabled = page === 0;
            if (next) next.disabled = page >= pages - 1;
            if (summary) summary.textContent = filtered.length
                ? `${page * size + 1}–${Math.min((page + 1) * size, filtered.length)} of ${filtered.length} payer${filtered.length === 1 ? '' : 's'}${query ? ` matching “${search?.value.trim()}”` : ''}`
                : '0 payers';
        };

        rows.forEach(row => row.expand?.addEventListener('click', () => {
            row.expanded = !row.expanded;
            if (row.list) row.list.scrollTop = 0;
            render();
        }));
        search?.addEventListener('input', () => {
            page = 0;
            rows.forEach(row => {
                row.expanded = false;
                if (row.list) row.list.scrollTop = 0;
            });
            render();
        });
        pageSize?.addEventListener('change', () => { page = 0; render(); });
        previous?.addEventListener('click', () => {
            page = Math.max(0, page - 1);
            render();
            search?.scrollIntoView({block: 'nearest'});
        });
        next?.addEventListener('click', () => {
            page += 1;
            render();
            search?.scrollIntoView({block: 'nearest'});
        });
        render();
    });
}
