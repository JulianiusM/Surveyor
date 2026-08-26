import type {
    RequirementConfiguration,
    RequirementParticipantSummary,
} from '../../src/public/js/modules/activity/activity-types';
import type {RequirementDraft} from '../../src/public/js/modules/activity/activity-requirements';

export function createRequirementParticipantSummary(
    overrides: Partial<RequirementParticipantSummary> = {},
): RequirementParticipantSummary {
    return {
        participantKey: 'profile:00000000-0000-4000-8000-000000000001',
        name: 'Alex Participant',
        roleIds: [7],
        requiredShifts: 2,
        assignedShifts: 0,
        remainingShifts: 2,
        source: 'general',
        attendanceDays: 3,
        ...overrides,
    };
}

export function createRequirementConfiguration(
    overrides: Partial<RequirementConfiguration> = {},
): RequirementConfiguration {
    return {
        plan: {
            assignmentMode: 'REQUIRED',
            generalRequiredShifts: 2,
            roundingMode: 'CEIL',
            startDate: '2027-06-01',
            endDate: '2027-06-03',
            allowOverfillAfterFull: false,
        },
        roleRequirements: [],
        stayRequirements: [{stayDays: 3, requiredShifts: 2}],
        overrides: [],
        participants: [createRequirementParticipantSummary()],
        capacitySummary: {availableSlots: 4, requiredSlots: 2, difference: 2},
        ...overrides,
    };
}

export function createRequirementDraft(overrides: Partial<RequirementDraft> = {}): RequirementDraft {
    return {
        assignmentMode: 'REQUIRED',
        generalRequiredShifts: 2,
        roundingMode: 'CEIL',
        allowOverfillAfterFull: false,
        roleRequirements: [],
        stayRequirements: [{stayDays: 3, requiredShifts: 2}],
        overrides: [],
        ...overrides,
    };
}
