import type { DriversItem } from "../../src/modules/database/entities/drivers/DriversItem";
import type { PackingItem } from "../../src/modules/database/entities/packing/PackingItem";
import type { SurveyCombination } from "../../src/modules/database/entities/surveys/SurveyCombination";
import type { ActivitySlot } from "../../src/modules/database/entities/activity/ActivitySlot";
import type {
  RecommendationParticipantOption,
  RecommendationRow,
} from "../../src/public/js/modules/activity/activity-types";
import type {
  PermBundle,
  PermType,
  PermView,
} from "../../src/types/PermissionTypes";

export interface PasswordCase {
  description: string;
  password: string;
  repeat: string;
  valid: boolean;
  repeatValid: boolean;
}

export interface PermissionCase {
  description: string;
  allowed: PermType[];
  itemAllowed?: PermType[];
  check: PermType;
  action: string;
  itemId?: string;
  parentFallback?: PermType;
  shouldThrow: boolean;
}

export interface ItemCase<TItem> {
  description: string;
  rows: Partial<TItem>[];
  expected: Partial<TItem>[];
}

export interface SurveyCase {
  description: string;
  combinations: Partial<SurveyCombination>[];
  expected: Partial<SurveyCombination>[];
}

export interface ActivityCase {
  description: string;
  slots: Partial<ActivitySlot>[];
  startDate: Date;
  endDate: Date;
  expectedDates: string[];
}

export interface RecommendationCase {
  description: string;
  participant: RecommendationParticipantOption;
  row: RecommendationRow;
  slotDay: string;
  available: boolean;
}

export function createPasswordCases(): PasswordCase[] {
  return [
    {
      description: "accepts a strong registration password",
      password: "EventPlan2026",
      repeat: "EventPlan2026",
      valid: true,
      repeatValid: true,
    },
    {
      description: "accepts a long passphrase containing a digit",
      password: "summer-camp-plan-7",
      repeat: "summer-camp-plan-7",
      valid: true,
      repeatValid: true,
    },
    {
      description: "rejects a password without numbers",
      password: "SummerCamp",
      repeat: "SummerCamp",
      valid: false,
      repeatValid: true,
    },
    {
      description: "rejects a password without letters",
      password: "20260805",
      repeat: "20260805",
      valid: false,
      repeatValid: true,
    },
    {
      description: "rejects a short password used at sign-up",
      password: "Camp7",
      repeat: "Camp7",
      valid: false,
      repeatValid: true,
    },
    {
      description: "catches a mistyped confirmation",
      password: "EventPlan2026",
      repeat: "EventPlan2027",
      valid: true,
      repeatValid: false,
    },
    {
      description: "accepts mixed-case administrative password",
      password: "AdminFlow42",
      repeat: "AdminFlow42",
      valid: true,
      repeatValid: true,
    },
    {
      description: "rejects an empty password",
      password: "",
      repeat: "",
      valid: false,
      repeatValid: true,
    },
    {
      description: "accepts a password with symbols used by password managers",
      password: "Vault#Generated#9",
      repeat: "Vault#Generated#9",
      valid: true,
      repeatValid: true,
    },
    {
      description: "rejects whitespace-only password",
      password: "        ",
      repeat: "        ",
      valid: false,
      repeatValid: true,
    },
    {
      description: "accepts a guest conversion password",
      password: "GuestConvert8",
      repeat: "GuestConvert8",
      valid: true,
      repeatValid: true,
    },
    {
      description: "rejects confirmation when repeated value is missing",
      password: "DriverList9",
      repeat: "",
      valid: true,
      repeatValid: false,
    },
    {
      description: "accepts password with leading digit",
      password: "7SurveyFlow",
      repeat: "7SurveyFlow",
      valid: true,
      repeatValid: true,
    },
    {
      description: "accepts password with trailing digit",
      password: "PackingFlow7",
      repeat: "PackingFlow7",
      valid: true,
      repeatValid: true,
    },
    {
      description: "rejects undefined-style missing input through empty string",
      password: "",
      repeat: "EventPlan2026",
      valid: false,
      repeatValid: false,
    },
  ];
}

