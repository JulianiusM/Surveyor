import {Column, PrimaryGeneratedColumn} from "typeorm";
import {TrackedBase} from "./TrackedBase";

export abstract class BaseEntityItem extends TrackedBase {
    @Column("varchar", {name: "title", length: 255})
    title!: string;
}

export abstract class NumericEntityItem extends BaseEntityItem {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;
}

export abstract class UuidEntityItem extends BaseEntityItem {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;
}