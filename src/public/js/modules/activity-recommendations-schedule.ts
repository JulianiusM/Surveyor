/**
 * Activity Recommendations Schedule Module
 * Handles the enhanced schedule-based recommendations view
 */

import {get, post} from '../core/http';
import {reloadAfterDelay} from '../shared/ui-helpers';
import type {
    AssignmentWarning,
    RecommendationParticipantOption,
    RecommendationRow,
    RecommendationWarning,
    BootstrapModal,
    BootstrapGlobal
} from './activity-types';
import {formatDateLabel} from "../core/formatting";

declare const bootstrap: BootstrapGlobal;

// Module-level state that persists across function calls
interface EventListenerTracking {
    element: HTMLElement | Document;
    event: string;
    handler: EventListener;
}

const moduleState = {
    recommendations: [] as RecommendationRow[],
    warnings: [] as RecommendationWarning[],
    participantOptions: [] as RecommendationParticipantOption[],
    slots: [] as any[],
    existingAssignments: [] as any[],
    eventListeners: [] as EventListenerTracking[],
    addModalInstance: null as BootstrapModal | null
};

/**
 * Cleanup function to reset module state and remove event listeners
 * Should be called when tearing down the view or between tests
 */
export function cleanupRecommendationScheduleView(): void {
    // Remove all tracked event listeners
    moduleState.eventListeners.forEach(({element, event, handler}) => {
        element.removeEventListener(event, handler);
    });
    moduleState.eventListeners = [];
    
    // Dispose modal if exists
    if (moduleState.addModalInstance) {
        if (typeof moduleState.addModalInstance.dispose === 'function') {
            moduleState.addModalInstance.dispose();
        }
        moduleState.addModalInstance = null;
    }
    
    // Clear all state arrays
    moduleState.recommendations = [];
    moduleState.warnings = [];
    moduleState.participantOptions = [];
    moduleState.slots = [];
    moduleState.existingAssignments = [];
}

