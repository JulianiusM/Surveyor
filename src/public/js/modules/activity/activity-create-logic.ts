/**
 * Business logic for activity creation
 * Pure logic layer - no DOM manipulation
 */

import type {ActivitySlot} from "../../../../modules/database/entities/activity/ActivitySlot";
import {ActivityCreateState} from './activity-create-state';

/**
 * Business logic class for activity creation
 * Handles slot operations without DOM concerns
 */
export class ActivityCreateLogic {
    constructor(private state: ActivityCreateState) {
    }

    /**
     * Sort function for slots by position
     */
    private sortSlotFn = (a: Partial<ActivitySlot>, b: Partial<ActivitySlot>) => (a.pos || 0) - (b.pos || 0);

    /**
     * Create a new slot object
     */
    createSlot(dateISO: string, pos: number, prefilled?: Partial<ActivitySlot>): Partial<ActivitySlot> {
        const id = prefilled?.id || crypto.randomUUID();

        return {
            id,
            pos: pos || prefilled?.pos || 0,
            day: dateISO,
            title: prefilled?.title || '',
            description: prefilled?.description || '',
            startTime: prefilled?.startTime || null,
            endTime: prefilled?.endTime || null,
            maxAssignees: prefilled?.maxAssignees || 1
        };
    }

    /**
     * Add or update a slot
     */
    upsertSlot(dateISO: string, slot: Partial<ActivitySlot>): void {
        this.state.updateSlot(dateISO, slot);
        this.state.sortSlots(dateISO, this.sortSlotFn);
    }

    /**
     * Delete a slot
     */
    deleteSlot(dateISO: string, id: string): void {
        this.state.removeSlot(dateISO, id);
        this.reIndexDate(dateISO);
    }

    /**
     * Re-index all slots for a date
     */
    reIndexDate(dateISO: string): void {
        this.state.reIndexDate(dateISO);
        this.state.sortSlots(dateISO, this.sortSlotFn);
    }

    /**
     * Get slot count for a date
     */
    getSlotCount(dateISO: string): number {
        return this.state.getSlotsByDate(dateISO).length;
    }

    /**
     * Prepare payload for submission (filter by date range)
     */
    preparePayload(startDate: Date, endDate: Date): Record<string, Partial<ActivitySlot>[]> {
        const payload: Record<string, Partial<ActivitySlot>[]> = {};
        const allSlots = this.state.getAllSlots();

        for (const [date, slots] of Object.entries(allSlots)) {
            const curDate = new Date(date);
            if (curDate >= startDate && curDate <= endDate) {
                payload[date] = slots;
            }
        }

        return payload;
    }

    /**
     * Initialize from prefilled slots
     */
    initializeFromPrefilled(prefilledSlots: Record<string, Partial<ActivitySlot>[]>): void {
        this.state.setSlotsMap(prefilledSlots);
    }
}
