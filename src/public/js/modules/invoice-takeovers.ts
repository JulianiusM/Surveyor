import {invoiceText} from '../../../modules/invoice/wording';

const PREVIEW_COUNT = 6;
const initializedOverviews = new WeakSet<HTMLElement>();

/** Keep each payer's coverage together while limiting long lists to a usable page. */
export function initTakeoverOverviews(root: Document | HTMLElement = document): void {
    // Each pool owns its search, paging, and expansion state; repeated initialization is harmless.
    for (const overview of root.querySelectorAll<HTMLElement>('[data-takeover-overview]')) {
    if (initializedOverviews.has(overview)) continue;
    initializedOverviews.add(overview);
    initTakeoverOverview(overview);
    }
}

/** Bind one coverage table without sharing navigation state with another pool. */
function initTakeoverOverview(overview: HTMLElement): void {
    // Capture the rendered hooks once. Coverage is display-only: these controls never save changes.
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

    /** Render the current page and each visible payer's preview or expanded coverage. */
    function render(): void {
        // Clamp navigation after filtering so every nonempty result has a visible page.
        const query = search?.value.trim().toLocaleLowerCase() || '';
        const size = Number(pageSize?.value) || 10;
        const filtered = rows.filter(row => !query || (row.element.dataset.searchText || '').toLocaleLowerCase().includes(query));
        const pages = Math.max(1, Math.ceil(filtered.length / size));
        page = Math.min(page, pages - 1);
        const visible = new Set(filtered.slice(page * size, (page + 1) * size));

        for (const row of rows) {
            row.element.hidden = !visible.has(row);
            if (row.element.hidden) continue;

            // A beneficiary search must reveal matches even when they were beyond the preview.
            const filterBeneficiaries = !!query && !(row.element.dataset.payerName || '').toLocaleLowerCase().includes(query);
            const matchingChips = filterBeneficiaries
                ? row.chips.filter(chip => (chip.dataset.beneficiaryName || '').toLocaleLowerCase().includes(query))
                : row.chips;
            const shownChips = new Set(row.expanded ? matchingChips : matchingChips.slice(0, PREVIEW_COUNT));
            for (const chip of row.chips) chip.hidden = !shownChips.has(chip);
            if (row.list) {
                row.list.setAttribute('data-expanded', String(row.expanded));
                row.list.setAttribute('tabindex', row.expanded ? '0' : '-1');
            }
            const canExpand = matchingChips.length > PREVIEW_COUNT;
            if (row.controls) row.controls.hidden = !canExpand && !filterBeneficiaries;
            if (row.summary) row.summary.textContent = filterBeneficiaries
                ? invoiceText('matchingCoverageSummary', {shown: shownChips.size, count: matchingChips.length})
                : invoiceText('shownCoverageSummary', {shown: shownChips.size, count: row.chips.length});
            if (row.expand) {
                row.expand.hidden = !canExpand;
                row.expand.textContent = invoiceText(row.expanded ? 'showFewerCovered' : 'showAllCovered', {count: matchingChips.length});
                row.expand.setAttribute('aria-expanded', String(row.expanded));
                row.expand.setAttribute('aria-label', invoiceText(row.expanded ? 'showFewerCoveredForPayer' : 'showAllCoveredForPayer', {
                    count: matchingChips.length, payer: row.element.dataset.payerName || '',
                }));
            }
        }

        // Update navigation and accessible counts using whole, plural-aware catalog messages.
        if (empty) empty.hidden = filtered.length > 0;
        if (previous) previous.disabled = page === 0;
        if (next) next.disabled = page >= pages - 1;
        if (summary) summary.textContent = filtered.length
            ? invoiceText(query ? 'takeoverSearchSummary' : 'takeoverPageSummary', {
                start: page * size + 1, end: Math.min((page + 1) * size, filtered.length),
                count: filtered.length, query: search?.value.trim() || '',
            })
            : invoiceText('noTakeoverPayers');
    }

    // Named handlers keep the interaction flow visible and prevent nested callback chains.
    for (const row of rows) {
        /** Toggle display-only coverage expansion for one payer and reset its scroll position. */
        function toggleCoverage(): void {
            row.expanded = !row.expanded;
            if (row.list) row.list.scrollTop = 0;
            render();
        }
        row.expand?.addEventListener('click', toggleCoverage);
    }
    /** Reset paging and expanded coverage before showing a new payer or beneficiary search. */
    function searchCoverage(): void {
        page = 0;
        for (const row of rows) {
            row.expanded = false;
            if (row.list) row.list.scrollTop = 0;
        }
        render();
    }
    /** Reset coverage paging after a display page-size change. */
    function resizePage(): void { page = 0; render(); }
    /** Show the previous coverage page and keep its search controls in view. */
    function previousPage(): void {
        page = Math.max(0, page - 1);
        render();
        search?.scrollIntoView({block: 'nearest'});
    }
    /** Show the next coverage page and keep its search controls in view. */
    function nextPage(): void {
        page += 1;
        render();
        search?.scrollIntoView({block: 'nearest'});
    }
    search?.addEventListener('input', searchCoverage);
    pageSize?.addEventListener('change', resizePage);
    previous?.addEventListener('click', previousPage);
    next?.addEventListener('click', nextPage);
    render();
}
