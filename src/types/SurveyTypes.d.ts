export type WeekDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type WeekInMonth = "1" | "2" | "3" | "4" | "LAST";
export type SurveyAnswer = "yes" | "no" | "maybe" | null;

export type BasePicked = {
    id: number;
    answer: SurveyAnswer | null;
    combinationId: number;
    username: string;
};

export type GuestResponseItem = BasePicked & {
    kind: "guest";
    guestId: string;
};

export type UserResponseItem = BasePicked & {
    kind: "user";
    userId: number;
    name: string; // only users have a 'name'
};

export type GroupKey = `u_${number}` | `g_${string}`;
export type GroupedResponses = Record<GroupKey, Array<UserResponseItem | GuestResponseItem>>;