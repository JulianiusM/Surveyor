import {Entity, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {DriversItem} from "./DriversItem";
import {DriversList} from "./DriversList";

@Entity("drivers_assignments", {schema: "surveyor"})
export class DriversAssignment extends DefaultNumericEntityItemAssignment {
    @RelationId((a: DriversAssignment) => a.entity)
    entityId!: string;

    @RelationId((a: DriversAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => DriversItem,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: DriversItem;

    @ManyToOne(
        () => DriversList,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: DriversList;
}
