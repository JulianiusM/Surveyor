import type {FairAssignmentContext, FairAssignmentSlot} from '../../src/modules/activity/fairAssignment';
import type {ParticipantAttendance} from '../../src/modules/activity/requirements';
import {
    createRoleRequirement,
    createStayRequirement,
} from './activityRequirementFactory';

export function createAutoAssignmentSlot(
    id: string,
    day: string,
    overrides: Partial<FairAssignmentSlot> = {},
): FairAssignmentSlot {
    return {
        id,
        day,
        startTime: '09:00:00',
        endTime: '10:00:00',
        maxAssignees: 1,
        assignedCount: 0,
        ...overrides,
    };
}

export function createAutoAssignmentParticipant(
    suffix: string,
    overrides: Partial<ParticipantAttendance> = {},
): ParticipantAttendance {
    return {
        profileId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
        ...overrides,
    };
}

export function createAutoAssignmentContext(
    overrides: Partial<FairAssignmentContext> = {},
): FairAssignmentContext {
    return {
        plan: {
            assignmentMode: 'REQUIRED',
            generalRequiredShifts: 2,
            roundingMode: 'CEIL',
            startDate: '2027-06-01',
            endDate: '2027-06-02',
            allowOverfillAfterFull: false,
            allowArrivalDayEvening: true,
            allowDepartureDayMorning: true,
        },
        slots: [
            createAutoAssignmentSlot('slot-a', '2027-06-01'),
            createAutoAssignmentSlot('slot-b', '2027-06-02'),
        ],
        participants: [
            createAutoAssignmentParticipant('1'),
            createAutoAssignmentParticipant('2'),
        ],
        roleRequirements: [createRoleRequirement(7, 1)],
        overrides: [],
        stayRequirements: [createStayRequirement(1, 1), createStayRequirement(2, 1)],
        existingAssignments: {},
        existingRecommendations: [],
        ...overrides,
    };
}
