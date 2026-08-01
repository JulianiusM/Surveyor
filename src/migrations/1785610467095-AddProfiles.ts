import {MigrationInterface, QueryRunner} from "typeorm";

export class AddProfiles1785610467095 implements MigrationInterface {
    name = 'AddProfiles1785610467095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        /* TODO: Implement migration using the following path:
        1. Prepare DB --> Remove/disable checks, unique/indexes, FKs, ...
        2. Create table profiles
        3. Create one profile for each user and guest
        4. Add profile_id column to all affected tables to replace user/guest
        5. Migrate user_id/guest_id to corresponding profile_id which was created in step 3
        6. Remove user_id and guest_id columns
        7. Rename the non-standard columns (i.e. slot, list, combination, survey, ...) to their normalized version (entity, item, assignment)
        8. Setup checks, unique/indexes, FKs, ...
         */

        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_357c0fbec24aac87ee423ba5168\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_ccd3f1ec65169179b395e5ba903\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_ee27f34d81abc82359683f84e38\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_33c32c9f3dbd2e9eaa63b7f08bf\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_797f953903af106421d5f2cada2\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_dc269892d22b330ef2c60aead83\``);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` DROP FOREIGN KEY \`FK_f124e3b4cbdb69f28f796e1cc99\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP FOREIGN KEY \`FK_6207edc397ed15fcbf1b87b1927\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP FOREIGN KEY \`FK_9cbf247de70a55b58841e7b0941\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP FOREIGN KEY \`FK_a0bad64d810ac4e76c23b86785d\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_574be0a35d91af3bac4e3f5ee73\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_99ffd07a41b38d3a13aadd7ce74\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_c217003837bbf8a7b3a2c1eeb80\``);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` DROP FOREIGN KEY \`FK_a801f486411025640abc78bbd91\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP FOREIGN KEY \`FK_a2b8c0843d19876a98b16b8461f\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP FOREIGN KEY \`FK_febc2c20c1ea64180fa09040f28\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP FOREIGN KEY \`FK_52165ba60768fd87815d733e562\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP FOREIGN KEY \`FK_e42ba7c85b05c49c8de4f360543\``);
        await queryRunner.query(`ALTER TABLE \`events\` DROP FOREIGN KEY \`FK_918130b4f882fda431503d6f4e0\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP FOREIGN KEY \`FK_0302a1df8a7c1ea8bc3cd8f98f0\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP FOREIGN KEY \`FK_01ebc30d7c6c9f3c764be121cda\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP FOREIGN KEY \`FK_46f987c26b60e3396f22d53735e\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP FOREIGN KEY \`FK_c4e8f0a94193ce0883305a90e88\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_0e34a6eb8333caef959e50f1682\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_3a84aa083a3749f16515d67b131\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_44fca84f2c94b85a4aa0f857af4\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_caa6eb650afe861c890f134afa9\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP FOREIGN KEY \`FK_3e411697f33a4269726c347d12d\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_d0ca8a723a711cac289a0572660\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_d6ad3e7aaa1d11ef848f03a80e5\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_eaed15cf3bb93c39608b4fcd38b\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` DROP FOREIGN KEY \`FK_bfaec999480077e410bddc977b3\``);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` DROP FOREIGN KEY \`FK_d4636d5c694bae3fd270f7c266f\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP FOREIGN KEY \`FK_f8218a37990e864e813f6451487\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_9e96938fab1057b20f085550ed0\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_aec8db1f4174e3b0f6bfc8fad09\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_b56fb307a2d9170d1fd91d53240\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_c9be315fed7f07cfc32196eb73d\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` DROP FOREIGN KEY \`FK_d9e6ddc59fdf807a57068e4a717\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_14bcf49cc71d7f857892abbfb0e\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_15c9124bfeb633545c5de42edb6\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_235dcfd351bc1eb6d12894b7e8f\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_2b4e3f83ce0b4a0d7617ac0cd44\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP FOREIGN KEY \`FK_c0e64c6fe4352a75372af4e98be\``);
        await queryRunner.query(`ALTER TABLE \`surveys\` DROP FOREIGN KEY \`FK_9532b923178387169ff592c12a9\``);
        await queryRunner.query(`DROP INDEX \`uk_driver_assignment_user\` ON \`drivers_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_packing_assignment_user\` ON \`packing_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_event_participant\` ON \`event_registrations\``);
        await queryRunner.query(`DROP INDEX \`unique_act_slot_role_map\` ON \`activity_slot_role\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_role\` ON \`activity_plan_requirements\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\``);
        await queryRunner.query(`DROP INDEX \`act_roles_name_plan\` ON \`activity_roles\``);
        await queryRunner.query(`DROP INDEX \`uk_unique_activity_assignment_user\` ON \`activity_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\``);
        await queryRunner.query(`DROP INDEX \`uk_entity_admin_assignment_user\` ON \`entity_admin_assignments\``);
        await queryRunner.query(`DROP INDEX \`combinations_single_entry\` ON \`survey_combinations\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`user_id\` \`profile_id\` int NULL`);
        await queryRunner.query(`CREATE TABLE \`profiles\`
                                 (
                                     \`id\`         varchar(36)  NOT NULL,
                                     \`name\`       varchar(50)  NOT NULL,
                                     \`type\`       enum ('user', 'guest') NOT NULL,
                                     \`user_id\`    int NULL,
                                     \`guest_id\`   varchar(36) NULL,
                                     \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                                     \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                                     UNIQUE INDEX \`REL_74c607202390168d8cb82bfd1e\` (\`guest_id\`),
                                     PRIMARY KEY (\`id\`)
                                 ) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`list_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`list_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP COLUMN \`list_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`list_id\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP COLUMN \`slot_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`slot_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`name\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`updatedAt\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`slot_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`plan_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`user_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`guest_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`combination_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`survey_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP COLUMN \`survey_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\`
            ADD \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD \`item_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`item_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`title\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`item_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_shares\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_surcharges\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_assignments\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`event_pool_takeovers\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`entity_permissions\`
            ADD \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`entity_permissions\`
            ADD \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`item_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD \`title\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD \`description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD \`entity_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\`
            ADD \`owner_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_items\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_items\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_lists\`
            ADD \`owner_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`events\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`events\`
            ADD \`owner_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`events\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`events\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            ADD \`owner_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`description\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_roles\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_roles\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_shares\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_surcharges\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_pool_takeovers\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoices\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`event_invoices\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\`
            ADD \`profile_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`surveys\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`surveys\`
            ADD \`owner_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`surveys\` CHANGE \`created_at\` \`created_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`ALTER TABLE \`surveys\` CHANGE \`updated_at\` \`updated_at\` timestamp (6) NOT NULL DEFAULT CURRENT_TIMESTAMP (6) ON UPDATE CURRENT_TIMESTAMP (6)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`unique_act_slot_role_map\` ON \`activity_slot_role\` (\`item_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_role\` ON \`activity_plan_requirements\` (\`entity_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\` (\`entity_id\`, \`profile_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`act_roles_name_plan\` ON \`activity_roles\` (\`title\`, \`entity_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_entity_admin_assignment_user\` ON \`entity_admin_assignments\` (\`entity_type\`, \`entity_id\`, \`profile_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`combinations_single_entry\` ON \`survey_combinations\` (\`WEEKDAY\`, \`entity_id\`, \`nth_week\`)`);
        await queryRunner.query(`ALTER TABLE \`profiles\`
            ADD CONSTRAINT \`FK_9e432b7df0d182f8d292902d1a2\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`profiles\`
            ADD CONSTRAINT \`FK_74c607202390168d8cb82bfd1eb\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_65f5d44f8502c7993c5909abf46\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_60fe7fbeb7989e3d57e25497433\` FOREIGN KEY (\`entity_id\`) REFERENCES \`drivers_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_7dd7dc3d7513cf40f4969f62d59\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_632373c9b9b3e96655056a5e84b\` FOREIGN KEY (\`entity_id\`) REFERENCES \`drivers_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\`
            ADD CONSTRAINT \`FK_f124e3b4cbdb69f28f796e1cc99\` FOREIGN KEY (\`owner_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD CONSTRAINT \`FK_d6105c3023345bcce04315a5348\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD CONSTRAINT \`FK_4071e785ceac4c6d7099dba956c\` FOREIGN KEY (\`entity_id\`) REFERENCES \`packing_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_08a98dc969604d0f178d7c0cdc6\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_806cf12016987469923cc77a3b4\` FOREIGN KEY (\`entity_id\`) REFERENCES \`packing_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\`
            ADD CONSTRAINT \`FK_a801f486411025640abc78bbd91\` FOREIGN KEY (\`owner_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD CONSTRAINT \`FK_4dfdcde929610d6b678eb836cc2\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD CONSTRAINT \`FK_b074710f3b4c3aca254d0abe3e3\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`events\`
            ADD CONSTRAINT \`FK_918130b4f882fda431503d6f4e0\` FOREIGN KEY (\`owner_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD CONSTRAINT \`FK_1ed51ea6ae527bc884ad9861fea\` FOREIGN KEY (\`item_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD CONSTRAINT \`FK_e579c5629494fd4d816c50c667b\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD CONSTRAINT \`FK_68a28d504f04eec65cf934c90ea\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_2e18c15367e05aee82757393d95\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_1a55a0030ef6b7b86196836d662\` FOREIGN KEY (\`item_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_6570f82bd747c7f97ba98b142b2\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD CONSTRAINT \`FK_c7cb790d8ad53f2c7fe28a342ee\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_8d17c638d85a798f61ef1a61552\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_649c9cf6e6fc5e58b31fe218931\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\`
            ADD CONSTRAINT \`FK_b52f7ff10af34cf2da73143d686\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            ADD CONSTRAINT \`FK_d4636d5c694bae3fd270f7c266f\` FOREIGN KEY (\`owner_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD CONSTRAINT \`FK_6891e834b28f40fa0bb3e35cc46\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_6d9982498d8251bef63c3a50209\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_fa9ac67f0e40ba558ced367f643\` FOREIGN KEY (\`item_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_7506e0df035e88c0245f6321bd4\` FOREIGN KEY (\`entity_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\`
            ADD CONSTRAINT \`FK_8c6662705ae5eb730b1fb9c9a61\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_8c6c1e7621847e0136637c8e531\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_e4c476f0c2aba82738e89bbd41a\` FOREIGN KEY (\`item_id\`) REFERENCES \`survey_combinations\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_af45d53d0468a292c0d19edc731\` FOREIGN KEY (\`entity_id\`) REFERENCES \`surveys\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD CONSTRAINT \`FK_5ba76f6069cd86d911d3f7025c0\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD CONSTRAINT \`FK_fd1e0eb96ae7d76e1c85363e726\` FOREIGN KEY (\`entity_id\`) REFERENCES \`surveys\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`surveys\`
            ADD CONSTRAINT \`FK_9532b923178387169ff592c12a9\` FOREIGN KEY (\`owner_id\`) REFERENCES \`profiles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        /* TODO: Implement migration using the following path:
        1. Prepare DB --> Remove/disable checks, unique/indexes, FKs, ...
        2. Create user_id and guest_id columns on the affected tables
        3. Migrate user_id/guest_id from corresponding profile_id of the affected tables
        4. Remove profile_id from affected tables
        5. Drop table profiles
        7. Rename the non-standard columns (i.e. slot, list, combination, survey, ...) to their normalized version (entity, item, assignment)
        8. Setup checks, unique/indexes, FKs, ...
         */

        await queryRunner.query(`ALTER TABLE \`surveys\` DROP FOREIGN KEY \`FK_9532b923178387169ff592c12a9\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP FOREIGN KEY \`FK_fd1e0eb96ae7d76e1c85363e726\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP FOREIGN KEY \`FK_5ba76f6069cd86d911d3f7025c0\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_af45d53d0468a292c0d19edc731\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_e4c476f0c2aba82738e89bbd41a\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP FOREIGN KEY \`FK_8c6c1e7621847e0136637c8e531\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` DROP FOREIGN KEY \`FK_8c6662705ae5eb730b1fb9c9a61\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_7506e0df035e88c0245f6321bd4\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_fa9ac67f0e40ba558ced367f643\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP FOREIGN KEY \`FK_6d9982498d8251bef63c3a50209\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP FOREIGN KEY \`FK_6891e834b28f40fa0bb3e35cc46\``);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` DROP FOREIGN KEY \`FK_d4636d5c694bae3fd270f7c266f\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` DROP FOREIGN KEY \`FK_b52f7ff10af34cf2da73143d686\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_649c9cf6e6fc5e58b31fe218931\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP FOREIGN KEY \`FK_8d17c638d85a798f61ef1a61552\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP FOREIGN KEY \`FK_c7cb790d8ad53f2c7fe28a342ee\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_6570f82bd747c7f97ba98b142b2\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_1a55a0030ef6b7b86196836d662\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP FOREIGN KEY \`FK_2e18c15367e05aee82757393d95\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP FOREIGN KEY \`FK_68a28d504f04eec65cf934c90ea\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP FOREIGN KEY \`FK_e579c5629494fd4d816c50c667b\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP FOREIGN KEY \`FK_1ed51ea6ae527bc884ad9861fea\``);
        await queryRunner.query(`ALTER TABLE \`events\` DROP FOREIGN KEY \`FK_918130b4f882fda431503d6f4e0\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP FOREIGN KEY \`FK_b074710f3b4c3aca254d0abe3e3\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP FOREIGN KEY \`FK_4dfdcde929610d6b678eb836cc2\``);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` DROP FOREIGN KEY \`FK_a801f486411025640abc78bbd91\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_806cf12016987469923cc77a3b4\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP FOREIGN KEY \`FK_08a98dc969604d0f178d7c0cdc6\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP FOREIGN KEY \`FK_4071e785ceac4c6d7099dba956c\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP FOREIGN KEY \`FK_d6105c3023345bcce04315a5348\``);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` DROP FOREIGN KEY \`FK_f124e3b4cbdb69f28f796e1cc99\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_632373c9b9b3e96655056a5e84b\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP FOREIGN KEY \`FK_7dd7dc3d7513cf40f4969f62d59\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_60fe7fbeb7989e3d57e25497433\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP FOREIGN KEY \`FK_65f5d44f8502c7993c5909abf46\``);
        await queryRunner.query(`ALTER TABLE \`profiles\` DROP FOREIGN KEY \`FK_74c607202390168d8cb82bfd1eb\``);
        await queryRunner.query(`ALTER TABLE \`profiles\` DROP FOREIGN KEY \`FK_9e432b7df0d182f8d292902d1a2\``);
        await queryRunner.query(`DROP INDEX \`combinations_single_entry\` ON \`survey_combinations\``);
        await queryRunner.query(`DROP INDEX \`uk_entity_admin_assignment_user\` ON \`entity_admin_assignments\``);
        await queryRunner.query(`DROP INDEX \`act_roles_name_plan\` ON \`activity_roles\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\``);
        await queryRunner.query(`DROP INDEX \`uk_plan_role\` ON \`activity_plan_requirements\``);
        await queryRunner.query(`DROP INDEX \`unique_act_slot_role_map\` ON \`activity_slot_role\``);
        await queryRunner.query(`ALTER TABLE \`surveys\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`surveys\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`surveys\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`surveys\`
            ADD \`owner_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\`
            ADD \`profile_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`event_invoices\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoices\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_pool_takeovers\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_surcharges\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_invoice_shares\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_roles\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_roles\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`description\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            ADD \`owner_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\` CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`description\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`events\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`events\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`events\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`events\`
            ADD \`owner_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_lists\`
            ADD \`owner_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_items\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`packing_items\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` CHANGE \`created_at\` \`created_at\` timestamp (0) NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\` DROP COLUMN \`owner_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\`
            ADD \`owner_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`updated_at\` \`updated_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`guests\` CHANGE \`created_at\` \`created_at\` timestamp (0) NOT NULL DEFAULT CURRENT_TIMESTAMP ()`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP COLUMN \`description\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\` DROP COLUMN \`title\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`item_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_responses\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`entity_permissions\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`entity_permissions\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`event_pool_takeovers\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`event_invoice_assignments\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`event_invoice_surcharges\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`event_invoice_shares\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`item_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_roles\` DROP COLUMN \`title\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`item_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slots\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\` DROP COLUMN \`item_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`event_registrations\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\` DROP COLUMN \`created_at\``);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`packing_items\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`entity_id\``);
        await queryRunner.query(`ALTER TABLE \`drivers_items\` DROP COLUMN \`profile_id\``);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD \`survey_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`survey_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`combination_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`slot_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP()`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD \`name\` varchar(50) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`slot_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD \`plan_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD \`slot_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`list_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD \`list_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`list_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`guest_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`user_id\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD \`list_id\` varchar(36) NULL`);
        await queryRunner.query(`DROP INDEX \`REL_74c607202390168d8cb82bfd1e\` ON \`profiles\``);
        await queryRunner.query(`DROP TABLE \`profiles\``);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\` CHANGE \`profile_id\` \`user_id\` int NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`combinations_single_entry\` ON \`survey_combinations\` (\`WEEKDAY\`, \`survey_id\`, \`nth_week\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_entity_admin_assignment_user\` ON \`entity_admin_assignments\` (\`entity_type\`, \`entity_id\`, \`user_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_activity_assignment_guest\` ON \`activity_assignments\` (\`slot_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_unique_activity_assignment_user\` ON \`activity_assignments\` (\`slot_id\`, \`user_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`act_roles_name_plan\` ON \`activity_roles\` (\`name\`, \`plan_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_participant_role\` ON \`activity_plan_requirement_overrides\` (\`plan_id\`, \`user_id\`, \`guest_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_plan_role\` ON \`activity_plan_requirements\` (\`plan_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`unique_act_slot_role_map\` ON \`activity_slot_role\` (\`slot_id\`, \`role_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_event_participant\` ON \`event_registrations\` (\`event_id\`, \`user_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_packing_assignment_guest\` ON \`packing_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_packing_assignment_user\` ON \`packing_assignments\` (\`item_id\`, \`user_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_driver_assignment_guest\` ON \`drivers_assignments\` (\`item_id\`, \`guest_id\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`uk_driver_assignment_user\` ON \`drivers_assignments\` (\`item_id\`, \`user_id\`)`);
        await queryRunner.query(`ALTER TABLE \`surveys\`
            ADD CONSTRAINT \`FK_9532b923178387169ff592c12a9\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_combinations\`
            ADD CONSTRAINT \`FK_c0e64c6fe4352a75372af4e98be\` FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_2b4e3f83ce0b4a0d7617ac0cd44\` FOREIGN KEY (\`survey_id\`) REFERENCES \`surveys\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_235dcfd351bc1eb6d12894b7e8f\` FOREIGN KEY (\`combination_id\`) REFERENCES \`survey_combinations\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_15c9124bfeb633545c5de42edb6\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`survey_responses\`
            ADD CONSTRAINT \`FK_14bcf49cc71d7f857892abbfb0e\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`entity_admin_assignments\`
            ADD CONSTRAINT \`FK_d9e6ddc59fdf807a57068e4a717\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_c9be315fed7f07cfc32196eb73d\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_b56fb307a2d9170d1fd91d53240\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_aec8db1f4174e3b0f6bfc8fad09\` FOREIGN KEY (\`slot_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_assignments\`
            ADD CONSTRAINT \`FK_9e96938fab1057b20f085550ed0\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_roles\`
            ADD CONSTRAINT \`FK_f8218a37990e864e813f6451487\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            ADD CONSTRAINT \`FK_d4636d5c694bae3fd270f7c266f\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_text_fields\`
            ADD CONSTRAINT \`FK_bfaec999480077e410bddc977b3\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_eaed15cf3bb93c39608b4fcd38b\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_d6ad3e7aaa1d11ef848f03a80e5\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirement_overrides\`
            ADD CONSTRAINT \`FK_d0ca8a723a711cac289a0572660\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_plan_requirements\`
            ADD CONSTRAINT \`FK_3e411697f33a4269726c347d12d\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_caa6eb650afe861c890f134afa9\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_44fca84f2c94b85a4aa0f857af4\` FOREIGN KEY (\`slot_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_3a84aa083a3749f16515d67b131\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_assignment_recommendations\`
            ADD CONSTRAINT \`FK_0e34a6eb8333caef959e50f1682\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD CONSTRAINT \`FK_c4e8f0a94193ce0883305a90e88\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD CONSTRAINT \`FK_46f987c26b60e3396f22d53735e\` FOREIGN KEY (\`plan_id\`) REFERENCES \`activity_plans\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_slots\`
            ADD CONSTRAINT \`FK_01ebc30d7c6c9f3c764be121cda\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`activity_slot_role\`
            ADD CONSTRAINT \`FK_0302a1df8a7c1ea8bc3cd8f98f0\` FOREIGN KEY (\`slot_id\`) REFERENCES \`activity_slots\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`events\`
            ADD CONSTRAINT \`FK_918130b4f882fda431503d6f4e0\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD CONSTRAINT \`FK_e42ba7c85b05c49c8de4f360543\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_registrations\`
            ADD CONSTRAINT \`FK_52165ba60768fd87815d733e562\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD CONSTRAINT \`FK_febc2c20c1ea64180fa09040f28\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`event_reg_links\`
            ADD CONSTRAINT \`FK_a2b8c0843d19876a98b16b8461f\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_lists\`
            ADD CONSTRAINT \`FK_a801f486411025640abc78bbd91\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_c217003837bbf8a7b3a2c1eeb80\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_99ffd07a41b38d3a13aadd7ce74\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_assignments\`
            ADD CONSTRAINT \`FK_574be0a35d91af3bac4e3f5ee73\` FOREIGN KEY (\`list_id\`) REFERENCES \`packing_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD CONSTRAINT \`FK_a0bad64d810ac4e76c23b86785d\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD CONSTRAINT \`FK_9cbf247de70a55b58841e7b0941\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`packing_items\`
            ADD CONSTRAINT \`FK_6207edc397ed15fcbf1b87b1927\` FOREIGN KEY (\`list_id\`) REFERENCES \`packing_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_lists\`
            ADD CONSTRAINT \`FK_f124e3b4cbdb69f28f796e1cc99\` FOREIGN KEY (\`owner_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_dc269892d22b330ef2c60aead83\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_797f953903af106421d5f2cada2\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_assignments\`
            ADD CONSTRAINT \`FK_33c32c9f3dbd2e9eaa63b7f08bf\` FOREIGN KEY (\`list_id\`) REFERENCES \`drivers_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_ee27f34d81abc82359683f84e38\` FOREIGN KEY (\`list_id\`) REFERENCES \`drivers_lists\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_ccd3f1ec65169179b395e5ba903\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
        await queryRunner.query(`ALTER TABLE \`drivers_items\`
            ADD CONSTRAINT \`FK_357c0fbec24aac87ee423ba5168\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT`);
    }

}
