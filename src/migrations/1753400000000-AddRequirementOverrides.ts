import {MigrationInterface, QueryRunner} from "typeorm";

export class AddRequirementOverrides1753400000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_plan_requirement_overrides (
                id INT NOT NULL AUTO_INCREMENT,
                plan_id CHAR(36) NOT NULL,
                role_id INT NULL,
                user_id INT NULL,
                guest_id INT NULL,
                required_shifts SMALLINT NOT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT pk_activity_plan_requirement_overrides PRIMARY KEY (id),
                CONSTRAINT fk_apro_plan FOREIGN KEY (plan_id) REFERENCES activity_plans(id) ON DELETE CASCADE,
                CONSTRAINT fk_apro_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
                CONSTRAINT fk_apro_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_apro_guest FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE,
                CONSTRAINT chk_apro_participant CHECK (
                    (user_id IS NOT NULL AND guest_id IS NULL) OR
                    (user_id IS NULL AND guest_id IS NOT NULL)
                )
            );
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uk_apro_plan_participant_role
            ON activity_plan_requirement_overrides (plan_id, user_id, guest_id, role_id);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS uk_apro_plan_participant_role ON activity_plan_requirement_overrides;`);
        await queryRunner.query(`DROP TABLE IF EXISTS activity_plan_requirement_overrides;`);
    }

}
