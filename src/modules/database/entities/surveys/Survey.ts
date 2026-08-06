import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import type {EntityBase} from "../../../../types/UserTypes";
import {User} from "../user/User";
import {SurveyCombination} from "./SurveyCombination";
import {SurveyResponse} from "./SurveyResponse";

@Entity("surveys", {schema: "surveyor"})
export class Survey implements EntityBase {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("varchar", {name: "header_img", length: 255, nullable: true})
    headerImg?: string | null;

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

    @ManyToOne(() => User, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: User;
}
