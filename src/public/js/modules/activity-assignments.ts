/**
 * Activity Assignments Module
 * Handles assignment warnings and take/leave actions
 */

import {post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {reloadAfterDelay} from '../shared/ui-helpers';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

export type WarningType =
    | "outside_attendance"
    | "arrival_day"
    | "departure_day"
    | "arrival_time_restricted"
    | "departure_time_restricted"
    | "overlap"
    | "over_capacity";

export interface AssignmentWarning {
    type: WarningType;
    conflicts?: string[];
}

export interface WarningModal {
    confirm(warnings: AssignmentWarning[], slotId: string): Promise<boolean>;
}

/**
 * Describe an assignment warning in human-readable format
 */
export function describeWarning(warning: AssignmentWarning, describeSlot: (slotId: string) => string): string {
    switch (warning.type) {
        case "outside_attendance":
            return "This slot is outside your attendance window.";
        case "arrival_day":
            return "This slot is on your arrival day.";
        case "arrival_time_restricted":
            return "Evening arrival-day assignments are disabled for this plan.";
        case "departure_day":
            return "This slot is on your departure day.";
        case "departure_time_restricted":
            return "Morning departure-day assignments are disabled for this plan.";
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

/**
 * Build a warning modal for displaying assignment warnings
 */
export function buildWarningModal(describeSlot: (slotId: string) => string): WarningModal {
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
                `Warnings detected for this assignment. Proceed?\n${warnings.map(w => describeWarning(w, describeSlot)).join('\n')}`,
            );
            return Promise.resolve(proceed);
        }

        const title = describeSlot(slotId);
        if (titleEl) titleEl.textContent = title;

        list.innerHTML = '';
        warnings.forEach((warning) => {
            const li = document.createElement('li');
            li.className = 'list-group-item text-bg-dark d-flex align-items-start gap-2';
            li.innerHTML = `<i class="bi bi-exclamation-triangle text-warning"></i><span>${describeWarning(warning, describeSlot)}</span>`;
            list.appendChild(li);
        });

        return await new Promise((resolve) => {
            let settled = false;

            function cleanup(result: boolean) {
                if (settled) return;
                settled = true;
                confirmBtn!.disabled = false;
                modal!.hide();
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
 * Initialize assign/unassign slot functionality
 */
export function initAssign(planId: string, warningModal: WarningModal): void {
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
