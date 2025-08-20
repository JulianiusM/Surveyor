import {Column, Entity, Index, JoinColumn, ManyToOne} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {Role} from "../user/Role";

@Index("role_id", ["roleId"], {})
@Entity("activity_assignment_roles", {schema: "surveyor"})
export class ActivityAssignmentRole {
    @Column("int", {primary: true, name: "assignment_id"})
    assignmentId: number;

    @Column("smallint", {primary: true, name: "role_id"})
    roleId: number;

    @Column("timestamp", {
        name: "created_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date | null;

    @Column("timestamp", {
        name: "updated_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date | null;

    @ManyToOne(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.activityAssignmentRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "assignment_id", referencedColumnName: "id"}])
    assignment: ActivityAssignment;

    @ManyToOne(() => Role, (roles) => roles.activityAssignmentRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role: Role;
}
