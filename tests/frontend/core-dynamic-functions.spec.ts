import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPasswordRepeatValid,
  isPasswordValid,
} from "../../src/public/js/core/password-validation";
import {
  formatDateLabel,
  formatTimeLabel,
  toDateTimeLocalValue,
  toISOStringOrNull,
} from "../../src/public/js/core/formatting";
import {
  requireEntityPerm,
  requireItemPerm,
} from "../../src/public/js/core/permissions";
import { serializeForm, serializePoolBaseSettings } from "../../src/public/js/events";
import { collectDriversItems } from "../../src/public/js/drivers-create";
import { collectPackingItems } from "../../src/public/js/packing-create";
import { collectSurveyCombinations } from "../../src/public/js/survey-create";
import { ActivityCreateLogic } from "../../src/public/js/modules/activity/activity-create-logic";
import { ActivityCreateState } from "../../src/public/js/modules/activity/activity-create-state";
import { ActivityRecommendationsState } from "../../src/public/js/modules/activity/activity-recommendations-state";
import { RecommendationsLogic } from "../../src/public/js/modules/activity/activity-recommendations-logic";
import type { ActivitySlot } from "../../src/modules/database/entities/activity/ActivitySlot";
import type { FormDataEntryValue } from "undici-types";
import {
  createActivityCases,
  createDriversCases,
  createPackingCases,
  createPasswordCases,
  createPermissionBundle,
  createPermissionCases,
  createRecommendationCases,
  createSurveyCases,
} from "../factories/frontendCoreDynamicFactory";
import {
  createItemTable,
  createSurveyTable,
} from "../keywords/frontendDynamicKeywords";

interface FakeFormDataSeed {
  values: [string, FormDataEntryValue][];
  multiValues: [string, FormDataEntryValue[]][];
}

class FakeFormData {
  private readonly values: [string, FormDataEntryValue][];
  private readonly multiValues: [string, FormDataEntryValue[]][];

  constructor(form: HTMLFormElement) {
    const seed = form as unknown as FakeFormDataSeed;
    this.values = seed.values;
    this.multiValues = seed.multiValues;
  }

  entries(): IterableIterator<[string, FormDataEntryValue]> {
    return this.values[Symbol.iterator]();
  }

  get(name: string): FormDataEntryValue | null {
    return this.values.find(([key]) => key === name)?.[1] ?? null;
  }

  getAll(name: string): FormDataEntryValue[] {
    return this.multiValues.find(([key]) => key === name)?.[1] ?? [];
  }
}

const originalWindow = globalThis.window;

