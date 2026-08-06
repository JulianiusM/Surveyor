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
