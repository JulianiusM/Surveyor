import {MigrationInterface, QueryRunner} from "typeorm";

export class UpdateGuestModel1780682196710 implements MigrationInterface {
    name = 'UpdateGuestModel1780682196710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`guests\`
            ADD \`token\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`guests\`
            ADD UNIQUE INDEX \`IDX_3d84b6c2d8e540af9da1cf265e\` (\`token\`)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_caa6eb650afe861c890f134afa9\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_c217003837bbf8a7b3a2c1eeb80\``);
        await queryRunner.query(`DROP INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_ccd3f1ec65169179b395e5ba903\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_dc269892d22b330ef2c60aead83\``);
        await queryRunner.query(`DROP INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP FOREIGN KEY \`FK_52165ba60768fd87815d733e562\``);
        await queryRunner.query(`DROP INDEX \`uk_event_participant\` ON \`event_registrations\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP FOREIGN KEY \`FK_febc2c20c1ea64180fa09040f28\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint(1) NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_14bcf49cc71d7f857892abbfb0e\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_d6ad3e7aaa1d11ef848f03a80e5\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_9e96938fab1057b20f085550ed0\``);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`id\` \`id\` int NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`guests\` DROP PRIMARY KEY`);
        await queryRunner.query(`ALTER TABLE \`guests\` DROP COLUMN \`id\``);
        await queryRunner.query(`ALTER TABLE \`guests\`
            ADD \`id\` varchar(36) NOT NULL PRIMARY KEY`);
        await queryRunner.query(`DROP INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_event_participant\` ON \`event_registrations\` (\`event_id\`, \`user_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\` (\`plan_id\`, \`user_id\`, \`guest_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\` (\`slot_id\`, \`guest_id\`)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_caa6eb650afe861c890f134afa9\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_c217003837bbf8a7b3a2c1eeb80\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_ccd3f1ec65169179b395e5ba903\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_dc269892d22b330ef2c60aead83\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD CONSTRAINT \`FK_52165ba60768fd87815d733e562\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD CONSTRAINT \`FK_febc2c20c1ea64180fa09040f28\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_14bcf49cc71d7f857892abbfb0e\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_d6ad3e7aaa1d11ef848f03a80e5\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_9e96938fab1057b20f085550ed0\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_9e96938fab1057b20f085550ed0\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_d6ad3e7aaa1d11ef848f03a80e5\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_14bcf49cc71d7f857892abbfb0e\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP FOREIGN KEY \`FK_febc2c20c1ea64180fa09040f28\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP FOREIGN KEY \`FK_52165ba60768fd87815d733e562\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_dc269892d22b330ef2c60aead83\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_ccd3f1ec65169179b395e5ba903\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_c217003837bbf8a7b3a2c1eeb80\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_caa6eb650afe861c890f134afa9\``);
        await queryRunner.query(`DROP INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\``);
        await queryRunner.query(`DROP INDEX \`uk_event_participant\` ON \`event_registrations\``);
        await queryRunner.query(`DROP INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\` (\`slot_id\`, \`guest_id\`)`);
        await queryRunner.query(`ALTER TABLE \`guests\` DROP COLUMN \`id\``);
        await queryRunner.query(`ALTER TABLE \`guests\`
            ADD \`id\` int NOT NULL AUTO_INCREMENT`);
        await queryRunner.query(`ALTER TABLE \`guests\`
            ADD PRIMARY KEY (\`id\`)`);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`id\` \`id\` int NOT NULL AUTO_INCREMENT`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_9e96938fab1057b20f085550ed0\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\` (\`plan_id\`, \`user_id\`, \`guest_id\`, \`role_id\`)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_d6ad3e7aaa1d11ef848f03a80e5\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_14bcf49cc71d7f857892abbfb0e\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD CONSTRAINT \`FK_febc2c20c1ea64180fa09040f28\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_event_participant\` ON \`event_registrations\` (\`event_id\`, \`user_id\`, \`guest_id\`)`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD CONSTRAINT \`FK_52165ba60768fd87815d733e562\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_dc269892d22b330ef2c60aead83\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_ccd3f1ec65169179b395e5ba903\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_c217003837bbf8a7b3a2c1eeb80\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`guest_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_caa6eb650afe861c890f134afa9\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`guests\` DROP INDEX \`IDX_3d84b6c2d8e540af9da1cf265e\``);
        await queryRunner.query(`ALTER TABLE \`guests\` DROP COLUMN \`token\``);
    }

}
