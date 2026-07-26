import {MigrationInterface, QueryRunner} from "typeorm";
import {columnExists} from "../modules/database/utils/migration-helper";

export class AddDietaryComment1784007497812 implements MigrationInterface {
    name = 'AddDietaryComment1784007497812'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await columnExists(queryRunner, "events", "allow_diet_comment")) {
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
        if (await columnExists(queryRunner, "events", "allow_diet_comment")) {
            await queryRunner.query(`ALTER TABLE \`events\` DROP COLUMN \`allow_diet_comment\``);
        }
    }

}
