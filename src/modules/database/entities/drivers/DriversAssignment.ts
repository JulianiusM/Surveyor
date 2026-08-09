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

import {Entity, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {DriversItem} from "./DriversItem";
import {DriversList} from "./DriversList";

@Entity("drivers_assignments", {schema: "surveyor"})
export class DriversAssignment extends DefaultNumericEntityItemAssignment {
    @RelationId((a: DriversAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => DriversItem,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: DriversItem;

    @RelationId((a: DriversAssignment) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => DriversList,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: DriversList;
}
