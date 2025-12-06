import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class AddArrivalDepartureFlags1753400000002 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("activity_plans", [
            new TableColumn({
                name: "allow_arrival_day_evening",
                type: "tinyint",
                width: 1,
                default: 1,
                isNullable: false,
            }),
            new TableColumn({
                name: "allow_departure_day_morning",
                type: "tinyint",
                width: 1,
                default: 1,
                isNullable: false,
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("activity_plans", "allow_departure_day_morning");
        await queryRunner.dropColumn("activity_plans", "allow_arrival_day_evening");
    }
}
