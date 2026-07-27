import {BeforeInsert, BeforeUpdate, Column, Entity, Index, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignment} from "../activity/ActivityAssignment";
import {ActivityPlan} from "../activity/ActivityPlan";
import {ActivityPlanRequirementOverride} from "../activity/ActivityPlanRequirementOverride";
import {ActivitySlot} from "../activity/ActivitySlot";
import {DriversAssignment} from "../drivers/DriversAssignment";
import {DriversItem} from "../drivers/DriversItem";
import {DriversList} from "../drivers/DriversList";
import {Event} from "../event/Event";
import {EventRegBypassLink} from "../event/EventRegBypassLink";
import {EventRegistration} from "../event/EventRegistration";
import {PackingAssignment} from "../packing/PackingAssignment";
import {PackingItem} from "../packing/PackingItem";
import {PackingList} from "../packing/PackingList";
import {EntityAdminAssignment} from "../permissions/EntityAdminAssignment";
import {Survey} from "../surveys/Survey";
import {SurveyResponse} from "../surveys/SurveyResponse";

@Index("email", ["email"], {unique: true})
@Index("username", ["username"], {unique: true})
@Entity("users", {schema: "surveyor"})
export class User {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "username", unique: true, length: 50})
    username!: string;

    @Column("varchar", {name: "name", length: 50})
    name!: string;

    @Column("varchar", {name: "email", unique: true, length: 100})
    email!: string;

    @Column("varchar", {name: "PASSWORD", nullable: true, length: 255})
    password?: string | null;

    @Column("tinyint", {
        name: "is_active",
        nullable: true,
        default: 0
    })
    isActive?: boolean | null;

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

    @Column("varchar", {name: "activation_token", nullable: true, length: 255})
    activationToken?: string | null;

    @Column("datetime", {name: "activation_token_expiration", nullable: true})
    activationTokenExpiration?: Date | null;

    @Column("varchar", {name: "reset_token", nullable: true, length: 255})
    resetToken?: string | null;

    @Column("datetime", {name: "reset_token_expiration", nullable: true})
    resetTokenExpiration?: Date | null;

    @Column('varchar', {name: 'oidc_sub', nullable: true, length: 255})
    oidcSub?: string | null;

    @Column('varchar', {name: 'oidc_issuer', nullable: true, length: 255})
    oidcIssuer?: string | null;

    @OneToMany(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.user
    )
    activityAssignments: ActivityAssignment[];

    @OneToMany(() => ActivitySlot, (activitySlots) => activitySlots.user)
    activitySlots: ActivitySlot[];

    @OneToMany(() => ActivityPlan, (activityPlans) => activityPlans.owner)
    activityPlans: ActivityPlan[];

    @OneToMany(
        () => DriversAssignment,
        (driversAssignments) => driversAssignments.user
    )
    driversAssignments: DriversAssignment[];

    @OneToMany(() => DriversItem, (driversItems) => driversItems.user)
    driversItems: DriversItem[];

    @OneToMany(() => DriversList, (driversLists) => driversLists.owner)
    driversLists: DriversList[];

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.user
    )
    packingAssignments: PackingAssignment[];

    @OneToMany(() => PackingItem, (packingItems) => packingItems.user)
    packingItems: PackingItem[];

    @OneToMany(() => PackingList, (packingLists) => packingLists.owner)
    packingLists: PackingList[];

    @OneToMany(() => SurveyResponse, (surveyResponses) => surveyResponses.user)
    surveyResponses: SurveyResponse[];

    @OneToMany(() => Survey, (surveys) => surveys.owner)
    surveys: Survey[];

    @OneToMany(() => Event, (event) => event.owner)
    events: Event[];

    @OneToMany(() => EventRegistration, (eventRegistration) => eventRegistration.user)
    eventRegistrations: EventRegistration[];

    @OneToMany(() => EntityAdminAssignment, (entityAdminAssignments) => entityAdminAssignments.user)
    entityAdminAssignments: EntityAdminAssignment[];

    @OneToMany(() => EventRegBypassLink, (link) => link.user)
    eventRegBypassLinksUsed: EventRegBypassLink[];

    @OneToMany(
        () => ActivityPlanRequirementOverride,
        (activityPlanRequirementOverrides) => activityPlanRequirementOverrides.user
    )
    activityPlanRequirementOverrides: ActivityPlanRequirementOverride[];

    @BeforeInsert()
    @BeforeUpdate()
    private ensureName() {
        if (!this.name || this.name === "") {
            this.name = this.username;
        }
    }
}
