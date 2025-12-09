/**
 * Activity Recommendations Schedule Module
 * Handles the enhanced schedule-based recommendations view
 * 
 * Architecture: Uses layered approach with separation of concerns
 * - State layer: ActivityRecommendationsState
 * - Logic layer: RecommendationsLogic  
 * - UI layer: RecommendationsUI
 */

import {get, post} from '../core/http';
import {reloadAfterDelay} from '../shared/ui-helpers';
import type {RecommendationRow} from './activity-types';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import {RecommendationsLogic} from './activity-recommendations-logic';
import {RecommendationsUI} from './activity-recommendations-ui';

// Module-level instances
let state: ActivityRecommendationsState | null = null;
let logic: RecommendationsLogic | null = null;
let ui: RecommendationsUI | null = null;

/**
 * Cleanup function to reset module state and remove event listeners
 * Should be called when tearing down the view or between tests
 */
export function cleanupRecommendationScheduleView(): void {
    if (ui) {
        ui.cleanup();
    }
    if (state) {
        state.reset();
    }
    state = null;
    logic = null;
    ui = null;
}

/**
 * Initialize recommendation schedule view with layered architecture
 * @param planId - Activity plan ID
 * @param describeSlot - Function to describe a slot by ID
 */
export function initRecommendationScheduleView(planId: string, describeSlot: (slotId: string) => string): void {
    const panel = document.getElementById('recommendationPanel');
    const scheduleView = panel?.querySelector<HTMLElement>('#recommendationScheduleView');
    
    if (!planId || !panel || !scheduleView) return;

    // Initialize layers
    state = new ActivityRecommendationsState();
    logic = new RecommendationsLogic(state);
    ui = new RecommendationsUI(state, logic, panel);

    // Helper function to re-render - declare first
    let renderAll: () => void;

    // Action handlers
    const handleApprove = (rec: RecommendationRow) => {
        logic!.approveRecommendation(rec);
        renderAll();
    };

    const handleReject = (rec: RecommendationRow) => {
        logic!.rejectRecommendation(rec);
        renderAll();
    };

    const handleRevert = (rec: RecommendationRow) => {
        logic!.revertToPending(rec);
        renderAll();
    };

    // Define renderAll after handlers
    renderAll = () => {
        ui!.renderAllRecommendations(handleApprove, handleReject, handleRevert);
    };

    // API functions
    const loadRecommendations = async () => {
        try {
            const url = `/api/activity/${planId}/recommendations`;
            const resp = await get(url);
            
            const data = resp.data || resp;
            state!.setRecommendations(data.recommendations || []);
            state!.setWarnings(data.warnings || []);
            state!.setParticipantOptions(data.participantOptions || []);
            state!.setSlots(data.slots || []);
            state!.setExistingAssignments([]);

            renderAll();
            ui!.setAlert();
        } catch (err) {
            console.error('Failed to load recommendations:', err);
            ui!.setAlert('Failed to load recommendations.', 'danger');
        }
    };

    const generateRecommendations = async () => {
        try {
            ui!.setAlert('Generating recommendations...', 'info');
            await post(`/api/activity/${planId}/recommendations/auto`, {});
            ui!.setAlert('Recommendations generated successfully.', 'info');
            await loadRecommendations();
        } catch (err) {
            console.error('Failed to generate recommendations:', err);
            ui!.setAlert('Failed to generate recommendations.', 'danger');
        }
    };

    const applyRecommendations = async () => {
        const recommendations = state!.getRecommendations();
        const payload = recommendations.map(r => ({
            slotId: r.slot.id,
            userId: r.user?.id || null,
            guestId: r.guest?.id || null,
            status: r.status
        }));

        try {
            ui!.setAlert('Saving recommendations...', 'info');
            await post(`/api/activity/${planId}/recommendations/apply`, {recommendations: payload});
            ui!.setAlert('Recommendations saved successfully! Reloading...', 'info');
            
            const activeTabEl = document.querySelector<HTMLElement>('.nav-link.active[data-bs-target]');
            if (activeTabEl) {
                sessionStorage.setItem('activity-active-tab', activeTabEl.getAttribute('data-bs-target') || '');
            }
            
            reloadAfterDelay(500);
        } catch (err) {
            console.error('Failed to save recommendations:', err);
            ui!.setAlert('Failed to save recommendations.', 'danger');
        }
    };

    const handleAddConfirm = (slotId: string, participantValue: string) => {
        const {type, id} = logic!.parseParticipantValue(participantValue);
        const userId = type === 'user' ? id : null;
        const guestId = type === 'guest' ? id : null;

        const participant = logic!.findParticipant(userId, guestId);
        if (!participant) return;

        if (logic!.isDuplicate(slotId, userId, guestId)) {
            alert('This recommendation already exists.');
            return;
        }

        const recommendations = state!.getRecommendations();
        let slot = recommendations.find((r) => r.slot.id === slotId)?.slot;
        if (!slot) {
            const scheduleView = panel.querySelector<HTMLElement>('#recommendationScheduleView');
            const slotElement = scheduleView?.querySelector(`[data-slot-id="${slotId}"]`);
            const slotTitle = slotElement?.querySelector('.fw-bold')?.textContent?.trim() || 'Unknown slot';
            slot = {id: slotId, title: slotTitle};
        }

        const newRec = logic!.createRecommendation(slot, participant, userId, guestId);
        logic!.addRecommendation(newRec);
        renderAll();
        ui!.hideModal();
    };

    ui!.setupButtons(loadRecommendations, generateRecommendations, applyRecommendations);
    ui!.setupAddModal(handleAddConfirm);
    loadRecommendations();
}
