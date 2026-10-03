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

/** Minimal, authorized event information shared by creation and entity settings pickers. */
export interface EventLinkOption {
    id: string;
    title: string;
    description?: string | null;
    startDate: string;
    endDate: string;
    archived: boolean;
    deadlinePassed: boolean;
}

/** Date filters overlap the event window. State filters never change attachment authority. */
export interface EventLinkOptionsQuery {
    q?: string;
    from?: string;
    to?: string;
    period?: 'all' | 'upcoming' | 'ongoing' | 'ended';
    archive?: 'all' | 'active' | 'archived';
    deadline?: 'all' | 'open' | 'passed';
    cursor?: string;
    selectedId?: string;
}

export interface EventLinkOptionsResult {
    items: EventLinkOption[];
    nextCursor: string | null;
    /** Selection resolution is independent of filters and applies the same disclosure policy. */
    selected?: EventLinkOption | null;
}

/** Creation callers may seed only a saved ID/title; remote options fill in other details. */
export interface EntityPickerOption {
    id: string | number;
    title?: string;
    description?: string | null;
    dateIso?: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    archived?: boolean;
    deadlinePassed?: boolean;
}

export interface EntityPickerOptions {
    id?: string;
    label?: string;
    value?: string | number | null;
    required?: boolean;
    class?: string;
    help?: string;
    placeholderLabel?: string;
    mode?: 'inline' | 'modal';
    /** Omit to use event discovery; null retains local-only selection for other callers. */
    endpoint?: string | null;
}

type ParticipantRow = {
    id: string | number;
    profileId: string | null;
    name: string;
    email?: string | null;
    arrivalDate: string | null;
    departureDate: string | null;
    dietaryChoices: EventRegistrationDietary[];
};
