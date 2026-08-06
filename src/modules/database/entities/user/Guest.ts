import {Column, Entity, OneToOne} from "typeorm";
import {UuidBase} from "../abstract/TrackedBase";
import {Profile} from "./Profile";

@Entity("guests", {schema: "surveyor"})
export class Guest extends UuidBase {
    @Column("varchar", {name: "username", length: 50})
    username!: string;

    @Column("varchar", {name: "email", nullable: true, length: 100})
    email?: string | null;

    @Column("varchar", {name: "token", unique: true, length: 255})
    token!: string;

    @OneToOne(() => Profile, (profile) => profile.guest)
    profile!: Profile;
}
