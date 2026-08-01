// src/modules/database/entities/event/EventRegBypassLink.ts
import {Column, Entity, Index, JoinColumn, ManyToOne, RelationId} from 'typeorm';
import {UuidProfileBase} from "../abstract/Base";
import {Event} from "./Event";

@Entity('event_reg_links')
@Index('uk_event_token', ['event', 'token'], {unique: true})
export class EventRegBypassLink extends UuidProfileBase {
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

    @Column('timestamp', {name: 'used_at', nullable: true})
    usedAt?: Date | null;

    @RelationId((a: EventRegBypassLink) => a.event)
    eventId!: string;

    @ManyToOne(() => Event, (events) => events.eventRegBypassLinks, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;
}
