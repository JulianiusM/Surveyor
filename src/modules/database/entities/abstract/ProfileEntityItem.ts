import {JoinColumn, ManyToOne, RelationId} from "typeorm";
import {Profile} from "../user/Profile";
import type {BaseEntity, DefaultItemRelationEntity} from "./BaseEntity";
import {NumericDescriptionEntityItem, UuidDescriptionEntityItem} from "./DescriptionEntityItem";
import type {EntityItemAssignment} from "./ProfileEntityItemAssignment";

export abstract class UuidProfileEntityItem extends UuidDescriptionEntityItem {
    @RelationId((a: UuidProfileEntityItem) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class UuidDefaultEntityItem extends UuidProfileEntityItem implements DefaultItemRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract entity: BaseEntity;
    abstract entityId: string;
}

export abstract class NumericProfileEntityItem extends NumericDescriptionEntityItem {
    @RelationId((a: NumericProfileEntityItem) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class NumericDefaultEntityItem extends NumericProfileEntityItem implements DefaultItemRelationEntity {
    abstract assignments: EntityItemAssignment[];
    abstract entity: BaseEntity;
    abstract entityId: string;
}