describe("frontend core dynamic functions smoke suite", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Surveyor: {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  describe("authentication dynamic validation", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createPasswordCases())("$description", (testCase) => {
      // Canary: registration/login password rules should remain stable for real user inputs.
      expect(isPasswordValid(testCase.password)).toBe(testCase.valid);
      expect(isPasswordRepeatValid(testCase.password, testCase.repeat)).toBe(
        testCase.repeatValid,
      );
    });
  });

  describe("permissions dynamic guards", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createPermissionCases())("$description", (testCase) => {
      // Canary: frontend permission checks must gate destructive or privileged flows.
      window.Surveyor.permissions = createPermissionBundle(
        testCase.allowed,
        testCase.itemAllowed ?? [],
        testCase.itemId || "item-1",
      );

      const assertion = () => {
        if (testCase.itemId !== undefined) {
          requireItemPerm(
            testCase.itemId,
            testCase.check,
            testCase.action,
            testCase.parentFallback,
          );
        } else {
          requireEntityPerm(testCase.check, testCase.action);
        }
      };

      if (testCase.shouldThrow) expect(assertion).toThrow();
      else expect(assertion).not.toThrow();
    });
  });

  describe("events date and registration payload dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createActivityCases())("$description", async (testCase) => {
      // Canary: registration forms must preserve attendance dates and selected registrations.
      vi.stubGlobal("FormData", FakeFormData);
      const form = {
        values: [
          ["arrivalDate", `${testCase.expectedDates[0]}T10:00`],
          ["departureDate", `${testCase.expectedDates[0]}T18:00`],
        ],
        multiValues: [["registrations", ["participant-a", "participant-b"]]],
      } as unknown as HTMLFormElement;

      const payload = serializeForm(form);
      expect(payload.arrivalDate).toBe(`${testCase.expectedDates[0]}T10:00`);
      expect(payload.registrations).toEqual(["participant-a", "participant-b"]);
      expect(formatDateLabel(testCase.expectedDates[0])).not.toBe("");
    });
  });

  describe("invoice pool form dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createActivityCases())(
      "$description invoice base settings",
      async (testCase) => {
        // Canary: invoice pool edits must send the stable fields the backend expects.
        vi.stubGlobal("FormData", FakeFormData);
        const form = {
          values: [
            ["description", `Travel pool ${testCase.expectedDates[0]}`],
            ["distribution", "EQUAL"],
          ],
          multiValues: [],
        } as unknown as HTMLFormElement;

        expect(serializePoolBaseSettings(form)).toEqual({
          description: `Travel pool ${testCase.expectedDates[0]}`,
          distribution: "EQUAL",
        });
      },
    );
  });

  describe("activity plan slot dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createActivityCases())("$description", (testCase) => {
      // Canary: activity slot JSON must keep only slots inside the event window.
      const state = new ActivityCreateState();
      const logic = new ActivityCreateLogic(state);
      logic.initializeFromPrefilled({
        [testCase.expectedDates[0]]: testCase.slots,
      });
      const payload = logic.preparePayload(
        testCase.startDate,
        testCase.endDate,
      );
      expect(Object.keys(payload)).toEqual(testCase.expectedDates);
      expect(payload[testCase.expectedDates[0]][0].title).toBe(
        testCase.slots[0].title,
      );
    });
  });

  describe("recommendation matching dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createRecommendationCases())("$description", (testCase) => {
      // Canary: recommendations must keep matching participants to available slots.
      const state = new ActivityRecommendationsState();
      state.setParticipantOptions([testCase.participant]);
      state.setRecommendations([testCase.row]);
      state.setSlots([testCase.row.item]);
      const logic = new RecommendationsLogic(state);

      expect(
        logic.isParticipantAvailable(testCase.participant, testCase.slotDay),
      ).toBe(testCase.available);
      expect(logic.getParticipantValue(testCase.participant)).toBe(
        `profile:${testCase.participant.profileId}`,
      );
      expect(logic.getSummaryStats().PENDING).toBe(1);
    });

    it('distinguishes roleless reassignment sources from named-role commitments', () => {
      // Canary: the recommendation GUI may stage moves and swaps only from assignments that do not carry named roles.
      const state = new ActivityRecommendationsState();
      const participant = {
        key: 'profile:00000000-0000-4000-8000-000000000001',
        profileId: '00000000-0000-4000-8000-000000000001',
        label: 'Alex Participant',
      };
      const source = {id: 'source-slot', title: 'Source', day: '2027-06-01'};
      const namedRoleSource = {id: 'named-slot', title: 'Named role', day: '2027-06-02'};
      const target = {id: 'target-slot', title: 'Target', day: '2027-06-03'};
      state.setParticipantOptions([participant]);
      state.setSlots([source, namedRoleSource, target]);
      state.setExistingAssignments([
        {item: source, profile: {id: participant.profileId, name: participant.label}, roles: ['default']},
        {item: namedRoleSource, profile: {id: participant.profileId, name: participant.label}, roles: ['Coordinator']},
      ]);
      const logic = new RecommendationsLogic(state);

      expect(logic.getRolelessAssignments(participant.profileId).map(({item}) => item.id)).toEqual(['source-slot']);
      expect(logic.isAlreadyAssigned(source.id, participant.profileId)).toBe(true);
      expect(logic.createRecommendation(target, participant, participant.profileId, 'REASSIGN', source)).toMatchObject({
        operation: 'REASSIGN',
        sourceItem: source,
        status: 'APPROVED',
        manual: true,
      });
    });

    it('filters applied history and removes a canceled staged unassignment', () => {
      // Canary: completed work must not clutter the review, while manual removals remain reversible until saved.
      const participant = {id: '00000000-0000-4000-8000-000000000001', name: 'Alex Participant'};
      const source = {id: 'source-slot', title: 'Source', day: '2027-06-01'};
      const unassignment = {
        item: source,
        profile: participant,
        status: 'APPROVED' as const,
        operation: 'UNASSIGN' as const,
        manual: true,
      };
      const state = new ActivityRecommendationsState();
      state.setRecommendations([
        unassignment,
        {...unassignment, id: 'applied-history', status: 'APPLIED'},
      ]);
      const logic = new RecommendationsLogic(state);

      expect(state.getRecommendations()).toEqual([unassignment]);
      expect(logic.getSummaryStats()).not.toHaveProperty('APPLIED');
      expect(logic.removeRecommendation(unassignment)).toBe(true);
      expect(state.getRecommendations()).toEqual([]);
    });

    it('removes both legs when either side of a manual swap is removed', () => {
      // Canary: a manually staged swap must never degrade into a one-way reassignment.
      const state = new ActivityRecommendationsState();
      const logic = new RecommendationsLogic(state);
      const first = {id: 'first-slot', title: 'First', day: '2027-06-01'};
      const second = {id: 'second-slot', title: 'Second', day: '2027-06-02'};
      const firstParticipant = {
        key: 'profile:00000000-0000-4000-8000-000000000001',
        profileId: '00000000-0000-4000-8000-000000000001',
        label: 'Alex Participant',
      };
      const secondParticipant = {
        key: 'profile:00000000-0000-4000-8000-000000000002',
        profileId: '00000000-0000-4000-8000-000000000002',
        label: 'Blair Participant',
      };
      const firstLeg = logic.createRecommendation(
        second, firstParticipant, firstParticipant.profileId, 'REASSIGN', first,
      );
      const secondLeg = logic.createRecommendation(
        first, secondParticipant, secondParticipant.profileId, 'REASSIGN', second,
      );
      state.setRecommendations([firstLeg, secondLeg]);

      expect(logic.rejectRecommendation(firstLeg)).toBe(true);
      expect(state.getRecommendations().map(({status}) => status)).toEqual(['REJECTED', 'REJECTED']);
      expect(logic.revertToPending(secondLeg)).toBe(true);
      expect(state.getRecommendations().map(({status}) => status)).toEqual(['PENDING', 'PENDING']);
      expect(logic.removeRecommendation(firstLeg)).toBe(true);
      expect(state.getRecommendations()).toEqual([]);
    });
  });

  describe("packing list row collection dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createPackingCases())("$description", async (testCase) => {
      // Canary: packing rows must serialize to the production item payload shape.
      const table = createItemTable(testCase.rows);

      expect(collectPackingItems(table as unknown as Element)).toEqual(
        testCase.expected,
      );
    });
  });

  describe("drivers list row collection dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createDriversCases())("$description", async (testCase) => {
      // Canary: driver rows must serialize to the production item payload shape.
      const table = createItemTable(testCase.rows);

      expect(collectDriversItems(table as unknown as Element)).toEqual(
        testCase.expected,
      );
    });
  });

  describe("survey combination dynamics", () => {
    // Canary: protects a high-value production behavior while avoiding private implementation details.
    it.each(createSurveyCases())("$description", async (testCase) => {
      // Canary: survey rows must keep weekday/week combinations compatible with backend entities.
      const table = createSurveyTable(testCase.combinations);

      expect(collectSurveyCombinations(table as unknown as Element)).toEqual(
        testCase.expected,
      );
      expect(formatTimeLabel("10:30:00")).toBe("10:30");
      expect(toDateTimeLocalValue(new Date("2026-08-05T10:30:00Z"))).toContain(
        "2026-08-05T10:30",
      );
      expect(toISOStringOrNull("2026-08-05T10:30")).toContain(
        "2026-08-05T10:30",
      );
    });
  });
});
