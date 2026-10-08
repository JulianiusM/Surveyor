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

import {Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultEntity} from "../abstract/BaseEntity";
import {Event} from "../event/Event";
import {PackingAssignment} from "./PackingAssignment";
import {PackingItem} from "./PackingItem";

@Entity("packing_lists", {schema: "surveyor"})
export class PackingList extends DefaultEntity {
    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.entity
    )
    packingAssignments!: PackingAssignment[];

    @OneToMany(() => PackingItem, (packingItems) => packingItems.entity)
    packingItems!: PackingItem[];

    @RelationId((pl: PackingList) => pl.event)
    eventId?: string;

    @ManyToOne(() => Event, (event) => event.packingLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;

    @OneToMany(() => PackingItem, (item) => item.entity)
    items: PackingItem[];

    @OneToMany(() => PackingAssignment, (assignment) => assignment.entity)
    assignments: PackingAssignment[];
}
