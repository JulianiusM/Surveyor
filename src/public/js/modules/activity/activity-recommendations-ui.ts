/**
 * UI layer for activity recommendations
 * Handles all DOM manipulation and rendering
 */

import {RecommendationsLogic} from './activity-recommendations-logic';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import type {BootstrapGlobal, RecommendationRow} from './activity-types';
import type {AssignmentWarning, RecommendationModalRequest} from '../../../../types/ActivityTypes';
import {describeWarning} from './activity-assignments';
import {cancelAlertDismissal, scheduleAlertDismissal} from '../../shared/alerts';

declare const bootstrap: BootstrapGlobal;

export type {RecommendationModalRequest} from '../../../../types/ActivityTypes';

/**
 * UI class for recommendations
 * Handles all DOM operations and user interactions
 */
export class RecommendationsUI {
    private readonly scheduleView: HTMLElement | null;
    private readonly alertBox: HTMLElement | null;
    private readonly summaryStats: HTMLElement | null;
    private readonly addModal: HTMLElement | null;
    private readonly addSlotIdInput: HTMLInputElement | null;
    private readonly addOperationSelect: HTMLSelectElement | null;
    private readonly addParticipantSelect: HTMLSelectElement | null;
    private readonly addSourceSelect: HTMLSelectElement | null;
    private readonly addSwapParticipantSelect: HTMLSelectElement | null;
    private readonly sourceAssignmentGroup: HTMLElement | null;
    private readonly swapAssignmentGroup: HTMLElement | null;
    private readonly addConfirmBtn: HTMLButtonElement | null;
    private readonly addWarningBox: HTMLElement | null;
    private previewRequest = 0;
    private readonly disabledControls = new Map<HTMLButtonElement | HTMLSelectElement, boolean>();

    constructor(
        private readonly state: ActivityRecommendationsState,
        private readonly logic: RecommendationsLogic,
        private readonly container: HTMLElement,
        private readonly describeSlot: (slotId: string) => string
    ) {
        this.scheduleView = container.querySelector<HTMLElement>('#recommendationScheduleView');
        this.alertBox = container.querySelector<HTMLElement>('[data-recommendations-alert]');
        this.summaryStats = container.querySelector<HTMLElement>('#recommendationSummaryStats');

        // Modal elements
        this.addModal = document.getElementById('addRecommendationModal');
        this.addSlotIdInput = this.addModal?.querySelector<HTMLInputElement>('#addRecommendationSlotId') || null;
        this.addOperationSelect = this.addModal?.querySelector<HTMLSelectElement>('#addRecommendationOperation') || null;
        this.addParticipantSelect = this.addModal?.querySelector<HTMLSelectElement>('#addRecommendationParticipant') || null;
        this.addSourceSelect = this.addModal?.querySelector<HTMLSelectElement>('#addRecommendationSource') || null;
        this.addSwapParticipantSelect = this.addModal?.querySelector<HTMLSelectElement>('#addRecommendationSwapParticipant') || null;
        this.sourceAssignmentGroup = this.addModal?.querySelector<HTMLElement>('[data-source-assignment-group]') || null;
        this.swapAssignmentGroup = this.addModal?.querySelector<HTMLElement>('[data-swap-assignment-group]') || null;
        this.addConfirmBtn = this.addModal?.querySelector<HTMLButtonElement>('#addRecommendationConfirm') || null;
        this.addWarningBox = this.addModal?.querySelector<HTMLElement>('[data-add-warning]') || null;

        // Initialize modal instance if needed
        if (this.addModal && !this.state.getModalInstance()) {
            this.state.setModalInstance(new bootstrap.Modal(this.addModal, {focus: true}));
        }
    }

    /** Freeze the reviewed draft while preview/confirmation/save is in progress, preserving disabled policies. */
    setBusy(busy: boolean): void {
        if (!busy) {
            for (const [control, disabled] of this.disabledControls) control.disabled = disabled;
            this.disabledControls.clear();
            return;
        }
        for (const root of [this.container, this.addModal]) {
            if (!root) continue;
            const controls = root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select');
            for (const control of controls) {
                if (!this.disabledControls.has(control)) this.disabledControls.set(control, control.disabled);
                control.disabled = true;
            }
        }
    }

