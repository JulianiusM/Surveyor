/**
 * Test data for activity-assignments module tests
 */

import type {AssignmentWarning} from '../../../src/public/js/modules/activity/activity-types';
import {deepCopy} from "../helpers/util";

const baseModalHTML = `
    <div id="assignmentWarningModal">
        <div id="assignmentWarningSlot"></div>
        <ul id="assignmentWarningList"></ul>
        <button id="assignmentWarningConfirm">Confirm</button>
        <button id="assignmentWarningCancel">Cancel</button>
    </div>
`;

export const _activityAssignmentsData = {
    describeWarning: [
        {
            description: 'describes outside_attendance warning',
            warning: {type: 'outside_attendance'} as AssignmentWarning,
            expected: 'outside your attendance window'
        },
        {
            description: 'describes arrival_day warning',
            warning: {type: 'arrival_day'} as AssignmentWarning,
            expected: 'arrival day'
        },
        {
            description: 'describes arrival_time_restricted warning',
            warning: {type: 'arrival_time_restricted'} as AssignmentWarning,
            expected: 'Evening arrival-day'
        },
        {
            description: 'describes departure_day warning',
            warning: {type: 'departure_day'} as AssignmentWarning,
            expected: 'departure day'
        },
        {
            description: 'describes departure_time_restricted warning',
            warning: {type: 'departure_time_restricted'} as AssignmentWarning,
            expected: 'Morning departure-day'
        },
        {
            description: 'describes over_capacity warning',
            warning: {type: 'over_capacity'} as AssignmentWarning,
            expected: 'already full'
        },
        {
            description: 'describes overlap warning without conflicts',
            warning: {type: 'overlap', conflicts: []} as AssignmentWarning,
            expected: 'overlaps'
        },
        {
            description: 'describes unknown warning type',
            warning: {type: 'unknown' as any} as AssignmentWarning,
            expected: 'warning detected'
        }
    ],

    buildWarningModal: {
        noModal: [
            {
                description: 'returns true immediately when no warnings',
                html: '<div></div>',
                warnings: [],
                slotId: 'slot1',
                confirmResult: true
            },
            {
                description: 'uses window.confirm when modal elements missing and user confirms',
                html: '<div></div>',
                warnings: [{type: 'outside_attendance'} as AssignmentWarning],
                slotId: 'slot1',
                confirmResult: true
            },
            {
                description: 'uses window.confirm when modal elements missing and user cancels',
                html: '<div></div>',
                warnings: [{type: 'outside_attendance'} as AssignmentWarning],
                slotId: 'slot1',
                confirmResult: false
            }
        ],

        withModal: [
            {
                description: 'returns true immediately when no warnings',
                html: baseModalHTML,
                warnings: [],
                slotId: 'slot1'
            },
            {
                description: 'shows modal with warnings and returns true on confirm',
                html: baseModalHTML,
                warnings: [
                    {type: 'outside_attendance'} as AssignmentWarning,
                    {type: 'arrival_day'} as AssignmentWarning
                ],
                slotId: 'slot1'
            }
        ],

        cancelModal: [
            {
                description: 'returns false when user clicks cancel',
                html: baseModalHTML,
                warnings: [{type: 'outside_attendance'} as AssignmentWarning],
                slotId: 'slot1'
            }
        ]
    },

    initAssign: {
        noAction: [
            {
                description: 'does nothing when clicked element has no data-action',
                planId: 'plan1',
                html: '<div><span>No action</span></div>'
            },
            {
                description: 'does nothing when slot card has no data-slotid',
                planId: 'plan1',
                html: '<div class="slot"><button data-action="assign">Assign</button></div>'
            }
        ],

        assignWithWarnings: [
            {
                description: 'handles assign action with warnings and proceeds on confirm',
                planId: 'plan1',
                slotId: 'slot1',
                role: 'driver',
                warnings: [{type: 'outside_attendance'} as AssignmentWarning],
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="assign" data-role="driver">Assign</button>
                    </div>
                `
            },
            {
                description: 'handles assign action without role parameter',
                planId: 'plan1',
                slotId: 'slot1',
                role: undefined,
                warnings: [],
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="assign">Assign</button>
                    </div>
                `
            }
        ],

        assignCancelled: [
            {
                description: 'does not perform assignment when user cancels warning modal',
                planId: 'plan1',
                slotId: 'slot1',
                role: 'driver',
                warnings: [{type: 'over_capacity'} as AssignmentWarning],
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="assign" data-role="driver">Assign</button>
                    </div>
                `
            }
        ],

        unassign: [
            {
                description: 'handles unassign action without fetching warnings',
                planId: 'plan1',
                slotId: 'slot1',
                role: 'driver',
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="unassign" data-role="driver">Unassign</button>
                    </div>
                `
            },
            {
                description: 'handles unassign action without role parameter',
                planId: 'plan1',
                slotId: 'slot1',
                role: undefined,
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="unassign">Unassign</button>
                    </div>
                `
            }
        ],

        error: [
            {
                description: 'shows error when warnings fetch fails',
                planId: 'plan1',
                slotId: 'slot1',
                role: 'driver',
                errorMessage: 'Network error',
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="assign" data-role="driver">Assign</button>
                    </div>
                `
            },
            {
                description: 'shows error when assignment API fails',
                planId: 'plan1',
                slotId: 'slot1',
                role: 'driver',
                errorMessage: 'Assignment failed',
                html: `
                    <div class="slot" data-slotid="slot1">
                        <button data-action="unassign" data-role="driver">Unassign</button>
                    </div>
                `
            }
        ]
    }
};

export const activityAssignmentsData = () => deepCopy(_activityAssignmentsData) as typeof _activityAssignmentsData;