/**
 * Controller unit tests (services mocked).
 * Focus: validation, orchestration, and error mapping — no DB involved.
 */

jest.mock('../../src/modules/database/services/ActivityService', () => ({
    createActivityPlanTx: jest.fn(),
    getActivitySlots: jest.fn(),
    getActivitySlotAssignmentsForUser: jest.fn(),
    getActivitySlotAssignmentsForGuest: jest.fn(),
    getActivitySlotAssignees: jest.fn(),
    getActivityPlanParticipants: jest.fn(),
    getAllRoles: jest.fn(),
    getActivitySlotRoles: jest.fn(),
    getActivityPlanTextFields: jest.fn(),
    updateActivityPlanDescription: jest.fn(),
    getActivityPlanTextFieldById: jest.fn(),
    createActivityPlanTextField: jest.fn(),
    updateActivityPlanTextField: jest.fn(),
    deleteActivityPlanTextField: jest.fn(),
    reorderActivitySlots: jest.fn(),
    getLastActivitySlotNumber: jest.fn(),
    addActivitySlot: jest.fn(),
    updateActivitySlot: jest.fn(),
    deleteActivitySlotAssignment: jest.fn(),
    updateActivityPlanFlags: jest.fn(),
    deleteActivitySlot: jest.fn(),
    addActivitySlotRoles: jest.fn(),
    updateActivitySlotRoles: jest.fn(),
    assignActivitySlotToUser: jest.fn(),
    assignActivitySlotToGuest: jest.fn(),
    unassignActivitySlotUser: jest.fn(),
    unassignActivitySlotGuest: jest.fn(),
    assignActivityAssignmentRoleToUser: jest.fn(),
    assignActivityAssignmentRoleToGuest: jest.fn(),
    unassignActivityAssignmentRoleFromUser: jest.fn(),
    unassignActivityAssignmentRoleFromGuest: jest.fn(),
    deleteActivityPlan: jest.fn(),
}));

jest.mock('../../src/modules/database/services/UserService', () => ({
    getAllRoles: jest.fn(),
}));

// Make IDs deterministic and date parsing stable
import { mockUtil, mockPermissionEngine } from '../mocks/commonMocks';

jest.mock('../../src/modules/lib/util', () => mockUtil({
    generateUniqueId: jest.fn(() => 'uid-123'),
    fromISOtoLocal: (s: string) => new Date(`${s}T00:00:00`),
}));

jest.mock('../../src/modules/permissionEngine', () => mockPermissionEngine());

import controller from '../../src/controller/activityController';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as userService from '../../src/modules/database/services/UserService';
import * as permissionEngine from '../../src/modules/permissionEngine';
import {APIError, ValidationError} from '../../src/modules/lib/errors';
import {setupMock, verifyMockCall, verifyResult} from '../keywords/common/controllerKeywords';
import * as testData from '../data/controller/activityData';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    createTextField,
    updateTextField,
    deleteTextField,
    reorderSlots,
    quickAddSlot,
    updateSlotDescription,
    updateSlotAttr,
    deleteAssignment,
    updateSettings,
    deleteSlot,
    addSlotRole,

    getAssignmentAccessMapping,
    getRoleAccessMapping,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    test.each(testData.preprocessCreateData)(
        '$description',
        ({input, expected, shouldThrow}) => {
            if (shouldThrow) {
                expect(() => preprocessCreate(input)).toThrow(shouldThrow === 'ValidationError' ? ValidationError : Error);
            } else {
                const res = preprocessCreate(input);
                expect(res).toMatchObject({
                    title: expected.title,
                    description: expected.description,
                    startDate: expected.startDate,
                    endDate: expected.endDate,
                });
                expect(Array.isArray(res.slots)).toBe(true);
                expect(res.slots).toHaveLength(expected.slotsLength);
                expect(res.slots[0]).toMatchObject({day: expected.slotDay, title: expected.slotTitle});
            }
        }
    );
});

