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

import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import type {WeekDay, WeekInMonth} from "../../../../types/SurveyTypes";
import {NumericDefaultEntityItem} from "../abstract/ProfileEntityItem";
import {Survey} from "./Survey";
import {SurveyResponse} from "./SurveyResponse";

export const WEEKDAYS: WeekDay[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const WEEKNUMS: WeekInMonth[] = ["1", "2", "3", "4", "LAST"];

@Index("combinations_single_entry", ["weekday", "entity", "nthWeek"], {
    unique: true,
})
@Entity("survey_combinations", {schema: "surveyor"})
export class SurveyCombination extends NumericDefaultEntityItem {
    @Column("simple-enum", {
        name: "WEEKDAY",
        enum: WEEKDAYS,
    })
    weekday: WeekDay;

    @Column("simple-enum", {name: "nth_week", enum: WEEKNUMS})
    nthWeek: WeekInMonth;

    @OneToMany(
        () => SurveyResponse,
        (surveyResponses) => surveyResponses.item
    )
    assignments!: SurveyResponse[];

    @RelationId((a: SurveyCombination) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => Survey,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: Survey;
}
