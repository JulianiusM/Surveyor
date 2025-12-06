import type {Request} from "express";
import {enforcePlanBindingDeadline} from "../../src/middleware/assignFlowFactory";
import {PERM} from "../../src/modules/lib/permissions";

jest.mock("../../src/modules/database/services/ActivityService", () => ({
    getActivityPlanById: jest.fn(),
}));

const {getActivityPlanById} = jest.requireMock("../../src/modules/database/services/ActivityService");

describe("enforcePlanBindingDeadline", () => {
    const baseReq = {params: {id: "plan-1"}, body: {}} as unknown as Request;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2025-01-02T12:00:00Z"));
        jest.resetAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("allows assignments when no deadline is set", async () => {
        getActivityPlanById.mockResolvedValueOnce({id: "plan-1", bindingDeadline: null});

        await expect(enforcePlanBindingDeadline(baseReq)).resolves.toBeUndefined();
        expect(getActivityPlanById).toHaveBeenCalledWith("plan-1");
    });

    test("allows assignments before the deadline", async () => {
        getActivityPlanById.mockResolvedValueOnce({
            id: "plan-1",
            bindingDeadline: new Date("2025-01-03T00:00:00Z"),
        });

        await expect(enforcePlanBindingDeadline(baseReq)).resolves.toBeUndefined();
    });

    test("blocks assignments after the deadline without admin rights", async () => {
        getActivityPlanById.mockResolvedValueOnce({
            id: "plan-1",
            bindingDeadline: new Date("2025-01-01T00:00:00Z"),
        });

        await expect(enforcePlanBindingDeadline(baseReq, undefined)).rejects.toMatchObject({
            name: "APIError",
            status: 403,
        });
    });

    test("allows assignments after the deadline for managers", async () => {
        getActivityPlanById.mockResolvedValueOnce({
            id: "plan-1",
            bindingDeadline: new Date("2025-01-01T00:00:00Z"),
        });

        const permData = {
            entity: {has: (perm: string) => perm === 'MANAGE_ASSIGNMENTS'},
        } as any;

        await expect(enforcePlanBindingDeadline(baseReq, permData)).resolves.toBeUndefined();
    });
});

