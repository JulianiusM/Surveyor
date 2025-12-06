import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId, Unique} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityRole} from "./ActivityRole";

@Unique("unique_act_ass_role_map", ["assignment", "role"])
@Entity("activity_assignment_roles", {schema: "surveyor"})
export class ActivityAssignmentRole {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

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

    @RelationId((aa: ActivityAssignmentRole) => aa.assignment)
    assignmentId!: number;

    @ManyToOne(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.activityAssignmentRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "assignment_id", referencedColumnName: "id"}])
    assignment!: ActivityAssignment;

    @RelationId((aa: ActivityAssignmentRole) => aa.role)
    roleId!: number;

    @ManyToOne(() => ActivityRole, (roles) => roles.activityAssignmentRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;
}
