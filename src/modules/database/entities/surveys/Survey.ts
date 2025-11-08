import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {SurveyCombination} from "./SurveyCombination";
import {SurveyResponse} from "./SurveyResponse";
import {User} from "../user/User";

@Entity("surveys", {schema: "surveyor"})
export class Survey {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

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
    surveyCombinations!: SurveyCombination[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.survey)
    surveyResponses!: SurveyResponse[];

    @RelationId((a: Survey) => a.owner)
    ownerId!: number;

    @ManyToOne(() => User, (users) => users.surveys, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: User;
}
