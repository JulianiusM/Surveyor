import {Column, Entity, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ActivityAssignment} from "../activity/ActivityAssignment";
import {ActivityPlanRequirementOverride} from "../activity/ActivityPlanRequirementOverride";
import {DriversAssignment} from "../drivers/DriversAssignment";
import {DriversItem} from "../drivers/DriversItem";
import {EventRegBypassLink} from "../event/EventRegBypassLink";
import {EventRegistration} from "../event/EventRegistration";
import {PackingAssignment} from "../packing/PackingAssignment";
import {SurveyResponse} from "../surveys/SurveyResponse";

@Entity("guests", {schema: "surveyor"})
export class Guest {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "username", length: 50})
    username!: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email?: string | null;

    @Column("varchar", {name: "token", unique: true, length: 255})
    token!: string;

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

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.guest
    )
    packingAssignments: PackingAssignment[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.guest)
    surveyResponses: SurveyResponse[];

    @OneToMany(() => EventRegistration, (eventRegistration) => eventRegistration.guest)
    eventRegistrations: EventRegistration[];

    @OneToMany(() => EventRegBypassLink, (link) => link.guest)
    eventRegBypassLinksUsed: EventRegBypassLink[];

    @OneToMany(
        () => ActivityPlanRequirementOverride,
        (activityPlanRequirementOverrides) => activityPlanRequirementOverrides.guest
    )
    activityPlanRequirementOverrides: ActivityPlanRequirementOverride[];
}
