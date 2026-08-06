import {Column, Entity, OneToMany} from "typeorm";
import {BaseEntity} from "../abstract/BaseEntity";
import {ActivityPlan} from "../activity/ActivityPlan";
import {DriversList} from "../drivers/DriversList";
import {PackingList} from "../packing/PackingList";
import {EventRegBypassLink} from "./EventRegBypassLink";
import {EventRegistration} from "./EventRegistration";

@Entity("events", {schema: "surveyor"})
export class Event extends BaseEntity {
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
