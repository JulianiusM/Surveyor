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
