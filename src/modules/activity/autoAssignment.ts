import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {compareActivitySlots} from "./timebox";
import {calculateRequirementsForParticipants, ParticipantAttendance, toParticipantKey} from "./requirements";
import {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import {RecommendationInput} from "../database/services/ActivityRecommendationService";
import * as requirementService from "../database/services/ActivityRequirementService";
import * as activityService from "../database/services/ActivityService";
import * as eventService from "../database/services/EventService";

/**
 * Core automatic recommendation generator for activity plans. The engine balances required
 * shifts per participant, respects attendance policies and overlap rules, and emits staged
 * recommendations that managers can review before applying. Keep business rules centralized
 * here to avoid divergence across controllers and UI clients.
 */

interface AutoAssignmentPlan
    extends Pick<
        ActivityPlan,
        |
        "assignmentMode"
        | "generalRequiredShifts"
        | "roundingMode"
        | "startDate"
        | "endDate"
        | "allowOverfillAfterFull"
        | "allowArrivalDayEvening"
        | "allowDepartureDayMorning"
    > {}

interface AutoAssignmentSlot extends ActivitySlot {
    assignedCount?: number;
}

export interface AutoAssignmentContext {
    plan: AutoAssignmentPlan;
    slots: AutoAssignmentSlot[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    existingAssignments: Record<string, AssignmentCandidate[]>;
}

interface ParticipantState {
    participant: ParticipantAttendance;
    participantKey: string;
    required: number;
    assigned: number;
}

interface SlotCapacity {
    slot: AutoAssignmentSlot;
    remaining: number;
    candidate: AssignmentCandidate;
}

function buildSlotCapacities(slots: AutoAssignmentSlot[], allowOverfill: boolean): SlotCapacity[] {
    return [...slots]
        .sort(compareActivitySlots)
        .map((slot) => {
            const capacity = allowOverfill ? Number.POSITIVE_INFINITY : slot.maxAssignees ?? Number.POSITIVE_INFINITY;
            const existing = Number((slot as AutoAssignmentSlot & {assignedCount?: number}).assignedCount ?? 0);
            const remaining = capacity === Number.POSITIVE_INFINITY ? capacity : Math.max(capacity - existing, 0);
            return {
                slot,
                remaining,
                candidate: toAssignmentCandidate(slot),
            } as SlotCapacity;
        })
        .filter((entry) => entry.remaining > 0);
}

function buildParticipantStates(
    ctx: AutoAssignmentContext,
): {states: Map<string, ParticipantState>; assignmentMap: Record<string, AssignmentCandidate[]>} {
    const requirements = calculateRequirementsForParticipants(
        ctx.plan,
        ctx.participants,
        ctx.roleRequirements,
        ctx.overrides,
    );

    const states = new Map<string, ParticipantState>();
    const assignmentMap: Record<string, AssignmentCandidate[]> = {};

    for (const participant of ctx.participants) {
        const participantKey = toParticipantKey(participant);
        const existing = ctx.existingAssignments[participantKey] ?? [];
        assignmentMap[participantKey] = [...existing];
        states.set(participantKey, {
            participant,
            participantKey,
            required: requirements[participantKey]?.requiredShifts ?? 0,
            assigned: existing.length,
        });
    }

    return {states, assignmentMap};
}

function scoreParticipant(a: ParticipantState, b: ParticipantState): number {
    const outstandingA = Math.max(a.required - a.assigned, 0);
    const outstandingB = Math.max(b.required - b.assigned, 0);

    if (outstandingA !== outstandingB) return outstandingB - outstandingA;

    const ratioA = a.required > 0 ? a.assigned / a.required : a.assigned;
    const ratioB = b.required > 0 ? b.assigned / b.required : b.assigned;

    if (ratioA !== ratioB) return ratioA - ratioB;

    if (a.assigned !== b.assigned) return a.assigned - b.assigned;

    return a.participantKey.localeCompare(b.participantKey);
}

function canAssign(
    candidate: AssignmentCandidate,
    participant: ParticipantAttendance,
    existing: AssignmentCandidate[],
    attendancePolicy: AttendancePolicy,
): boolean {
    const warnings = collectAssignmentWarnings(candidate, participant, existing, attendancePolicy);
    return warnings.every(
        (w) => !["outside_attendance", "overlap", "arrival_time_restricted", "departure_time_restricted"].includes(w.type)
    );
}

export function generateAutoRecommendations(ctx: AutoAssignmentContext): RecommendationInput[] {
    const allowOverfill = Boolean(ctx.plan.allowOverfillAfterFull);
    const slotCapacities = buildSlotCapacities(ctx.slots, allowOverfill);
    const {states, assignmentMap} = buildParticipantStates(ctx);

    if (!slotCapacities.length || !states.size) return [];

    const recommendations: RecommendationInput[] = [];

    const attendancePolicy: AttendancePolicy = {
        allowArrivalDayEvening: ctx.plan.allowArrivalDayEvening,
        allowDepartureDayMorning: ctx.plan.allowDepartureDayMorning,
    };

    for (const slot of slotCapacities) {
        if (slot.remaining === 0) continue;

        const candidates = [...states.values()].sort(scoreParticipant);

        for (const state of candidates) {
            if (slot.remaining === 0) break;

            const participantAssignments = assignmentMap[state.participantKey] ?? [];
            if (!canAssign(slot.candidate, state.participant, participantAssignments, attendancePolicy)) {
                continue;
            }

            recommendations.push({
                slotId: slot.slot.id,
                userId: state.participant.userId ?? null,
                guestId: state.participant.guestId ?? null,
                status: "PENDING",
            });

            slot.remaining -= 1;
            state.assigned += 1;
            assignmentMap[state.participantKey] = [...participantAssignments, slot.candidate];
        }
    }

    return recommendations;
}

function mergeParticipants(
    base: ParticipantAttendance[],
    supplemental: ParticipantAttendance[],
    overrides: ActivityPlanRequirementOverride[],
): ParticipantAttendance[] {
    const map = new Map<string, ParticipantAttendance>();

    const upsert = (participant: ParticipantAttendance) => {
        const key = toParticipantKey(participant);
        if (!map.has(key)) {
            map.set(key, participant);
        }
    };

    base.forEach(upsert);
    supplemental.forEach(upsert);

    for (const override of overrides) {
        const participant: ParticipantAttendance = {
            userId: override.userId ?? undefined,
            guestId: override.guestId ?? undefined,
            roleIds: override.roleId ? [override.roleId] : undefined,
        };
        upsert(participant);
    }

    return Array.from(map.values());
}

function toParticipantAttendanceFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    return Object.keys(assignments).map((key) => {
        const [type, id] = key.split(":");
        if (type === "user") {
            return {userId: Number(id)};
        }
        if (type === "guest") {
            return {guestId: Number(id)};
        }
        return {};
    });
}

export async function generatePlanRecommendations(planId: string): Promise<RecommendationInput[]> {
    const requirementConfig = await requirementService.getRequirementConfiguration(planId);
    const [plan, slots, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    if (!plan) throw new Error(`Activity plan ${planId} not found`);

    const eventParticipants = plan.event
        ? await eventService.getEventParticipants(plan.event.id)
        : [];

    const participantsFromEvent: ParticipantAttendance[] = eventParticipants.map((p) => ({
        userId: p.userId ?? undefined,
        guestId: p.guestId ?? undefined,
        arrivalDate: p.arrivalDate ?? undefined,
        departureDate: p.departureDate ?? undefined,
    }));

    const participantsFromAssignments = toParticipantAttendanceFromAssignments(existingAssignments);

    const participants = mergeParticipants(
        participantsFromEvent,
        participantsFromAssignments,
        requirementConfig.overrides,
    );

    const context: AutoAssignmentContext = {
        plan: {
            assignmentMode: plan.assignmentMode,
            generalRequiredShifts: plan.generalRequiredShifts,
            roundingMode: plan.roundingMode,
            startDate: plan.startDate,
            endDate: plan.endDate,
            allowOverfillAfterFull: plan.allowOverfillAfterFull,
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
        slots,
        participants,
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        existingAssignments,
    };

    return generateAutoRecommendations(context);
}
