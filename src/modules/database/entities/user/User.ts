import {BeforeInsert, BeforeUpdate, Column, Entity, Index, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {TrackedBase} from "../abstract/TrackedBase";
import {Profile} from "./Profile";

@Index("email", ["email"], {unique: true})
@Index("username", ["username"], {unique: true})
@Entity("users", {schema: "surveyor"})
export class User extends TrackedBase {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "username", unique: true, length: 50})
    username!: string;

    @Column("varchar", {name: "name", length: 50})
    name!: string;

    @Column("varchar", {name: "email", unique: true, length: 100})
    email!: string;

    @Column("varchar", {name: "PASSWORD", nullable: true, length: 255})
    password?: string | null;

    @Column("tinyint", {
        name: "is_active",
        nullable: true,
        default: 0
    })
    isActive?: boolean | null;

    @Column("varchar", {name: "activation_token", nullable: true, length: 255})
    activationToken?: string | null;

    @Column("datetime", {name: "activation_token_expiration", nullable: true})
    activationTokenExpiration?: Date | null;

    @Column("varchar", {name: "reset_token", nullable: true, length: 255})
    resetToken?: string | null;

    @Column("datetime", {name: "reset_token_expiration", nullable: true})
    resetTokenExpiration?: Date | null;

    @Column('varchar', {name: 'oidc_sub', nullable: true, length: 255})
    oidcSub?: string | null;

    @Column('varchar', {name: 'oidc_issuer', nullable: true, length: 255})
    oidcIssuer?: string | null;

    @OneToMany(() => Profile, (profile) => profile.user)
    profiles: Profile[];

    @BeforeInsert()
    @BeforeUpdate()
    private ensureName() {
        if (!this.name || this.name === "") {
            this.name = this.username;
        }
    }
}
