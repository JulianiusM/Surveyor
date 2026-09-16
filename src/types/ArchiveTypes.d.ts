/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {EntityType} from './UtilTypes';

/**
 * Identity of an overview root; nested records follow their owning root's lifecycle.
 * Always carry type and ID together because metadata/preferences span several tables.
 * This reference contains no authority: controllers still authenticate and authorize it.
 */
export interface ArchiveReference {
    type: EntityType;
    id: string;
}

/**
 * Default follows authoritative archival; the other values affect only the acting profile's overview.
 * 'shown' also keeps archived roots visible in the active section, while 'hidden' can
 * conceal active roots. Neither choice changes permissions, records or anybody else's view.
 */
export type PersonalVisibility = 'default' | 'hidden' | 'shown';

/**
 * Public lifecycle projection derived from one database snapshot of the root and event.
 * Personal preferences never belong in this shared state. Keep direct and inherited
 * archival distinct so rendering can explain which entity must be restored.
 */
export interface ArchiveState {
    /** Effective state, combining the root's own timestamp and its event's timestamp. */
    archived: boolean;
    /** A separately archived child stays archived when its event is restored. */
    directArchived: boolean;
    /** Present only while the linked event is archived. */
    inheritedFromEventId: string | null;
    /** The governing event regardless of whether it is archived; null for standalone roots. */
    eventId: string | null;
    /** Used by the controller's existing owner/organizer authorization rules. */
    ownerId: string;
    /** A durable organizer choice; restoring an independent dated root sets this pause. */
    autoArchivePaused: boolean;
    /** Events and standalone activity plans have independent schedules; linked plans follow their event. */
    hasAutomaticSchedule: boolean;
}

/**
 * Server-derived capabilities keep permission and inheritance rules out of Pug and browser code.
 * They describe the current render only; mutation endpoints repeat their own authorization
 * checks and never accept these booleans back from the browser as proof of permission.
 */
export interface ArchivePresentation extends ArchiveState {
    /** This session has authority over this root's archival, subject to the state-specific actions below. */
    canManage: boolean;
    /** The session may set direct archival, including on a child already archived through its event. */
    canArchive: boolean;
    /** The session may clear existing direct archival and no archived governing event prevents it. */
    canRestore: boolean;
    /** The session may change the independent dated root's automatic-archival pause. */
    canManageAutomation: boolean;
    /** Only provided when the active session may view the governing event. */
    eventUrl?: string;
}
