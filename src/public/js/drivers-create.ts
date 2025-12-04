/**
 * Drivers list creation functionality
 * Minimal form handling for drivers list creation
 */

import { setCurrentNavLocation } from '../core/navigation';
import type { DriversItem } from "../../modules/database/entities/drivers/DriversItem";

/**
 * Handle form submission - build JSON from form and submit
 * @param evt Submit event
 */
function handleSubmit(evt: Event): void {
    const form = document.getElementById('packingForm') as HTMLFormElement;
    const hiddenFld = document.getElementById('itemsJson') as HTMLInputElement;
    const tableBody = document.getElementById('itemTable');
    
    evt.preventDefault();
    
    const items: Partial<DriversItem>[] = [];

    if (tableBody) {
        tableBody.querySelectorAll('tr').forEach(tr => {
            // @ts-expect-error TS(2531): Object is possibly 'null'
            const tVal = tr.querySelector(`input[name^="t_"]`)?.value.trim();
            if (!tVal) return;
            
            items.push({
                title: tVal,
                // @ts-expect-error TS(2531): Object is possibly 'null'
                description: tr.querySelector(`input[name^="d_"]`)?.value.trim(),
                // @ts-expect-error TS(2531): Object is possibly 'null'
                maxAssignees: tr.querySelector(`input[name^="m_"]`)?.value
            });
        });
    }

    hiddenFld.value = JSON.stringify(items);
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
    initListeners();
}

// Expose to global scope
window.Surveyor.init = init;
