import {JoinColumn, ManyToOne, RelationId} from "typeorm";
import {Profile} from "../user/Profile";
import {NumericBase, UuidBase} from "./TrackedBase";

export abstract class NumericProfileBase extends NumericBase {
    @RelationId((a: NumericProfileBase) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}

export abstract class UuidProfileBase extends UuidBase {
    @RelationId((a: UuidProfileBase) => a.profile)
    profileId!: string;

    @ManyToOne(() => Profile, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn({name: "profile_id", referencedColumnName: "id"})
    profile!: Profile;
}