import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class AddActivitySlotArrivalDepartureFlags1733587200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if columns already exist to make migration idempotent
        const table = await queryRunner.getTable("activity_slots");
        
        if (table && !table.findColumnByName("is_arrival_evening")) {
            await queryRunner.addColumn(
                "activity_slots",
                new TableColumn({
                    name: "is_arrival_evening",
                    type: "tinyint",
                    width: 1,
                    isNullable: true,
                })
            );
        }

        if (table && !table.findColumnByName("is_departure_morning")) {
            await queryRunner.addColumn(
                "activity_slots",
                new TableColumn({
                    name: "is_departure_morning",
                    type: "tinyint",
                    width: 1,
                    isNullable: true,
                })
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("activity_slots");
        
        if (table && table.findColumnByName("is_departure_morning")) {
            await queryRunner.dropColumn("activity_slots", "is_departure_morning");
        }

        if (table && table.findColumnByName("is_arrival_evening")) {
            await queryRunner.dropColumn("activity_slots", "is_arrival_evening");
        }
    }
}
