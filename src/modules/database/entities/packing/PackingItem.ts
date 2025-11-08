import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn,} from "typeorm";
import {PackingAssignment} from "./PackingAssignment";
import {PackingList} from "./PackingList";

@Index("fk_packing_items_list", ["listId"], {})
@Entity("packing_items", {schema: "surveyor"})
export class PackingItem {
    @PrimaryColumn("varchar", {name: "id", length: 36})
    id: string;

    @Column("varchar", {name: "list_id", length: 36})
    listId: string;

    @Column("varchar", {name: "title", length: 255})
    title: string;

    @Column("varchar", {name: "description", nullable: true, length: 255})
    description: string | null;

    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: 1,
    })
    maxAssignees: number | null;

    @Column("tinyint", {
        name: "required_by_all",
        width: 1,
        default: 0,
    })
    requiredByAll: boolean;

    @Column("int", {name: "pos", default: 0})
    pos: number;

    @Column("timestamp", {
        name: "created_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date;

    @Column("timestamp", {
        name: "updated_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.item
    )
    packingAssignments: PackingAssignment[];

    @ManyToOne(() => PackingList, (packingLists) => packingLists.packingItems, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list: PackingList;
}
