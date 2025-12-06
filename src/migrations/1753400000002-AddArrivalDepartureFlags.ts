import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class AddArrivalDepartureFlags1753400000002 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if columns already exist before adding (makes migration idempotent)
        const table = await queryRunner.getTable("activity_plans");
        const hasArrivalColumn = table?.columns.find(col => col.name === "allow_arrival_day_evening");
        const hasDepartureColumn = table?.columns.find(col => col.name === "allow_departure_day_morning");
        
        const columnsToAdd = [];
        
        if (!hasArrivalColumn) {
            columnsToAdd.push(new TableColumn({
                name: "allow_arrival_day_evening",
                type: "tinyint",
                width: 1,
                default: "1",
                isNullable: false,
            }));
        }
        
        if (!hasDepartureColumn) {
            columnsToAdd.push(new TableColumn({
                name: "allow_departure_day_morning",
                type: "tinyint",
                width: 1,
                default: "1",
                isNullable: false,
            }));
        }
        
        if (columnsToAdd.length > 0) {
            await queryRunner.addColumns("activity_plans", columnsToAdd);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Check if columns exist before dropping (makes migration idempotent)
        const table = await queryRunner.getTable("activity_plans");
        const hasArrivalColumn = table?.columns.find(col => col.name === "allow_arrival_day_evening");
        const hasDepartureColumn = table?.columns.find(col => col.name === "allow_departure_day_morning");
        
        if (hasDepartureColumn) {
            await queryRunner.dropColumn("activity_plans", "allow_departure_day_morning");
        }
        if (hasArrivalColumn) {
            await queryRunner.dropColumn("activity_plans", "allow_arrival_day_evening");
        }
    }
}
