import {Column, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {EntityBase} from "../../../../types/UserTypes";
import {Profile} from "../user/Profile";
import {BaseEntityItem} from "./BaseEntityItem";
import type {EntityItemAssignment} from "./ProfileEntityItemAssignment";
import {UuidBase} from "./TrackedBase";

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

export abstract class BaseEntity extends UuidBase implements EntityBase {
    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("varchar", {name: "header_img", length: 255, nullable: true})
    headerImg?: string | null;

    @RelationId((a: BaseEntity) => a.owner)
    ownerId!: string;

    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: Profile;
}

export abstract class DefaultEntity extends BaseEntity implements DefaultRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract items: BaseEntityItem[];
}