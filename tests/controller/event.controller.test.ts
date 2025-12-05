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
    getEventParticipants: jest.fn(),
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
    updateRegistrationDates: jest.fn(),
}));

jest.mock('../../src/modules/database/services/EventInvoiceService', () => ({
    listPools: jest.fn(() => Promise.resolve([])),
    getMyInvoices: jest.fn(() => Promise.resolve([])),
    getParticipantPools: jest.fn(() => Promise.resolve([])),
}));

import { mockUtil, mockPermissionEngine } from '../mocks/commonMocks';

jest.mock('../../src/modules/lib/util', () => mockUtil({
    isWithinWindow: jest.fn(() => true),
    rewriteISOToZone: jest.fn((iso: string, tz: string) => `rewritten:${iso}:${tz}`),
    getResource: jest.fn((req: any, type: string) => req.resource?.[type]),
}));

jest.mock('../../src/modules/permissionEngine', () => mockPermissionEngine());

import controller from '../../src/controller/eventController';
import * as eventService from '../../src/modules/database/services/EventService';
import * as permissionEngine from '../../src/modules/permissionEngine';
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
    // Set default return values for new mocks
    (eventService.getEventParticipants as jest.Mock).mockResolvedValue([]);
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
        await expect(afterCreateItems(expectedId, {_body: {}})).resolves.toBeUndefined();
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
        setupMock(eventService.getEventParticipants, registrations);
    });

    test.each(scenarios)(
        '$description',
        async ({eventOverrides, session, mockRegistration, mockActivityPlans, mockPackingLists, mockDriverLists,
                expectedRegistrationCall, expected, expectNoCall, registrations: customRegistrations}) => {
            const event = {...baseEvent, ...eventOverrides};
            
            if (customRegistrations) {
                setupMock(eventService.getRegistrationsForEvent, customRegistrations);
                setupMock(eventService.getEventParticipants, customRegistrations);
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
            
            const req = {session} as any;
            const res = await fetchForView(event, req);
            
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
            
            const req = {session, resource: {}} as any;
            
            if (shouldThrow) {
                await expect(registerAttendance(event as any, body, req)).rejects.toBeInstanceOf(APIError);
            } else if (expectedCall) {
                const result = await registerAttendance(event as any, body, req);
                if (expectedMessage) {
                    verifyResult(result, expectedMessage);
                }
                verifyMockCall(eventService[expectedCall.service], ...expectedCall.args);
            } else if (expectCallMade) {
                await registerAttendance(event as any, body, req);
                expect(eventService[expectCallMade]).toHaveBeenCalled();
            }
        }
    );
});

describe('cancelRegistration', () => {
    test.each(testData.cancelRegistrationData)(
        '$description',
        async ({eventId, session, expectedMessage, expectedArgs, shouldThrow}) => {
            const event = {id: eventId} as any;
            
            if (shouldThrow) {
                await expect(cancelRegistration(event, session as any)).rejects.toBeInstanceOf(APIError);
            } else {
                const result = await cancelRegistration(event, session as any);
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
            // Mock permData with all necessary permissions
            const mockPermData = {
                entity: new Set(['EDIT_META', 'EDIT_TITLE', 'EDIT_DESC', 'MANAGE_REQUIREMENTS', 'EDIT_CAPACITY'])
            };
            
            if (shouldThrow) {
                await expect(updateEventSettings(event as any, body, mockPermData as any)).rejects.toBeInstanceOf(APIError);
            } else {
                const msg = await updateEventSettings(event as any, body, mockPermData as any);
                
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

describe('updateRegistrationDates', () => {
    const {updateRegistrationDates} = controller as any;
    
    test.each(testData.updateRegistrationDatesData)(
        '$description',
        async ({body, event, registrationId, expectedMessage, expectedCalls, expectNotCalled, shouldThrow, datesOutsideWindow}: any) => {
            const mockEvent = {id: 'e1', ...event} as any;
            
            // Set up isWithinWindow mock based on test expectations
            (isWithinWindow as jest.Mock).mockReturnValue(!datesOutsideWindow);
            
            if (shouldThrow) {
                await expect(
                    updateRegistrationDates(mockEvent, registrationId, body)
                ).rejects.toThrow(shouldThrow === 'APIError' ? APIError : Error);
                
                if (expectNotCalled) {
                    expectNotCalled.forEach(serviceName => {
                        expect(eventService[serviceName]).not.toHaveBeenCalled();
                    });
                }
            } else {
                const msg = await updateRegistrationDates(mockEvent, registrationId, body);
                
                if (expectedMessage) {
                    verifyResult(msg, expectedMessage);
                }
                
                if (expectedCalls) {
                    Object.keys(expectedCalls).forEach(serviceName => {
                        verifyMockCall(eventService[serviceName], ...expectedCalls[serviceName]);
                    });
                }
            }
        }
    );
});
