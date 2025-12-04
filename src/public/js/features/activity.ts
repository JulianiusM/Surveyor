/**
 * Activity plan view functionality
 * Handles slot management, assignments, inline editing, and owner operations
 */

import { setCurrentNavLocation } from '../core/navigation';
import { post } from '../core/http';
import { showInlineAlert } from '../shared/alerts';
import { startInlineEdit, startInlineEditArea } from '../shared/inline-edit';
import { initCardReorder } from '../shared/drag-drop';
import { initOwnerRemove, initOwnerFlags } from '../shared/owner-operations';
import { getSelectValues } from '../core/form-utils';

/**
 * Get the activity plan ID from the window object
 */
function getActivityPlanId(): string {
    // @ts-expect-error TS(2304): Cannot find name 'ACT_PLAN_ID'
    return window.ACT_PLAN_ID;
}

/**
 * Initialize assign/unassign slot functionality
 */
function initAssign(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target?.closest('[data-action]');
        if (!btn) return;

        const card = btn.closest('.slot');
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        const role = btn.dataset.role;
        
        try {
            await post(`/activity/${planId}/${act}`, { slotId, role });
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}

/**
 * Initialize select2 for role selection
 */
function initSelectBox(): void {
    const planId = getActivityPlanId();

    $('.multiSelect').select2({
        placeholder: 'Add Roles',
        width: '100%',
        //@ts-ignore
        selectionCssClass: 'text-bg-dark',
        dropdownCssClass: 'text-bg-dark',
    });

    document.addEventListener('click', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target.closest('[data-addRoles]');
        if (!btn) return;

        const div = btn.closest('.role-assignment');
        if (!div) return;

        const sel = div.querySelector('select') as HTMLSelectElement;
        if (!sel) return;

        const slot = sel.dataset.id;
        const vals = getSelectValues(sel);

        try {
            await post(`/activity/${planId}/slot/${slot}/addRole`, { roles: vals });
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}

/**
 * Initialize inline editing for slots and plan description
 */
function initInlineEdit(): void {
    const planId = getActivityPlanId();

    document.addEventListener('dblclick', (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const desc = e.target.closest('[data-edit="planDescription"]');
        if (desc) return startInlineEditArea(desc, `/activity/${planId}/description`);

        // @ts-expect-error TS(2531): Object is possibly 'null'
        const card = e.target.closest('.slot');
        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (!card || e.target.closest('button')) return;

        /* choose editable span */
        // @ts-expect-error TS(2531): Object is possibly 'null'
        let span = e.target.closest('[data-edit]');

        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (!span && e.target.closest('.badge'))
            span = card.querySelector('[data-edit="maxAssignees"]');

        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (!span && e.target.closest('small'))
            span = card.querySelector('[data-edit="description"]');
        if (!span)
            span = card.querySelector('[data-edit="title"]');

        startInlineEdit(span, `/activity/${planId}/slot`);
    });
}

/**
 * Initialize slot deletion
 */
function initDelete(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target.closest('[data-delete-slot]');
        if (!btn) return;
        if (!confirm('Delete this slot?')) return;

        const id = btn.dataset.slotid;
        try {
            await post(`/activity/${planId}/slot/${id}/delete`, {});
            showInlineAlert('success', 'Deleted');
            setTimeout(() => location.reload(), 100);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}

/**
 * Initialize add slot functionality
 */
function initAddSlot(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target.closest('[data-add-slot]');
        if (!btn) return;

        // hide button, replace by small inline form
        const dateISO = btn.dataset.date;
        const cell = btn.parentElement;
        btn.remove();

        const wrap = document.createElement('div');
        wrap.className = 'd-grid gap-1';

        const title = document.createElement('input');
        title.className = 'form-control form-control-sm text-bg-dark';
        title.placeholder = 'Title';
        title.required = true;

        const desc = document.createElement('input');
        desc.className = 'form-control form-control-sm text-bg-dark';
        desc.placeholder = 'Description';

        const max = document.createElement('input');
        max.type = 'number';
        max.min = '1';
        max.value = '1';
        max.className = 'form-control form-control-sm text-bg-dark';

        const save = document.createElement('button');
        save.className = 'btn btn-sm btn-success mt-1';
        save.textContent = 'Add';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-sm btn-outline-secondary mt-1';
        cancel.textContent = '×';

        wrap.append(title, desc, max, save, cancel);
        cell.appendChild(wrap);

        cancel.onclick = () => {
            wrap.remove();
            cell.appendChild(btn);
        };

        save.onclick = async () => {
            try {
                await post(`/activity/${planId}/slot/add`, {
                    date: dateISO,
                    title: title.value.trim(),
                    description: desc.value.trim(),
                    maxAssignees: max.value,
                });
                showInlineAlert('success', 'Added');
                setTimeout(() => location.reload(), 100);
            } catch (err) {
                // @ts-expect-error TS(2571): Object is of type 'unknown'
                showInlineAlert('error', err.message);
            }
        };
    });
}

/**
 * Initialize drag-and-drop for slots
 */
function initDnD(): void {
    const planId = getActivityPlanId();

    initCardReorder({
        containerClass: 'slot-container',
        cardClass: 'slot',
        apiUrl: `/activity/${planId}/slot/reorder`,
        getOrderData: (container) => {
            return [...container.querySelectorAll('.slot')]
                .map((el, i) => ({ slotId: el.dataset.slotid, pos: i }));
        },
    });
}

/**
 * Initialize date display formatting
 */
function initDates(): void {
    document.querySelectorAll('th[data-date]').forEach(th => {
        // @ts-expect-error TS(2339): Property 'dataset' does not exist
        const [y, m, day] = th.dataset.date.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));

        // @ts-expect-error TS(2531): Object is possibly 'null'
        th.querySelector('.day').textContent =
            d.toLocaleDateString(undefined, { weekday: 'short' });

        // @ts-expect-error TS(2531): Object is possibly 'null'
        th.querySelector('.date').textContent = d.toLocaleDateString();
    });
}

/**
 * Initialize all activity plan functionality
 */
export function init(): void {
    setCurrentNavLocation();
    initDates();
    initSelectBox();

    const planId = getActivityPlanId();
    if (planId) {
        initAssign();
        initInlineEdit();
        initDelete();
        initAddSlot();
        initDnD();

        // Initialize owner operations
        initOwnerFlags({
            baseUrl: `/activity/${planId}`,
        });

        initOwnerRemove({
            baseUrl: `/activity/${planId}`,
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