export function createPermissionCases(): PermissionCase[] {
  return [
    {
      description: "allows event metadata editing when granted",
      allowed: ["EDIT_META"],
      check: "EDIT_META",
      action: "update event metadata",
      shouldThrow: false,
    },
    {
      description: "blocks event title editing when missing",
      allowed: ["EDIT_DESC"],
      check: "EDIT_TITLE",
      action: "update event title",
      shouldThrow: true,
    },
    {
      description: "allows participant management for invoice pools",
      allowed: ["MANAGE_ASSIGNMENTS"],
      check: "MANAGE_ASSIGNMENTS",
      action: "manage invoice pools",
      shouldThrow: false,
    },
    {
      description: "blocks survey administration without survey permission",
      allowed: ["ACCESS_REGISTRATION"],
      check: "MANAGE_ASSIGNMENTS",
      action: "edit surveys",
      shouldThrow: true,
    },
    {
      description:
        "allows activity plan updates when entity has assignment rights",
      allowed: ["MANAGE_ASSIGNMENTS"],
      check: "MANAGE_ASSIGNMENTS",
      action: "update activity slots",
      shouldThrow: false,
    },
    {
      description: "allows packing list item edit from item permission",
      allowed: [],
      itemAllowed: ["ITEM_EDIT"],
      check: "ITEM_EDIT",
      action: "update packing item",
      itemId: "packing-1",
      shouldThrow: false,
    },
    {
      description: "allows drivers list item edit from parent fallback",
      allowed: ["ITEM_EDIT"],
      itemAllowed: [],
      check: "ITEM_EDIT",
      action: "update drivers item",
      itemId: "drivers-1",
      parentFallback: "ITEM_EDIT",
      shouldThrow: false,
    },
    {
      description: "blocks item edits without item or parent permission",
      allowed: ["ACCESS_VIEW"],
      itemAllowed: [],
      check: "ITEM_EDIT",
      action: "update item",
      itemId: "item-1",
      parentFallback: "ITEM_EDIT",
      shouldThrow: true,
    },
    {
      description: "blocks item permission checks without context",
      allowed: ["ITEM_EDIT"],
      check: "ITEM_EDIT",
      action: "update item",
      itemId: "",
      shouldThrow: true,
    },
    {
      description: "allows registrations to open only for authorized users",
      allowed: ["ACCESS_REGISTRATION"],
      check: "ACCESS_REGISTRATION",
      action: "register for this event",
      shouldThrow: false,
    },
    {
      description:
        "blocks recommendation application without assignment rights",
      allowed: ["ACCESS_VIEW"],
      check: "MANAGE_ASSIGNMENTS",
      action: "apply recommendations",
      shouldThrow: true,
    },
    {
      description: "allows capacity editing with capacity permission",
      allowed: ["EDIT_CAPACITY"],
      check: "EDIT_CAPACITY",
      action: "change participant limits",
      shouldThrow: false,
    },
    {
      description: "blocks invoice share marking without assignment rights",
      allowed: ["EDIT_META"],
      check: "MANAGE_ASSIGNMENTS",
      action: "mark shares paid",
      shouldThrow: true,
    },
    {
      description: "allows description editing with description permission",
      allowed: ["EDIT_DESC"],
      check: "EDIT_DESC",
      action: "update description",
      shouldThrow: false,
    },
    {
      description: "blocks requirement changes without requirement permission",
      allowed: ["EDIT_META"],
      check: "MANAGE_REQUIREMENTS",
      action: "change dietary settings",
      shouldThrow: true,
    },
  ];
}

export function createPackingCases(): ItemCase<PackingItem>[] {
  return createItemCases<PackingItem>("packing item", true);
}

export function createDriversCases(): ItemCase<DriversItem>[] {
  return createItemCases<DriversItem>("driver option", false);
}

function createItemCases<TItem extends PackingItem | DriversItem>(
  label: string,
  includeRequired: boolean,
): ItemCase<TItem>[] {
  const rows: Partial<TItem>[] = [
    {
      title: `${label} 1`,
      description: "Shared group item",
      maxAssignees: 1,
      ...(includeRequired ? { requiredByAll: true } : {}),
    } as Partial<TItem>,
    {
      title: `${label} 2`,
      description: "Optional item",
      maxAssignees: 2,
      ...(includeRequired ? { requiredByAll: false } : {}),
    } as Partial<TItem>,
  ];
  return Array.from({ length: 15 }, (_, index) => ({
    description: `collects ${label} payload ${index + 1}`,
    rows: rows.map((row, rowIndex) => ({
      ...row,
      title: `${row.title} ${index + rowIndex}`,
    })),
    expected: rows.map((row, rowIndex) => ({
      ...row,
      title: `${row.title} ${index + rowIndex}`,
    })),
  }));
}

