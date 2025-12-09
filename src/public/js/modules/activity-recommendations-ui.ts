/**
 * UI layer for activity recommendations
 * Handles all DOM manipulation and rendering
 */

import type {
    RecommendationRow,
    BootstrapModal,
    BootstrapGlobal
} from './activity-types';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import {RecommendationsLogic} from './activity-recommendations-logic';

declare const bootstrap: BootstrapGlobal;

/**
 * UI class for recommendations
 * Handles all DOM operations and user interactions
 */
export class RecommendationsUI {
    private scheduleView: HTMLElement | null;
    private alertBox: HTMLElement | null;
    private summaryStats: HTMLElement | null;
    private addModal: HTMLElement | null;
    private addSlotIdInput: HTMLInputElement | null;
    private addParticipantSelect: HTMLSelectElement | null;
    private addConfirmBtn: HTMLButtonElement | null;
    private addWarningBox: HTMLElement | null;

    constructor(
        private state: ActivityRecommendationsState,
        private logic: RecommendationsLogic,
        private container: HTMLElement
    ) {
        this.scheduleView = container.querySelector<HTMLElement>('#recommendationScheduleView');
        this.alertBox = container.querySelector<HTMLElement>('[data-recommendations-alert]');
        this.summaryStats = container.querySelector<HTMLElement>('#recommendationSummaryStats');
        
        // Modal elements
        this.addModal = document.getElementById('addRecommendationModal');
        this.addSlotIdInput = this.addModal?.querySelector<HTMLInputElement>('#addRecommendationSlotId') || null;
        this.addParticipantSelect = this.addModal?.querySelector<HTMLSelectElement>('#addRecommendationParticipant') || null;
        this.addConfirmBtn = this.addModal?.querySelector<HTMLButtonElement>('#addRecommendationConfirm') || null;
        this.addWarningBox = this.addModal?.querySelector<HTMLElement>('[data-add-warning]') || null;

        // Initialize modal instance if needed
        if (this.addModal && !this.state.getModalInstance()) {
            this.state.setModalInstance(new bootstrap.Modal(this.addModal, {focus: true}));
        }
    }

