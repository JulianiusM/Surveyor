import {Column, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn} from "typeorm";

export class ModifyTracking {
    @CreateDateColumn({type: "timestamp", name: "created_at"})
    createdAt: Date;

    @UpdateDateColumn({type: "timestamp", name: "updated_at"})
    updatedAt: Date;
}

export abstract class TrackedBase {
    @Column(() => ModifyTracking, {prefix: false})
    track: ModifyTracking;
}

export abstract class UuidBase extends TrackedBase {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;
}

export abstract class NumericBase extends TrackedBase {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;
}