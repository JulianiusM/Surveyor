// src/modules/database/entities/common/EntityPermissions.ts
import {Column, Entity, Index, PrimaryGeneratedColumn} from "typeorm";
import type {CombEntityType} from "../../../../types/UtilTypes";

@Entity("entity_permissions")
@Index("uk_entity_perm_audience", ["entityType", "entityId", "audience"], {unique: true})
export class EntityPermissions {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "entity_type", length: 32})
    entityType!: CombEntityType;

    @Column("char", {name: "entity_id", length: 36})
    entityId!: string;

    @Column("enum", {name: "audience", enum: ["participant", "guest", "authenticated", "public"]})
    audience!: "participant" | "guest" | "authenticated" | "public";

    @Column("int", {name: "perms", unsigned: true, default: () => "0"})
    perms!: number;
}
