import {Column, Entity, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ActivityAssignment} from "../activity/ActivityAssignment";
import {DriversAssignment} from "../drivers/DriversAssignment";
import {DriversItem} from "../drivers/DriversItem";
import {GuestLink} from "./GuestLink";
import {PackingAssignment} from "../packing/PackingAssignment";
import {SurveyResponse} from "../surveys/SurveyResponse";
import {EventRegistration} from "../event/EventRegistration";
import {EventRegBypassLink} from "../event/EventRegBypassLink";
import {ActivityPlanRequirementOverride} from "../activity/ActivityPlanRequirementOverride";

@Entity("guests", {schema: "surveyor"})
export class Guest {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "username", length: 50})
    username!: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email?: string | null;

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
