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
