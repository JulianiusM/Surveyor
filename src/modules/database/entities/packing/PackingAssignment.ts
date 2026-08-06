import {Entity, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {PackingItem} from "./PackingItem";
import {PackingList} from "./PackingList";

@Entity("packing_assignments", {schema: "surveyor"})
export class PackingAssignment extends DefaultNumericEntityItemAssignment {
    @RelationId((a: PackingAssignment) => a.entity)
    entityId!: string;

    @RelationId((a: PackingAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => PackingItem,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: PackingItem;

    @ManyToOne(
        () => PackingList,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: PackingList;
}
