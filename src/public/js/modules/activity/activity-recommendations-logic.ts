/**
 * Business logic for activity recommendations
 * Pure logic layer - no DOM manipulation
 */

import {formatDateLabel} from "../../core/formatting";
import {ActivityRecommendationsState} from './activity-recommendations-state';
import type {
    ExistingActivityAssignment,
    RecommendationOperation,
    RecommendationParticipantOption,
    RecommendationRow,
} from './activity-types';

/**
 * Business logic class for recommendations
 * Handles all recommendation operations without DOM concerns
 */
export class RecommendationsLogic {
    constructor(private readonly state: ActivityRecommendationsState) {
    }

    /**
     * Approve a recommendation
     */
    approveRecommendation(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(rec, 'APPROVED');
    }

    /**
     * Reject a recommendation
     */
    rejectRecommendation(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(rec, 'REJECTED');
    }

    /**
     * Revert recommendation to pending
     */
    revertToPending(rec: RecommendationRow): boolean {
        return this.state.updateRecommendationStatus(rec, 'PENDING');
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
        return `profile:${option.profileId}`;
    }

    /**
     * Parse participant value from form
     */
    parseParticipantValue(value: string): { type: string; id: string | number } {
        const [type, idStr] = value.split(':');
        let id: string | number = idStr;
        if (type === "user") {
            id = Number.parseInt(idStr, 10);
        }
        return {type, id};
    }

    /**
     * Find participant by ID
     */
    findParticipant(profileId: string | null): RecommendationParticipantOption | undefined {
        const options = this.state.getParticipantOptions();
        return options.find((p) =>
            (profileId && p.profileId === profileId)
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
    getAvailableParticipants(slotDay?: string | null): RecommendationParticipantOption[] {
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
    isDuplicate(slotId: string, profileId: string | null): boolean {
        return this.state.hasDuplicateRecommendation(slotId, profileId);
    }

    isAlreadyAssigned(slotId: string, profileId: string | null): boolean {
        return Boolean(profileId && this.state.getExistingAssignments().some((assignment) =>
            assignment.item.id === slotId && assignment.profile.id === profileId));
    }

    getRolelessAssignments(profileId?: string | null): ExistingActivityAssignment[] {
        return this.state.getExistingAssignments().filter((assignment) =>
            (!profileId || assignment.profile.id === profileId)
            && assignment.roles.every((role) => role === 'default'));
    }

    /**
     * Check for overlapping assignments on same day
     */
    hasOverlappingAssignment(
        profileId: string | null,
        slotId: string
    ): boolean {
        const slots = this.state.getSlots();
        const slot = slots.find((s: any) => s.id === slotId);
        if (!slot?.day) return false;

        const slotDate = new Date(slot.day);
        const existingAssignments = this.state.getExistingAssignments();

        return existingAssignments.some((assignment) => {
            const matchesParticipant =
                (profileId && assignment.profile?.id === profileId);

            if (!matchesParticipant) return false;

            const assignmentDate = new Date(assignment.item.day || '');
            if (assignmentDate.toDateString() !== slotDate.toDateString()) return false;

            // Check time overlap
            const slotStart = new Date(`${slot.day}T${slot.startTime}`);
            const slotEnd = new Date(`${slot.day}T${slot.endTime}`);
            const assignmentStart = new Date(`${assignment.item.day}T${assignment.item.startTime}`);
            const assignmentEnd = new Date(`${assignment.item.day}T${assignment.item.endTime}`);

            return slotStart < assignmentEnd && slotEnd > assignmentStart;
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
            const slotId = rec.item.id;
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
        slot: RecommendationRow['item'],
        participant: RecommendationParticipantOption,
        profileId: string | null,
        operation: RecommendationOperation = 'ASSIGN',
        sourceItem?: RecommendationRow['item'] | null,
    ): RecommendationRow {
        return {
            item: slot,
            sourceItem: sourceItem ?? null,
            profile: profileId ? {id: profileId, name: participant.label} : null,
            status: 'APPROVED',
            operation,
            manual: true,
        };
    }

    /**
     * Add new recommendation
     */
    addRecommendation(recommendation: RecommendationRow): void {
        this.state.addRecommendation(recommendation);
    }

    removeRecommendation(recommendation: RecommendationRow): boolean {
        return this.state.removeRecommendation(recommendation);
    }
}
