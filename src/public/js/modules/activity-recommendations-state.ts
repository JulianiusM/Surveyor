/**
 * State management for activity recommendations
 * Encapsulates all recommendation-related state with methods for safe access and modification
 */

import type {
    RecommendationParticipantOption,
    RecommendationRow,
    RecommendationWarning,
    BootstrapModal
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
    private slots: any[] = [];
    private existingAssignments: any[] = [];
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

    getSlots(): any[] {
        return [...this.slots];
    }

    getExistingAssignments(): any[] {
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
        this.recommendations = recommendations;
    }

    setWarnings(warnings: RecommendationWarning[]): void {
        this.warnings = warnings;
    }

    setParticipantOptions(options: RecommendationParticipantOption[]): void {
        this.participantOptions = options;
    }

    setSlots(slots: any[]): void {
        this.slots = slots;
    }

    setExistingAssignments(assignments: any[]): void {
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
    updateRecommendationStatus(slotId: string, userId: number | null, guestId: number | null, status: string): boolean {
        const idx = this.recommendations.findIndex((r) =>
            r.slot.id === slotId &&
            r.user?.id === userId &&
            r.guest?.id === guestId
        );
        
        if (idx !== -1) {
            this.recommendations[idx].status = status as any;
            return true;
        }
        return false;
    }

    addRecommendation(recommendation: RecommendationRow): void {
        this.recommendations.push(recommendation);
    }

    // Check for duplicates
    hasDuplicateRecommendation(slotId: string, userId: number | null, guestId: number | null): boolean {
        return this.recommendations.some(r =>
            r.slot.id === slotId &&
            r.user?.id === userId &&
            r.guest?.id === guestId
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
