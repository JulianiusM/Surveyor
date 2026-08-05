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
