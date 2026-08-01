// src/modules/database/entities/common/EntityPermissions.ts
import {Column, Entity, Index} from "typeorm";
import type {CombEntityType} from "../../../../types/UtilTypes";
import {NumericBase} from "../abstract/TrackedBase";

export type EntityPermAudience = "participant" | "guest" | "authenticated" | "public";
export const ENTITY_PERM_AUDIENCE = ["participant", "guest", "authenticated", "public"];

@Entity("entity_permissions")
@Index("uk_entity_perm_audience", ["entityType", "entityId", "audience"], {unique: true})
export class EntityPermissions extends NumericBase {
    @Column("varchar", {name: "entity_type", length: 32})
    entityType!: CombEntityType;

    @Column("char", {name: "entity_id", length: 36})
    entityId!: string;

    @Column("enum", {name: "audience", enum: ENTITY_PERM_AUDIENCE})
    audience!: EntityPermAudience;

    @Column("int", {name: "perms", unsigned: true, default: () => "0"})
    perms!: number;
}
