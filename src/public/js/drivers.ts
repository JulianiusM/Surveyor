/**
 * Drivers list view functionality
 * Handles assignment, inline editing, reordering, and owner operations for drivers lists
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms, requireEntityPerm} from './core/permissions';
import {startInlineEdit, startInlineEditArea} from './shared/inline-edit';
import {initAssignButtons} from './shared/entity-assign';
import {initTableReorder} from './shared/drag-drop';
import {initAssignmentRemoval, initItemDeletion, initQuickAdd} from './shared/list-actions';

/**
 * Get the drivers list ID from the window object
 */
function getDriversListId(): string {
    return window.Surveyor.entityId ?? '';
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
            startInlineEditArea(elem as HTMLElement, `/api/drivers/${listId}/description`, {
                scope: 'entity',
                key: 'EDIT_DESC',
                action: 'edit driver plan descriptions'
            });
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
        try {
            requireEntityPerm('ITEM_EDIT', 'reorder drivers');
            initTableReorder({
                tbodySelector: 'tbody[data-reorderable]',
                apiUrl: `/drivers/${listId}/reorder`,
                getItemId: (row) => row.dataset.itemid || '',
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Reordering not permitted.';
            console.warn(message);
        }

        initInlineEdit();

        // Initialize quick add form
        initQuickAdd({
            formId: 'quickAddForm',
            baseUrl: `/drivers/${listId}`,
        });

        initAssignmentRemoval({
            baseUrl: `/drivers/${listId}`,
        });

        initItemDeletion({
            baseUrl: `/drivers/${listId}`,
            confirmMessage: 'Delete this driver permanently?',
            successMessage: 'Driver deleted',
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
