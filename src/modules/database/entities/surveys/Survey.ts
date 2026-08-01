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
