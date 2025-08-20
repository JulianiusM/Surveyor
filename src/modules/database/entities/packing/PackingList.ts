import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany,} from "typeorm";
import {PackingAssignment} from "./PackingAssignment";
import {PackingItem} from "./PackingItem";
import {User} from "../user/User";

@Index("fk_packing_list_user", ["ownerId"], {})
@Entity("packing_lists", {schema: "surveyor"})
export class PackingList {
    @Column("char", {
        primary: true,
        name: "id",
        length: 36,
        default: () => "'UUID()'",
    })
    id: string;

    @Column("int", {name: "owner_id"})
    ownerId: number;

    @Column("varchar", {name: "title", length: 255})
    title: string;

    @Column("text", {name: "description", nullable: true})
    description: string | null;

    @Column("tinyint", {
        name: "allow_guest_add",
        width: 1,
        default: () => "'0'",
    })
    allowGuestAdd: boolean;

    @Column("tinyint", {name: "guest_manage", width: 1, default: () => "'0'"})
    guestManage: boolean;

    @Column("timestamp", {
        name: "created_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date | null;

    @Column("timestamp", {
        name: "updated_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.list
    )
    packingAssignments: PackingAssignment[];

    @OneToMany(() => PackingItem, (packingItems) => packingItems.list)
    packingItems: PackingItem[];

    @ManyToOne(() => User, (users) => users.packingLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner: User;
}