describe('createEntity / afterCreateItems', () => {
    it('passes fields to createActivityPlanTx and returns plan id', async () => {
        const {planData, userId, expectedId, expectedArgs} = testData.createEntityData;
        setupMock(activityService.createActivityPlanTx, expectedId);
        
        const id = await createEntity(userId, planData);
        
        verifyResult(id, expectedId);
        verifyMockCall(activityService.createActivityPlanTx, ...expectedArgs);
        await expect(afterCreateItems(expectedId, {_body: {}})).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    const {plan, slotsByDate, assignees, participants, roles, slotRoles, scenarios} = testData.fetchForViewData;

    beforeEach(() => {
        setupMock(activityService.getActivitySlots, slotsByDate);
        setupMock(activityService.getActivitySlotAssignees, assignees);
        setupMock(activityService.getActivityPlanParticipants, participants);
        setupMock(userService.getAllRoles, roles);
        setupMock(activityService.getActivitySlotRoles, slotRoles);
    });

    test.each(scenarios)(
        '$description',
        async ({session, mockAssignments, mockFunc, expectedAssignments, expectedCounters}) => {
            if (mockFunc) {
                setupMock(activityService[mockFunc], mockAssignments);
            }
            
            const req = {session} as any;
            const res = await fetchForView(plan as any, req);
            
            verifyResult(res.assignments, expectedAssignments);
            if (expectedCounters) {
                verifyResult(res.counters, expectedCounters);
            }
        }
    );
});

describe('fetchForDuplicate / deleteEntity', () => {
    it('fetchForDuplicate returns slot map', async () => {
        const {plan, slotMap} = testData.fetchForDuplicateData;
        setupMock(activityService.getActivitySlots, slotMap);
        
        const out = await fetchForDuplicate(plan as any, {} as any);
        
        verifyResult(out, slotMap);
    });

    it('deleteEntity delegates to service', async () => {
        const {plan} = testData.deleteEntityData;
        
        await deleteEntity(plan as any, {} as any);
        
        verifyMockCall(activityService.deleteActivityPlan, plan.id);
    });
});

describe('API helpers', () => {
    describe('updateDescription', () => {
        test.each(testData.updateDescriptionData)(
            '$description',
            async ({planId, body, expectedMessage, shouldThrow}) => {
                if (shouldThrow) {
                    await expect(updateDescription(planId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateDescription(planId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(activityService.updateActivityPlanDescription, planId, body.description);
                }
            }
        );
    });

    describe('createTextField', () => {
        test.each(testData.createTextFieldData)(
            '$description',
            async ({planId, body, expectedTitle, expectedText, shouldThrow}) => {
                const mockField = {id: 'tf-123'};
                setupMock(activityService.createActivityPlanTextField, mockField);

                if (shouldThrow) {
                    await expect(createTextField(planId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await createTextField(planId, body);
                    verifyResult(result, mockField);
                    verifyMockCall(
                        activityService.createActivityPlanTextField,
                        planId,
                        expectedTitle,
                        expectedText ?? ''
                    );
                }
            }
        );
    });

    describe('updateTextField', () => {
        test.each(testData.updateTextFieldData)(
            '$description',
            async ({planId, textFieldId, existing, body, expectedTitle, expectedText, shouldThrow, permData}) => {
                setupMock(activityService.getActivityPlanTextFieldById, existing);

                if (shouldThrow) {
                    await expect(updateTextField(planId, textFieldId, body, permData)).rejects.toBeInstanceOf(APIError);
                    return;
                }

                setupMock(activityService.updateActivityPlanTextField, undefined);
                const result = await updateTextField(planId, textFieldId, body, permData);

                verifyResult(result, 'Text field updated');
                verifyMockCall(
                    activityService.updateActivityPlanTextField,
                    textFieldId,
                    expectedText ?? '',
                    expectedTitle
                );
            }
        );
    });

    describe('deleteTextField', () => {
        test.each(testData.deleteTextFieldData)(
            '$description',
            async ({planId, textFieldId, existing, expectedMessage, shouldThrow}) => {
                setupMock(activityService.getActivityPlanTextFieldById, existing);

                if (shouldThrow) {
                    await expect(deleteTextField(planId, textFieldId)).rejects.toBeInstanceOf(APIError);
                    return;
                }

                setupMock(activityService.deleteActivityPlanTextField, undefined);
                const result = await deleteTextField(planId, textFieldId);

                verifyResult(result, expectedMessage);
                verifyMockCall(activityService.deleteActivityPlanTextField, textFieldId);
            }
        );
    });

    it('reorderSlots passes through and returns message', async () => {
        const {planId, order, expectedMessage} = testData.reorderSlotsData;
        
        const result = await reorderSlots(planId, order);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(activityService.reorderActivitySlots, planId, order);
    });

    describe('quickAddSlot', () => {
        const {plan, scenarios} = testData.quickAddSlotData;

        test.each(scenarios)(
            '$description',
            async ({lastPos, body, expectedMessage, expectedSlot, expectedMaxAssignees, shouldThrow}) => {
                if (lastPos !== undefined) {
                    setupMock(activityService.getLastActivitySlotNumber, lastPos);
                }
                
                if (shouldThrow) {
                    await expect(quickAddSlot(plan as any, body)).rejects.toBeInstanceOf(APIError);
                } else if (expectedSlot) {
                    const result = await quickAddSlot(plan as any, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(activityService.addActivitySlot, plan.id, expectedSlot);
                } else if (expectedMaxAssignees) {
                    await quickAddSlot(plan as any, body);
                    expect(activityService.addActivitySlot).toHaveBeenCalledWith(
                        plan.id, 
                        expect.objectContaining({maxAssignees: expectedMaxAssignees})
                    );
                }
            }
        );
    });

    describe('updateSlotDescription', () => {
        test.each(testData.updateSlotDescriptionData)(
            '$description',
            async ({slotId, body, mockResolve, expectedMessage, shouldThrow}) => {
                setupMock(activityService.updateActivitySlot, mockResolve);
                
                if (shouldThrow) {
                    await expect(updateSlotDescription(slotId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateSlotDescription(slotId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(activityService.updateActivitySlot, slotId, body);
                }
            }
        );
    });

    describe('updateSlotAttr', () => {
        test.each(testData.updateSlotAttrData)(
            '$description',
            async ({slotId, body, mockResolve, expectedMessage, expectedUpdate, shouldThrow}) => {
                if (mockResolve !== undefined) {
                    setupMock(activityService.updateActivitySlot, mockResolve);
                }
                
                // Mock permData with all necessary permissions
                const mockPermData = {
                    entity: new Set(['EDIT_META', 'EDIT_TITLE', 'EDIT_DESC', 'MANAGE_REQUIREMENTS', 'EDIT_CAPACITY']),
                    itemAllow: jest.fn(() => true)
                };
                
                if (shouldThrow) {
                    await expect(updateSlotAttr(slotId, body, mockPermData as any)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await updateSlotAttr(slotId, body, mockPermData as any);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(activityService.updateActivitySlot, slotId, expectedUpdate);
                }
            }
        );
    });

    it('deleteAssignment delegates and returns message', async () => {
        const {assignmentId, expectedMessage} = testData.deleteAssignmentData;
        
        const result = await deleteAssignment(assignmentId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(activityService.deleteActivitySlotAssignment, assignmentId);
    });

    it('updateSettings delegates and returns message', async () => {
        const {planId, body, expectedMessage} = testData.updateSettingsData;
        
        const result = await updateSettings(planId, body);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(permissionEngine.saveDefaultPermsFromBody, 'activity', planId, body);
    });

    it('deleteSlot delegates and returns message', async () => {
        const {slotId, expectedMessage} = testData.deleteSlotData;
        
        const result = await deleteSlot(slotId);
        
        verifyResult(result, expectedMessage);
        verifyMockCall(activityService.deleteActivitySlot, slotId);
    });

    describe('addSlotRole', () => {
        test.each(testData.addSlotRoleData)(
            '$description',
            async ({slotId, body, expectedMessage, shouldThrow}) => {
                if (shouldThrow) {
                    await expect(addSlotRole(slotId, body)).rejects.toBeInstanceOf(APIError);
                } else {
                    const result = await addSlotRole(slotId, body);
                    verifyResult(result, expectedMessage);
                    verifyMockCall(activityService.addActivitySlotRoles, slotId, body.roles);
                }
            }
        );
    });
});

describe('access mappings', () => {
    it('getAssignmentAccessMapping routes to correct service funcs', async () => {
        const {assignToUser, userId, unassignFromGuest, guestId} = testData.assignmentAccessMappingData;
        
        const m = getAssignmentAccessMapping();
        await m.assignToUser(assignToUser, userId);
        await m.unassignFromGuest(unassignFromGuest, guestId);

        verifyMockCall(activityService.assignActivitySlotToUser, assignToUser.slotId, userId);
        verifyMockCall(activityService.unassignActivitySlotGuest, unassignFromGuest.slotId, guestId);
    });

    it('getRoleAccessMapping routes with role in body', async () => {
        const {assignToUser, userId, roleId} = testData.roleAccessMappingData;
        
        const m = getRoleAccessMapping();
        await m.assignToUser(assignToUser, userId);

        verifyMockCall(activityService.assignActivityAssignmentRoleToUser, assignToUser.slotId, userId, roleId);
    });
});
