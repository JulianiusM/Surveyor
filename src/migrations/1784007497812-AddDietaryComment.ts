import {MigrationInterface, QueryRunner} from "typeorm";

export class AddDietaryComment1784007497812 implements MigrationInterface {
    name = 'AddDietaryComment1784007497812'

    private async columnExists(
        queryRunner: QueryRunner,
        table: string,
        column: string
    ): Promise<boolean> {
        const result = await queryRunner.query(
            `
                SELECT COUNT(*) as count
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = ?
                  AND COLUMN_NAME = ?
            `,
            [table, column]
        );

        return result[0].count > 0;
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await this.columnExists(queryRunner, "events", "allow_diet_comment")) {
            await queryRunner.query(`ALTER TABLE \`events\`
                ADD \`allow_diet_comment\` tinyint(1) NOT NULL DEFAULT '0'`);
        }
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\` CHANGE \`choice\` \`choice\` enum ('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES', 'COMMENT') NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE
                                 FROM \`event_registration_dietary\`
                                 WHERE \`choice\` = 'COMMENT'`);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\` CHANGE \`choice\` \`choice\` enum ('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES') NOT NULL`);
        if (await this.columnExists(queryRunner, "events", "allow_diet_comment")) {
            await queryRunner.query(`ALTER TABLE \`events\` DROP COLUMN \`allow_diet_comment\``);
        }
    }

}
