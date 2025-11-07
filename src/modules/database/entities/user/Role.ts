import {BeforeInsert, BeforeUpdate, Column, Entity, Index, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignmentRole} from "../activity/ActivityAssignmentRole";
import {ActivitySlotRole} from "../activity/ActivitySlotRole";
import {ActivityPlanRequirement} from "../activity/ActivityPlanRequirement";

@Index("name", ["name"], {unique: true})
@Entity("roles", {schema: "surveyor"})
export class Role {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("varchar", {name: "name", unique: true, length: 50})
    name!: string;

    @Column("text", {name: "description", nullable: true})
    description: string | null;

    @Column("tinyint", {name: "is_default", width: 1, default: () => "'0'"})
    isDefault: boolean;

    @OneToMany(
        () => ActivityAssignmentRole,
        (activityAssignmentRoles) => activityAssignmentRoles.role
    )
    activityAssignmentRoles: ActivityAssignmentRole[];

    @OneToMany(
        () => ActivitySlotRole,
        (activitySlotRole) => activitySlotRole.role
    )
    activitySlotRoles: ActivitySlotRole[];

    @OneToMany(
        () => ActivityPlanRequirement,
        (activityPlanRequirements) => activityPlanRequirements.role
    )
    activityPlanRequirements: ActivityPlanRequirement[];

    @BeforeInsert()
    @BeforeUpdate()
    private validateName() {
        if (!this.name || this.name.trim() === '') {
            throw new Error('Role.name is required');
        }
    }
}
