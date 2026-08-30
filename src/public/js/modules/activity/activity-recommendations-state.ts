/**
 * State management for activity recommendations
 * Encapsulates all recommendation-related state with methods for safe access and modification
 */

import type {
    BootstrapModal,
    ExistingActivityAssignment,
    RecommendationParticipantOption,
    RecommendationRow,
    RecommendationSlotOption,
    RecommendationWarning
} from './activity-types';

interface EventListenerTracking {
    element: HTMLElement | Document;
    event: string;
    handler: EventListener;
}

/**
 * State management class for activity recommendations
 * Provides encapsulated access to recommendation state with proper lifecycle management
 */
export class ActivityRecommendationsState {
    private recommendations: RecommendationRow[] = [];
    private warnings: RecommendationWarning[] = [];
    private participantOptions: RecommendationParticipantOption[] = [];
    private slots: RecommendationSlotOption[] = [];
    private existingAssignments: ExistingActivityAssignment[] = [];
    private eventListeners: EventListenerTracking[] = [];
    private addModalInstance: BootstrapModal | null = null;

    // Getters - return copies to prevent external mutation
    getRecommendations(): RecommendationRow[] {
        return [...this.recommendations];
    }

    getWarnings(): RecommendationWarning[] {
        return [...this.warnings];
    }

    getParticipantOptions(): RecommendationParticipantOption[] {
        return [...this.participantOptions];
    }

    getSlots(): RecommendationSlotOption[] {
        return [...this.slots];
    }

    getExistingAssignments(): ExistingActivityAssignment[] {
        return [...this.existingAssignments];
    }

    getEventListeners(): EventListenerTracking[] {
        return [...this.eventListeners];
    }

    getModalInstance(): BootstrapModal | null {
        return this.addModalInstance;
    }

    // Setters
    setRecommendations(recommendations: RecommendationRow[]): void {
        // Applied recommendations are audit history, not actionable review items.
        this.recommendations = recommendations.filter((recommendation) =>
            !recommendation.hidden && recommendation.status !== 'APPLIED');
    }

    setWarnings(warnings: RecommendationWarning[]): void {
        this.warnings = warnings;
    }

    setParticipantOptions(options: RecommendationParticipantOption[]): void {
        this.participantOptions = options;
    }

    setSlots(slots: RecommendationSlotOption[]): void {
        this.slots = slots;
    }

    setExistingAssignments(assignments: ExistingActivityAssignment[]): void {
        this.existingAssignments = assignments;
    }

    setModalInstance(instance: BootstrapModal | null): void {
        this.addModalInstance = instance;
    }

    // Event listener management
    trackListener(element: HTMLElement | Document, event: string, handler: EventListener): void {
        this.eventListeners.push({element, event, handler});
    }

    // Update methods
    updateRecommendationStatus(
        recommendation: RecommendationRow,
        status: RecommendationRow['status'],
    ): boolean {
        const current = this.recommendations.find((candidate) =>
            candidate === recommendation
            || Boolean(recommendation.id && candidate.id === recommendation.id));
        if (!current) return false;

        current.status = status;
        const reciprocalSwap = this.findReciprocalManualSwap(current);
        if (reciprocalSwap) reciprocalSwap.status = status;
        return true;
    }

    addRecommendation(recommendation: RecommendationRow): void {
        this.recommendations.push(recommendation);
    }

    removeRecommendation(recommendation: RecommendationRow): boolean {
        const matches = (candidate: RecommendationRow): boolean =>
            candidate === recommendation
            || Boolean(recommendation.id && candidate.id === recommendation.id);
        const reciprocalSwap = this.findReciprocalManualSwap(recommendation);
        const previousLength = this.recommendations.length;
        this.recommendations = this.recommendations.filter((candidate) =>
            !matches(candidate) && candidate !== reciprocalSwap);
        return this.recommendations.length < previousLength;
    }

    private findReciprocalManualSwap(recommendation: RecommendationRow): RecommendationRow | undefined {
        if (!recommendation.manual || recommendation.operation !== 'REASSIGN' || !recommendation.sourceItem) {
            return undefined;
        }
        return this.recommendations.find((candidate) =>
            candidate !== recommendation
            && candidate.manual
            && candidate.operation === 'REASSIGN'
            && candidate.item.id === recommendation.sourceItem!.id
            && candidate.sourceItem?.id === recommendation.item.id);
    }

    // Check for duplicates
    hasDuplicateRecommendation(slotId: string, profileId: string | null): boolean {
        return this.recommendations.some(r =>
            r.item.id === slotId &&
            (r.profile?.id ?? null) === profileId
        );
    }

    /**
     * Reset all state - used for cleanup
     */
    reset(): void {
        // Remove all tracked event listeners
        this.eventListeners.forEach(({element, event, handler}) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners = [];

        // Dispose modal if exists
        if (this.addModalInstance) {
            if (typeof this.addModalInstance.dispose === 'function') {
                this.addModalInstance.dispose();
            }
            this.addModalInstance = null;
        }

        // Clear all arrays
        this.recommendations = [];
        this.warnings = [];
        this.participantOptions = [];
        this.slots = [];
        this.existingAssignments = [];
    }
}
