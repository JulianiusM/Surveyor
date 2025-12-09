/**
 * Business logic for activity recommendations
 * Pure logic layer - no DOM manipulation
 */

import type {
    RecommendationParticipantOption,
    RecommendationRow
} from './activity-types';
import {ActivityRecommendationsState} from './activity-recommendations-state';
import {formatDateLabel} from "../core/formatting";

/**
 * Business logic class for recommendations
 * Handles all recommendation operations without DOM concerns
 */
export class RecommendationsLogic {
    constructor(private state: ActivityRecommendationsState) {}

    /**
     * Approve a recommendation
     */
    approveRecommendation(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(
            rec.slot.id,
            rec.user?.id ?? null,
            rec.guest?.id ?? null,
            'APPROVED'
        );
    }

    /**
     * Reject a recommendation
     */
    rejectRecommendation(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(
            rec.slot.id,
            rec.user?.id ?? null,
            rec.guest?.id ?? null,
            'REJECTED'
        );
    }

    /**
     * Revert recommendation to pending
     */
    revertToPending(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(
            rec.slot.id,
            rec.user?.id ?? null,
            rec.guest?.id ?? null,
            'PENDING'
        );
    }

    /**
     * Format participant label with attendance dates
     */
    formatParticipantLabel(option: RecommendationParticipantOption): string {
        const arrival = formatDateLabel(option.arrivalDate ?? null);
        const departure = formatDateLabel(option.departureDate ?? null);
        const attendance = arrival || departure ? ` (${arrival || 'start'} – ${departure || 'end'})` : '';
        return `${option.label}${attendance}`;
    }

    /**
     * Get participant value for form
     */
    getParticipantValue(option: RecommendationParticipantOption): string {
        return option.userId ? `user:${option.userId}` : `guest:${option.guestId}`;
    }

    /**
     * Parse participant value from form
     */
    parseParticipantValue(value: string): {type: string; id: number} {
        const [type, idStr] = value.split(':');
        return {type, id: parseInt(idStr, 10)};
    }

    /**
     * Find participant by ID
     */
    findParticipant(userId: number | null, guestId: number | null): RecommendationParticipantOption | undefined {
        const options = this.state.getParticipantOptions();
        return options.find((p) =>
            (userId && p.userId === userId) || (guestId && p.guestId === guestId)
        );
    }

    /**
     * Check if participant is available for a given date
     */
    isParticipantAvailable(option: RecommendationParticipantOption, slotDay: string): boolean {
        if (!slotDay || (!option.arrivalDate && !option.departureDate)) {
            return true;
        }

        const slotDate = new Date(slotDay);
        
        if (option.arrivalDate) {
            const arrival = new Date(option.arrivalDate);
            if (slotDate < arrival) return false;
        }
        
        if (option.departureDate) {
            const departure = new Date(option.departureDate);
            if (slotDate > departure) return false;
        }
        
        return true;
    }

    /**
     * Filter participants for a specific slot date
     */
    getAvailableParticipants(slotDay: string | null): RecommendationParticipantOption[] {
        if (!slotDay) {
            return this.state.getParticipantOptions();
        }

        return this.state.getParticipantOptions().filter(opt =>
            this.isParticipantAvailable(opt, slotDay)
        );
    }

    /**
     * Check for duplicate recommendation
     */
    isDuplicate(slotId: string, userId: number | null, guestId: number | null): boolean {
        return this.state.hasDuplicateRecommendation(slotId, userId, guestId);
    }

    /**
     * Check for overlapping assignments on same day
     */
    hasOverlappingAssignment(
        userId: number | null,
        guestId: number | null,
        slotId: string
    ): boolean {
        const slots = this.state.getSlots();
        const slot = slots.find((s: any) => s.id === slotId);
        if (!slot) return false;

        const slotDate = new Date(slot.day);
        const existingAssignments = this.state.getExistingAssignments();

        return existingAssignments.some((assignment: any) => {
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
    }

    /**
     * Check for overlapping recommendations
     */
    hasOverlappingRecommendation(
        userId: number | null,
        guestId: number | null,
        slotDay: string | null,
        slotStartTime: string | null,
        slotEndTime: string | null
    ): boolean {
        if (!slotDay || !slotStartTime || !slotEndTime) return false;

        const recommendations = this.state.getRecommendations();
        return recommendations.some(r => {
            // Must be same participant
            if (!(r.user?.id === userId || r.guest?.id === guestId)) return false;
            
            // Must be same day (comparing with DOM would require UI layer)
            // This is a simplified check - full implementation would need slot day info
            return false; // Placeholder - actual implementation needs more context
        });
    }

    /**
     * Calculate summary statistics
     */
    getSummaryStats(): Record<string, number> {
        const recommendations = this.state.getRecommendations();
        const counts: Record<string, number> = {
            PENDING: 0,
            APPROVED: 0,
            REJECTED: 0,
        };

        recommendations.forEach((rec) => {
            if (rec.status && counts[rec.status] !== undefined) {
                counts[rec.status] += 1;
            }
        });

        return counts;
    }

    /**
     * Group recommendations by slot
     */
    groupRecommendationsBySlot(): Map<string, RecommendationRow[]> {
        const recommendations = this.state.getRecommendations();
        const bySlot = new Map<string, RecommendationRow[]>();
        
        recommendations.forEach((rec) => {
            const slotId = rec.slot.id;
            if (!bySlot.has(slotId)) {
                bySlot.set(slotId, []);
            }
            bySlot.get(slotId)!.push(rec);
        });

        return bySlot;
    }

    /**
     * Create new recommendation
     */
    createRecommendation(
        slot: any,
        participant: RecommendationParticipantOption,
        userId: number | null,
        guestId: number | null
    ): RecommendationRow {
        return {
            slot,
            user: userId ? {id: userId, username: participant.label} : null,
            guest: guestId ? {id: guestId, username: participant.label} : null,
            status: 'APPROVED',
        };
    }

    /**
     * Add new recommendation
     */
    addRecommendation(recommendation: RecommendationRow): void {
        this.state.addRecommendation(recommendation);
    }
}
