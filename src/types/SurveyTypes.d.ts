export type WeekDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type WeekInMonth = "1" | "2" | "3" | "4" | "LAST";
export type SurveyAnswer = "yes" | "no" | "maybe" | null;

export type BasePicked = {
    id: number;
    answer: SurveyAnswer | null;
    combinationId: number;
    profileId: string;
    name: string;
};

export type GroupedResponses = Record<string, Array<UserResponseItem | GuestResponseItem>>;