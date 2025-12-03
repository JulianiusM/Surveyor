import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId, Unique} from "typeorm";
import {User} from "../user/User";
import type {CombEntityType} from "../../../../types/UtilTypes";

@Entity("entity_admin_assignments")
@Unique("uk_entity_admin_assignment_user", ["entityType", "entityId", "user"])
export class EntityAdminAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "entity_type", length: 32})
    entityType!: CombEntityType;

    @Column("char", {name: "entity_id", length: 36})
    entityId!: string;

    @Column("int", {name: "perms", unsigned: true, default: () => "0"})
    perms!: number;

    @Column("int", {name: "created_by", nullable: true})
    createdBy?: number | null;

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

    @RelationId((ea: EntityAdminAssignment) => ea.user)
    userId!: number;

    @ManyToOne(() => User, (users) => users.entityAdminAssignments, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user!: User;
}