    /**
     * Show alert message
     */
    setAlert(message?: string, variant: 'info' | 'danger' = 'info'): void {
        if (!this.alertBox) return;
        const target = this.alertBox.querySelector('span') || this.alertBox;
        
        if (!message) {
            this.alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        this.alertBox.classList.remove('d-none', 'alert-info', 'alert-danger');
        this.alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        target.textContent = message;
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
        onRevert: () => void
    ): void {
        const recDiv = document.createElement('div');
        recDiv.className = 'd-flex align-items-center gap-2 mb-1 p-1 border rounded';
        recDiv.dataset.recId = rec.id || '';
        recDiv.dataset.slotId = rec.slot.id;
        if (rec.user?.id) recDiv.dataset.userId = String(rec.user.id);
        if (rec.guest?.id) recDiv.dataset.guestId = String(rec.guest.id);

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
        icon.className = rec.status === 'APPROVED' ? 'bi bi-check-circle-fill text-success' : 
                         rec.status === 'REJECTED' ? 'bi bi-x-circle-fill text-danger' :
                         'bi bi-clock-fill text-warning';
        recDiv.append(icon);

        // Participant name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'flex-grow-1 small';
        nameSpan.textContent = rec.user?.username || rec.guest?.username || 'Unknown';
        recDiv.append(nameSpan);

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
        onRevert: (rec: RecommendationRow) => void
    ): void {
        if (!this.scheduleView) return;
        
        // Clear all recommendation containers
        const containers = this.scheduleView.querySelectorAll<HTMLElement>('[data-slot-recommendations]');
        containers.forEach((container) => {
            container.innerHTML = '';
        });

        // Group recommendations by slot
        const bySlot = this.logic.groupRecommendationsBySlot();

        // Render recommendations in their respective slots
        bySlot.forEach((recs, slotId) => {
            const container = this.scheduleView!.querySelector<HTMLElement>(`[data-slot-recommendations="${slotId}"]`);
            if (container) {
                recs.forEach((rec) => this.renderRecommendation(
                    rec,
                    container,
                    () => onApprove(rec),
                    () => onReject(rec),
                    () => onRevert(rec)
                ));
            }
        });

        this.updateSummaryStats();
    }

    /**
     * Setup add recommendation modal
     */
    setupAddModal(
        onConfirm: (slotId: string, participantValue: string) => void
    ): void {
        if (!this.scheduleView) return;

        const scheduleViewClickHandler = (e: Event) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-add-recommendation]') as HTMLButtonElement;
            if (!btn) return;

            const slotId = btn.dataset.slotId;
            if (!slotId || !this.addModal) return;

            const modalInstance = this.state.getModalInstance();
            if (!modalInstance) return;

            // Get slot date from DOM to filter participants
            const slotElement = this.scheduleView.querySelector(`[data-slot-id="${slotId}"]`);
            const slotDay = slotElement?.closest('[data-day]')?.getAttribute('data-day');
            
            // Populate modal
            if (this.addSlotIdInput) this.addSlotIdInput.value = slotId;
            if (this.addParticipantSelect) {
                this.addParticipantSelect.innerHTML = '<option value="">Choose a participant...</option>';
                
                // Filter participants based on attendance window
                const availableParticipants = this.logic.getAvailableParticipants(slotDay);
                availableParticipants.forEach((opt) => {
                    const option = document.createElement('option');
                    option.value = this.logic.getParticipantValue(opt);
                    option.textContent = this.logic.formatParticipantLabel(opt);
                    this.addParticipantSelect!.append(option);
                });
                
                // Add change handler to show warning when participant selected
                // Note: This listener uses {once: true} so it self-removes and doesn't need tracking
                this.addParticipantSelect.addEventListener('change', () => {
                    this.showOverlapWarning(slotId);
                }, {once: true});
            }
            if (this.addWarningBox) this.addWarningBox.classList.add('d-none');

            modalInstance.show();
        };
        
        this.scheduleView.addEventListener('click', scheduleViewClickHandler);
        this.state.trackListener(this.scheduleView, 'click', scheduleViewClickHandler);

        if (this.addConfirmBtn) {
            const addConfirmClickHandler = async () => {
                const slotId = this.addSlotIdInput?.value;
                const participantValue = this.addParticipantSelect?.value;
                if (slotId && participantValue) {
                    onConfirm(slotId, participantValue);
                }
            };
            this.addConfirmBtn.addEventListener('click', addConfirmClickHandler);
            this.state.trackListener(this.addConfirmBtn, 'click', addConfirmClickHandler);
        }
    }

    /**
     * Show overlap warning in modal
     */
    private showOverlapWarning(slotId: string): void {
        if (!this.addWarningBox || !this.addParticipantSelect) return;

        // Clear warning first
        this.addWarningBox.classList.add('d-none');
        
        const participantValue = this.addParticipantSelect.value;
        if (!participantValue || !slotId) return;
        
        // Check for overlap using logic layer
        const {type, id} = this.logic.parseParticipantValue(participantValue);
        const userId = type === 'user' ? id : null;
        const guestId = type === 'guest' ? id : null;
        
        const hasOverlap = this.logic.hasOverlappingAssignment(userId, guestId, slotId);
        
        if (hasOverlap) {
            this.addWarningBox.classList.remove('d-none');
            const span = this.addWarningBox.querySelector('span');
            if (span) {
                span.textContent = '⚠️ Warning: This participant has an overlapping assignment or recommendation on the same day';
            }
        }
    }

    /**
     * Hide modal
     */
    hideModal(): void {
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
        // State cleanup handles event listener removal
        this.state.reset();
    }
}
