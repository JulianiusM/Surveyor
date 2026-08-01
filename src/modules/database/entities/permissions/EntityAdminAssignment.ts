import {Column, Entity, Unique} from "typeorm";
import type {CombEntityType} from "../../../../types/UtilTypes";
import {NumericProfileBase} from "../abstract/Base";

@Entity("entity_admin_assignments")
@Unique("uk_entity_admin_assignment_user", ["entityType", "entityId", "profile"])
export class EntityAdminAssignment extends NumericProfileBase {
    @Column("varchar", {name: "entity_type", length: 32})
    entityType!: CombEntityType;

    @Column("char", {name: "entity_id", length: 36})
    entityId!: string;

    @Column("int", {name: "perms", unsigned: true, default: () => "0"})
    perms!: number;

    @Column("int", {name: "created_by", nullable: true})
    createdBy?: number | null;
}