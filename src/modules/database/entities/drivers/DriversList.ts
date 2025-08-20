import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {DriversAssignment} from "./DriversAssignment";
import {DriversItem} from "./DriversItem";
import {User} from "../user/User";

@Index("owner_id", ["ownerId"], {})
@Entity("drivers_lists", {schema: "surveyor"})
export class DriversList {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
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
        () => DriversAssignment,
        (driversAssignments) => driversAssignments.list
    )
    driversAssignments: DriversAssignment[];

    @OneToMany(() => DriversItem, (driversItems) => driversItems.list)
    driversItems: DriversItem[];

    @ManyToOne(() => User, (users) => users.driversLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner: User;
}
