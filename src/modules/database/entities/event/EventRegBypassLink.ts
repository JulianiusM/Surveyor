/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