    /**
     * Show alert message
     */
    setAlert(message?: string, variant: 'info' | 'danger' = 'info', persistent = false): void {
        if (!this.alertBox) return;
        cancelAlertDismissal(this.alertBox);
        const target = this.alertBox.querySelector('span') || this.alertBox;

        if (!message) {
            this.alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        this.alertBox.classList.remove('d-none', 'alert-info', 'alert-danger');
        this.alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        this.alertBox.classList.toggle('alert', !persistent);
        this.alertBox.classList.toggle('status-notice', persistent);
        this.alertBox.setAttribute('role', persistent ? 'status' : 'alert');
        target.textContent = message;
        const alertBox = this.alertBox;
        if (!persistent) scheduleAlertDismissal(alertBox, () => alertBox.classList.add('d-none'));
    }

    /**
     * Update summary statistics display
     */
    updateSummaryStats(): void {
        if (!this.summaryStats) return;
        this.summaryStats.innerHTML = '';

        const recommendations = this.state.getRecommendations();
        if (!recommendations.length) {
            const span = document.createElement('span');
            span.className = 'text-secondary';
            span.textContent = 'No recommendations loaded.';
            this.summaryStats.append(span);
            return;
        }

        const counts = this.logic.getSummaryStats();
        const pieces: { label: string; key: string; className: string }[] = [
            {label: 'Pending', key: 'PENDING', className: 'badge bg-secondary text-white me-1'},
            {label: 'Approved', key: 'APPROVED', className: 'badge bg-success text-white me-1'},
            {label: 'Rejected', key: 'REJECTED', className: 'badge bg-danger text-white me-1'},
        ];

        pieces.forEach(({label, key, className}) => {
            const value = counts[key];
            const span = document.createElement('span');
            span.className = className;
            span.textContent = `${label}: ${value}`;
            this.summaryStats!.append(span);
        });
    }

    /**
     * Render a single recommendation
     */
    private renderRecommendation(
        rec: RecommendationRow,
        container: HTMLElement,
        onApprove: () => void,
        onReject: () => void,
        onRevert: () => void,
        onRemove: () => void,
    ): void {
        const recDiv = document.createElement('div');
        recDiv.className = 'd-flex flex-wrap align-items-center gap-2 mb-1 p-1 border rounded';
        recDiv.dataset.recId = rec.id || '';
        recDiv.dataset.slotId = rec.item.id;
        if (rec.profile?.id) recDiv.dataset.profileId = rec.profile.id;

        const operation = rec.operation ?? 'ASSIGN';
        const isSwap = operation === 'REASSIGN' && Boolean(rec.sourceItem && this.state.getRecommendations().some(
            (candidate) => candidate !== rec
                && candidate.operation === 'REASSIGN'
                && candidate.item.id === rec.sourceItem!.id
                && candidate.sourceItem?.id === rec.item.id,
        ));

        // Status-based styling
        if (rec.status === 'APPROVED') {
            recDiv.classList.add('border-success');
        } else if (rec.status === 'REJECTED') {
            recDiv.classList.add('border-danger');
        } else {
            recDiv.classList.add('border-warning');
        }

        // Icon
        const icon = document.createElement('i');
        icon.className = 'bi bi-clock-fill text-warning';
        if (operation === 'REASSIGN') {
            icon.className = 'bi bi-arrow-left-right text-info';
        } else if (operation === 'UNASSIGN') {
            icon.className = 'bi bi-person-dash-fill text-danger';
        }
        if (rec.status === 'APPROVED') {
            icon.className = operation === 'REASSIGN'
                ? 'bi bi-arrow-left-right text-info'
                : operation === 'UNASSIGN'
                    ? 'bi bi-person-dash-fill text-danger'
                    : 'bi bi-check-circle-fill text-success';
        } else if (rec.status === 'REJECTED') {
            icon.className = 'bi bi-x-circle-fill text-danger';
        }
        recDiv.append(icon);

        // Participant name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'flex-grow-1 small';
        const participantName = rec.profile?.name || 'Unknown';
        nameSpan.textContent = operation === 'REASSIGN'
            ? `${participantName} — ${isSwap ? 'swap' : 'move'} from ${rec.sourceItem?.title || 'another slot'}`
            : operation === 'UNASSIGN'
                ? `${participantName} — remove from this slot`
                : participantName;
        recDiv.append(nameSpan);

        if (operation !== 'ASSIGN') {
            const operationBadge = document.createElement('span');
            operationBadge.className = operation === 'REASSIGN'
                ? 'badge bg-info text-dark small'
                : 'badge bg-danger text-white small';
            operationBadge.textContent = operation === 'REASSIGN'
                ? isSwap ? 'SWAP' : 'REASSIGNMENT'
                : 'UNASSIGNMENT';
            recDiv.append(operationBadge);
        }

        // Status badge
        const badge = document.createElement('span');
        badge.className = 'badge small';
        if (rec.status === 'APPROVED') {
            badge.classList.add('bg-success', 'text-white');
            badge.textContent = 'Approved';
        } else if (rec.status === 'REJECTED') {
            badge.classList.add('bg-danger', 'text-white');
            badge.textContent = 'Rejected';
        } else {
            badge.classList.add('bg-warning', 'text-dark');
            badge.textContent = 'Pending';
        }
        recDiv.append(badge);

        // Action buttons - all states are reversible
        if (rec.status === 'PENDING') {
            const approveBtn = this.createButton('btn btn-xs btn-success', 'Approve', '<i class="bi bi-check"></i>', onApprove);
            const rejectBtn = this.createButton('btn btn-xs btn-danger', 'Reject', '<i class="bi bi-x"></i>', onReject);
            recDiv.append(approveBtn, rejectBtn);
        } else if (rec.status === 'APPROVED') {
            const revertBtn = this.createButton('btn btn-xs btn-outline-secondary', 'Revert to Pending', '<i class="bi bi-arrow-counterclockwise"></i>', onRevert);
            recDiv.append(revertBtn);
        } else if (rec.status === 'REJECTED') {
            const approveBtn = this.createButton('btn btn-xs btn-outline-success', 'Approve', '<i class="bi bi-check"></i>', onApprove);
            const revertBtn = this.createButton('btn btn-xs btn-outline-secondary', 'Revert to Pending', '<i class="bi bi-arrow-counterclockwise"></i>', onRevert);
            recDiv.append(approveBtn, revertBtn);
        }
        if (rec.manual) {
            const title = operation === 'UNASSIGN' ? 'Cancel unassignment' : 'Remove manual operation';
            const removeBtn = this.createButton(
                'btn btn-xs btn-outline-danger',
                title,
                '<i class="bi bi-trash"></i>',
                onRemove,
            );
            removeBtn.setAttribute('aria-label', `${title} for ${participantName}`);
            recDiv.append(removeBtn);
        }

        // Warnings belong to the review row, not a timed alert. They remain visible after
        // cancelling confirmation so the organizer can discuss the conflict first.
        const warnings = this.state.getWarningsForRecommendation(rec);
        if (warnings.length) {
            const notice = document.createElement('div');
            notice.className = 'status-notice alert-warning small w-100 mb-0';
            notice.setAttribute('role', 'status');
            notice.dataset.recommendationWarnings = '';
            for (const warning of warnings) {
                const message = document.createElement('div');
                message.textContent = describeWarning(warning, this.describeSlot);
                notice.append(message);
            }
            recDiv.append(notice);
        }
        container.append(recDiv);
    }

    /**
     * Helper to create buttons with tracked event listeners
     */
    private createButton(className: string, title: string, innerHTML: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = className;
        btn.type = 'button';
        btn.title = title;
        btn.innerHTML = innerHTML;

        const handler = () => onClick();
        btn.addEventListener('click', handler);
        this.state.trackListener(btn, 'click', handler);

        return btn;
    }

    /**
     * Render all recommendations
     */
    renderAllRecommendations(
        onApprove: (rec: RecommendationRow) => void,
        onReject: (rec: RecommendationRow) => void,
        onRevert: (rec: RecommendationRow) => void,
        onRemove: (rec: RecommendationRow) => void,
    ): void {
        if (!this.scheduleView) return;

        // Clear all recommendation containers
        const containers = this.scheduleView.querySelectorAll<HTMLElement>('[data-slot-recommendations]');
        for (const container of containers) container.innerHTML = '';

        // Group recommendations by slot
        const bySlot = this.logic.groupRecommendationsBySlot();

        // Render recommendations in their respective slots
        for (const [slotId, recs] of bySlot) {
            const container = this.scheduleView!.querySelector<HTMLElement>(`[data-slot-recommendations="${slotId}"]`);
            if (container) {
                for (const rec of recs) this.renderRecommendation(
                    rec,
                    container,
                    () => onApprove(rec),
                    () => onReject(rec),
                    () => onRevert(rec),
                    () => onRemove(rec),
                );
            }
        }

        this.updateSummaryStats();
    }

    /**
     * Setup add recommendation modal
     */
    setupAddModal(
        onConfirm: (request: RecommendationModalRequest) => void,
        onUnassign: (slotId: string, profileId: string) => void,
        onPreview: (request: RecommendationModalRequest) => Promise<AssignmentWarning[]>,
    ): void {
        if (!this.scheduleView) return;

        const scheduleViewClickHandler = (e: Event) => {
            const target = e.target as HTMLElement;
            const unassignButton = target.closest('[data-unassign-recommendation]') as HTMLButtonElement | null;
            if (unassignButton?.dataset.slotId && unassignButton.dataset.profileId) {
                onUnassign(unassignButton.dataset.slotId, unassignButton.dataset.profileId);
                return;
            }
            const btn = target.closest('[data-add-recommendation]') as HTMLButtonElement;
            if (!btn) return;

            const slotId = btn.dataset.slotId;
            if (!slotId || !this.addModal) return;

            const modalInstance = this.state.getModalInstance();
            if (!modalInstance) return;

            // Get slot date from DOM to filter participants
            const slotElement = this.scheduleView!.querySelector(`[data-slot-id="${slotId}"]`);
            const slotDay = slotElement?.closest<HTMLElement>('[data-day]')?.dataset.day;

            // Opening a different slot invalidates any preview left in flight by an earlier selection.
            this.previewRequest++;
            if (this.addSlotIdInput) this.addSlotIdInput.value = slotId;
            if (this.addOperationSelect) this.addOperationSelect.value = 'ASSIGN';
            if (this.addWarningBox) this.addWarningBox.classList.add('d-none');
            this.populateOperationFields(slotId, slotDay);

            modalInstance.show();
        };

        this.scheduleView.addEventListener('click', scheduleViewClickHandler);
        this.state.trackListener(this.scheduleView, 'click', scheduleViewClickHandler);

        if (this.addOperationSelect) {
            const operationHandler = () => {
                this.populateOperationFields(
                    this.addSlotIdInput?.value || '',
                    this.state.getSlots().find((slot) => slot.id === this.addSlotIdInput?.value)?.day,
                );
                void this.showOverlapWarning(onPreview);
            };
            this.addOperationSelect.addEventListener('change', operationHandler);
            this.state.trackListener(this.addOperationSelect, 'change', operationHandler);
        }
        if (this.addParticipantSelect) {
            const participantHandler = () => {
                this.populateSourceAssignments();
                void this.showOverlapWarning(onPreview);
            };
            this.addParticipantSelect.addEventListener('change', participantHandler);
            this.state.trackListener(this.addParticipantSelect, 'change', participantHandler);
        }
        const sourceHandler = () => { void this.showOverlapWarning(onPreview); };
        for (const select of [this.addSourceSelect, this.addSwapParticipantSelect]) {
            if (!select) continue;
            select.addEventListener('change', sourceHandler);
            this.state.trackListener(select, 'change', sourceHandler);
        }

        if (this.addConfirmBtn) {
            const addConfirmClickHandler = () => {
                const request = this.readModalRequest();
                if (!request) {
                    this.showAddWarning('Select every assignment required for this operation.');
                    return;
                }
                onConfirm(request);
            };
            this.addConfirmBtn.addEventListener('click', addConfirmClickHandler);
            this.state.trackListener(this.addConfirmBtn, 'click', addConfirmClickHandler);
        }
    }

    /** Read a complete operation once, so preview and staging never disagree about the selected legs. */
    private readModalRequest(): RecommendationModalRequest | undefined {
        const targetSlotId = this.addSlotIdInput?.value;
        const participantValue = this.addParticipantSelect?.value;
        if (!targetSlotId || !participantValue) return undefined;
        const {type, id} = this.logic.parseParticipantValue(participantValue);
        if (type !== 'profile') return undefined;
        const operation = (this.addOperationSelect?.value || 'ASSIGN') as RecommendationModalRequest['operation'];
        const request: RecommendationModalRequest = {targetSlotId, profileId: id as string, operation};
        if (operation !== 'ASSIGN') request.sourceItemId = this.addSourceSelect?.value;
        if (operation === 'SWAP') request.swapProfileId = this.addSwapParticipantSelect?.value;
        if ((operation !== 'ASSIGN' && !request.sourceItemId) || (operation === 'SWAP' && !request.swapProfileId)) return undefined;
        return request;
    }

    private showAddWarning(message: string): void {
        if (!this.addWarningBox) return;
        this.addWarningBox.classList.remove('d-none');
        const span = this.addWarningBox.querySelector('span');
        if (span) span.textContent = message;
    }

    private populateOperationFields(slotId: string, slotDay?: string): void {
        const operation = this.addOperationSelect?.value || 'ASSIGN';
        this.addWarningBox?.classList.add('d-none');
        this.sourceAssignmentGroup?.classList.toggle('d-none', operation === 'ASSIGN');
        this.swapAssignmentGroup?.classList.toggle('d-none', operation !== 'SWAP');
        if (!this.addParticipantSelect) return;

        this.addParticipantSelect.innerHTML = '<option value="">Choose a participant...</option>';
        const targetHasRolelessAssignment = this.logic.getRolelessAssignments()
            .some((assignment) => assignment.item.id === slotId);
        if (operation === 'SWAP' && !targetHasRolelessAssignment) {
            this.showAddWarning('A swap needs an assignment without named roles in this slot.');
        }
        const availableParticipants = this.logic.getAvailableParticipants(slotDay).filter((participant) => {
            if (!participant.profileId || this.logic.isAlreadyAssigned(slotId, participant.profileId)) return false;
            if (operation === 'ASSIGN') return true;
            return this.logic.getRolelessAssignments(participant.profileId)
                .some((assignment) => assignment.item.id !== slotId);
        });
        availableParticipants.forEach((participant) => {
            const option = document.createElement('option');
            option.value = this.logic.getParticipantValue(participant);
            option.textContent = this.logic.formatParticipantLabel(participant);
            this.addParticipantSelect!.append(option);
        });
        this.populateSourceAssignments();
        this.populateSwapAssignments(slotId);
    }

    private populateSourceAssignments(): void {
        if (!this.addSourceSelect || !this.addParticipantSelect) return;
        const {type, id} = this.logic.parseParticipantValue(this.addParticipantSelect.value || ':');
        const profileId = type === 'profile' ? id as string : null;
        this.addSourceSelect.innerHTML = '<option value="">Choose the source assignment...</option>';
        this.logic.getRolelessAssignments(profileId).forEach((assignment) => {
            if (assignment.item.id === this.addSlotIdInput?.value) return;
            const option = document.createElement('option');
            option.value = assignment.item.id;
            option.textContent = assignment.item.title;
            this.addSourceSelect!.append(option);
        });
    }

    private populateSwapAssignments(slotId: string): void {
        if (!this.addSwapParticipantSelect) return;
        this.addSwapParticipantSelect.innerHTML = '<option value="">Choose the participant to swap...</option>';
        this.logic.getRolelessAssignments().forEach((assignment) => {
            if (assignment.item.id !== slotId) return;
            const option = document.createElement('option');
            option.value = assignment.profile.id;
            option.textContent = assignment.profile.name;
            this.addSwapParticipantSelect!.append(option);
        });
    }

    /**
     * Show overlap warning in modal
     */
    private async showOverlapWarning(onPreview: (request: RecommendationModalRequest) => Promise<AssignmentWarning[]>): Promise<void> {
        if (!this.addWarningBox || !this.addParticipantSelect) return;
        // Selection changes can complete out of order. Only the newest server preview
        // describes this modal; the browser never implements a second collision rule.
        const requestId = ++this.previewRequest;
        this.addWarningBox.classList.add('d-none');
        const request = this.readModalRequest();
        if (!request) return;
        try {
            const warnings = await onPreview(request);
            if (requestId !== this.previewRequest) return;
            const messages: string[] = [];
            for (const warning of warnings) messages.push(describeWarning(warning, this.describeSlot));
            if (messages.length) this.showAddWarning(messages.join(' '));
        } catch {
            if (requestId === this.previewRequest) this.showAddWarning('Warnings could not be checked. Try again before saving changes.');
        }
    }

    /**
     * Hide modal
     */
    hideModal(): void {
        this.previewRequest++;
        const modalInstance = this.state.getModalInstance();
        if (modalInstance) {
            modalInstance.hide();
        }
    }

    /**
     * Setup button handlers
     */
    setupButtons(
        onRefresh: () => void,
        onAuto: () => void,
        onApply: () => void
    ): void {
        const refreshBtn = this.container.querySelector<HTMLButtonElement>('[data-recommendations-refresh]');
        const autoBtn = this.container.querySelector<HTMLButtonElement>('[data-recommendations-auto]');
        const applyBtn = this.container.querySelector<HTMLButtonElement>('[data-recommendations-apply]');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', onRefresh);
            this.state.trackListener(refreshBtn, 'click', onRefresh);
        }
        if (autoBtn) {
            autoBtn.addEventListener('click', onAuto);
            this.state.trackListener(autoBtn, 'click', onAuto);
        }
        if (applyBtn) {
            applyBtn.addEventListener('click', onApply);
            this.state.trackListener(applyBtn, 'click', onApply);
        }
    }

    /**
     * Cleanup - remove all event listeners and clear DOM
     */
    cleanup(): void {
        this.previewRequest++;
        this.setBusy(false);
        if (this.alertBox) cancelAlertDismissal(this.alertBox);
        // State cleanup handles event listener removal
        this.state.reset();
    }
}
