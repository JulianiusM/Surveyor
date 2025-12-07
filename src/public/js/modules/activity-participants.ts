/**
 * Activity Participants Tab Module
 * Handles filtering and search functionality for the participants list
 */

type ParticipantFilter = 'all' | 'assigned' | 'unassigned';

/**
 * Initialize participants tab with search and filter functionality
 */
export function initParticipantsTab(): void {
    const tab = document.getElementById('tab-participants');
    if (!tab) return;

    const searchInput = tab.querySelector<HTMLInputElement>('#participant-search');
    const filterButtons = Array.from(
        tab.querySelectorAll<HTMLButtonElement>('[data-participant-filter]')
    );
    const rows = Array.from(
        tab.querySelectorAll<HTMLTableRowElement>('[data-participant-row]')
    );

    if (!rows.length) return;

    let currentFilter: ParticipantFilter = 'all';
    let currentSearch = '';

    const applyFilters = () => {
        const search = currentSearch.trim().toLowerCase();

        rows.forEach((row) => {
            const name = (row.dataset.participantName || '').toLowerCase();
            const assigned = row.dataset.participantAssigned === '1';

            let visible = true;

            if (search && !name.includes(search)) {
                visible = false;
            }

            if (currentFilter === 'assigned' && !assigned) {
                visible = false;
            } else if (currentFilter === 'unassigned' && assigned) {
                visible = false;
            }

            row.classList.toggle('d-none', !visible);
        });
    };

    searchInput?.addEventListener('input', () => {
        currentSearch = searchInput.value || '';
        applyFilters();
    });

    filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-participant-filter') as ParticipantFilter | null;
            if (!mode) return;

            currentFilter = mode;
            filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
            applyFilters();
        });
    });

    // Initial state
    applyFilters();
}
