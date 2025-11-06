export type CreateEventDTO = {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    location?: string;
    timezone?: string;
    bindingDeadline?: string | null;
    allowOverfillAfterFull?: boolean;
};

export type DIETARY = "MEAT" | "FISH" | "VEGETARIAN" | "VEGAN" | "HALAL" | "KOSHER" | "ALLERGIES";