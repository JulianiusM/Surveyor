/**
 * Activity Assignments Module
 * Handles assignment warnings and take/leave actions
 */

import {assertSuccessfulResponse, post} from '../../core/http';
import {showInlineAlert} from '../../shared/alerts';
import {reloadAfterDelay} from '../../shared/ui-helpers';
import type {AssignmentWarning, AssignmentWarningPreview, BootstrapGlobal, WarningModal,} from './activity-types';

declare const bootstrap: BootstrapGlobal;

/**
 * Describe an assignment warning in human-readable format
 */
export function describeWarning(warning: AssignmentWarning, describeSlot: (slotId: string) => string): string {
    switch (warning.type) {
        case "ineligible_participant":
            return "This profile is not eligible for recommendations in the linked event.";
        case "outside_attendance":
            return "This slot is outside your attendance window.";
        case "arrival_day":
            return "This slot is on your arrival day.";
        case "arrival_time_restricted":
            return "This arrival-day time is not eligible under the plan's arrival policy.";
        case "departure_day":
            return "This slot is on your departure day.";
        case "departure_time_restricted":
            return "This departure-day time is not eligible under the plan's departure policy.";
        case "over_capacity":
            return "This slot is already full. Joining will exceed its capacity.";
        case "overlap": {
            const conflicts: string[] = [];
            for (const conflict of warning.overlapDetails ?? []) {
                const title = conflict.title || describeSlot(conflict.id);
                const time = conflict.startTime && conflict.endTime ? ` (${conflict.startTime.slice(0, 5)}–${conflict.endTime.slice(0, 5)})` : '';
                conflicts.push(`${conflict.planTitle ? conflict.planTitle + ': ' : ''}${title} on ${conflict.day}${time}`);
            }
            if (!conflicts.length) {
                for (const id of warning.conflicts ?? []) conflicts.push(describeSlot(id));
            }
            const detail = conflicts.length ? `: ${conflicts.join(', ')}` : '';
            const priority = warning.requiredPriority
                ? ' Required takes precedence over Free. Discuss this conflict with the participant before confirming.'
                : warning.confirmable ? ' Resolve this with the affected participant before confirming the overlap.' : '';
            return `This slot overlaps with another assignment or recommendation${detail}.${priority}`;
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
    let confirming = false;

    async function confirm(warnings: AssignmentWarning[], slotId: string, confirmationLabel = 'Continue anyway'): Promise<boolean> {
        if (!warnings.length) return true;
        if (confirming) return false;
        if (!modal || !modalEl || !list || !confirmBtn || !cancelBtn) {
            const proceed = window.confirm(
                `Warnings detected for this assignment. Proceed?\n${warnings.map(w => describeWarning(w, describeSlot)).join('\n')}`,
            );
            return Promise.resolve(proceed);
        }

        const title = slotId ? describeSlot(slotId) : 'Approved recommendations';
        if (titleEl) titleEl.textContent = title;
        confirmBtn.textContent = confirmationLabel;

        list.innerHTML = '';
        for (const warning of warnings) {
            const li = document.createElement('li');
            li.className = 'list-group-item text-bg-dark d-flex align-items-start gap-2';
            const icon = document.createElement('i');
            icon.className = 'bi bi-exclamation-triangle text-warning';
            const text = document.createElement('span');
            // Plan and slot titles are user content; never interpolate them into HTML.
            text.textContent = describeWarning(warning, describeSlot);
            li.append(icon, text);
            list.appendChild(li);
        }

        confirming = true;
        return await new Promise<boolean>(function waitForConfirmation(resolve) {
            let settled = false;

            function cleanup(result: boolean) {
                if (settled) return;
                settled = true;
                confirming = false;
                modalEl!.removeEventListener('hidden.bs.modal', onHidden);
                confirmBtn!.onclick = null;
                cancelBtn!.onclick = null;
                confirmBtn!.disabled = false;
                modal!.hide();
                resolve(result);
            }

            function onHidden(): void {
                cleanup(false);
            }

            function onConfirmed(): void {
                confirmBtn!.disabled = true;
                cleanup(true);
            }

            function onCancelled(): void {
                cleanup(false);
            }

            modalEl!.addEventListener('hidden.bs.modal', onHidden, {once: true});
            confirmBtn!.onclick = onConfirmed;
            cancelBtn!.onclick = onCancelled;
            modal.show();
        });
    }

    return {confirm};
}

/**
 * Initialize assign/unassign slot functionality
 */
export function initAssign(planId: string, warningModal: WarningModal): void {
    async function fetchWarnings(slotId: string): Promise<AssignmentWarningPreview> {
        const res = await post(`/api/activity/${planId}/slot/${slotId}/warnings`, {});
        assertSuccessfulResponse(res);
        // A failed preview cannot be interpreted as permission to silently skip mandatory warnings.
        return res.data;
    }

    async function handleAssignmentClick(e: Event): Promise<void> {
        const btn = (e.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
        if (!btn || btn.hasAttribute('disabled')) return;

        const card = btn.closest('.slot') as HTMLElement | null;
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        const role = btn.dataset.role;
        const roleAssignment = btn.closest<HTMLElement>('.role-assignment');
        const assignmentId = roleAssignment?.dataset.assignmentId;
        const hasExistingAssignment = Boolean(assignmentId && assignmentId !== 'null');

        const shouldCheckWarnings = act === 'assign' || (act === 'take-role' && !hasExistingAssignment);

        async function performUpdate(confirmation?: string): Promise<void> {
            const response = await post(`/api/activity/${planId}/${act}`, {itemId: slotId, role, overlapConfirmation: confirmation});
            assertSuccessfulResponse(response);
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(120);
        }

        // Prevent repeated clicks from opening concurrent confirmation dialogs.
        btn.setAttribute('disabled', 'disabled');
        try {
            let confirmation: string | undefined;
            if (shouldCheckWarnings) {
                const preview = await fetchWarnings(slotId);
                const proceed = await warningModal.confirm(preview.warnings, slotId);
                if (!proceed) return;
                confirmation = preview.overlapConfirmation;
            }
            await performUpdate(confirmation);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update slot assignment.';
            showInlineAlert('error', message);
        } finally {
            btn.removeAttribute('disabled');
        }
    }

    document.addEventListener('click', handleAssignmentClick);
}
