/**
 * Activity Filters Module
 * Handles date formatting and slot filtering functionality
 */

/**
 * Initialize date display formatting in table headers
 */
export function initDates(): void {
    document.querySelectorAll('th[data-date]').forEach(el => {
        const th = el as HTMLElement;
        const dateValue = th.dataset.date;
        if (!dateValue) return;
        const [y, m, day] = dateValue.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));

        const dayEl = th.querySelector('.day');
        if (dayEl) {
            dayEl.textContent = d.toLocaleDateString(undefined, {weekday: 'short'});
        }

        const dateEl = th.querySelector('.date');
        if (dateEl) {
            dateEl.textContent = d.toLocaleDateString();
        }
    });
}

/**
 * Initialize filter buttons for the schedule (All / My / Open)
 */
export function initSlotFilters(): void {
    const filterButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-slot-filter]')
    );
    if (!filterButtons.length) return;

    type FilterMode = 'all' | 'mine' | 'open';

    const applyFilter = (mode: FilterMode) => {
        const slots = document.querySelectorAll<HTMLElement>('.slot');
        slots.forEach((slot) => {
            // always start visible
            slot.classList.remove('d-none');

            if (mode === 'mine') {
                if (slot.dataset.my !== '1') {
                    slot.classList.add('d-none');
                }
            } else if (mode === 'open') {
                if (slot.dataset.open !== '1') {
                    slot.classList.add('d-none');
                }
            }
            // mode === 'all' → nothing to filter
        });
    };

    filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-slot-filter') as FilterMode | null;
            if (!mode) return;

            // visual active state
            filterButtons.forEach((b) => {
                b.classList.toggle('active', b === btn);
            });

            applyFilter(mode);
        });
    });

    // initial state
    applyFilter('all');
}
