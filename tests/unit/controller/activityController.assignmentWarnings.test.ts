import type {Request} from "express";
import controller from "../../../src/controller/activityController";
import {PERM} from "../../../src/modules/lib/permissions";

jest.mock("../../../src/modules/database/services/ActivityService", () => ({
    getActivityPlanById: jest.fn(),
    getActivitySlotById: jest.fn(),
    getParticipantAssignmentsWithSlots: jest.fn(),
    getActivitySlotAssignees: jest.fn(),
}));

jest.mock("../../../src/modules/database/services/ActivityRequirementService", () => ({
    getRequirementConfiguration: jest.fn(),
}));

jest.mock("../../../src/modules/database/services/EventService", () => ({
    getEventParticipants: jest.fn(),
}));

const activityService = jest.requireMock("../../../src/modules/database/services/ActivityService");
const requirementService = jest.requireMock("../../../src/modules/database/services/ActivityRequirementService");
const eventService = jest.requireMock("../../../src/modules/database/services/EventService");

describe("getAssignmentWarnings", () => {
    const session = {user: {id: 1}} as unknown as Request["session"];

    beforeEach(() => {
        jest.resetAllMocks();
    });

    test("returns overlap, arrival, and capacity warnings", async () => {
        activityService.getActivityPlanById.mockResolvedValue({
            id: "plan-1",
            allowOverfillAfterFull: false,
            event: {id: "event-1"},
        });
        activityService.getActivitySlotById.mockResolvedValue({
            id: "slot-1",
            day: "2025-01-01",
            startTime: "10:00",
            endTime: "11:00",
            pos: 1,
            maxAssignees: 1,
        });
        requirementService.getRequirementConfiguration.mockResolvedValue({overrides: []});
        activityService.getParticipantAssignmentsWithSlots.mockResolvedValue({
            "user:1": [
                {id: "slot-existing", day: "2025-01-01", startTime: "10:30", endTime: "11:30", pos: 2},
            ],
        });
        activityService.getActivitySlotAssignees.mockResolvedValue({
            "slot-1": [{id: 1}],
        });
        eventService.getEventParticipants.mockResolvedValue([
            {userId: 1, arrivalDate: "2025-01-01", departureDate: "2025-01-03"},
        ]);

        const warnings = await controller.getAssignmentWarnings("plan-1", "slot-1", session, undefined, {});

        expect(warnings).toEqual(
            expect.arrayContaining([
                {type: "arrival_day"},
                {type: "over_capacity"},
                {type: "overlap", conflicts: ["slot-existing"]},
            ]),
        );
    });

    test("requires manage permission when targeting another participant", async () => {
        await expect(
            controller.getAssignmentWarnings("plan-1", "slot-1", session, undefined, {userId: 2}),
        ).rejects.toMatchObject({status: 403});

        const permData = {entity: {has: (perm: number) => perm === PERM.MANAGE_ASSIGNMENTS}} as any;
        activityService.getActivityPlanById.mockResolvedValue({id: "plan-1", allowOverfillAfterFull: true});
        activityService.getActivitySlotById.mockResolvedValue({
            id: "slot-1",
            day: "2025-01-02",
            pos: 1,
        });
        requirementService.getRequirementConfiguration.mockResolvedValue({overrides: []});
        activityService.getParticipantAssignmentsWithSlots.mockResolvedValue({});
        activityService.getActivitySlotAssignees.mockResolvedValue({});
        eventService.getEventParticipants.mockResolvedValue([]);

        await expect(
            controller.getAssignmentWarnings("plan-1", "slot-1", session, permData, {userId: 2}),
        ).resolves.toEqual([]);
    });
});

