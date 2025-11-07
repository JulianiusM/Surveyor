import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,} from "typeorm";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {SurveyCombination} from "./SurveyCombination";
import {Survey} from "./Survey";
import type {SurveyAnswer} from "../../../../types/SurveyTypes";

@Index("responses_ibfk_1", ["userId"], {})
@Index("responses_ibfk_2", ["guestId"], {})
@Index("responses_ibfk_3", ["combinationId"], {})
@Index("responses_surveys_id_fk", ["surveyId"], {})
@Entity("survey_responses", {schema: "surveyor"})
export class SurveyResponse {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("int", {name: "user_id", nullable: true})
    userId: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId: number | null;

    @Column("varchar", {name: "survey_id"})
    surveyId: string;

    @Column("int", {name: "combination_id"})
    combinationId: number;

    @Column("simple-enum", {
        name: "answer",
        enum: ["yes", "no", "maybe"],
        default: "no",
    })
    answer: SurveyAnswer;

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

    @ManyToOne(() => User, (users) => users.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user: User;

    @ManyToOne(() => Guest, (guests) => guests.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;

    @ManyToOne(
        () => SurveyCombination,
        (surveyCombinations) => surveyCombinations.surveyResponses,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "combination_id", referencedColumnName: "id"}])
    combination: SurveyCombination;

    @ManyToOne(() => Survey, (surveys) => surveys.surveyResponses, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "survey_id", referencedColumnName: "id"}])
    survey: Survey;
}
