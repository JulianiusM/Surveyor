import {Entity, JoinColumn, ManyToOne, RelationId, Unique} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityRole} from "./ActivityRole";

@Unique("unique_act_ass_role_map", ["assignment", "role"])
@Entity("activity_assignment_roles", {schema: "surveyor"})
export class ActivityAssignmentRole extends NumericBase {
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

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;
}
