import {summarizeParticipantRequirements} from "../../../src/modules/activity/requirements";

describe("summarizeParticipantRequirements", () => {
    const plan = {
        assignmentMode: "REQUIRED" as const,
        generalRequiredShifts: 2,
        roundingMode: "CEIL" as const,
        startDate: "2024-01-01",
        endDate: "2024-01-03",
    };

    it("returns required, assigned, and remaining counts with names", () => {
        const participants = [
            {userId: 1, name: "Alice"},
            {guestId: 2, name: "Bob", arrivalDate: "2024-01-02"},
        ];

        const roleRequirements: any[] = [];
        const overrides: any[] = [];
        const assignments = {
            "user:1": [{}, {}],
            "guest:2": [{}],
        };

        const summary = summarizeParticipantRequirements(plan, participants, roleRequirements, overrides, assignments);

        expect(summary).toEqual([
            {
                participantKey: "user:1",
                name: "Alice",
                requiredShifts: 2,
                assignedShifts: 2,
                remainingShifts: 0,
                source: "general",
                attendance: undefined,
            },
            {
                participantKey: "guest:2",
                name: "Bob",
                requiredShifts: 2,
                assignedShifts: 1,
                remainingShifts: 1,
                source: "general",
                attendance: {arrivalDate: "2024-01-02", departureDate: undefined},
            },
        ]);
    });

    it("applies override sources and zeros when not required", () => {
        const participants = [
            {userId: 3, name: "Charlie"},
        ];

        const roleRequirements: any[] = [];
        const overrides = [{userId: 3, requiredShifts: 0}];
        const assignments = {"user:3": [{}]};

        const summary = summarizeParticipantRequirements(plan, participants, roleRequirements, overrides, assignments);

        expect(summary[0]).toMatchObject({
            participantKey: "user:3",
            requiredShifts: 0,
            assignedShifts: 1,
            remainingShifts: 0,
            source: "override",
        });
    });
});
