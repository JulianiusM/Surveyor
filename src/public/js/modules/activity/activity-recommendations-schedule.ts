/**
 * Activity recommendations schedule view.
 * The state, logic and UI layers own the draft. This module coordinates requests;
 * availability decisions stay on the server for every assignment path.
 */
import {assertSuccessfulResponse, get, post} from '../../core/http';
import {generateRecommendationsAndWait} from './activity-recommendation-jobs';
import {reloadAfterDelay} from '../../shared/ui-helpers';
import {showInlineAlert} from '../../shared/alerts';
import {RecommendationsLogic} from './activity-recommendations-logic';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import {RecommendationsUI} from './activity-recommendations-ui';
import type {AssignmentWarning, RecommendationInput, RecommendationModalRequest,
    RecommendationWarningPreview} from '../../../../types/ActivityTypes';
import type {RecommendationRow, WarningModal} from './activity-types';

// Keep the explicit lifecycle: in-flight previews cannot update a replacement view.
let state: ActivityRecommendationsState | null = null;
let ui: RecommendationsUI | null = null;

export function cleanupRecommendationScheduleView(): void {
    if (ui) ui.cleanup();
    state = null;
    ui = null;
}

/** Initialize the existing review without exposing another collision implementation to the browser. */
export async function initRecommendationScheduleView(
    planId: string, describeSlot: (slotId: string) => string, warningModal: WarningModal,
): Promise<ActivityRecommendationsState | null> {
    const panel = document.getElementById('recommendationPanel');
    const scheduleView = panel?.querySelector<HTMLElement>('#recommendationScheduleView');
    if (!planId || !panel || !scheduleView) return null;

    const viewState = new ActivityRecommendationsState();
    const viewLogic = new RecommendationsLogic(viewState);
    const viewUI = new RecommendationsUI(viewState, viewLogic, panel, describeSlot);
    state = viewState;
    ui = viewUI;
    let saving = false;
    let previewRequest = 0;
    const saveResultKey = 'activity-recommendation-result-' + planId;

    function renderAll(): void {
        viewUI.renderAllRecommendations(handleApprove, handleReject, handleRevert, handleRemove);
        if (saving) viewUI.setBusy(true);
    }

    /** Preview a complete draft without persisting it or trusting browser-calculated warnings. */
    async function previewReview(recommendations: RecommendationInput[]): Promise<RecommendationWarningPreview> {
        const response = await post('/api/activity/' + planId + '/recommendations/warnings', {recommendations});
        assertSuccessfulResponse(response);
        return response.data;
    }

    async function refreshDraftWarnings(): Promise<void> {
        const request = ++previewRequest;
        const payload = viewLogic.createReviewPayload();
        const draft = JSON.stringify(payload);
        try {
            const preview = await previewReview(payload);
            if (state !== viewState || request !== previewRequest || draft !== JSON.stringify(viewLogic.createReviewPayload())) return;
            viewState.setWarnings(preview.warnings);
            renderAll();
        } catch (error) {
            if (state !== viewState || request !== previewRequest) return;
            const message = error instanceof Error ? error.message : 'Warnings could not be checked.';
            viewUI.setAlert(message + ' Check the review again before saving.', 'danger', true);
        }
    }

    function handleApprove(rec: RecommendationRow): void {
        viewLogic.approveRecommendation(rec);
        renderAll();
        void refreshDraftWarnings();
    }
    function handleReject(rec: RecommendationRow): void {
        viewLogic.rejectRecommendation(rec);
        renderAll();
        void refreshDraftWarnings();
    }
    function handleRevert(rec: RecommendationRow): void {
        viewLogic.revertToPending(rec);
        renderAll();
        void refreshDraftWarnings();
    }
    function handleRemove(rec: RecommendationRow): void {
        if (!viewLogic.removeRecommendation(rec)) return;
        renderAll();
        viewUI.setAlert('Manual operation removed. Select Save changes to persist this review.', 'info');
        void refreshDraftWarnings();
    }

    async function loadRecommendations(): Promise<void> {
        try {
            const response = await get('/api/activity/' + planId + '/recommendations');
            assertSuccessfulResponse(response);
            if (state !== viewState) return;
            const data = response.data;
            viewState.setRecommendations(data.recommendations || []);
            viewState.setWarnings(data.warnings || []);
            viewState.setParticipantOptions(data.participantOptions || []);
            viewState.setSlots(data.slots || []);
            viewState.setExistingAssignments(data.existingAssignments || []);
            renderAll();
            const result = sessionStorage.getItem(saveResultKey);
            sessionStorage.removeItem(saveResultKey);
            viewUI.setAlert(result || undefined, 'info', Boolean(result));
            // Approved rows must show the application projection. Pending proposals
            // remain commitments and cannot release their actual source assignments.
            await refreshDraftWarnings();
        } catch (error) {
            if (state !== viewState) return;
            const message = error instanceof Error ? error.message : 'Failed to load recommendations.';
            viewUI.setAlert(message, 'danger', true);
        }
    }

    function showGenerationStatus(status: string): void {
        if (status === 'RUNNING' && state === viewState) viewUI.setAlert('Calculating recommendations...', 'info', true);
    }
    async function generateRecommendations(): Promise<void> {
        try {
            viewUI.setAlert('Generating recommendations...', 'info', true);
            await generateRecommendationsAndWait(planId, showGenerationStatus);
            await loadRecommendations();
        } catch (error) {
            if (state !== viewState) return;
            const message = error instanceof Error ? error.message : 'Failed to generate recommendations.';
            viewUI.setAlert(message, 'danger', true);
        }
    }

    /** Freeze, preview, display and confirm the exact draft before submitting its acknowledgement. */
    async function applyRecommendations(): Promise<void> {
        if (saving) return;
        saving = true;
        previewRequest++;
        viewUI.setBusy(true);
        const payload = viewLogic.createReviewPayload();
        try {
            const preview = await previewReview(payload);
            if (state !== viewState) return;
            viewState.setWarnings(preview.warnings);
            renderAll();
            const overlaps: AssignmentWarning[] = [];
            for (const result of preview.warnings) {
                if (result.recommendation.status !== 'APPROVED') continue;
                for (const warning of result.warnings) {
                    if (warning.type === 'overlap' && warning.confirmable) overlaps.push(warning);
                }
            }
            if (preview.overlapConfirmation) {
                const confirmed = await warningModal.confirm(overlaps, '', 'Confirm overlapping changes');
                if (!confirmed || state !== viewState) return;
            }
            viewUI.setAlert('Saving recommendations...', 'info', true);
            const response = await post('/api/activity/' + planId + '/recommendations/apply', {
                recommendations: payload, overlapConfirmation: preview.overlapConfirmation,
            });
            assertSuccessfulResponse(response);
            if (state !== viewState) return;
            // Report actual counts, including skipped rows retained for review.
            const result = response.data;
            viewState.setWarnings(result.warnings || []);
            renderAll();
            const message = 'Saved review. Applied ' + result.applied + '; skipped ' + result.skipped + '.';
            viewUI.setAlert(message, 'info', true);
            sessionStorage.setItem(saveResultKey, message);
            const activeTab = document.querySelector<HTMLElement>('.nav-link.active[data-bs-target]');
            if (activeTab) sessionStorage.setItem('activity-active-tab', activeTab.dataset.bsTarget || '');
            reloadAfterDelay(500);
        } catch (error) {
            if (state !== viewState) return;
            const message = error instanceof Error ? error.message : 'Failed to save recommendations.';
            viewUI.setAlert(message, 'danger', true);
            // A stale-confirmation rejection preserves the draft and requires another
            // deliberate save after fresh, persistent warnings have been displayed.
            await refreshDraftWarnings();
        } finally {
            saving = false;
            viewUI.setBusy(false);
        }
    }

    function slotFor(slotId: string): RecommendationRow['item'] | undefined {
        return viewState.getSlots().find((slot) => slot.id === slotId);
    }

    /** Construct both legs once for preview/staging; source assignments stay in this plan. */
    function createManualRows(request: RecommendationModalRequest): RecommendationRow[] {
        const participant = viewLogic.findParticipant(request.profileId);
        const targetSlot = slotFor(request.targetSlotId);
        if (!participant || !targetSlot) throw new Error('Select a participant and slot.');
        if (viewLogic.isDuplicate(request.targetSlotId, request.profileId)
            || viewLogic.isAlreadyAssigned(request.targetSlotId, request.profileId)) {
            throw new Error('This recommendation already exists.');
        }
        if (request.operation === 'ASSIGN') return [viewLogic.createRecommendation(targetSlot, participant, request.profileId)];
        const sourceSlot = request.sourceItemId ? slotFor(request.sourceItemId) : undefined;
        if (!sourceSlot) throw new Error('Select the source assignment.');
        const staged = [viewLogic.createRecommendation(targetSlot, participant, request.profileId, 'REASSIGN', sourceSlot)];
        if (request.operation === 'SWAP') {
            const outgoingParticipant = viewLogic.findParticipant(request.swapProfileId || null);
            const outgoingAssignment = viewState.getExistingAssignments().find((assignment) =>
                assignment.item.id === targetSlot.id && assignment.profile.id === request.swapProfileId);
            if (!outgoingParticipant || !outgoingAssignment || !request.swapProfileId) throw new Error('Select the participant to swap.');
            if (viewLogic.isDuplicate(sourceSlot.id, request.swapProfileId)
                || viewLogic.isAlreadyAssigned(sourceSlot.id, request.swapProfileId)) {
                throw new Error('The selected participant cannot be moved into the other side of this swap.');
            }
            staged.push(viewLogic.createRecommendation(sourceSlot, outgoingParticipant, request.swapProfileId, 'REASSIGN', targetSlot));
        }
        return staged;
    }

    async function previewManualRows(request: RecommendationModalRequest): Promise<AssignmentWarning[]> {
        const staged = createManualRows(request);
        const preview = await previewReview(viewLogic.createReviewPayload(staged));
        const warnings: AssignmentWarning[] = [];
        for (const result of preview.warnings) {
            for (const row of staged) {
                if (result.recommendation.itemId === row.item.id && result.recommendation.profileId === row.profile?.id) {
                    warnings.push(...result.warnings);
                }
            }
        }
        return warnings;
    }
    async function handleAddConfirm(request: RecommendationModalRequest): Promise<void> {
        try {
            for (const recommendation of createManualRows(request)) viewLogic.addRecommendation(recommendation);
            renderAll();
            viewUI.hideModal();
            await refreshDraftWarnings();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'The operation could not be added.';
            showInlineAlert('error', message, document.querySelector<HTMLElement>('#addRecommendationModal .modal-body') ?? undefined);
        }
    }
    function handleUnassign(slotId: string, profileId: string): void {
        if (viewLogic.isDuplicate(slotId, profileId)) {
            showInlineAlert('error', 'A recommendation for this participant and slot already exists.');
            return;
        }
        const assignment = viewState.getExistingAssignments().find((existing) =>
            existing.item.id === slotId && existing.profile.id === profileId);
        if (!assignment) return;
        viewLogic.addRecommendation({item: assignment.item, profile: assignment.profile,
            status: 'APPROVED', operation: 'UNASSIGN', manual: true});
        renderAll();
        void refreshDraftWarnings();
    }

    viewUI.setupButtons(loadRecommendations, generateRecommendations, applyRecommendations);
    viewUI.setupAddModal(handleAddConfirm, handleUnassign, previewManualRows);
    await loadRecommendations();
    return viewState;
}
