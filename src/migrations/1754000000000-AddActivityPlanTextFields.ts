import {MigrationInterface, QueryRunner} from "typeorm";

export class AddActivityPlanTextFields1754000000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_plan_text_fields (
                id CHAR(36) NOT NULL,
                title VARCHAR(255) NOT NULL,
                text TEXT NULL,
                plan_id CHAR(36) NOT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_activity_plan_text_fields_plan_id (plan_id),
                CONSTRAINT fk_activity_plan_text_fields_plan
                    FOREIGN KEY (plan_id) REFERENCES activity_plans (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS activity_plan_text_fields`);
    }

}
