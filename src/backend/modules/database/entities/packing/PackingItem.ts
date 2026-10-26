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

import {Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {UuidDefaultEntityItem} from "../abstract/ProfileEntityItem";
import {PackingAssignment} from "./PackingAssignment";
import {PackingList} from "./PackingList";

@Entity("packing_items", {schema: "surveyor"})
export class PackingItem extends UuidDefaultEntityItem {
    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: 1,
    })
    maxAssignees?: number | null;

    @Column("tinyint", {
        name: "required_by_all",
        default: 0
    })
    requiredByAll!: boolean;

    @Column("int", {name: "pos", default: 0})
    pos!: number;

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.item
    )
    assignments!: PackingAssignment[];

    @RelationId((a: PackingItem) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => PackingList,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: PackingList;
}
