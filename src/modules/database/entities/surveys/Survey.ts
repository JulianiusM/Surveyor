import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany,} from "typeorm";
import {SurveyCombination} from "./SurveyCombination";
import {SurveyResponse} from "./SurveyResponse";
import {User} from "../user/User";

@Index("surveys_owner_id_user_id_fk", ["ownerId"], {})
@Entity("surveys", {schema: "surveyor"})
export class Survey {
    @Column("char", {
        primary: true,
        name: "id",
        length: 36,
        default: () => "'UUID()'",
    })
    id: string;

    @Column("int", {name: "owner_id"})
    ownerId: number;

    @Column("varchar", {name: "title", length: 255})
    title: string;

    @Column("text", {name: "description", nullable: true})
    description: string | null;

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

    @OneToMany(
        () => SurveyCombination,
        (surveyCombinations) => surveyCombinations.survey
    )
    surveyCombinations: SurveyCombination[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.survey)
    surveyResponses: SurveyResponse[];

    @ManyToOne(() => User, (users) => users.surveys, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner: User;
}
