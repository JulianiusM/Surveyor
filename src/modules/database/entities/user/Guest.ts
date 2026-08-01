import {Column, Entity, OneToOne, PrimaryGeneratedColumn} from "typeorm";
import {Profile} from "./Profile";

@Entity("guests", {schema: "surveyor"})
export class Guest {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "username", length: 50})
    username!: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email?: string | null;

    @Column("varchar", {name: "token", unique: true, length: 255})
    token!: string;

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

    @OneToOne(() => Profile, (profile) => profile.guest)
    profile!: Profile;
}
