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
