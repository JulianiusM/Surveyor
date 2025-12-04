/**
 * Packing list view functionality
 * Handles assignment, inline editing, reordering, and owner operations for packing lists
 */

import { setCurrentNavLocation } from './core/navigation';
import { loadPerms } from './core/permissions';
import { post } from './core/http';
import { showInlineAlert } from './shared/alerts';
import { startInlineEdit, startInlineEditArea } from './shared/inline-edit';
import { initAssignButtons } from './shared/entity-assign';
import { initTableReorder } from './shared/drag-drop';
import { reloadAfterDelay } from './shared/ui-helpers';
import {
    initOwnerRemove,
    initOwnerFlags,
    initOwnerDeleteItem,
    initQuickAdd
} from '../shared/owner-operations';

/**
 * Get the packing list ID from the window object
 */
function getPackListId(): string {
    // @ts-expect-error TS(2339): Property 'PACK_LIST_ID' does not exist
    return window.PACK_LIST_ID;
}

/**
 * Initialize inline editing for packing list items
 */
function initInlineEdit(): void {
    const listId = getPackListId();

    document.querySelectorAll('td[data-edit]').forEach(td => {
        td.addEventListener('dblclick', () => {
            startInlineEdit(td as HTMLElement, `/api/packing/${listId}/item`);
        });
    });

    document.querySelectorAll('[data-edit="planDescription"]').forEach(elem => {
        elem.addEventListener('dblclick', () => {
            startInlineEditArea(elem as HTMLElement, `/api/packing/${listId}/description`);
        });
    });
}

/**
 * Initialize "required by all" toggle for items
 */
function initMarkEveryone(): void {
    const listId = getPackListId();

    document.addEventListener('change', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const sw = e.target.closest('[data-required-toggle]');
        if (!sw) return;

        const itemId = sw.dataset.itemid;
        try {
            await post(`/api/packing/${listId}/item/${itemId}/required`, { flag: sw.checked });
            
            // Visual highlighting
            const row = document.querySelector(`tr[data-itemid="${itemId}"]`);
            if (row) row.classList.toggle('table-info', sw.checked);
            
            reorderRequiredRows();
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(100);
        } catch (err) {
            sw.checked = !sw.checked;  // rollback
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
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

        // @ts-expect-error TS(2339): Property 'dataset' does not exist
        return Number(a.dataset.pos) - Number(b.dataset.pos); // Original order
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
        // @ts-expect-error TS(2339): Property 'dataset' does not exist
        const itemId = cb.dataset.itemid;
        const row = cb.closest('tr');
        const stored = localStorage.getItem(prefix + itemId) === '1';

        if (stored) markPacked(row, cb, true);

        cb.addEventListener('change', () => {
            // @ts-expect-error TS(2339): Property 'checked' does not exist
            markPacked(row, cb, cb.checked);
        });
    });

    function markPacked(row: any, cb: any, packed: boolean): void {
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
            baseUrl: `/packing/${listId}`,
        });

        // Initialize drag-and-drop reordering
        initTableReorder({
            tbodySelector: 'tbody[data-reorderable]',
            apiUrl: `/packing/${listId}/reorder`,
            getItemId: (row) => row.dataset.itemid || '',
        });

        initInlineEdit();
        
        // Initialize quick add form
        initQuickAdd({
            formId: 'quickAddForm',
            baseUrl: `/packing/${listId}`,
        });

        // Initialize owner operations
        initOwnerRemove({
            baseUrl: `/packing/${listId}`,
        });

        initMarkEveryone();

        initOwnerFlags({
            baseUrl: `/packing/${listId}`,
        });

        initOwnerDeleteItem({
            baseUrl: `/packing/${listId}`,
            confirmMessage: 'Delete this item permanently?',
            successMessage: 'Item deleted',
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
