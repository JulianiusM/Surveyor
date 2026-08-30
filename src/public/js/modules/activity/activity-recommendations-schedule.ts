/**
 * Activity Recommendations Schedule Module
 * Handles the enhanced schedule-based recommendations view
 *
 * Architecture: Uses layered approach with separation of concerns
 * - State layer: ActivityRecommendationsState
 * - Logic layer: RecommendationsLogic
 * - UI layer: RecommendationsUI
 */

import {get, post} from '../../core/http';
import {generateRecommendationsAndWait} from './activity-recommendation-jobs';
import {reloadAfterDelay} from '../../shared/ui-helpers';
import {RecommendationsLogic} from './activity-recommendations-logic';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import {RecommendationsUI} from './activity-recommendations-ui';
import type {RecommendationModalRequest} from './activity-recommendations-ui';
import type {RecommendationRow} from './activity-types';

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
export async function initRecommendationScheduleView(planId: string, describeSlot: (slotId: string) => string): Promise<ActivityRecommendationsState | null> {
    const panel = document.getElementById('recommendationPanel');
    const scheduleView = panel?.querySelector<HTMLElement>('#recommendationScheduleView');

    if (!planId || !panel || !scheduleView) return null;

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

    const handleRemove = (rec: RecommendationRow) => {
        if (!logic!.removeRecommendation(rec)) return;
        renderAll();
        ui!.setAlert('Manual operation removed. Select Save changes to persist this review.', 'info');
    };

    // Define renderAll after handlers
    renderAll = () => {
        ui!.renderAllRecommendations(handleApprove, handleReject, handleRevert, handleRemove);
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
            state!.setExistingAssignments(data.existingAssignments || []);

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
            await generateRecommendationsAndWait(planId, (status) => {
                if (status === 'RUNNING') ui!.setAlert('Calculating recommendations...', 'info');
            });
            ui!.setAlert('Recommendations generated successfully.', 'info');
            await loadRecommendations();
        } catch (err) {
            console.error('Failed to generate recommendations:', err);
            ui!.setAlert('Failed to generate recommendations.', 'danger');
        }
    };

    const applyRecommendations = async () => {
        const recommendations = state!.getRecommendations();
        const payload = recommendations
            .filter((recommendation) => !(recommendation.manual && recommendation.status === 'REJECTED'))
            .map(r => ({
            id: r.id,
            itemId: r.item.id,
            profileId: r.profile?.id || null,
            status: r.status,
            operation: r.operation || 'ASSIGN',
            sourceItemId: r.sourceItem?.id || null,
            manual: Boolean(r.manual),
        }));

        try {
            ui!.setAlert('Saving recommendations...', 'info');
            await post(`/api/activity/${planId}/recommendations/apply`, {recommendations: payload});
            ui!.setAlert('Recommendations saved successfully! Reloading...', 'info');

            const activeTabEl = document.querySelector<HTMLElement>('.nav-link.active[data-bs-target]');
            if (activeTabEl) {
                sessionStorage.setItem('activity-active-tab', activeTabEl.dataset.bsTarget || '');
            }

            reloadAfterDelay(500);
        } catch (err) {
            console.error('Failed to save recommendations:', err);
            ui!.setAlert('Failed to save recommendations.', 'danger');
        }
    };

    const slotFor = (slotId: string) => state!.getSlots().find((slot) => slot.id === slotId);
    const handleAddConfirm = (request: RecommendationModalRequest) => {
        const participant = logic!.findParticipant(request.profileId);
        if (!participant) return;
        if (logic!.isDuplicate(request.targetSlotId, request.profileId)
            || logic!.isAlreadyAssigned(request.targetSlotId, request.profileId)) {
            alert('This recommendation already exists.');
            return;
        }

        const targetSlot = slotFor(request.targetSlotId);
        if (!targetSlot) return;
        if (request.operation === 'ASSIGN') {
            logic!.addRecommendation(logic!.createRecommendation(
                targetSlot,
                participant,
                request.profileId,
            ));
        } else {
            const sourceSlot = request.sourceItemId ? slotFor(request.sourceItemId) : undefined;
            if (!sourceSlot) return;
            const staged = [logic!.createRecommendation(
                targetSlot,
                participant,
                request.profileId,
                'REASSIGN',
                sourceSlot,
            )];

            if (request.operation === 'SWAP' && request.swapProfileId) {
                const outgoingAssignment = state!.getExistingAssignments().find((assignment) =>
                    assignment.item.id === targetSlot.id
                    && assignment.profile.id === request.swapProfileId);
                const outgoingParticipant = logic!.findParticipant(request.swapProfileId);
                if (!outgoingAssignment || !outgoingParticipant) return;
                if (logic!.isDuplicate(sourceSlot.id, request.swapProfileId)
                    || logic!.isAlreadyAssigned(sourceSlot.id, request.swapProfileId)) {
                    alert('The selected participant cannot be moved into the other side of this swap.');
                    return;
                }
                staged.push(logic!.createRecommendation(
                    sourceSlot,
                    outgoingParticipant,
                    request.swapProfileId,
                    'REASSIGN',
                    targetSlot,
                ));
            }
            staged.forEach((recommendation) => logic!.addRecommendation(recommendation));
        }
        renderAll();
        ui!.hideModal();
    };

    const handleUnassign = (slotId: string, profileId: string) => {
        if (logic!.isDuplicate(slotId, profileId)) {
            alert('A recommendation for this participant and slot already exists.');
            return;
        }
        const assignment = state!.getExistingAssignments().find((existing) =>
            existing.item.id === slotId && existing.profile.id === profileId);
        if (!assignment) return;
        logic!.addRecommendation({
            item: assignment.item,
            profile: assignment.profile,
            status: 'APPROVED',
            operation: 'UNASSIGN',
            manual: true,
        });
        renderAll();
    };

    ui!.setupButtons(loadRecommendations, generateRecommendations, applyRecommendations);
    ui!.setupAddModal(handleAddConfirm, handleUnassign);
    await loadRecommendations();

    return state;
}
