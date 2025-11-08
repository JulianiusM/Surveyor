import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {SurveyCombination} from "./SurveyCombination";
import {Survey} from "./Survey";
import type {SurveyAnswer} from "../../../../types/SurveyTypes";

@Entity("survey_responses", {schema: "surveyor"})
export class SurveyResponse {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("simple-enum", {
        name: "answer",
        enum: ["yes", "no", "maybe"],
        default: "no",
    })
    answer!: SurveyAnswer;

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

    @RelationId((c: SurveyResponse) => c.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((c: SurveyResponse) => c.guest)
    guestId?: number;

    @ManyToOne(() => Guest, (guests) => guests.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;

    @RelationId((c: SurveyResponse) => c.combination)
    combinationId!: number;

    @ManyToOne(
        () => SurveyCombination,
        (surveyCombinations) => surveyCombinations.surveyResponses,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "combination_id", referencedColumnName: "id"}])
    combination!: SurveyCombination;

    @RelationId((c: SurveyResponse) => c.survey)
    surveyId!: string;

    @ManyToOne(() => Survey, (surveys) => surveys.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "survey_id", referencedColumnName: "id"}])
    survey!: Survey;
}
