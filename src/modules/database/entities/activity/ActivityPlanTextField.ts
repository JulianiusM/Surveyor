import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {ActivityPlan} from "./ActivityPlan";

@Entity("activity_plan_text_fields", {schema: "surveyor"})
export class ActivityPlanTextField {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "text", nullable: true})
    text?: string | null;

    @RelationId((t: ActivityPlanTextField) => t.plan)
    planId!: string;

    @ManyToOne(() => ActivityPlan, (plan) => plan.textFields, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

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
}
