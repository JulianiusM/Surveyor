/**
 * Drivers list creation functionality
 * Minimal form handling for drivers list creation
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';
import type {DriversItem} from "../../modules/database/entities/drivers/DriversItem";

/**
 * Handle form submission - build JSON from form and submit
 * @param evt Submit event
 */
export function collectDriversItems(tableBody: Element | null): Partial<DriversItem>[] {
    const items: Partial<DriversItem>[] = [];

    if (tableBody) {
        tableBody.querySelectorAll('tr').forEach(tr => {
            const titleInput = tr.querySelector<HTMLInputElement>('input[name^="t_"]');
            const tVal = titleInput?.value.trim();
            if (!tVal) return;

            const descInput = tr.querySelector<HTMLInputElement>('input[name^="d_"]');
            const maxInput = tr.querySelector<HTMLInputElement>('input[name^="m_"]');
            items.push({
                title: tVal,
                description: descInput?.value.trim(),
                maxAssignees: Number.parseInt(maxInput?.value || "1")
            });
        });
    }

    return items;
}

function handleSubmit(evt: Event): void {
    const form = document.getElementById('packingForm') as HTMLFormElement;
    const hiddenFld = document.getElementById('itemsJson') as HTMLInputElement;
    const tableBody = document.getElementById('itemTable');

    evt.preventDefault();
    hiddenFld.value = JSON.stringify(collectDriversItems(tableBody));
    form.submit();
}

/**
 * Initialize event listeners
 */
function initListeners(): void {
    const form = document.getElementById('packingForm');
    form?.addEventListener('submit', handleSubmit);
}

/**
 * Initialize drivers list creation page
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initListeners();
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