export function initRecommendationScheduleView(planId: string, describeSlot: (slotId: string) => string): void {
    const panel = document.getElementById('recommendationPanel');
    const scheduleView = panel?.querySelector<HTMLElement>('#recommendationScheduleView');
    const alertBox = panel?.querySelector<HTMLElement>('[data-recommendations-alert]');
    const refreshBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-refresh]');
    const autoBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-auto]');
    const applyBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-apply]');
    const summaryStats = panel?.querySelector<HTMLElement>('#recommendationSummaryStats');

    if (!planId || !panel || !scheduleView) return;

    // Add recommendation modal
    const addModal = document.getElementById('addRecommendationModal');
    const addSlotIdInput = addModal?.querySelector<HTMLInputElement>('#addRecommendationSlotId');
    const addParticipantSelect = addModal?.querySelector<HTMLSelectElement>('#addRecommendationParticipant');
    const addConfirmBtn = addModal?.querySelector<HTMLButtonElement>('#addRecommendationConfirm');
    const addWarningBox = addModal?.querySelector<HTMLElement>('[data-add-warning]');

    if (addModal && !moduleState.addModalInstance) {
        moduleState.addModalInstance = new bootstrap.Modal(addModal, {focus: true});
    }
    const addModalInstance = moduleState.addModalInstance;

    // Helper to track event listeners for cleanup
    const addTrackedListener = (element: HTMLElement | Document, event: string, handler: EventListener) => {
        element.addEventListener(event, handler);
        moduleState.eventListeners.push({element, event, handler});
    };

    const setAlert = (message?: string, variant: 'info' | 'danger' = 'info') => {
        if (!alertBox) return;
        const target = alertBox.querySelector('span') || alertBox;
        if (!message) {
            alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        alertBox.classList.remove('d-none', 'alert-info', 'alert-danger');
        alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        target.textContent = message;
    };

    const formatParticipantLabel = (option: RecommendationParticipantOption) => {
        const arrival = formatDateLabel(option.arrivalDate ?? null);
        const departure = formatDateLabel(option.departureDate ?? null);
        const attendance = arrival || departure ? ` (${arrival || 'start'} – ${departure || 'end'})` : '';
        return `${option.label}${attendance}`;
    };

    const participantValue = (option: RecommendationParticipantOption) =>
        option.userId ? `user:${option.userId}` : `guest:${option.guestId}`;

    const updateSummaryStats = () => {
        if (!summaryStats) return;
        summaryStats.innerHTML = '';

        if (!moduleState.recommendations.length) {
            const span = document.createElement('span');
            span.className = 'text-secondary';
            span.textContent = 'No recommendations loaded.';
            summaryStats.append(span);
            return;
        }

        const counts: Record<string, number> = {
            PENDING: 0,
            APPROVED: 0,
            REJECTED: 0,
        };

        moduleState.recommendations.forEach((rec) => {
            if (rec.status && counts[rec.status] !== undefined) {
                counts[rec.status] += 1;
            }
        });

        const pieces: { label: string; key: keyof typeof counts; className: string }[] = [
            {label: 'Pending', key: 'PENDING', className: 'badge bg-secondary text-white me-1'},
            {label: 'Approved', key: 'APPROVED', className: 'badge bg-success text-white me-1'},
            {label: 'Rejected', key: 'REJECTED', className: 'badge bg-danger text-white me-1'},
        ];

        pieces.forEach(({label, key, className}) => {
            const value = counts[key];
            const span = document.createElement('span');
            span.className = className;
            span.textContent = `${label}: ${value}`;
            summaryStats.append(span);
        });
    };

    const renderRecommendation = (rec: RecommendationRow, container: HTMLElement) => {
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
            const approveBtn = document.createElement('button');
            approveBtn.className = 'btn btn-xs btn-success';
            approveBtn.type = 'button';
            approveBtn.title = 'Approve';
            approveBtn.innerHTML = '<i class="bi bi-check"></i>';
            const approveHandler = () => approveRecommendation(rec);
            addTrackedListener(approveBtn, 'click', approveHandler);
            recDiv.append(approveBtn);

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'btn btn-xs btn-danger';
            rejectBtn.type = 'button';
            rejectBtn.title = 'Reject';
            rejectBtn.innerHTML = '<i class="bi bi-x"></i>';
            const rejectHandler = () => rejectRecommendation(rec);
            addTrackedListener(rejectBtn, 'click', rejectHandler);
            recDiv.append(rejectBtn);
        } else if (rec.status === 'APPROVED') {
            // Can revert to pending (acts as "undo approve")
            const revertBtn = document.createElement('button');
            revertBtn.className = 'btn btn-xs btn-outline-secondary';
            revertBtn.type = 'button';
            revertBtn.title = 'Revert to Pending';
            revertBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
            const revertHandler = () => removeRecommendation(rec);
            addTrackedListener(revertBtn, 'click', revertHandler);
            recDiv.append(revertBtn);
        } else if (rec.status === 'REJECTED') {
            // Can approve (revert rejection)
            const approveBtn = document.createElement('button');
            approveBtn.className = 'btn btn-xs btn-outline-success';
            approveBtn.type = 'button';
            approveBtn.title = 'Approve';
            approveBtn.innerHTML = '<i class="bi bi-check"></i>';
            const approveHandler = () => approveRecommendation(rec);
            addTrackedListener(approveBtn, 'click', approveHandler);
            recDiv.append(approveBtn);
            
            // Can also revert to pending
            const revertBtn = document.createElement('button');
            revertBtn.className = 'btn btn-xs btn-outline-secondary';
            revertBtn.type = 'button';
            revertBtn.title = 'Revert to Pending';
            revertBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i>';
            const revertHandler = () => removeRecommendation(rec);
            addTrackedListener(revertBtn, 'click', revertHandler);
            recDiv.append(revertBtn);
        }

        container.append(recDiv);
    };

    const renderAllRecommendations = () => {
        // Clear all recommendation containers
        const containers = scheduleView.querySelectorAll<HTMLElement>('[data-slot-recommendations]');
        containers.forEach((container) => {
            container.innerHTML = '';
        });

        // Group recommendations by slot
        const bySlot = new Map<string, RecommendationRow[]>();
        moduleState.recommendations.forEach((rec) => {
            const slotId = rec.slot.id;
            if (!bySlot.has(slotId)) {
                bySlot.set(slotId, []);
            }
            bySlot.get(slotId)!.push(rec);
        });

        // Render recommendations in their respective slots
        bySlot.forEach((recs, slotId) => {
            const container = scheduleView.querySelector<HTMLElement>(`[data-slot-recommendations="${slotId}"]`);
            if (container) {
                recs.forEach((rec) => renderRecommendation(rec, container));
            }
        });

        updateSummaryStats();
    };

    const approveRecommendation = async (rec: RecommendationRow) => {
        const idx = moduleState.recommendations.findIndex((r) =>
            r.slot.id === rec.slot.id &&
            r.user?.id === rec.user?.id &&
            r.guest?.id === rec.guest?.id
        );
        if (idx !== -1) {
            moduleState.recommendations[idx].status = 'APPROVED';
            renderAllRecommendations();
        }
    };

    const rejectRecommendation = async (rec: RecommendationRow) => {
        const idx = moduleState.recommendations.findIndex((r) =>
            r.slot.id === rec.slot.id &&
            r.user?.id === rec.user?.id &&
            r.guest?.id === rec.guest?.id
        );
        if (idx !== -1) {
            moduleState.recommendations[idx].status = 'REJECTED';
            renderAllRecommendations();
        }
    };

    const removeRecommendation = async (rec: RecommendationRow) => {
        // Revert to PENDING instead of deleting
        const idx = moduleState.recommendations.findIndex((r) =>
            r.slot.id === rec.slot.id &&
            r.user?.id === rec.user?.id &&
            r.guest?.id === rec.guest?.id
        );
        if (idx !== -1) {
            moduleState.recommendations[idx].status = 'PENDING';
            renderAllRecommendations();
        }
    };

    const loadRecommendations = async () => {
        try {
            const url = `/api/activity/${planId}/recommendations`;
            const resp = await get(url);
            
            // Extract data from {status, data, message} format
            const data = resp.data || resp;

            moduleState.recommendations = data.recommendations || [];
            moduleState.warnings = data.warnings || [];
            moduleState.participantOptions = data.participantOptions || [];
            moduleState.slots = data.slots || [];
            
            // Extract existing assignments from recommendations for overlap detection
            moduleState.existingAssignments = [];

            renderAllRecommendations();
            setAlert();
        } catch (err) {
            console.error('Failed to load recommendations:', err);
            setAlert('Failed to load recommendations.', 'danger');
        }
    };

    const generateRecommendations = async () => {
        try {
            setAlert('Generating recommendations...', 'info');
            await post(`/api/activity/${planId}/recommendations/auto`, {});
            setAlert('Recommendations generated successfully.', 'info');
            await loadRecommendations();
        } catch (err) {
            console.error('Failed to generate recommendations:', err);
            setAlert('Failed to generate recommendations.', 'danger');
        }
    };

    const applyRecommendations = async () => {
        // Apply = Save all current statuses
        // Send all recommendations with their current status
        const payload = moduleState.recommendations.map(r => ({
            slotId: r.slot.id,
            userId: r.user?.id || null,
            guestId: r.guest?.id || null,
            status: r.status
        }));

        try {
            setAlert('Saving recommendations...', 'info');
            // Wait for backend to complete (includes regeneration)
            await post(`/api/activity/${planId}/recommendations/apply`, {recommendations: payload});
            setAlert('Recommendations saved successfully! Reloading...', 'info');
            // Store active tab before reload
            const activeTabEl = document.querySelector<HTMLElement>('.nav-link.active[data-bs-target]');
            if (activeTabEl) {
                const targetId = activeTabEl.getAttribute('data-bs-target') || '';
                sessionStorage.setItem('activity-active-tab', targetId);
            }
            // Reload after API completes (backend regenerates recommendations)
            reloadAfterDelay(500);
        } catch (err) {
            console.error('Failed to save recommendations:', err);
            setAlert('Failed to save recommendations.', 'danger');
        }
    };

    // Add recommendation handlers
    const scheduleViewClickHandler = (e: Event) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('[data-add-recommendation]') as HTMLButtonElement;
        if (!btn) return;

        const slotId = btn.dataset.slotId;
        if (!slotId || !addModal || !addModalInstance) return;

        // Get slot date from DOM to filter participants
        const slotElement = scheduleView.querySelector(`[data-slot-id="${slotId}"]`);
        const slotDay = slotElement?.closest('[data-day]')?.getAttribute('data-day');
        
        // Populate modal
        if (addSlotIdInput) addSlotIdInput.value = slotId;
        if (addParticipantSelect) {
            addParticipantSelect.innerHTML = '<option value="">Choose a participant...</option>';
            
            // Filter participants based on attendance window
            moduleState.participantOptions.forEach((opt) => {
                // Check if participant is available for this slot's day
                let isAvailable = true;
                if (slotDay && (opt.arrivalDate || opt.departureDate)) {
                    const slotDate = new Date(slotDay);
                    if (opt.arrivalDate) {
                        const arrival = new Date(opt.arrivalDate);
                        if (slotDate < arrival) isAvailable = false;
                    }
                    if (opt.departureDate) {
                        const departure = new Date(opt.departureDate);
                        if (slotDate > departure) isAvailable = false;
                    }
                }
                
                if (!isAvailable) return; // Skip participants outside attendance window
                
                const option = document.createElement('option');
                option.value = participantValue(opt);
                option.textContent = formatParticipantLabel(opt);
                addParticipantSelect.append(option);
            });
            
            // Add change handler to show warning when participant selected
            // Note: We don't track this listener because it uses {once: true} and removes itself
            addParticipantSelect.addEventListener('change', () => {
                // Clear warning first
                if (addWarningBox) {
                    addWarningBox.classList.add('d-none');
                }
                
                const participantValue = addParticipantSelect.value;
                if (!participantValue || !slotId) return;
                
                // Check for overlap
                const [type, idStr] = participantValue.split(':');
                const id = parseInt(idStr, 10);
                const userId = type === 'user' ? id : null;
                const guestId = type === 'guest' ? id : null;
                
                const participant = moduleState.participantOptions.find((p) =>
                    (userId && p.userId === userId) || (guestId && p.guestId === guestId)
                );
                
                if (participant) {
                    // Find slot from existing data
                    const slot = moduleState.slots.find((s: any) => s.id === slotId);
                    if (slot) {
                        // Check for overlapping assignments on same day
                        const slotDate = new Date(slot.day);
                        const hasOverlap = moduleState.existingAssignments.some((assignment: any) => {
                            const matchesParticipant = 
                                (userId && assignment.user?.id === userId) ||
                                (guestId && assignment.guest?.id === guestId);
                            
                            if (!matchesParticipant) return false;
                            
                            const assignmentDate = new Date(assignment.slot.day);
                            if (assignmentDate.toDateString() !== slotDate.toDateString()) return false;
                            
                            // Check time overlap
                            const slotStart = new Date(`${slot.day}T${slot.startTime}`);
                            const slotEnd = new Date(`${slot.day}T${slot.endTime}`);
                            const assignmentStart = new Date(`${assignment.slot.day}T${assignment.slot.startTime}`);
                            const assignmentEnd = new Date(`${assignment.slot.day}T${assignment.slot.endTime}`);
                            
                            return slotStart < assignmentEnd && slotEnd > assignmentStart;
                        });
                        
                        if (hasOverlap && addWarningBox) {
                            addWarningBox.classList.remove('d-none');
                            const span = addWarningBox.querySelector('span');
                            if (span) span.textContent = '⚠️ Warning: This participant has an overlapping assignment or recommendation on the same day';
                        }
                    }
                }
            }, {once: true}); // Only attach once per modal open
        }
        if (addWarningBox) addWarningBox.classList.add('d-none');

        addModalInstance.show();
    };
    addTrackedListener(scheduleView, 'click', scheduleViewClickHandler);

    if (addConfirmBtn) {
        const addConfirmClickHandler = async () => {
            const slotId = addSlotIdInput?.value;
            const participantValue = addParticipantSelect?.value;
            if (!slotId || !participantValue) return;

            const [type, idStr] = participantValue.split(':');
            const id = parseInt(idStr, 10);
            const userId = type === 'user' ? id : null;
            const guestId = type === 'guest' ? id : null;

            const participant = moduleState.participantOptions.find((p) =>
                (userId && p.userId === userId) || (guestId && p.guestId === guestId)
            );

            if (!participant) return;

            // Find slot information from existing recommendations or from DOM
            let slot = moduleState.recommendations.find((r) => r.slot.id === slotId)?.slot;
            if (!slot) {
                // Try to get slot title from DOM
                const slotElement = scheduleView.querySelector(`[data-slot-id="${slotId}"]`);
                const slotTitle = slotElement?.querySelector('.fw-bold')?.textContent?.trim() || 'Unknown slot';
                slot = {
                    id: slotId,
                    title: slotTitle,
                };
            }

            // Check for duplicates before adding
            const isDuplicate = moduleState.recommendations.some(r =>
                r.slot.id === slotId &&
                r.user?.id === userId &&
                r.guest?.id === guestId
            );

            if (isDuplicate) {
                alert('This recommendation already exists.');
                return;
            }
            
            // Add recommendation directly (overlap warning already shown on selection change)
            // Get slot's day/time from DOM
            const slotElement = scheduleView.querySelector(`[data-slot-id="${slotId}"]`);
            const slotDay = slotElement?.closest('[data-day]')?.getAttribute('data-day');
            const slotStartTime = slotElement?.querySelector('[data-start-time]')?.getAttribute('data-start-time');
            const slotEndTime = slotElement?.querySelector('[data-end-time]')?.getAttribute('data-end-time');
            
            // Check if participant has overlapping recommendations
            const hasOverlap = moduleState.recommendations.some(r => {
                // Must be same participant
                if (!(r.user?.id === userId || r.guest?.id === guestId)) return false;
                
                // Must be same day
                const rSlotEl = scheduleView.querySelector(`[data-slot-id="${r.slot.id}"]`);
                const rDay = rSlotEl?.closest('[data-day]')?.getAttribute('data-day');
                if (rDay !== slotDay) return false;
                
                // Check time overlap
                const rStartTime = rSlotEl?.querySelector('[data-start-time]')?.getAttribute('data-start-time');
                const rEndTime = rSlotEl?.querySelector('[data-end-time]')?.getAttribute('data-end-time');
                
                if (slotStartTime && slotEndTime && rStartTime && rEndTime) {
                    // Times overlap if slot1.start < slot2.end AND slot1.end > slot2.start
                    const overlap = slotStartTime < rEndTime && slotEndTime > rStartTime;
                    return overlap;
                }
                
                return false;
            });
            
            // Always clear warning first
            if (addWarningBox) {
                addWarningBox.classList.add('d-none');
            }
            
            // Show warning if overlap detected
            if (hasOverlap && addWarningBox) {
                addWarningBox.classList.remove('d-none');
                addWarningBox.classList.remove('alert-info');
                addWarningBox.classList.add('alert-warning');
                const span = addWarningBox.querySelector('span');
                if (span) span.textContent = '⚠️ Warning: This participant has an overlapping assignment or recommendation on the same day.';
                // Allow them to proceed anyway - it's just a warning
            }

            // Create new recommendation
            const newRec: RecommendationRow = {
                slot,
                user: userId ? {id: userId, username: participant.label} : null,
                guest: guestId ? {id: guestId, username: participant.label} : null,
                status: 'APPROVED',
            };

            moduleState.recommendations.push(newRec);
            renderAllRecommendations();

            if (addModalInstance) addModalInstance.hide();
        };
        addTrackedListener(addConfirmBtn, 'click', addConfirmClickHandler);
    }

    // Button handlers
    if (refreshBtn) addTrackedListener(refreshBtn, 'click', loadRecommendations);
    if (autoBtn) addTrackedListener(autoBtn, 'click', generateRecommendations);
    if (applyBtn) addTrackedListener(applyBtn, 'click', applyRecommendations);

    // Initial load
    loadRecommendations();
}
