import {Column, Entity, Index, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignmentRole} from "../activity/ActivityAssignmentRole";
import {ActivitySlotRole} from "../activity/ActivitySlotRole";

@Index("name", ["name"], {unique: true})
@Entity("roles", {schema: "surveyor"})
export class Role {
    @PrimaryGeneratedColumn({type: "smallint", name: "id"})
    id: number;

    @Column("varchar", {name: "name", unique: true, length: 50})
    name: string;

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
}
