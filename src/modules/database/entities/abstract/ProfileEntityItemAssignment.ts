import {NumericProfileBase, UuidProfileBase} from "./Base";
import type {BaseEntity, DefaultItemAssignmentRelationEntity} from "./BaseEntity";
import type {BaseEntityItem} from "./BaseEntityItem";

export abstract class DefaultNumericEntityItemAssignment extends NumericProfileBase implements DefaultItemAssignmentRelationEntity {
    abstract entity: BaseEntity;
    abstract entityId: string;
    abstract item: BaseEntityItem;
    abstract itemId: string;
}

export abstract class DefaultUuidEntityItemAssignment extends UuidProfileBase implements DefaultItemAssignmentRelationEntity {
    abstract entity: BaseEntity;
    abstract entityId: string;
    abstract item: BaseEntityItem;
    abstract itemId: string;
}

export type EntityItemAssignment = NumericProfileBase | UuidProfileBase;
export type DefaultEntityItemAssignment = DefaultNumericEntityItemAssignment | DefaultUuidEntityItemAssignment;