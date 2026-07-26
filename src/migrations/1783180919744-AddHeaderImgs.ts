import {MigrationInterface, QueryRunner} from "typeorm";
import {columnExists} from "../modules/database/utils/migration-helper";

export class AddHeaderImgs1783180919744 implements MigrationInterface {
    name = 'AddHeaderImgs1783180919744'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            "drivers_lists",
            "packing_lists",
            "events",
            "activity_plans",
            "surveys",
        ];

        for (const table of tables) {
            const exists = await columnExists(queryRunner, table, "header_img");

            if (!exists) {
                await queryRunner.query(
                    `ALTER TABLE \`${table}\`
                        ADD \`header_img\` varchar(255) NULL`
                );
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            "surveys",
            "activity_plans",
            "events",
            "packing_lists",
            "drivers_lists",
        ];

        for (const table of tables) {
            const exists = await columnExists(queryRunner, table, "header_img");

            if (exists) {
                await queryRunner.query(
                    `ALTER TABLE \`${table}\` DROP COLUMN \`header_img\``
                );
            }
        }
    }
}
