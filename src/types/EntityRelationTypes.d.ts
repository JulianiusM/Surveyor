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

import type {BaseEntity} from '../backend/modules/database/entities/abstract/BaseEntity';
import type {BaseEntityItem} from '../backend/modules/database/entities/abstract/BaseEntityItem';
import type {DefaultNumericEntityItemAssignment, DefaultUuidEntityItemAssignment} from '../backend/modules/database/entities/abstract/ProfileEntityItemAssignment';
import type {NumericProfileBase, UuidProfileBase} from '../backend/modules/database/entities/abstract/Base';


export interface ChildItemRelation {
    items: BaseEntityItem[];
}

export interface ChildAssigmentRelation {
    assignments: EntityItemAssignment[];
}

export interface DefaultRelationEntity extends ChildItemRelation, ChildAssigmentRelation {
}

export interface ParentEntityRelation {
    entityId: string;
    entity: BaseEntity;
}

export interface ParentItemRelation {
    itemId: string;
    item: BaseEntityItem;
}

export interface DefaultItemRelationEntity extends ParentEntityRelation, ChildAssigmentRelation {
}

export interface DefaultItemAssignmentRelationEntity extends ParentEntityRelation, ParentItemRelation {
}

export type EntityItemAssignment = NumericProfileBase | UuidProfileBase;

export type DefaultEntityItemAssignment = DefaultNumericEntityItemAssignment | DefaultUuidEntityItemAssignment;
