/**
 * Drivers list view functionality
 * Handles assignment, inline editing, reordering, and owner operations for drivers lists
 */

import { setCurrentNavLocation } from '../core/navigation';
import { loadPerms } from '../core/permissions';
import { startInlineEdit, startInlineEditArea } from '../shared/inline-edit';
import { initAssignButtons } from '../shared/entity-assign';
import { initTableReorder } from '../shared/drag-drop';
import {
    initOwnerRemove,
    initOwnerFlags,
    initOwnerDeleteItem,
    initQuickAdd
} from '../shared/owner-operations';

/**
 * Get the drivers list ID from the window object
 */
function getDriversListId(): string {
    // @ts-expect-error TS(2339): Property 'DRIVERS_LIST_ID' does not exist
    return window.DRIVERS_LIST_ID;
}

/**
 * Initialize inline editing for drivers list items
 */
function initInlineEdit(): void {
    const listId = getDriversListId();

    document.querySelectorAll('td[data-edit]').forEach(td => {
        td.addEventListener('dblclick', () => {
            startInlineEdit(td as HTMLElement, `/api/drivers/${listId}/item`);
        });
    });

    document.querySelectorAll('[data-edit="planDescription"]').forEach(elem => {
        elem.addEventListener('dblclick', () => {
            startInlineEditArea(elem as HTMLElement, `/api/drivers/${listId}/description`);
        });
    });
}

/**
 * Initialize all drivers list functionality
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();

    const listId = getDriversListId();
    if (listId) {
        // Initialize assignment buttons
        initAssignButtons({
            tableSelector: 'table[data-assignable]',
            baseUrl: `/drivers/${listId}`,
        });

        // Initialize drag-and-drop reordering
        initTableReorder({
            tbodySelector: 'tbody[data-reorderable]',
            apiUrl: `/drivers/${listId}/reorder`,
            getItemId: (row) => row.dataset.itemid || '',
        });

        initInlineEdit();

        // Initialize quick add form
        initQuickAdd({
            formId: 'quickAddForm',
            baseUrl: `/drivers/${listId}`,
        });

        // Initialize owner operations
        initOwnerRemove({
            baseUrl: `/drivers/${listId}`,
        });

        initOwnerFlags({
            baseUrl: `/drivers/${listId}`,
        });

        initOwnerDeleteItem({
            baseUrl: `/drivers/${listId}`,
            confirmMessage: 'Delete this driver permanently?',
            successMessage: 'Driver deleted',
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
