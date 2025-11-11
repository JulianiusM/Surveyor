/**
 * Controller unit tests (services + util mocked).
 */

jest.mock('../../src/modules/database/services/EventService', () => ({
    createEventTx: jest.fn(),
    getRegistrationFor: jest.fn(),
    getActivityPlansForEvent: jest.fn(),
    getPackingListsForEvent: jest.fn(),
    getDriverListsForEvent: jest.fn(),
    getRegistrationsForEvent: jest.fn(),
    deleteEvent: jest.fn(),
    isEventFull: jest.fn(),
    isRegisteredForEvent: jest.fn(),
    registerUser: jest.fn(),
    registerGuest: jest.fn(),
    deleteRegistrationFor: jest.fn(),
    updateEventMeta: jest.fn(),
    updateEventTitle: jest.fn(),
    updateEventDescription: jest.fn(),
    updateEventDates: jest.fn(),
}));

jest.mock('../../src/modules/lib/util', () => ({
    // Keep these deterministic for tests
    isWithinWindow: jest.fn(() => true),
    rewriteISOToZone: jest.fn((iso: string, tz: string) => `rewritten:${iso}:${tz}`),
}));

import controller from '../../src/controller/eventController';
import * as eventService from '../../src/modules/database/services/EventService';
import {APIError, ValidationError} from '../../src/modules/lib/errors';
import {isWithinWindow, rewriteISOToZone} from '../../src/modules/lib/util';
import {setupMock, verifyMockCall, verifyResult} from '../keywords/common/controllerKeywords';
import * as testData from '../data/controller/eventData';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    registerAttendance,
    cancelRegistration,
    updateEventSettings,
} = controller as any;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    test.each(testData.preprocessCreateData)(
        '$description',
        ({input, expected, expectRewrite, shouldThrow}) => {
            if (shouldThrow) {
                expect(() => preprocessCreate(input)).toThrow(shouldThrow === 'ValidationError' ? ValidationError : Error);
            } else {
                const out = preprocessCreate(input);
                
                if (expectRewrite) {
                    expect(rewriteISOToZone).toHaveBeenCalledWith(...expectRewrite);
                }
                
                if (expected.bindingDeadline !== undefined) {
                    expect(out.bindingDeadline).toBe(expected.bindingDeadline);
                }
                if (expected.timezone !== undefined) {
                    expect(out.timezone).toBe(expected.timezone);
                }
                if (expected.title) {
                    expect(out).toMatchObject(expected);
                }
            }
        }
    );
});

describe('createEntity / afterCreateItems / deleteEntity', () => {
    it('createEntity forwards fields to service', async () => {
        const {userId, data, expectedId} = testData.createEntityData;
        setupMock(eventService.createEventTx, expectedId);
        
        const id = await createEntity(userId, data);
        
        verifyResult(id, expectedId);
        verifyMockCall(eventService.createEventTx,
            userId, data.title, data.description, data.startDate, data.endDate,
            data.location, data.bindingDeadline, data.requireDietaryInfo, data.maxParticipants, data.timezone
        );
        await expect(afterCreateItems()).resolves.toBeUndefined();
    });

    it('deleteEntity delegates to service', async () => {
        const {event} = testData.deleteEntityData;
        
        await deleteEntity(event as any, {} as any);
        
        verifyMockCall(eventService.deleteEvent, event.id);
    });
});

