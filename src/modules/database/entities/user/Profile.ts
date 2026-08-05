import {Column, Entity, JoinColumn, ManyToOne, OneToOne, RelationId} from "typeorm";
import type {ProfileType} from "../../../../types/UserTypes";
import {UuidBase} from "../abstract/TrackedBase";
import {Guest} from "./Guest";
import {User} from "./User";

export const PROFILE_TYPES: ProfileType[] = ["user", "guest"];

@Entity("profiles", {schema: "surveyor"})
export class Profile extends UuidBase {
    @Column("varchar", {name: "name", length: 50})
    name!: string;

    @Column("simple-enum", {name: "type", enum: PROFILE_TYPES})
    type!: ProfileType;

    @RelationId((profile: Profile) => profile.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.profiles, {
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((profile: Profile) => profile.guest)
    guestId?: string;

    @OneToOne(() => Guest, (guests) => guests.profile, {
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;
}