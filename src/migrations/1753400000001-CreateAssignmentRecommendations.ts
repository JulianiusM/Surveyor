import {MigrationInterface, QueryRunner} from "typeorm";

export class CreateAssignmentRecommendations1753400000001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE activity_assignment_recommendations (
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

        await queryRunner.query(`
            CREATE INDEX idx_aar_plan ON activity_assignment_recommendations(plan_id);
        `);
        await queryRunner.query(`
            CREATE INDEX idx_aar_slot ON activity_assignment_recommendations(slot_id);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX idx_aar_slot ON activity_assignment_recommendations;`);
        await queryRunner.query(`DROP INDEX idx_aar_plan ON activity_assignment_recommendations;`);
        await queryRunner.query(`DROP TABLE activity_assignment_recommendations;`);
    }
}
