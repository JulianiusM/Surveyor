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

import {Entity, OneToMany,} from "typeorm";
import {DefaultEntity} from "../abstract/BaseEntity";
import {SurveyCombination} from "./SurveyCombination";
import {SurveyResponse} from "./SurveyResponse";

@Entity("surveys", {schema: "surveyor"})
export class Survey extends DefaultEntity {
    @OneToMany(
        () => SurveyCombination,
        (surveyCombinations) => surveyCombinations.entity
    )
    items!: SurveyCombination[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.entity)
    assignments!: SurveyResponse[];
}
