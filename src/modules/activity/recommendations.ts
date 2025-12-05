import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {AssignmentCandidate, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {normalizeRecommendationInput, RecommendationInput} from "../database/services/ActivityRecommendationService";
import {ParticipantAttendance, toParticipantKey} from "./requirements";

export interface RecommendationWarningResult {
    recommendation: RecommendationInput;
    warnings: ReturnType<typeof collectAssignmentWarnings>;
}

export interface RecommendationWarningOptions {
    slots: ActivitySlot[];
    recommendations: RecommendationInput[];
    existingAssignments?: Record<string, AssignmentCandidate[]>;
    participantAttendance?: Record<string, ParticipantAttendance>;
}

export function buildRecommendationWarnings({
    slots,
    recommendations,
    existingAssignments = {},
    participantAttendance = {},
}: RecommendationWarningOptions): RecommendationWarningResult[] {
    const slotMap = new Map<string, ActivitySlot>();
    for (const slot of slots) {
        slotMap.set(slot.id, slot);
    }

    const participantQueue = new Map<string, AssignmentCandidate[]>();
    const results: RecommendationWarningResult[] = [];

    for (const rec of recommendations.map(normalizeRecommendationInput)) {
        const slot = slotMap.get(rec.slotId);
        if (!slot) {
            throw new Error(`Slot ${rec.slotId} not found for recommendation warnings`);
        }

        const participantKey = toParticipantKey({userId: rec.userId ?? undefined, guestId: rec.guestId ?? undefined});
        const attendance = participantAttendance[participantKey] ?? {userId: rec.userId ?? undefined, guestId: rec.guestId ?? undefined};
        const existing = existingAssignments[participantKey] ?? [];
        const prior = participantQueue.get(participantKey) ?? [];

        const candidate = toAssignmentCandidate(slot);
        const warnings = collectAssignmentWarnings(candidate, attendance, [...existing, ...prior]);

        results.push({recommendation: rec, warnings});

        participantQueue.set(participantKey, [...prior, candidate]);
    }

    return results;
}
