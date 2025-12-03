// src/modules/database/entities/event/EventRegBypassLink.ts
import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from 'typeorm';
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {Event} from "./Event";

@Entity('event_reg_links')
@Index('uk_event_token', ['event', 'token'], {unique: true})
export class EventRegBypassLink {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column('varchar', {length: 64, name: 'token', unique: true})
    token!: string;

    @Column('int', {name: 'created_by'})
    createdBy!: number;

    @Column('smallint', {name: 'max_uses', default: () => '1'})
    maxUses!: number;

    @Column('smallint', {name: 'used_count', default: () => '0'})
    usedCount!: number;

    @Column('timestamp', {name: 'expires_at', nullable: true})
    expiresAt?: Date | null;

    @Column('timestamp', {name: 'revoked_at', nullable: true})
    revokedAt?: Date | null;

    @Column('timestamp', {name: 'created_at', default: () => 'CURRENT_TIMESTAMP'})
    createdAt!: Date;

    @Column('timestamp', {name: 'updated_at', default: () => 'CURRENT_TIMESTAMP'})
    updatedAt!: Date;

    @Column('timestamp', {name: 'used_at', nullable: true})
    usedAt?: Date | null;

    @RelationId((a: EventRegBypassLink) => a.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.eventRegBypassLinksUsed, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((a: EventRegBypassLink) => a.guest)
    guestId?: number;

    @ManyToOne(() => Guest, (guests) => guests.eventRegBypassLinksUsed, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;

    @RelationId((a: EventRegBypassLink) => a.event)
    eventId!: string;

    @ManyToOne(() => Event, (events) => events.eventRegBypassLinks, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;
}
