/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// src/modules/database/entities/common/EntityPermissions.ts
import {Column, Entity, Index} from "typeorm";
import type {Audience} from "../../../../types/PermissionTypes";
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
