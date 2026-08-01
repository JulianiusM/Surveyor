import {Column} from "typeorm";
import {NumericEntityItem, UuidEntityItem} from "./BaseEntityItem";

export abstract class UuidDescriptionEntityItem extends UuidEntityItem {
    @Column("varchar", {name: "description", nullable: true, length: 255})
    description?: string | null;
}

export abstract class NumericDescriptionEntityItem extends NumericEntityItem {
    @Column("varchar", {name: "description", nullable: true, length: 255})
    description?: string | null;
}