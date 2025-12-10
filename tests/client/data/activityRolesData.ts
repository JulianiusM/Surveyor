/**
 * Test data for activity-roles module tests
 */

import type {RoleSummary} from '../../../src/public/js/modules/activity-types';
import {deepCopy} from "../helpers/util";

const sampleRoles: RoleSummary[] = [
    {id: 'role1', name: 'Driver', label: 'Driver', color: '#ff0000'},
    {id: 'role2', name: 'Navigator', label: 'Navigator', color: '#00ff00'}
];

const _activityRolesData = {
    getAllRoles: [
        {
            description: 'returns empty array when window.Surveyor is undefined',
            initialRoles: undefined,
            expected: []
        },
        {
            description: 'returns empty array when allRoles is undefined',
            initialRoles: null,
            expected: []
        },
        {
            description: 'returns roles array when defined',
            initialRoles: sampleRoles,
            expected: sampleRoles
        }
    ],

    getSlotRolesForSlot: [
        {
            description: 'returns empty array when window.Surveyor is undefined',
            slotId: 'slot1',
            slotRoles: undefined,
            expected: []
        },
        {
            description: 'returns empty array when slot not in map',
            slotId: 'slot1',
            slotRoles: {slot2: sampleRoles},
            expected: []
        },
        {
            description: 'returns roles for specified slot',
            slotId: 'slot1',
            slotRoles: {slot1: sampleRoles, slot2: []},
            expected: sampleRoles
        }
    ],

    addRoleToGlobal: [
        {
            description: 'creates window.Surveyor if undefined',
            initialRoles: undefined,
            roleToAdd: sampleRoles[0],
            expectedRoles: [sampleRoles[0]]
        },
        {
            description: 'adds new role to empty list',
            initialRoles: [],
            roleToAdd: sampleRoles[0],
            expectedRoles: [sampleRoles[0]]
        },
        {
            description: 'adds new role to existing list',
            initialRoles: [sampleRoles[0]],
            roleToAdd: sampleRoles[1],
            expectedRoles: sampleRoles
        },
        {
            description: 'does not add duplicate role',
            initialRoles: sampleRoles,
            roleToAdd: sampleRoles[0],
            expectedRoles: sampleRoles
        }
    ],

    initSlotRoleAdminModal: {
        invalidSetup: [
            {
                description: 'does nothing when planId is empty',
                planId: '',
                html: '<div></div>',
                describeSlot: () => 'Slot'
            },
            {
                description: 'does nothing when modal element missing',
                planId: 'plan1',
                html: '<div></div>',
                describeSlot: () => 'Slot'
            },
            {
                description: 'does nothing when body element missing',
                planId: 'plan1',
                html: '<div id="slotRoleAdminModal"></div>',
                describeSlot: () => 'Slot'
            }
        ],

        validSetup: [
            {
                description: 'initializes modal with all required elements',
                planId: 'plan1',
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                `,
                describeSlot: () => 'Slot'
            }
        ],

        openModal: [
            {
                description: 'opens modal and updates title when button clicked',
                planId: 'plan1',
                slotId: 'slot1',
                expectedTitle: 'Slot slot1',
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <div class="role-assignment" data-role-name="driver" data-role-label="Driver"></div>
                    </div>
                `
            }
        ],

        renderTable: [
            {
                description: 'renders empty state when no roles',
                planId: 'plan1',
                slotId: 'slot1',
                expectedRows: 1,
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <ul class="list-unstyled">
                            <li><button data-assignid="assign1"></button><span class="flex-grow-1">John Doe</span></li>
                        </ul>
                    </div>
                `
            },
            {
                description: 'renders table rows for each role',
                planId: 'plan1',
                slotId: 'slot1',
                expectedRows: 2,
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <ul class="list-unstyled">
                            <li><button data-assignid="assign1"></button><span class="flex-grow-1">John Doe</span></li>
                        </ul>
                        <div class="role-assignment" data-role-name="driver" data-role-label="Driver"></div>
                        <div class="role-assignment" data-role-name="navigator" data-role-label="Navigator"></div>
                    </div>
                `
            }
        ],

        saveSuccess: [
            {
                description: 'successfully saves role assignments',
                planId: 'plan1',
                slotId: 'slot1',
                expectedPayload: {
                    assignments: [
                        {role: 'driver', assignmentId: null}
                    ]
                },
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <ul class="list-unstyled">
                            <li><button data-assignid="assign1"></button><span class="flex-grow-1">John Doe</span></li>
                        </ul>
                        <div class="role-assignment" data-role-name="driver" data-role-label="Driver"></div>
                    </div>
                `
            }
        ],

        saveError: [
            {
                description: 'shows error when permission denied',
                planId: 'plan1',
                slotId: 'slot1',
                errorMessage: 'permission',
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <ul class="list-unstyled">
                            <li><button data-assignid="assign1"></button><span class="flex-grow-1">John Doe</span></li>
                        </ul>
                        <div class="role-assignment" data-role-name="driver" data-role-label="Driver"></div>
                    </div>
                `
            },
            {
                description: 'shows error when API fails',
                planId: 'plan1',
                slotId: 'slot1',
                errorMessage: 'Server error',
                html: `
                    <div id="slotRoleAdminModal">
                        <div id="slotRoleAdminTitle"></div>
                        <table>
                            <tbody id="slotRoleAdminBody"></tbody>
                        </table>
                        <input type="hidden" id="slotRoleAdminSlotId" />
                        <div id="slotRoleAdminError" class="d-none"></div>
                        <button id="slotRoleAdminSave"></button>
                    </div>
                    <div class="slot" data-slotid="slot1">
                        <button data-slot-role-admin data-slotid="slot1">Manage Roles</button>
                        <ul class="list-unstyled">
                            <li><button data-assignid="assign1"></button><span class="flex-grow-1">John Doe</span></li>
                        </ul>
                        <div class="role-assignment" data-role-name="driver" data-role-label="Driver"></div>
                    </div>
                `
            }
        ]
    }
};

export const activityRolesData = () => deepCopy(_activityRolesData) as typeof _activityRolesData;
