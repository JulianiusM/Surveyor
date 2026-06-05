import {EventRegistrationDietary} from "../modules/database/entities/event/EventRegistrationDietary";

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

type ParticipantRow = {
    id: string | number;
    userId: number | null;
    guestId: string | null;
    name: string;
    email?: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    dietaryChoices: EventRegistrationDietary[];
};