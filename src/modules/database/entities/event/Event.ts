import {Column, Entity, Index, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {ActivityPlan} from "../activity/ActivityPlan";
import {PackingList} from "../packing/PackingList";
import {DriversList} from "../drivers/DriversList";
import {EventRegistration} from "./EventRegistration";
// import related entities lazily to avoid circular deps
// import { ActivityPlan } from "../activity/ActivityPlan";
// import { PackingList } from "../packing/PackingList";

@Index("owner_id", ["ownerId"], {})
@Entity("events", {schema: "surveyor"})
export class Event {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string; // UUID (use generateUniqueId())

    @Column("int", {name: "owner_id"})
    ownerId!: number;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

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

    @Column("tinyint", {name: "require_dietary_info", width: 1, default: 0})
    requireDietaryInfo: boolean;

    @Column("int", {name: "max_participants", nullable: true})
    maxParticipants: number | null;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;

    @Column("timestamp", {name: "updated_at", default: () => "CURRENT_TIMESTAMP"})
    updatedAt!: Date;

    @OneToMany(() => EventRegistration, (r) => r.event)
    registrations: EventRegistration[];

    @OneToMany(() => ActivityPlan, (p) => p.event)
    activityPlans: ActivityPlan[];

    @OneToMany(() => PackingList, (l) => l.event)
    packingLists: PackingList[];

    @OneToMany(() => DriversList, (d) => d.event)
    driversLists: DriversList[];
}
