/**
 * State management for activity creation
 * Encapsulates slot management state
 */

import type {ActivitySlot} from "../../../modules/database/entities/activity/ActivitySlot";

/**
 * State management class for activity creation
 * Manages slots organized by date
 */
export class ActivityCreateState {
    private slotsMap: Record<string, Partial<ActivitySlot>[]> = {};

    /**
     * Get all slots for a specific date
     */
    getSlotsByDate(dateISO: string): Partial<ActivitySlot>[] {
        return [...(this.slotsMap[dateISO] || [])];
    }

    /**
     * Get a specific slot by date and ID
     */
    getSlot(dateISO: string, id: string): Partial<ActivitySlot> | undefined {
        return (this.slotsMap[dateISO] || []).find((v) => v.id === id);
    }

    /**
     * Update or add a slot
     */
    updateSlot(dateISO: string, slot: Partial<ActivitySlot>): void {
        let arr = this.slotsMap[dateISO] || [];
        let curr = arr.findIndex((v) => v.id === slot.id);
        
        if (curr !== -1) {
            arr[curr] = slot;
        } else {
            arr.push(slot);
        }
        
        this.slotsMap[dateISO] = arr;
    }

    /**
     * Remove a slot
     */
    removeSlot(dateISO: string, id: string): void {
        if (this.slotsMap[dateISO]) {
            this.slotsMap[dateISO] = this.slotsMap[dateISO].filter((s) => s.id !== id);
        }
    }

    /**
     * Sort slots for a specific date
     */
    sortSlots(dateISO: string, sortFn: (a: Partial<ActivitySlot>, b: Partial<ActivitySlot>) => number): void {
        if (this.slotsMap[dateISO]) {
            this.slotsMap[dateISO].sort(sortFn);
        }
    }

    /**
     * Get all dates that have slots
     */
    getDates(): string[] {
        return Object.keys(this.slotsMap);
    }

    /**
     * Get all slots for all dates
     */
    getAllSlots(): Record<string, Partial<ActivitySlot>[]> {
        // Return a shallow copy of the map with array copies
        const copy: Record<string, Partial<ActivitySlot>[]> = {};
        for (const [date, slots] of Object.entries(this.slotsMap)) {
            copy[date] = [...slots];
        }
        return copy;
    }

    /**
     * Set entire slots map (for initialization from prefilled data)
     */
    setSlotsMap(slotsMap: Record<string, Partial<ActivitySlot>[]>): void {
        this.slotsMap = slotsMap;
    }

    /**
     * Re-index slots for a given date (set pos based on array order)
     */
    reIndexDate(dateISO: string): void {
        if (this.slotsMap[dateISO]) {
            this.slotsMap[dateISO].forEach((s, i) => {
                s.pos = i;
            });
        }
    }

    /**
     * Reset all state - for cleanup/testing
     */
    reset(): void {
        this.slotsMap = {};
    }
}