describe('fetchForView', () => {
    const {baseEvent, registrations, scenarios} = testData.fetchForViewData;

    beforeEach(() => {
        setupMock(eventService.getRegistrationsForEvent, registrations);
    });

    test.each(scenarios)(
        '$description',
        async ({eventOverrides, session, mockRegistration, mockActivityPlans, mockPackingLists, mockDriverLists,
                expectedRegistrationCall, expected, expectNoCall, registrations: customRegistrations}) => {
            const event = {...baseEvent, ...eventOverrides};
            
            if (customRegistrations) {
                setupMock(eventService.getRegistrationsForEvent, customRegistrations);
            }
            
            if (mockRegistration !== undefined) {
                setupMock(eventService.getRegistrationFor, mockRegistration);
            }
            if (mockActivityPlans) {
                setupMock(eventService.getActivityPlansForEvent, mockActivityPlans);
            }
            if (mockPackingLists) {
                setupMock(eventService.getPackingListsForEvent, mockPackingLists);
            }
            if (mockDriverLists) {
                setupMock(eventService.getDriverListsForEvent, mockDriverLists);
            }
            
            const res = await fetchForView(event, session as any);
            
            if (expectedRegistrationCall) {
                verifyMockCall(eventService.getRegistrationFor, ...expectedRegistrationCall);
            }
            
            if (expectNoCall) {
                expect(eventService[expectNoCall]).not.toHaveBeenCalled();
            }
            
            Object.keys(expected).forEach(key => {
                if (expected[key] === null) {
                    expect(res[key]).toBeNull();
                } else {
                    verifyResult(res[key], expected[key]);
                }
            });
        }
    );
});

describe('fetchForDuplicate', () => {
    it('returns the given event', async () => {
        const {event} = testData.fetchForDuplicateData;
        await expect(fetchForDuplicate(event as any, {} as any)).resolves.toBe(event);
    });
});

describe('registerAttendance', () => {
    const {event, scenarios} = testData.registerAttendanceData;

    test.each(scenarios)(
        '$description',
        async ({mockFull, mockRegistered, mockWithinWindow, body, session, expectedMessage, expectedCall, expectCallMade, shouldThrow}) => {
            if (mockFull !== undefined) {
                setupMock(eventService.isEventFull, mockFull);
            }
            if (mockRegistered !== undefined) {
                setupMock(eventService.isRegisteredForEvent, mockRegistered);
            }
            if (mockWithinWindow !== undefined) {
                (isWithinWindow as jest.Mock).mockReturnValue(mockWithinWindow);
            }
            
            if (shouldThrow) {
                await expect(registerAttendance(event as any, body, session as any)).rejects.toBeInstanceOf(APIError);
            } else if (expectedCall) {
                const result = await registerAttendance(event as any, body, session as any);
                if (expectedMessage) {
                    verifyResult(result, expectedMessage);
                }
                verifyMockCall(eventService[expectedCall.service], ...expectedCall.args);
            } else if (expectCallMade) {
                await registerAttendance(event as any, body, session as any);
                expect(eventService[expectCallMade]).toHaveBeenCalled();
            }
        }
    );
});

describe('cancelRegistration', () => {
    test.each(testData.cancelRegistrationData)(
        '$description',
        async ({eventId, session, expectedMessage, expectedArgs, shouldThrow}) => {
            if (shouldThrow) {
                await expect(cancelRegistration(eventId, session as any)).rejects.toBeInstanceOf(APIError);
            } else {
                const result = await cancelRegistration(eventId, session as any);
                if (expectedMessage) {
                    verifyResult(result, expectedMessage);
                }
                verifyMockCall(eventService.deleteRegistrationFor, ...expectedArgs);
            }
        }
    );
});

describe('updateEventSettings', () => {
    const {event, scenarios} = testData.updateEventSettingsData;

    test.each(scenarios)(
        '$description',
        async ({body, expectedMessage, expectRewrite, expectedCalls, expectNotCalled, shouldThrow}) => {
            if (shouldThrow) {
                await expect(updateEventSettings(event as any, body)).rejects.toBeInstanceOf(APIError);
            } else {
                const msg = await updateEventSettings(event as any, body);
                
                if (expectedMessage) {
                    verifyResult(msg, expectedMessage);
                }
                
                if (expectRewrite) {
                    expect(rewriteISOToZone).toHaveBeenCalledWith(...expectRewrite);
                }
                
                if (expectedCalls) {
                    Object.keys(expectedCalls).forEach(serviceName => {
                        verifyMockCall(eventService[serviceName], ...expectedCalls[serviceName]);
                    });
                }
                
                if (expectNotCalled) {
                    expectNotCalled.forEach(serviceName => {
                        expect(eventService[serviceName]).not.toHaveBeenCalled();
                    });
                }
            }
        }
    );
});
