// src/modules/database/entities/common/EntityPermissions.ts
import {Column, Entity, Index} from "typeorm";
import {Audience} from "../../../../types/PermissionTypes";
import type {CombEntityType} from "../../../../types/UtilTypes";
import {NumericBase} from "../abstract/TrackedBase";

export const ENTITY_PERM_AUDIENCE: Audience[] = ["participant", "guest", "authenticated", "public"];

@Entity("entity_permissions")
@Index("uk_entity_perm_audience", ["entityType", "entityId", "audience"], {unique: true})
export class EntityPermissions extends NumericBase {
    @Column("varchar", {name: "entity_type", length: 32})
    entityType!: CombEntityType;

    @Column("char", {name: "entity_id", length: 36})
    entityId!: string;

    @Column("enum", {name: "audience", enum: ENTITY_PERM_AUDIENCE})
    audience!: Audience;

    @Column("int", {name: "perms", unsigned: true, default: () => "0"})
    perms!: number;
}
