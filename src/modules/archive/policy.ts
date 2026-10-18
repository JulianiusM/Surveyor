/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {ArchiveReference, PersonalVisibility} from '../../types/ArchiveTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Use the full polymorphic identity for every lifecycle and preference lookup. */
export function archiveKey(ref: ArchiveReference): string {
    return `${ref.type}:${ref.id}`;
}

/**
 * Parent state is inherited at read time; no child archive flags are copied or synchronized.
 * This makes event archival apply to all attachments immediately and preserves a child's
 * independent manual archival when its event is restored. The rule does not affect access.
 */
export function isEffectivelyArchived(archivedAt: Date | null, parentArchivedAt: Date | null = null): boolean {
    return archivedAt !== null || parentArchivedAt !== null;
}

/**
 * Explicit show/hide overrides placement only. The authoritative lifecycle remains unchanged.
 * 'shown' keeps even an archived root in the active section; 'hidden' moves even an active
 * root to the collapsed section. Only 'default' follows the effective lifecycle state.
 */
export function isHiddenInOverview(archived: boolean, visibility: PersonalVisibility): boolean {
    return visibility === 'hidden' || (visibility === 'default' && archived);
}

export function validateArchiveAfterDays(afterDays: number, now: Date): void {
    // Reject fractions, negative delays, overflow and invalid clocks before building
    // SQL. The job validates even while disabled, so a bad setting is visible at startup.
    if (!Number.isSafeInteger(afterDays) || afterDays < 0 || !Number.isFinite(now.getTime())) {
        throw new Error('AUTO_ARCHIVE_AFTER_DAYS must be a finite, non-negative integer and the current time must be valid.');
    }
    // SQL DATE supports years 1000–9999. Check the arithmetic as well as the setting
    // before startup can hand an invalid cutoff to the database.
    const cutoff = now.getTime() - (afterDays + 1) * DAY_MS;
    if (!Number.isFinite(new Date(cutoff).getTime()) || cutoff < Date.UTC(1000, 0, 1) || cutoff >= Date.UTC(10000, 0, 1)) {
        throw new Error('AUTO_ARCHIVE_AFTER_DAYS produces an unrepresentable database date cutoff.');
    }
}

/**
 * The period's final day is inclusive. Subtract the full delay plus that final day
 * from today's UTC midnight to obtain the latest end date eligible for archival.
 * A zero-day delay therefore never archives an entity during its final day.
 * For example, with a one-day delay an end date of September 10 first qualifies
 * on September 12 UTC: September 11 is the complete waiting day. Using UTC date
 * arithmetic keeps the boundary independent of server time zone and daylight saving.
 */
export function automaticArchiveCutoff(afterDays: number, now: Date): string {
    validateArchiveAfterDays(afterDays, now);
    // Database periods use DATE, not instants. Compare a YYYY-MM-DD cutoff instead
    // of converting each stored end date to a local timestamp in the database query.
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(midnight - (afterDays + 1) * DAY_MS).toISOString().slice(0, 10);
}
