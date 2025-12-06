import {MigrationInterface, QueryRunner} from "typeorm";

export class CreateAssignmentRecommendations1753400000001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_assignment_recommendations (
                id CHAR(36) NOT NULL,
                plan_id CHAR(36) NOT NULL,
                slot_id CHAR(36) NOT NULL,
                user_id INT NULL,
                guest_id INT NULL,
                status ENUM('PENDING', 'APPROVED', 'APPLIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT pk_activity_assignment_recommendations PRIMARY KEY (id),
                CONSTRAINT fk_aar_plan FOREIGN KEY (plan_id) REFERENCES activity_plans(id) ON DELETE CASCADE,
                CONSTRAINT fk_aar_slot FOREIGN KEY (slot_id) REFERENCES activity_slots(id) ON DELETE CASCADE,
                CONSTRAINT fk_aar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_aar_guest FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL,
                CONSTRAINT chk_aar_participant CHECK (
                    (user_id IS NOT NULL AND guest_id IS NULL) OR
                    (user_id IS NULL AND guest_id IS NOT NULL)
                )
            );
        `);

        // Note: Indexes for foreign keys are created automatically by MySQL/MariaDB
        // No need to explicitly create idx_aar_plan and idx_aar_slot
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // No need to drop indexes explicitly - they will be dropped with the table
        await queryRunner.query(`DROP TABLE IF EXISTS activity_assignment_recommendations;`);
    }
}
