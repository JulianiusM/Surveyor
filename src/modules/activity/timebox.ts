import {ActivitySlot} from "../database/entities/activity/ActivitySlot";

export interface SlotTimeboxCandidate {
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    pos?: number | null;
}

export interface SlotTimebox {
    startMinutes: number | null;
    endMinutes: number | null;
}

/**
 * Parse a database time string (HH:MM or HH:MM:SS) into minutes after midnight.
 * Returns null when the value is missing or malformed so callers can skip
 * overlap checks gracefully when no timebox is defined.
 */
export function parseTimeToMinutes(time?: string | null): number | null {
    if (!time) return null;
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] ?? 0);

    if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        return null;
    }

    return Math.round(hours * 60 + minutes + seconds / 60);
}

/**
 * Convert a slot into a normalized timebox representation. If either start or
 * end time is missing, the respective value is set to null.
 */
export function toSlotTimebox(slot: SlotTimeboxCandidate): SlotTimebox {
    return {
        startMinutes: parseTimeToMinutes(slot.startTime),
        endMinutes: parseTimeToMinutes(slot.endTime),
    };
}

/**
 * Compare two slots by day, then by start time (if provided), then by their
 * positional ordering. This ensures start times take precedence when present,
 * keeping legacy positioning stable for slots without a timebox.
 */
export function compareSlotsByDayAndTime(a: SlotTimeboxCandidate, b: SlotTimeboxCandidate): number {
    const dayCompare = a.day.localeCompare(b.day);
    if (dayCompare !== 0) return dayCompare;

    const aStart = parseTimeToMinutes(a.startTime);
    const bStart = parseTimeToMinutes(b.startTime);

    if (aStart !== null && bStart !== null && aStart !== bStart) {
        return aStart - bStart;
    }

    if (aStart !== null && bStart === null) return -1;
    if (aStart === null && bStart !== null) return 1;

    const aPos = a.pos ?? 0;
    const bPos = b.pos ?? 0;
    return aPos - bPos;
}

/**
 * Determine whether two slots overlap on the same day based on their defined
 * start and end times. If either slot lacks a full timebox, the function
 * returns false so that upstream callers can decide how to handle partial
 * definitions.
 */
export function slotsOverlap(a: SlotTimeboxCandidate, b: SlotTimeboxCandidate): boolean {
    if (a.day !== b.day) return false;

    const {startMinutes: aStart, endMinutes: aEnd} = toSlotTimebox(a);
    const {startMinutes: bStart, endMinutes: bEnd} = toSlotTimebox(b);

    if (aStart === null || aEnd === null || bStart === null || bEnd === null) {
        return false;
    }

    // Touching boundaries (e.g., slot A ends at 10:00, slot B starts at 10:00) are NOT considered overlaps.
    // This is intentional and tested: only slots with actual time overlap return true.
    return aStart < bEnd && bStart < aEnd;
}

/**
 * Convenience helper for ActivitySlot entities to avoid re-typing the shape.
 */
export function compareActivitySlots(a: ActivitySlot, b: ActivitySlot): number {
    return compareSlotsByDayAndTime(
        {day: a.day, startTime: a.startTime, endTime: a.endTime, pos: a.pos},
        {day: b.day, startTime: b.startTime, endTime: b.endTime, pos: b.pos},
    );
}
