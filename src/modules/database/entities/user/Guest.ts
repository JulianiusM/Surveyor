import {Column, Entity, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ActivityAssignment} from "../activity/ActivityAssignment";
import {DriversAssignment} from "../drivers/DriversAssignment";
import {DriversItem} from "../drivers/DriversItem";
import {GuestLink} from "./GuestLink";
import {PackingAssignment} from "../packing/PackingAssignment";
import {SurveyResponse} from "../surveys/SurveyResponse";

@Entity("guests", {schema: "surveyor"})
export class Guest {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("varchar", {name: "username", length: 100})
    username: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email: string | null;

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
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.guest
    )
    activityAssignments: ActivityAssignment[];

    @OneToMany(
        () => DriversAssignment,
        (driversAssignments) => driversAssignments.guest
    )
    driversAssignments: DriversAssignment[];

    @OneToMany(() => DriversItem, (driversItems) => driversItems.guest)
    driversItems: DriversItem[];

    @OneToMany(() => GuestLink, (guestLinks) => guestLinks.guest)
    guestLinks: GuestLink[];

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.guest
    )
    packingAssignments: PackingAssignment[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.guest)
    surveyResponses: SurveyResponse[];
}
