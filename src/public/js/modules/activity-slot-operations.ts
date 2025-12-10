/**
 * Activity Slot Operations Module
 * Handles basic slot operations: inline editing and deletion
 */

import {post} from '../core/http';
import {requireEntityPerm, requireItemPerm} from '../core/permissions';
import {showInlineAlert} from '../shared/alerts';
import {initCardReorder} from "../shared/drag-drop";
import {startInlineEdit, startInlineEditArea} from '../shared/inline-edit';
import {reloadAfterDelay} from '../shared/ui-helpers';

/**
 * Initialize inline editing for slots and plan description
 */
export function initInlineEdit(planId: string): void {
    document.addEventListener('dblclick', (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;

        // Plan description
        const desc = target.closest<HTMLElement>('[data-edit="planDescription"]');
        if (desc) {
            return startInlineEditArea(desc, `/api/activity/${planId}/description`, {
                scope: 'entity',
                key: 'EDIT_DESC',
                action: 'edit activity descriptions',
            });
        }

        const textField = target.closest<HTMLElement>('[data-edit="textField"]');
        if (textField && textField.dataset.id) {
            return startInlineEditArea(
                textField,
                `/api/activity/${planId}/text-field/${textField.dataset.id}`,
                {
                    scope: 'entity',
                    key: 'ACCESS_VIEW',
                    action: 'edit shared text fields',
                },
                {
                    payloadKey: 'text',
                    successMessage: 'Text updated',
                    placeholder: textField.dataset.placeholder || 'double-click to edit',
                    maxLength: 5000,
                    onSave: () => reloadAfterDelay(100),
                },
            );
        }

        // For slots: allow double-click only on actual editable elements
        const editable = target.closest<HTMLElement>('.slot [data-edit]');
        if (!editable) return;

        // Ignore double-click on buttons
        if (target.closest('button')) return;

        startInlineEdit(editable, `/api/activity/${planId}/slot`);
    });
}

/**
 * Initialize slot deletion
 */
export function initDelete(planId: string): void {
    document.addEventListener('click', async (e: Event) => {
        const target = e.target as Element;
        if (!target) return;

        const btn = target.closest('[data-delete-slot]');
        if (!btn) return;
        if (!confirm('Delete this slot?')) return;

        const id = (btn as HTMLElement).dataset.slotid;
        try {
            requireItemPerm(id || '', 'ITEM_DELETE', 'delete slots', 'ITEM_DELETE');
            await post(`/api/activity/${planId}/slot/${id}/delete`, {});
            showInlineAlert('success', 'Deleted');
            reloadAfterDelay(100);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to delete slot.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize drag-and-drop for slots
 */
export function initDnD(planId: string): void {
    try {
        requireEntityPerm('ITEM_EDIT', 'reorder slots');
    } catch (err) {
        return;
    }

    initCardReorder({
        containerClass: 'slot-container',
        cardClass: 'slot',
        apiUrl: `/api/activity/${planId}/slot/reorder`,
        getOrderData: (container) => {
            return [...container.querySelectorAll<HTMLElement>('.slot')]
                .map((el, i) => ({slotId: el.dataset.slotid, pos: i}));
        },
    });
}
