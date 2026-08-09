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