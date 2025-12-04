/**
 * Core navigation utilities
 * Handles navigation state and highlighting
 */

/**
 * Set current navigation location in navbar as active
 */
export function setCurrentNavLocation(): void {
    const path = window.location.pathname;

    // Set corresponding nav items active
    if (path.includes("/settings")) {
        $("#settings").addClass("active");
    } else if (path.includes("/login")) {
        $("#login").addClass("active");
    } else if (path.includes("/register")) {
        $("#register").addClass("active");
    }
}

/**
 * Initialize entity list filtering
 * Adds search functionality to entity lists
 */
export function initEntityLists(): void {
    document.querySelectorAll('[data-filter="section"]').forEach(sec => {
        const input = sec.querySelector('input[type="search"]') as HTMLInputElement;
        const list = sec.querySelector('.js-list');
        const count = sec.querySelector('.js-count');
        if (!input || !list || !count) return;
        
        const items = Array.from(list.querySelectorAll('.list-group-item'));
        const total = items.length;
        
        const update = () => {
            const q = (input.value || '').trim().toLowerCase();
            let visible = 0;
            items.forEach(li => {
                const txt = (li.getAttribute('data-search') || li.textContent || '').toLowerCase();
                const show = !q || txt.includes(q);
                li.classList.toggle('d-none', !show);
                if (show) visible++;
            });
            count.textContent = `${visible}/${total}`;
        };
        
        // mark section for script
        sec.setAttribute('data-filter', 'section');
        input.addEventListener('input', update);
        update();
    });
}
