/**
 * Test data for activity-requirements module tests
 */

const baseHTML = `
    <div id="requirementPanel">
        <div data-requirements-alert class="d-none alert"><span></span></div>
        <div id="roleRequirementList"></div>
        <div id="overrideList"></div>
        <button data-add-override>Add Override</button>
        <button data-requirements-refresh>Reload</button>
        <button data-requirements-save>Save</button>
        <button data-requirements-baseline-calc>Calculate</button>
        <table>
            <tbody id="requirementSummaryBody"></tbody>
        </table>
        <div id="requirementSummaryStats"></div>
        <select id="assignmentMode"><option value="FREE">Free</option></select>
        <input id="requiredShifts" type="number" />
        <select id="roundingMode"><option value="">None</option></select>
        <input id="bindingDeadline" type="datetime-local" />
        <input id="allowOverfill" type="checkbox" />
        <input id="allowArrivalEvening" type="checkbox" />
        <input id="allowDepartureMorning" type="checkbox" />
    </div>
`;

const mockConfig = {
    plan: {
        assignmentMode: 'FREE',
        generalRequiredShifts: 3,
        roundingMode: null,
        bindingDeadline: null,
        allowOverfillAfterFull: false,
        allowArrivalDayEvening: true,
        allowDepartureDayMorning: true
    },
    roleRequirements: [
        {roleId: 1, requiredShifts: 2},
        {roleId: 2, requiredShifts: 1}
    ],
    overrides: [],
    participants: []
};

const mockConfigWithOverrides = {
    ...mockConfig,
    overrides: [
        {
            id: 1,
            userId: 10,
            user: {username: 'john'},
            roleId: 1,
            requiredShifts: 5
        }
    ]
};

const mockConfigWithParticipants = {
    ...mockConfig,
    participants: [
        {
            participantKey: 'user-1',
            name: 'John Doe',
            requiredShifts: 3,
            assignedShifts: 2,
            remainingShifts: 1,
            source: 'auto',
            attendance: {
                arrivalDate: '2025-01-01',
                departureDate: '2025-01-05'
            }
        },
        {
            participantKey: 'user-2',
            name: 'Jane Smith',
            requiredShifts: 2,
            assignedShifts: 2,
            remainingShifts: 0,
            source: 'manual',
            attendance: null
        },
        {
            participantKey: 'user-3',
            name: 'Bob Wilson',
            requiredShifts: 1,
            assignedShifts: 3,
            remainingShifts: -2,
            source: 'auto',
            attendance: null
        }
    ]
};

import {deepCopy} from "../helpers/util";

const _activityRequirementsData = {
    initSetup: {
        invalid: [
            {
                description: 'does nothing when panel element missing',
                planId: 'plan1',
                html: '<div></div>'
            },
            {
                description: 'does nothing when panel exists but empty',
                planId: 'plan1',
                html: '<div id="requirementPanel"></div>'
            }
        ],

        valid: [
            {
                description: 'initializes and loads requirements with complete HTML',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig
            }
        ]
    },

    loading: {
        success: [
            {
                description: 'loads requirements successfully and shows confirmation',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                expectedAlertText: 'Requirements loaded'
            }
        ],

        error: [
            {
                description: 'shows error alert when loading fails',
                planId: 'plan1',
                html: baseHTML,
                errorMessage: 'Network error'
            }
        ]
    },

    roleRequirements: {
        render: [
            {
                description: 'renders input for each role',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                expectedInputs: 2 // Driver and Navigator from mock
            },
            {
                description: 'renders inputs even with no existing requirements',
                planId: 'plan1',
                html: baseHTML,
                mockData: {...mockConfig, roleRequirements: []},
                expectedInputs: 2 // Still shows all available roles
            }
        ]
    },

    overrides: {
        render: [
            {
                description: 'shows empty state when no overrides',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                hasEmptyState: true,
                expectedRows: 0
            },
            {
                description: 'renders override rows when overrides exist',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfigWithOverrides,
                hasEmptyState: false,
                expectedRows: 1
            }
        ],

        addOverride: [
            {
                description: 'adds new override row when button clicked',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig
            }
        ],

        removeOverride: [
            {
                description: 'removes override row when remove button clicked',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfigWithOverrides
            }
        ]
    },

    summary: {
        stats: [
            {
                description: 'shows empty state when no participants',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                expectedBadges: 0
            },
            {
                description: 'shows statistics badges for participants',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfigWithParticipants,
                expectedBadges: 4 // Total, Satisfied, Under-assigned, Over-assigned
            }
        ],

        table: [
            {
                description: 'shows empty row when no participants',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                expectedRows: 1
            },
            {
                description: 'renders row for each participant',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfigWithParticipants,
                expectedRows: 3
            }
        ]
    },

    save: {
        success: [
            {
                description: 'saves requirements successfully',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                expectedPayload: {
                    assignmentMode: 'FREE'
                }
            }
        ],

        error: [
            {
                description: 'shows error when save fails',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                errorMessage: 'Save failed'
            }
        ]
    },

    baseline: {
        success: [
            {
                description: 'sets baseline requirement after calculation',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                baselineValue: 4,
            }
        ],
        error: [
            {
                description: 'shows error when baseline calculation fails',
                planId: 'plan1',
                html: baseHTML,
                mockData: mockConfig,
                errorMessage: 'Calculation failed',
            }
        ]
    },

    reload: [
        {
            description: 'reloads requirements when reload button clicked',
            planId: 'plan1',
            html: baseHTML,
            mockData: mockConfig
        }
    ]
};

export const activityRequirementsData = () => deepCopy(_activityRequirementsData) as typeof _activityRequirementsData;
