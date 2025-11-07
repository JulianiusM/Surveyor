import {BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne} from "typeorm";
import {Guest} from "./Guest";
import {randomBytes} from "node:crypto";

@Index("uk_token", ["token"], {unique: true})
@Entity("guest_links", {schema: "surveyor"})
export class GuestLink {
    @Column("int", {primary: true, name: "guest_id"})
    guestId: number;

    @Column("varchar", {primary: true, name: "entity_type", length: 20})
    entityType: string;

    @Column("varchar", {primary: true, name: "entity_id", length: 36})
    entityId: string;

    @Column("varchar", {name: "token", unique: true, length: 255})
    token!: string;

    @Column("timestamp", {
        name: "created_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date;

    @ManyToOne(() => Guest, (guests) => guests.guestLinks, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;

    @BeforeInsert()
    private ensureToken() {
        if (!this.token || this.token.trim() === '') {
            // 32 bytes → 64 hex chars (fits in length 255, deterministic and URL-safe enough for your use)
            this.token = randomBytes(32).toString('hex');
        }
    }
}
