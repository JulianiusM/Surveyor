/**
 * Packing list view functionality
 * Handles assignment, inline editing, reordering, and owner operations for packing lists
 */

import {assertSuccessfulResponse, post} from './core/http';
import {setCurrentNavLocation} from './core/navigation';
import {loadPerms, requireEntityPerm, requireItemPerm} from './core/permissions';
import {initEntityHeader} from "./modules/entity-header";
import {showInlineAlert} from './shared/alerts';
import {initTableReorder} from './shared/drag-drop';
import {initAssignButtons} from './shared/entity-assign';
import {startInlineEdit} from './shared/inline-edit';
import {initAssignmentRemoval, initItemDeletion, initQuickAdd} from './shared/list-actions';
import {reloadAfterDelay} from './shared/ui-helpers';

/**
 * Get the packing list ID from the window object
 */
function getPackListId(): string {
    return window.Surveyor.entityId ?? '';
}

/**
 * Initialize inline editing for packing list items
 */
function initInlineEdit(): void {
    const listId = getPackListId();

    document.querySelectorAll('td[data-edit]').forEach(td => {
        td.addEventListener('dblclick', () => {
            const cell = td as HTMLElement;
            // Packing exposes separate title/capacity grants. Keep its browser gate aligned
            // with the rendered cells and attribute route without changing other features.
            const permission = cell.dataset.edit === 'title' ? 'EDIT_TITLE'
                : cell.dataset.edit === 'maxAssignees' ? 'EDIT_CAPACITY' : undefined;
            startInlineEdit(cell, `/api/packing/${listId}/item`, permission, true);
        });
    });

}

/**
 * Initialize "required by all" toggle for items
 */
function initMarkEveryone(): void {
    const listId = getPackListId();
    const pending = new WeakMap<HTMLInputElement, boolean>();

    document.addEventListener('change', async (e: Event) => {
        const sw = (e.target as Element | null)?.closest('[data-required-toggle]') as HTMLInputElement | null;
        if (!sw) return;
        // Disabling blocks real clicks; a synthetic/repeated change must not start a second
        // write or change the value displayed for the command already in flight.
        if (pending.has(sw)) {
            sw.checked = pending.get(sw)!;
            return;
        }
        if (sw.disabled) return;

        const itemId = sw.dataset.itemid;
        const original = sw.defaultChecked;
        const desired = sw.checked;
        pending.set(sw, desired);
        sw.disabled = true;
        try {
            requireItemPerm(itemId || '', 'EDIT_META', 'toggle shared requirements', 'ITEM_EDIT');
            assertSuccessfulResponse(await post(`/api/packing/${listId}/item/${itemId}/required`, {flag: desired, expectedValue: original}));
            // Advance the saved baseline only after confirmed success. A second change before
            // the existing delayed reload must compare against this saved value, not page load.
            sw.defaultChecked = desired;
            sw.checked = desired;

            // Visual highlighting
            const row = document.querySelector(`tr[data-itemid="${itemId}"]`);
            if (row) row.classList.toggle('table-info', desired);

            reorderRequiredRows();
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(100);
        } catch (err) {
            sw.checked = original;
            const message = err instanceof Error ? err.message : 'Unable to update shared requirement.';
            showInlineAlert('error', message);
        } finally {
            pending.delete(sw);
            sw.disabled = false;
        }
    });
}

/**
 * Sort rows: "Everyone" items first, then by original position
 */
function reorderRequiredRows(): void {
    const table = document.querySelector('table[data-assignable]');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.children);
    rows.sort((a, b) => {
        const aReq = a.classList.contains('table-info') ? 0 : 1;
        const bReq = b.classList.contains('table-info') ? 0 : 1;
        if (aReq !== bReq) return aReq - bReq;  // Required first

        return Number((a as HTMLElement).dataset.pos) - Number((b as HTMLElement).dataset.pos); // Original order
    });
    rows.forEach(r => tbody.appendChild(r));
}

/**
 * Initialize local packed status tracking
 */
function initPackedToggle(): void {
    const listId = getPackListId();
    const prefix = `packed_${listId}_`;

    document.querySelectorAll('[data-packed]').forEach(cb => {
        const checkbox = cb as HTMLInputElement;
        const itemId = checkbox.dataset.itemid;
        const row = checkbox.closest('tr');
        const stored = localStorage.getItem(prefix + itemId) === '1';

        if (stored && row) markPacked(row, checkbox, true);

        cb.addEventListener('change', () => {
            if (row) {
                markPacked(row, checkbox, checkbox.checked);
            }
        });
    });

    function markPacked(row: HTMLTableRowElement, cb: HTMLInputElement, packed: boolean): void {
        const required = row.dataset.required;
        cb.checked = packed;

        if (packed) {
            localStorage.setItem(prefix + row.dataset.itemid, '1');
            row.classList.add('table-success');      // green
            row.classList.remove('table-info');      // remove blue
        } else {
            localStorage.removeItem(prefix + row.dataset.itemid);
            row.classList.remove('table-success');
            if (required) row.classList.add('table-info'); // restore original color
        }
    }
}

/**
 * Initialize all packing list functionality
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    reorderRequiredRows();

    const listId = getPackListId();
    if (listId) {
        initPackedToggle();

        // Initialize assignment buttons
        initAssignButtons({
            tableSelector: 'table[data-assignable]',
            baseUrl: `/api/packing/${listId}`,
        });

        // Initialize drag-and-drop reordering
        try {
            requireEntityPerm('ITEM_EDIT', 'reorder packing items');
            initTableReorder({
                tbodySelector: 'tbody[data-reorderable]',
                apiUrl: `/api/packing/${listId}/reorder`,
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
            baseUrl: `/api/packing/${listId}`,
        });

        initAssignmentRemoval({
            baseUrl: `/api/packing/${listId}`,
        });

        initMarkEveryone();

        initItemDeletion({
            baseUrl: `/api/packing/${listId}`,
            confirmMessage: 'Delete this item permanently?',
            successMessage: 'Item deleted',
        });

        initEntityHeader();
    }
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
