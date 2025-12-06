/**
 * Unit tests for assignFlowFactory middleware
 * Uses data-driven testing approach with test data in tests/data/middleware/assignFlowFactoryData.ts
 */

import type {Request} from "express";
import {enforcePlanBindingDeadline} from "../../src/middleware/assignFlowFactory";

// Mock activity service
jest.mock("../../src/modules/database/services/ActivityService", () => ({
    getActivityPlanById: jest.fn(),
}));

const {getActivityPlanById} = jest.requireMock("../../src/modules/database/services/ActivityService");

// Import test data
import {enforcePlanBindingDeadlineData} from '../data/middleware/assignFlowFactoryData';

// Import test keywords
import {clearAllMocks, setupMock, verifyMockCall} from '../keywords/common/controllerKeywords';

describe("enforcePlanBindingDeadline - Data Driven", () => {
    const baseReq = {params: {id: "plan-1"}, body: {}} as unknown as Request;

    beforeEach(() => {
        jest.useFakeTimers();
        clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test.each(enforcePlanBindingDeadlineData)(
        '$description',
        async ({plan, currentTime, permData, shouldSucceed, expectedError}) => {
            // Setup time
            jest.setSystemTime(new Date(currentTime));
            
            // Setup mock
            setupMock(getActivityPlanById, plan);

            // Execute and verify
            if (shouldSucceed) {
                await expect(enforcePlanBindingDeadline(baseReq, permData as any)).resolves.toBeUndefined();
                verifyMockCall(getActivityPlanById, plan.id);
            } else {
                await expect(enforcePlanBindingDeadline(baseReq, permData)).rejects.toMatchObject(expectedError);
                verifyMockCall(getActivityPlanById, plan.id);
            }
        }
    );
});

