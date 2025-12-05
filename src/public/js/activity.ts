/**
 * Activity plan view functionality
 * Handles slot management, assignments, inline editing, and owner operations
 */

import {setCurrentNavLocation} from './core/navigation';
import {post} from './core/http';
import {showInlineAlert} from './shared/alerts';
import {startInlineEdit, startInlineEditArea} from './shared/inline-edit';
import {initCardReorder} from './shared/drag-drop';
import {initAssignmentRemoval} from './shared/list-actions';
import {getSelectValues} from './core/form-utils';
import {reloadAfterDelay} from './shared/ui-helpers';
import {loadPerms, requireEntityPerm, requireItemPerm} from './core/permissions';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: {focus?: boolean}) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

type WarningType = "outside_attendance" | "arrival_day" | "departure_day" | "overlap" | "over_capacity";

interface AssignmentWarning {
    type: WarningType;
    conflicts?: string[];
}

interface WarningModal {
    confirm(warnings: AssignmentWarning[], slotId: string): Promise<boolean>;
}

function formatTimeLabel(time?: string | null): string {
    if (!time) return "";
    return time.slice(0, 5);
}

function describeSlot(slotId: string): string {
    const slotEl = document.querySelector<HTMLElement>(`.slot[data-slotid="${slotId}"]`);
    if (!slotEl) return `slot ${slotId}`;

    const title = slotEl.querySelector<HTMLElement>('[data-edit="title"]')?.textContent?.trim();
    const day = slotEl.dataset.day
        || slotEl.closest<HTMLElement>('.slot-container')?.dataset.date
        || '';
    const start = formatTimeLabel(slotEl.dataset.start || null);
    const end = formatTimeLabel(slotEl.dataset.end || null);

    const timePart = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${title || 'Slot'}${day ? ` on ${day}` : ''}${timePart}`;
}

function describeWarning(warning: AssignmentWarning): string {
    switch (warning.type) {
    case "outside_attendance":
        return "This slot is outside your attendance window.";
    case "arrival_day":
        return "This slot is on your arrival day.";
    case "departure_day":
        return "This slot is on your departure day.";
    case "over_capacity":
        return "This slot is already full.";
    case "overlap": {
        const conflicts = (warning.conflicts || []).map(describeSlot);
        const detail = conflicts.length ? `: ${conflicts.join(', ')}` : '';
        return `This slot overlaps with another assignment${detail}`;
    }
    default:
        return "Assignment warning detected.";
    }
}

function buildWarningModal(): WarningModal {
    const modalEl = document.getElementById('assignmentWarningModal');
    const list = document.getElementById('assignmentWarningList');
    const titleEl = document.getElementById('assignmentWarningSlot');
    const confirmBtn = document.getElementById('assignmentWarningConfirm') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('assignmentWarningCancel') as HTMLButtonElement | null;

    const modal = modalEl && typeof bootstrap !== 'undefined'
        ? new bootstrap.Modal(modalEl, {focus: true})
        : null;

    async function confirm(warnings: AssignmentWarning[], slotId: string): Promise<boolean> {
        if (!warnings.length) return true;
        if (!modal || !modalEl || !list || !confirmBtn || !cancelBtn) {
            const proceed = window.confirm(
                `Warnings detected for this assignment. Proceed?\n${warnings.map(describeWarning).join('\n')}`,
            );
            return Promise.resolve(proceed);
        }

        const title = describeSlot(slotId);
        if (titleEl) titleEl.textContent = title;

        list.innerHTML = '';
        warnings.forEach((warning) => {
            const li = document.createElement('li');
            li.className = 'list-group-item text-bg-dark d-flex align-items-start gap-2';
            li.innerHTML = `<i class="bi bi-exclamation-triangle text-warning"></i><span>${describeWarning(warning)}</span>`;
            list.appendChild(li);
        });

        return await new Promise((resolve) => {
            let settled = false;

            function cleanup(result: boolean) {
                if (settled) return;
                settled = true;
                confirmBtn.disabled = false;
                modal.hide();
                resolve(result);
            }

            const onHidden = () => cleanup(false);
            modalEl.addEventListener('hidden.bs.modal', onHidden, {once: true});

            confirmBtn.onclick = async () => {
                confirmBtn.disabled = true;
                cleanup(true);
            };

            cancelBtn.onclick = () => cleanup(false);
            modal.show();
        });
    }

    return {confirm};
}

/**
 * Get the activity plan ID from the window object
 */
function getActivityPlanId(): string {
    return window.ACT_PLAN_ID ?? '';
}

/**
 * Initialize assign/unassign slot functionality
 */
function initAssign(warningModal: WarningModal): void {
    const planId = getActivityPlanId();

    async function fetchWarnings(slotId: string): Promise<AssignmentWarning[]> {
        try {
            const res = await post(`/api/activity/${planId}/slot/${slotId}/warnings`, {});
            return res?.data?.warnings || [];
        } catch {
            return [];
        }
    }

    document.addEventListener('click', async (e: Event) => {
        const btn = (e.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
        if (!btn) return;

        const card = btn.closest('.slot') as HTMLElement | null;
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        const role = btn.dataset.role;

        const performUpdate = async () => {
            await post(`/api/activity/${planId}/${act}`, {slotId, role});
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(120);
        };

        try {
            if (act === 'assign') {
                const warnings = await fetchWarnings(slotId);
                const proceed = await warningModal.confirm(warnings, slotId);
                if (!proceed) return;
            }

            await performUpdate();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update slot assignment.';
            showInlineAlert('error', message);
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
        const btn = (e.target as Element | null)?.closest('[data-addRoles]');
        if (!btn) return;

        const div = btn.closest('.role-assignment');
        if (!div) return;

        const sel = div.querySelector('select');
        if (!sel) return;

        const slot = sel.dataset.id;
        const vals = getSelectValues(sel);

        try {
            requireItemPerm(slot || '', 'EDIT_META', 'manage slot roles', 'ITEM_EDIT');
            await post(`/api/activity/${planId}/slot/${slot}/addRole`, {roles: vals});
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(120);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to update roles for this slot.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize inline editing for slots and plan description
 */
function initInlineEdit(): void {
    const planId = getActivityPlanId();

    document.addEventListener('dblclick', (e: Event) => {
        const target = e.target as Element;
        if (!target) return;

        const desc = target.closest<HTMLElement>('[data-edit="planDescription"]');
        if (desc) return startInlineEditArea(desc, `/api/activity/${planId}/description`, {
            scope: 'entity',
            key: 'EDIT_DESC',
            action: 'edit activity descriptions'
        });

        const card = target.closest('.slot');
        if (!card || target.closest('button')) return;

        /* choose editable span */
        let span = target.closest<HTMLElement>('[data-edit]');

        if (!span && target.closest('.badge'))
            span = card.querySelector('[data-edit="maxAssignees"]');

        if (!span && target.closest('small'))
            span = card.querySelector('[data-edit="description"]');
        if (!span)
            span = card.querySelector('[data-edit="title"]');

        if (span) startInlineEdit(span, `/api/activity/${planId}/slot`);
    });
}

/**
 * Initialize slot deletion
 */
function initDelete(): void {
    const planId = getActivityPlanId();

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
 * Initialize add slot functionality
 */
function initAddSlot(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', (e: Event) => {
        const btn: HTMLButtonElement | undefined | null = (e.target as HTMLButtonElement | null)?.closest('[data-add-slot]');
        if (!btn) return;

        // hide button, replace by small inline form
        const dateISO = btn.dataset.date;
        const cell = btn.parentElement;
        if (!cell) return;
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

        const startTime = document.createElement('input');
        startTime.type = 'time';
        startTime.className = 'form-control form-control-sm text-bg-dark';
        startTime.placeholder = 'Start';

        const endTime = document.createElement('input');
        endTime.type = 'time';
        endTime.className = 'form-control form-control-sm text-bg-dark';
        endTime.placeholder = 'End';

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

        wrap.append(title, desc, startTime, endTime, max, save, cancel);
        cell.appendChild(wrap);

        cancel.onclick = () => {
            wrap.remove();
            cell.appendChild(btn);
        };

        save.onclick = async () => {
            try {
                requireEntityPerm('ITEM_ADD', 'add slots');
                const startVal = startTime.value ? `${startTime.value}:00` : null;
                const endVal = endTime.value ? `${endTime.value}:00` : null;
                await post(`/api/activity/${planId}/slot/add`, {
                    date: dateISO,
                    title: title.value.trim(),
                    description: desc.value.trim(),
                    startTime: startVal,
                    endTime: endVal,
                    maxAssignees: max.value,
                });
                showInlineAlert('success', 'Added');
                reloadAfterDelay(100);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unable to add the slot.';
                showInlineAlert('error', message);
            }
        };
    });
}

/**
 * Initialize drag-and-drop for slots
 */
function initDnD(): void {
    const planId = getActivityPlanId();

    try {
        requireEntityPerm('ITEM_EDIT', 'reorder slots');
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Reordering is not allowed.';
        showInlineAlert('error', message);
        return;
    }

    initCardReorder({
        containerClass: 'slot-container',
        cardClass: 'slot',
        apiUrl: `/activity/${planId}/slot/reorder`,
        getOrderData: (container) => {
            return [...container.querySelectorAll<HTMLElement>('.slot')]
                .map((el, i) => ({slotId: el.dataset.slotid, pos: i}));
        },
    });
}

/**
 * Initialize date display formatting
 */
function initDates(): void {
    document.querySelectorAll('th[data-date]').forEach(el => {
        const th = el as HTMLElement;
        const dateValue = th.dataset.date;
        if (!dateValue) return;
        const [y, m, day] = dateValue.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));

        const dayEl = th.querySelector('.day');
        if (dayEl) {
            dayEl.textContent = d.toLocaleDateString(undefined, {weekday: 'short'});
        }

        const dateEl = th.querySelector('.date');
        if (dateEl) {
            dateEl.textContent = d.toLocaleDateString();
        }
    });
}

/**
 * Initialize all activity plan functionality
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initDates();
    initSelectBox();

    const planId = getActivityPlanId();
    if (planId) {
        const warningModal = buildWarningModal();
        initAssign(warningModal);
        initInlineEdit();
        initDelete();
        initAddSlot();
        initDnD();

        initAssignmentRemoval({
            baseUrl: `/activity/${planId}`,
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
