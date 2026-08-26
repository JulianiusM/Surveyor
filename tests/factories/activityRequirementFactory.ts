import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivityPlanStayRequirement} from '../../src/modules/database/entities/activity/ActivityPlanStayRequirement';
import {ParticipantAttendance} from '../../src/modules/activity/requirements';

export function createRequirementPlan(overrides: Partial<ActivityPlan> = {}): ActivityPlan {
    return Object.assign(new ActivityPlan(), {
        assignmentMode: 'REQUIRED',
        generalRequiredShifts: 5,
        roundingMode: 'CEIL',
        startDate: '2027-06-01',
        endDate: '2027-06-10',
        ...overrides,
    });
}

export function createParticipantAttendance(overrides: Partial<ParticipantAttendance> = {}): ParticipantAttendance {
    return {
        profileId: '00000000-0000-4000-8000-000000000001',
        arrivalDate: '2027-06-01',
        departureDate: '2027-06-03',
        ...overrides,
    };
}

export function createStayRequirement(
    stayDays: number,
    requiredShifts: number,
): ActivityPlanStayRequirement {
    return Object.assign(new ActivityPlanStayRequirement(), {stayDays, requiredShifts});
}

export function createRequirementCapacitySlots() {
    return [
        {id: 'slot-with-two-roles', maxAssignees: 3},
        {id: 'slot-with-one-role', maxAssignees: 3},
        {id: 'slot-without-roles', maxAssignees: 2},
    ];
}

export function createRequirementSlotRoles() {
    return {
        'slot-with-two-roles': [{maxQty: 1}, {maxQty: 1}],
        'slot-with-one-role': [{maxQty: 1}],
    };
}
