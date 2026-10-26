/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {AssignmentCandidate} from '../../../types/ActivityTypes';











import type {ParticipantAttendance} from "../../../types/ActivityRequirementTypes";
import {toParticipantKey} from "../../../common/activity/requirements";


/** Merge known participant identities in supplied group order.
 * Later nonnull attendance/name/role fields replace earlier values; missing
 * fields retain them, and the final result keeps stable participant-key order. */
export function mergeParticipants(...groups: ParticipantAttendance[][]): ParticipantAttendance[] {
    // Unknown identities cannot acquire an entry; each known key has one merge
    // target regardless of which captured source group supplied its fields.
    const participants = new Map<string, ParticipantAttendance>();
    for (const group of groups) {
        for (const participant of group) {
            const key = toParticipantKey(participant);
            if (key === "participant:unknown") continue;
            const existing = participants.get(key);
            participants.set(key, existing ? {
                ...existing,
                arrivalDate: participant.arrivalDate ?? existing.arrivalDate,
                departureDate: participant.departureDate ?? existing.departureDate,
                name: participant.name ?? existing.name,
                roleIds: participant.roleIds ?? existing.roleIds,
            } : participant);
        }
    }
    // Sort only the merged projection, preserving the input collections.
    return [...participants.values()].sort((a, b) => toParticipantKey(a).localeCompare(toParticipantKey(b)));
}

/** Recover profile participant identities from the existing assignment-key map.
 * Non-profile keys contribute nothing; this projection invents no attendance,
 * role or display data from the associated slot collections. */
export function participantsFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    // Preserve the established key split and profile-only selection semantics.
    return Object.keys(assignments).flatMap((key) => {
        const [type, id] = key.split(":");
        return type === "profile" ? [{profileId: id}] : [];
    });
}
