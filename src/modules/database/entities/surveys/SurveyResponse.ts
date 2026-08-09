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

import {Column, Entity, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import type {SurveyAnswer} from "../../../../types/SurveyTypes";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {Survey} from "./Survey";
import {SurveyCombination} from "./SurveyCombination";

export const SURVEY_ANSWERS: SurveyAnswer[] = ["yes", "no", "maybe"];

@Entity("survey_responses", {schema: "surveyor"})
export class SurveyResponse extends DefaultNumericEntityItemAssignment {
    @Column("simple-enum", {
        name: "answer",
        enum: SURVEY_ANSWERS,
        default: "no",
    })
    answer!: SurveyAnswer;

    @RelationId((a: SurveyResponse) => a.item)
    itemId!: string;

    @ManyToOne(
        () => SurveyCombination,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: SurveyCombination;

    @RelationId((a: SurveyResponse) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => Survey,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: Survey;
}
