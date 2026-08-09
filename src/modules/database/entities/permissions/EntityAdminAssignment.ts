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