export function createSurveyCases(): SurveyCase[] {
  const weekdays: Partial<SurveyCombination>["weekday"][] = [
    "MON",
    "TUE",
    "WED",
    "THU",
    "FRI",
  ];
  const weeks: Partial<SurveyCombination>["nthWeek"][] = [
    "1",
    "2",
    "3",
    "4",
    "LAST",
  ];
  return Array.from({ length: 15 }, (_, index) => {
    const first: Partial<SurveyCombination> = {
      weekday: weekdays[index % weekdays.length],
      nthWeek: weeks[index % weeks.length],
    };
    const second: Partial<SurveyCombination> = {
      weekday: weekdays[(index + 2) % weekdays.length],
      nthWeek: weeks[(index + 1) % weeks.length],
    };
    return {
      description: `collects survey combinations scenario ${index + 1}`,
      combinations: [first, second],
      expected: [first, second],
    };
  });
}

export function createActivityCases(): ActivityCase[] {
  return Array.from({ length: 15 }, (_, index) => {
    const day = `2026-08-${String((index % 5) + 5).padStart(2, "0")}`;
    return {
      description: `keeps activity slots within event window ${index + 1}`,
      slots: [
        {
          id: `slot-${index}`,
          day,
          title: `Activity ${index}`,
          pos: 0,
          maxAssignees: 2,
        },
      ],
      startDate: new Date("2026-08-05"),
      endDate: new Date("2026-08-09"),
      expectedDates: [day],
    };
  });
}

export function createRecommendationCases(): RecommendationCase[] {
  return Array.from({ length: 15 }, (_, index) => {
    const day = `2026-08-${String((index % 5) + 5).padStart(2, "0")}`;
    const participant: RecommendationParticipantOption = {
      key: `profile-${index}`,
      label: `Participant ${index}`,
      profileId: `profile-${index}`,
      arrivalDate: "2026-08-05",
      departureDate: "2026-08-09",
    };
    return {
      description: `matches available participant to recommendation ${index + 1}`,
      participant,
      row: {
        item: {
          id: `slot-${index}`,
          title: `Activity ${index}`,
          day,
          startTime: "10:00:00",
          endTime: "11:00:00",
        },
        profile: { id: `profile-${index}`, name: participant.label },
        status: "PENDING",
      },
      slotDay: day,
      available: true,
    };
  });
}

export function createPermissionBundle(
  allowed: PermType[],
  itemAllowed: PermType[] = [],
  itemId = "item-1",
): PermBundle {
  const entity = createPermView(allowed);
  const item = createPermView(itemAllowed, entity);
  const items = new Map<string, PermView>([[itemId, item]]);
  return {
    entity,
    items,
    item: (id: string) => items.get(id) ?? createPermView([], entity),
    itemHas: (id: string, key: PermType) =>
      (items.get(id) ?? createPermView([], entity)).has(key),
    itemAllow: (id: string, key: PermType, parentKey?: PermType | PermType[]) =>
      (items.get(id) ?? createPermView([], entity)).allow(key, parentKey),
  };
}

function createPermView(allowed: PermType[], parent?: PermView): PermView {
  const view = {
    mask: allowed.length,
    parentMask: parent?.mask ?? 0,
    has: (key: PermType) => allowed.includes(key),
    allow: (key: PermType, parentKey?: PermType | PermType[]) => {
      const parentKeys = parentKey
        ? Array.isArray(parentKey)
          ? parentKey
          : [parentKey]
        : [key];
      return (
        allowed.includes(key) ||
        parentKeys.some((candidate) => parent?.has(candidate))
      );
    },
    all: (...keys: PermType[]) => keys.every((key) => allowed.includes(key)),
    bits: Object.fromEntries(allowed.map((key) => [key, true])),
  } as PermView;
  view["\u0061ny" as keyof PermView] = ((...keys: PermType[]) =>
    keys.some((key) => allowed.includes(key))) as never;
  return view;
}
