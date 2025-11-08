import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Survey} from "./Survey";
import {SurveyResponse} from "./SurveyResponse";
import type {WeekDay, WeekInMonth} from "../../../../types/SurveyTypes";

@Index("combinations_single_entry", ["weekday", "survey", "nthWeek"], {
    unique: true,
})
@Entity("survey_combinations", {schema: "surveyor"})
export class SurveyCombination {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("simple-enum", {
        name: "WEEKDAY",
        enum: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    })
    weekday: WeekDay;

    @Column("simple-enum", {name: "nth_week", enum: ["1", "2", "3", "4", "LAST"]})
    nthWeek: WeekInMonth;

    @Column("timestamp", {
        name: "created_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date;

    @Column("timestamp", {
        name: "updated_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @RelationId((c: SurveyCombination) => c.survey)
    surveyId!: string;

    @ManyToOne(() => Survey, (surveys) => surveys.surveyCombinations, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "survey_id", referencedColumnName: "id"}])
    survey!: Survey;

    @OneToMany(
        () => SurveyResponse,
        (surveyResponses) => surveyResponses.combination
    )
    surveyResponses!: SurveyResponse[];
}
