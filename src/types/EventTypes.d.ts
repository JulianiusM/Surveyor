/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

export type DIETARY = "MEAT" | "FISH" | "VEGETARIAN" | "VEGAN" | "HALAL" | "KOSHER" | "ALLERGIES" | "COMMENT";

type ParticipantRow = {
    id: string | number;
    profileId: string | null;
    name: string;
    email?: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    dietaryChoices: EventRegistrationDietary[];
};