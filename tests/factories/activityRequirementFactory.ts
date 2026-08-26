import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivityPlanRequirement} from '../../src/modules/database/entities/activity/ActivityPlanRequirement';
import {ActivityPlanRequirementOverride} from '../../src/modules/database/entities/activity/ActivityPlanRequirementOverride';
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

export function createRoleRequirement(
    roleId: number,
    requiredShifts: number,
): ActivityPlanRequirement {
    return Object.assign(new ActivityPlanRequirement(), {roleId: String(roleId), requiredShifts});
}

export function createParticipantRequirementOverride(
    profileId: string,
    requiredShifts: number,
    roleId: number | null = null,
): ActivityPlanRequirementOverride {
    return Object.assign(new ActivityPlanRequirementOverride(), {
        profileId,
        profile: {id: profileId},
        roleId,
        requiredShifts,
    });
}

export function createRequirementCapacitySlots() {
    return [
        {id: 'slot-with-two-roles', maxAssignees: 3},
        {id: 'slot-with-one-role', maxAssignees: 3},
        {id: 'slot-without-roles', maxAssignees: 2},
    ];
}
