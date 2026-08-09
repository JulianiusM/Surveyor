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
import {DriversAssignment} from "./DriversAssignment";
import {DriversList} from "./DriversList";

@Entity("drivers_items", {schema: "surveyor"})
export class DriversItem extends UuidDefaultEntityItem {
    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: () => "'1'",
    })
    maxAssignees?: number | null;

    @Column("int", {name: "pos", default: 0})
    pos!: number;

    @OneToMany(
        () => DriversAssignment,
        (assignment) => assignment.item
    )
    assignments!: DriversAssignment[];

    @RelationId((a: DriversItem) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => DriversList,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: DriversList;
}
