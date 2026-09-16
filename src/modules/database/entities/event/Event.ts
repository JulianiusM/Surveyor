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

import {Column, Entity, Index, OneToMany} from "typeorm";
import {BaseEntity} from "../abstract/BaseEntity";
import {ActivityPlan} from "../activity/ActivityPlan";
import {DriversList} from "../drivers/DriversList";
import {PackingList} from "../packing/PackingList";
import {EventRegBypassLink} from "./EventRegBypassLink";
import {EventRegistration} from "./EventRegistration";

@Entity("events", {schema: "surveyor"})
// The sweep filters archive/pause state and advances through (endDate, id) batches.
@Index("idx_events_auto_archive", ["archivedAt", "autoArchivePaused", "endDate", "id"])
export class Event extends BaseEntity {
    /**
     * Explicit organizer override; date changes do not silently clear it.
     * Manual restoration sets the pause in the same write as clearing archivedAt,
     * preventing the hourly sweep from immediately archiving an expired event again.
     * Attached entities inherit this event's eventual archive state without a copied flag.
     */
    @Column("boolean", {name: "auto_archive_paused", default: false})
    autoArchivePaused!: boolean;

    @Column("date", {name: "start_date"})
    startDate!: string; // YYYY-MM-DD

    @Column("date", {name: "end_date"})
    endDate!: string; // YYYY-MM-DD

    @Column("varchar", {name: "location", length: 255, nullable: true})
    location?: string | null;

    @Column("timestamp", {name: "binding_deadline", nullable: true})
    bindingDeadline?: string | null;

    @Column("varchar", {name: "timezone", length: 255, nullable: true})
    timezone?: string | null;

    @Column("tinyint", {
        name: "require_dietary_info",
        default: 0
    })
    requireDietaryInfo!: boolean;

    @Column("tinyint", {
        name: "allow_diet_comment",
        default: 0
    })
    allowDietComment!: boolean;

    @Column("tinyint", {
        name: "allow_reg_date_update",
        default: 0
    })
    allowRegDateUpdatesAfterDeadline!: boolean;

    @Column("tinyint", {
        name: "allow_reg_cancel",
        default: 0
    })
    allowRegCancelationAfterDeadline!: boolean;

    @Column("tinyint", {
        name: "allow_reg_diet_update",
        default: 0
    })
    allowRegDietUpdateAfterDeadline!: boolean;

    @Column("int", {name: "max_participants", nullable: true})
    maxParticipants?: number | null;

    @OneToMany(() => EventRegistration, (r) => r.event)
    registrations: EventRegistration[];

    @OneToMany(() => ActivityPlan, (p) => p.event)
    activityPlans: ActivityPlan[];

    @OneToMany(() => PackingList, (l) => l.event)
    packingLists: PackingList[];

    @OneToMany(() => DriversList, (d) => d.event)
    driversLists: DriversList[];

    @OneToMany(() => EventRegBypassLink, (d) => d.event)
    eventRegBypassLinks: EventRegBypassLink[];
}
