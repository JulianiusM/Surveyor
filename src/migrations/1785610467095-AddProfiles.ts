import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    columnExists,
    createConstraintIfNotExists,
    createUniqueIndexIfNotExists,
    dropColumnIfExists,
    dropFkConstraintIfExists,
    dropIndexIfExists,
    tableExists
} from "../modules/database/utils/migration-helper";

interface ForeignKeyDef {
    table: string;
    name: string;
    definition: string;
}

interface IndexDef {
    table: string;
    name: string;
    columns: string;
}

interface RelationMapping {
    table: string;
    profile?: { oldUser?: string; oldGuest?: string; };
    entity?: { old: string; type: string; };
    item?: { old: string; type: string; };
}

export class AddProfiles1785610467095 implements MigrationInterface {
    name = 'AddProfiles1785610467095';

    private async getColumnType(queryRunner: QueryRunner, table: string, column: string): Promise<string | null> {
        const result = await queryRunner.query(
            `SELECT DATA_TYPE as dataType
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?`,
            [table, column]
        );

        return result[0]?.dataType?.toLowerCase() ?? null;
    }

    private async migrateOwnerToProfile(queryRunner: QueryRunner, table: string): Promise<void> {
        if (!await columnExists(queryRunner, table, 'owner_id')) {
            return;
        }

        const ownerType = await this.getColumnType(queryRunner, table, 'owner_id');
        if (ownerType === 'varchar' || ownerType === 'char') {
            return;
        }

        await addColumnIfNotExists(queryRunner, table, 'owner_profile_id', 'varchar(36)', 'NULL');
        await queryRunner.query(
            `UPDATE \`${table}\` t
                LEFT JOIN \`profiles\` p ON p.user_id = t.owner_id
             SET t.owner_profile_id = p.id
             WHERE t.owner_profile_id IS NULL
               AND t.owner_id IS NOT NULL`
        );

        await dropColumnIfExists(queryRunner, table, 'owner_id');
        await queryRunner.query(`ALTER TABLE \`${table}\`
            CHANGE \`owner_profile_id\` \`owner_id\` varchar(36) NULL`);
    }

    private async migrateOwnerToUser(queryRunner: QueryRunner, table: string): Promise<void> {
        if (!await columnExists(queryRunner, table, 'owner_id')) {
            return;
        }

        const ownerType = await this.getColumnType(queryRunner, table, 'owner_id');
        if (ownerType === 'int' || ownerType === 'bigint' || ownerType === 'smallint') {
            return;
        }

        await addColumnIfNotExists(queryRunner, table, 'owner_user_id', 'int', 'NULL');
        await queryRunner.query(
            `UPDATE \`${table}\` t
                LEFT JOIN \`profiles\` p ON p.id = t.owner_id
             SET t.owner_user_id = p.user_id
             WHERE t.owner_user_id IS NULL
               AND t.owner_id IS NOT NULL`
        );

        await dropColumnIfExists(queryRunner, table, 'owner_id');
        await queryRunner.query(`ALTER TABLE \`${table}\`
            CHANGE \`owner_user_id\` \`owner_id\` int NULL`);
    }

    private async ensureProfileTable(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`profiles\`
                                 (
                                     \`id\`         varchar(36)            NOT NULL,
                                     \`name\`       varchar(50)            NOT NULL,
                                     \`type\`       enum ('user', 'guest') NOT NULL,
                                     \`user_id\`    int                    NULL,
                                     \`guest_id\`   varchar(36)            NULL,
                                     \`created_at\` timestamp(6)           NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                                     \`updated_at\` timestamp(6)           NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                                     PRIMARY KEY (\`id\`)
                                 ) ENGINE = InnoDB`);

        await createUniqueIndexIfNotExists(queryRunner, 'profiles', 'REL_74c607202390168d8cb82bfd1e', '`guest_id`');
    }

    private async migrateRelationColumnsUp(queryRunner: QueryRunner, mapping: RelationMapping): Promise<void> {
        if (mapping.profile) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'profile_id', 'varchar(36)', 'NULL');

            const hasOldUser = mapping.profile.oldUser ? await columnExists(queryRunner, mapping.table, mapping.profile.oldUser) : false;
            const hasOldGuest = mapping.profile.oldGuest ? await columnExists(queryRunner, mapping.table, mapping.profile.oldGuest) : false;

            if (hasOldUser || hasOldGuest) {
                const joins = [];
                const sources = ['t.profile_id'];
                if (hasOldUser && mapping.profile.oldUser) {
                    joins.push(`LEFT JOIN \`profiles\` pu ON pu.user_id = t.\`${mapping.profile.oldUser}\``);
                    sources.push('pu.id');
                }
                if (hasOldGuest && mapping.profile.oldGuest) {
                    joins.push(`LEFT JOIN \`profiles\` pg ON pg.guest_id = t.\`${mapping.profile.oldGuest}\``);
                    sources.push('pg.id');
                }

                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                         ${joins.join('\n                     ')}
                    SET t.profile_id = COALESCE(${sources.join(', ')}) WHERE t.profile_id IS NULL`
                );
            }
        }

        if (mapping.entity) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'entity_id', mapping.entity.type, 'NULL');
            if (await columnExists(queryRunner, mapping.table, mapping.entity.old)) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\`
                     SET \`entity_id\` = COALESCE(\`entity_id\`, \`${mapping.entity.old}\`)
                     WHERE \`entity_id\` IS NULL`
                );
            }
        }

        if (mapping.item) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'item_id', mapping.item.type, 'NULL');
            if (await columnExists(queryRunner, mapping.table, mapping.item.old)) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\`
                     SET \`item_id\` = COALESCE(\`item_id\`, \`${mapping.item.old}\`)
                     WHERE \`item_id\` IS NULL`
                );
            }
        }

        if (mapping.profile?.oldUser) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.profile.oldUser);
        }
        if (mapping.profile?.oldGuest) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.profile.oldGuest);
        }
        if (mapping.entity?.old) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.entity.old);
        }
        if (mapping.item?.old) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.item.old);
        }
    }

    private async migrateRelationColumnsDown(queryRunner: QueryRunner, mapping: RelationMapping): Promise<void> {
        const hasProfiles = await tableExists(queryRunner, 'profiles');

        if (mapping.profile?.oldUser) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.profile.oldUser, 'int', 'NULL');
        }
        if (mapping.profile?.oldGuest) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.profile.oldGuest, 'varchar(36)', 'NULL');
        }

        if (mapping.entity) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.entity.old, mapping.entity.type, 'NULL');
        }
        if (mapping.item) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.item.old, mapping.item.type, 'NULL');
        }

        if (hasProfiles && mapping.profile && await columnExists(queryRunner, mapping.table, 'profile_id')) {
            if (mapping.profile.oldUser) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                        LEFT JOIN \`profiles\` p ON p.id = t.profile_id
                     SET t.\`${mapping.profile.oldUser}\` = COALESCE(t.\`${mapping.profile.oldUser}\`, p.user_id)
                     WHERE t.profile_id IS NOT NULL`
                );
            }
            if (mapping.profile.oldGuest) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                        LEFT JOIN \`profiles\` p ON p.id = t.profile_id
                     SET t.\`${mapping.profile.oldGuest}\` = COALESCE(t.\`${mapping.profile.oldGuest}\`, p.guest_id)
                     WHERE t.profile_id IS NOT NULL`
                );
            }
        }

        if (mapping.entity && await columnExists(queryRunner, mapping.table, 'entity_id')) {
            await queryRunner.query(
                `UPDATE \`${mapping.table}\`
                 SET \`${mapping.entity.old}\` = COALESCE(\`${mapping.entity.old}\`, \`entity_id\`)
                 WHERE \`${mapping.entity.old}\` IS NULL`
            );

            await dropColumnIfExists(queryRunner, mapping.table, 'entity_id');
        }

        if (mapping.item && await columnExists(queryRunner, mapping.table, 'item_id')) {
            await queryRunner.query(
                `UPDATE \`${mapping.table}\`
                 SET \`${mapping.item.old}\` = COALESCE(\`${mapping.item.old}\`, \`item_id\`)
                 WHERE \`${mapping.item.old}\` IS NULL`
            );

            await dropColumnIfExists(queryRunner, mapping.table, 'item_id');
        }

        await dropColumnIfExists(queryRunner, mapping.table, 'profile_id');
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const oldForeignKeys = [
            ['drivers_items', 'FK_357c0fbec24aac87ee423ba5168'],
            ['drivers_items', 'FK_ccd3f1ec65169179b395e5ba903'],
            ['drivers_items', 'FK_ee27f34d81abc82359683f84e38'],
            ['drivers_assignments', 'FK_33c32c9f3dbd2e9eaa63b7f08bf'],
            ['drivers_assignments', 'FK_797f953903af106421d5f2cada2'],
            ['drivers_assignments', 'FK_dc269892d22b330ef2c60aead83'],
            ['drivers_lists', 'FK_f124e3b4cbdb69f28f796e1cc99'],
            ['packing_items', 'FK_6207edc397ed15fcbf1b87b1927'],
            ['packing_items', 'FK_9cbf247de70a55b58841e7b0941'],
            ['packing_items', 'FK_a0bad64d810ac4e76c23b86785d'],
            ['packing_assignments', 'FK_574be0a35d91af3bac4e3f5ee73'],
            ['packing_assignments', 'FK_99ffd07a41b38d3a13aadd7ce74'],
            ['packing_assignments', 'FK_c217003837bbf8a7b3a2c1eeb80'],
            ['packing_lists', 'FK_a801f486411025640abc78bbd91'],
            ['event_reg_links', 'FK_a2b8c0843d19876a98b16b8461f'],
            ['event_reg_links', 'FK_febc2c20c1ea64180fa09040f28'],
            ['event_registrations', 'FK_52165ba60768fd87815d733e562'],
            ['event_registrations', 'FK_e42ba7c85b05c49c8de4f360543'],
            ['events', 'FK_918130b4f882fda431503d6f4e0'],
            ['activity_slot_role', 'FK_0302a1df8a7c1ea8bc3cd8f98f0'],
            ['activity_slots', 'FK_01ebc30d7c6c9f3c764be121cda'],
            ['activity_slots', 'FK_46f987c26b60e3396f22d53735e'],
            ['activity_slots', 'FK_c4e8f0a94193ce0883305a90e88'],
            ['activity_assignment_recommendations', 'FK_0e34a6eb8333caef959e50f1682'],
            ['activity_assignment_recommendations', 'FK_3a84aa083a3749f16515d67b131'],
            ['activity_assignment_recommendations', 'FK_44fca84f2c94b85a4aa0f857af4'],
            ['activity_assignment_recommendations', 'FK_caa6eb650afe861c890f134afa9'],
            ['activity_plan_requirements', 'FK_3e411697f33a4269726c347d12d'],
            ['activity_plan_requirement_overrides', 'FK_d0ca8a723a711cac289a0572660'],
            ['activity_plan_requirement_overrides', 'FK_d6ad3e7aaa1d11ef848f03a80e5'],
            ['activity_plan_requirement_overrides', 'FK_eaed15cf3bb93c39608b4fcd38b'],
            ['activity_plan_text_fields', 'FK_bfaec999480077e410bddc977b3'],
            ['activity_plans', 'FK_d4636d5c694bae3fd270f7c266f'],
            ['activity_roles', 'FK_f8218a37990e864e813f6451487'],
            ['activity_assignments', 'FK_9e96938fab1057b20f085550ed0'],
            ['activity_assignments', 'FK_aec8db1f4174e3b0f6bfc8fad09'],
            ['activity_assignments', 'FK_b56fb307a2d9170d1fd91d53240'],
            ['activity_assignments', 'FK_c9be315fed7f07cfc32196eb73d'],
            ['entity_admin_assignments', 'FK_d9e6ddc59fdf807a57068e4a717'],
            ['survey_responses', 'FK_14bcf49cc71d7f857892abbfb0e'],
            ['survey_responses', 'FK_15c9124bfeb633545c5de42edb6'],
            ['survey_responses', 'FK_235dcfd351bc1eb6d12894b7e8f'],
            ['survey_responses', 'FK_2b4e3f83ce0b4a0d7617ac0cd44'],
            ['survey_combinations', 'FK_c0e64c6fe4352a75372af4e98be'],
            ['surveys', 'FK_9532b923178387169ff592c12a9']
        ] as const;

        const oldUniqueIndexes = [
            ['drivers_assignments', 'uk_driver_assignment_user'],
            ['drivers_assignments', 'uk_driver_assignment_guest'],
            ['packing_assignments', 'uk_packing_assignment_user'],
            ['packing_assignments', 'uk_packing_assignment_guest'],
            ['event_registrations', 'uk_event_participant'],
            ['activity_slot_role', 'unique_act_slot_role_map'],
            ['activity_plan_requirements', 'uk_plan_role'],
            ['activity_plan_requirement_overrides', 'uk_plan_participant_role'],
            ['activity_roles', 'act_roles_name_plan'],
            ['activity_assignments', 'uk_unique_activity_assignment_user'],
            ['activity_assignments', 'uk_activity_assignment_guest'],
            ['entity_admin_assignments', 'uk_entity_admin_assignment_user'],
            ['survey_combinations', 'combinations_single_entry']
        ] as const;

        const mappings: RelationMapping[] = [
            {
                table: 'drivers_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {table: 'event_reg_links', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'event_registrations', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'activity_slot_role', item: {old: 'slot_id', type: 'varchar(36)'}},
            {
                table: 'activity_slots',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_assignment_recommendations',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_requirements', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_plan_requirement_overrides',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_text_fields', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {table: 'activity_roles', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'survey_responses',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'combination_id', type: 'int'},
                entity: {old: 'survey_id', type: 'varchar(36)'}
            },
            {table: 'survey_combinations', entity: {old: 'survey_id', type: 'varchar(36)'}}
        ];

        const newIndexes: IndexDef[] = [
            {table: 'activity_slot_role', name: 'unique_act_slot_role_map', columns: '`item_id`, `role_id`'},
            {table: 'activity_plan_requirements', name: 'uk_plan_role', columns: '`entity_id`, `role_id`'},
            {
                table: 'activity_plan_requirement_overrides',
                name: 'uk_plan_participant_role',
                columns: '`entity_id`, `profile_id`, `role_id`'
            },
            {table: 'activity_roles', name: 'act_roles_name_plan', columns: '`title`, `entity_id`'},
            {
                table: 'entity_admin_assignments',
                name: 'uk_entity_admin_assignment_user',
                columns: '`entity_type`, `entity_id`, `profile_id`'
            },
            {
                table: 'survey_combinations',
                name: 'combinations_single_entry',
                columns: '`WEEKDAY`, `entity_id`, `nth_week`'
            }
        ];

        const newForeignKeys: ForeignKeyDef[] = [
            {
                table: 'profiles',
                name: 'FK_9e432b7df0d182f8d292902d1a2',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
            },
            {
                table: 'profiles',
                name: 'FK_74c607202390168d8cb82bfd1eb',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_65f5d44f8502c7993c5909abf46',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_60fe7fbeb7989e3d57e25497433',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_7dd7dc3d7513cf40f4969f62d59',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_632373c9b9b3e96655056a5e84b',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_lists',
                name: 'FK_f124e3b4cbdb69f28f796e1cc99',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_items',
                name: 'FK_d6105c3023345bcce04315a5348',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_items',
                name: 'FK_4071e785ceac4c6d7099dba956c',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_08a98dc969604d0f178d7c0cdc6',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_806cf12016987469923cc77a3b4',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_lists',
                name: 'FK_a801f486411025640abc78bbd91',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_reg_links',
                name: 'FK_4dfdcde929610d6b678eb836cc2',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_registrations',
                name: 'FK_b074710f3b4c3aca254d0abe3e3',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'events',
                name: 'FK_918130b4f882fda431503d6f4e0',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slot_role',
                name: 'FK_1ed51ea6ae527bc884ad9861fea',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slots',
                name: 'FK_e579c5629494fd4d816c50c667b',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slots',
                name: 'FK_68a28d504f04eec65cf934c90ea',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_2e18c15367e05aee82757393d95',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_1a55a0030ef6b7b86196836d662',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_6570f82bd747c7f97ba98b142b2',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirements',
                name: 'FK_c7cb790d8ad53f2c7fe28a342ee',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_8d17c638d85a798f61ef1a61552',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_649c9cf6e6fc5e58b31fe218931',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_text_fields',
                name: 'FK_b52f7ff10af34cf2da73143d686',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plans',
                name: 'FK_d4636d5c694bae3fd270f7c266f',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_roles',
                name: 'FK_6891e834b28f40fa0bb3e35cc46',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_6d9982498d8251bef63c3a50209',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_fa9ac67f0e40ba558ced367f643',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_7506e0df035e88c0245f6321bd4',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'entity_admin_assignments',
                name: 'FK_8c6662705ae5eb730b1fb9c9a61',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_8c6c1e7621847e0136637c8e531',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_e4c476f0c2aba82738e89bbd41a',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `survey_combinations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_af45d53d0468a292c0d19edc731',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_5ba76f6069cd86d911d3f7025c0',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_fd1e0eb96ae7d76e1c85363e726',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'surveys',
                name: 'FK_9532b923178387169ff592c12a9',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            }
        ];

        await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const [table, fk] of oldForeignKeys) {
                await dropFkConstraintIfExists(queryRunner, table, fk);
            }
            for (const [table, index] of oldUniqueIndexes) {
                await dropIndexIfExists(queryRunner, table, index);
            }

            await this.ensureProfileTable(queryRunner);

            await queryRunner.query(`INSERT INTO \`profiles\` (\`id\`, \`name\`, \`type\`, \`user_id\`, \`guest_id\`,
                                                               \`created_at\`, \`updated_at\`)
                                     SELECT UUID(),
                                            LEFT(COALESCE(NULLIF(TRIM(u.name), ''), u.username), 50),
                                            'user',
                                            u.id,
                                            NULL,
                                            u.created_at,
                                            u.updated_at
                                     FROM \`users\` u
                                              LEFT JOIN \`profiles\` p ON p.user_id = u.id
                                     WHERE p.user_id IS NULL`);

            await queryRunner.query(`INSERT INTO \`profiles\` (\`id\`, \`name\`, \`type\`, \`user_id\`, \`guest_id\`,
                                                               \`created_at\`, \`updated_at\`)
                                     SELECT UUID(),
                                            LEFT(g.username, 50),
                                            'guest',
                                            NULL,
                                            g.id,
                                            g.created_at,
                                            g.updated_at
                                     FROM \`guests\` g
                                              LEFT JOIN \`profiles\` p ON p.guest_id = g.id
                                     WHERE p.guest_id IS NULL`);

            await this.migrateOwnerToProfile(queryRunner, 'drivers_lists');
            await this.migrateOwnerToProfile(queryRunner, 'packing_lists');
            await this.migrateOwnerToProfile(queryRunner, 'events');
            await this.migrateOwnerToProfile(queryRunner, 'activity_plans');
            await this.migrateOwnerToProfile(queryRunner, 'surveys');

            await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'profile_id', 'varchar(36)', 'NULL');
            if (await columnExists(queryRunner, 'entity_admin_assignments', 'user_id')) {
                await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                    LEFT JOIN \`profiles\` p ON p.user_id = e.user_id
                                         SET e.profile_id = COALESCE(e.profile_id, p.id)
                                         WHERE e.profile_id IS NULL`);
                await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'user_id');
            } else {
                const profileType = await this.getColumnType(queryRunner, 'entity_admin_assignments', 'profile_id');
                if (profileType === 'int' || profileType === 'bigint' || profileType === 'smallint') {
                    await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'profile_uuid', 'varchar(36)', 'NULL');
                    await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                        LEFT JOIN \`profiles\` p ON p.user_id = e.profile_id
                                             SET e.profile_uuid = COALESCE(e.profile_uuid, p.id)
                                             WHERE e.profile_id IS NOT NULL`);
                    await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'profile_id');
                    await queryRunner.query('ALTER TABLE `entity_admin_assignments` CHANGE `profile_uuid` `profile_id` varchar(36) NULL');
                }
            }

            for (const mapping of mappings) {
                await this.migrateRelationColumnsUp(queryRunner, mapping);
            }

            await addColumnIfNotExists(queryRunner, 'activity_roles', 'title', 'varchar(255)', 'NULL');
            if (await columnExists(queryRunner, 'activity_roles', 'name')) {
                await queryRunner.query('UPDATE `activity_roles` SET `title` = COALESCE(`title`, `name`) WHERE `title` IS NULL');
                await dropColumnIfExists(queryRunner, 'activity_roles', 'name');
            }
            await queryRunner.query('UPDATE `activity_roles` SET `title` = COALESCE(`title`, CONCAT(`id`, \':role\')) WHERE `title` IS NULL');
            await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `title` `title` varchar(255) NOT NULL');

            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'title', 'varchar(255)', 'NULL');
            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'description', 'varchar(255)', 'NULL');
            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'profile_id', 'varchar(36)', 'NULL');
            await queryRunner.query(`UPDATE \`survey_combinations\`
                                     SET \`title\` = COALESCE(\`title\`, CONCAT(\`WEEKDAY\`, ' ', \`nth_week\`))
                                     WHERE \`title\` IS NULL`);
            await queryRunner.query('ALTER TABLE `survey_combinations` CHANGE `title` `title` varchar(255) NOT NULL');

            if (await columnExists(queryRunner, 'activity_slots', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_slots` CHANGE `description` `description` varchar(255) NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `description` `description` varchar(255) NULL');
            }

            if (await columnExists(queryRunner, 'activity_assignments', 'updatedAt')) {
                await addColumnIfNotExists(queryRunner, 'activity_assignments', 'updated_at', 'timestamp(6)', 'NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)');
                await queryRunner.query('UPDATE `activity_assignments` SET `updated_at` = `updatedAt` WHERE `updatedAt` IS NOT NULL');
                await dropColumnIfExists(queryRunner, 'activity_assignments', 'updatedAt');
            }

            for (const index of newIndexes) {
                await createUniqueIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
            }

            for (const fk of newForeignKeys) {
                await createConstraintIfNotExists(queryRunner, fk.table, fk.name, fk.definition);
            }
        } finally {
            await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const newForeignKeys = [
            ['surveys', 'FK_9532b923178387169ff592c12a9'],
            ['survey_combinations', 'FK_fd1e0eb96ae7d76e1c85363e726'],
            ['survey_combinations', 'FK_5ba76f6069cd86d911d3f7025c0'],
            ['survey_responses', 'FK_af45d53d0468a292c0d19edc731'],
            ['survey_responses', 'FK_e4c476f0c2aba82738e89bbd41a'],
            ['survey_responses', 'FK_8c6c1e7621847e0136637c8e531'],
            ['entity_admin_assignments', 'FK_8c6662705ae5eb730b1fb9c9a61'],
            ['activity_assignments', 'FK_7506e0df035e88c0245f6321bd4'],
            ['activity_assignments', 'FK_fa9ac67f0e40ba558ced367f643'],
            ['activity_assignments', 'FK_6d9982498d8251bef63c3a50209'],
            ['activity_roles', 'FK_6891e834b28f40fa0bb3e35cc46'],
            ['activity_plans', 'FK_d4636d5c694bae3fd270f7c266f'],
            ['activity_plan_text_fields', 'FK_b52f7ff10af34cf2da73143d686'],
            ['activity_plan_requirement_overrides', 'FK_649c9cf6e6fc5e58b31fe218931'],
            ['activity_plan_requirement_overrides', 'FK_8d17c638d85a798f61ef1a61552'],
            ['activity_plan_requirements', 'FK_c7cb790d8ad53f2c7fe28a342ee'],
            ['activity_assignment_recommendations', 'FK_6570f82bd747c7f97ba98b142b2'],
            ['activity_assignment_recommendations', 'FK_1a55a0030ef6b7b86196836d662'],
            ['activity_assignment_recommendations', 'FK_2e18c15367e05aee82757393d95'],
            ['activity_slots', 'FK_68a28d504f04eec65cf934c90ea'],
            ['activity_slots', 'FK_e579c5629494fd4d816c50c667b'],
            ['activity_slot_role', 'FK_1ed51ea6ae527bc884ad9861fea'],
            ['events', 'FK_918130b4f882fda431503d6f4e0'],
            ['event_registrations', 'FK_b074710f3b4c3aca254d0abe3e3'],
            ['event_reg_links', 'FK_4dfdcde929610d6b678eb836cc2'],
            ['packing_lists', 'FK_a801f486411025640abc78bbd91'],
            ['packing_assignments', 'FK_806cf12016987469923cc77a3b4'],
            ['packing_assignments', 'FK_08a98dc969604d0f178d7c0cdc6'],
            ['packing_items', 'FK_4071e785ceac4c6d7099dba956c'],
            ['packing_items', 'FK_d6105c3023345bcce04315a5348'],
            ['drivers_lists', 'FK_f124e3b4cbdb69f28f796e1cc99'],
            ['drivers_assignments', 'FK_632373c9b9b3e96655056a5e84b'],
            ['drivers_assignments', 'FK_7dd7dc3d7513cf40f4969f62d59'],
            ['drivers_items', 'FK_60fe7fbeb7989e3d57e25497433'],
            ['drivers_items', 'FK_65f5d44f8502c7993c5909abf46'],
            ['profiles', 'FK_74c607202390168d8cb82bfd1eb'],
            ['profiles', 'FK_9e432b7df0d182f8d292902d1a2']
        ] as const;

        const newUniqueIndexes = [
            ['survey_combinations', 'combinations_single_entry'],
            ['entity_admin_assignments', 'uk_entity_admin_assignment_user'],
            ['activity_roles', 'act_roles_name_plan'],
            ['activity_plan_requirement_overrides', 'uk_plan_participant_role'],
            ['activity_plan_requirements', 'uk_plan_role'],
            ['activity_slot_role', 'unique_act_slot_role_map']
        ] as const;

        const mappings: RelationMapping[] = [
            {table: 'survey_combinations', entity: {old: 'survey_id', type: 'varchar(36)'}},
            {
                table: 'survey_responses',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'combination_id', type: 'int'},
                entity: {old: 'survey_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_roles', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {table: 'activity_plan_text_fields', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_plan_requirement_overrides',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_requirements', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_assignment_recommendations',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_slots',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_slot_role', item: {old: 'slot_id', type: 'varchar(36)'}},
            {table: 'event_registrations', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'event_reg_links', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {
                table: 'packing_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            }
        ];

        const oldIndexes: IndexDef[] = [
            {table: 'drivers_assignments', name: 'uk_driver_assignment_user', columns: '`item_id`, `user_id`'},
            {table: 'drivers_assignments', name: 'uk_driver_assignment_guest', columns: '`item_id`, `guest_id`'},
            {table: 'packing_assignments', name: 'uk_packing_assignment_user', columns: '`item_id`, `user_id`'},
            {table: 'packing_assignments', name: 'uk_packing_assignment_guest', columns: '`item_id`, `guest_id`'},
            {table: 'event_registrations', name: 'uk_event_participant', columns: '`event_id`, `user_id`, `guest_id`'},
            {table: 'activity_slot_role', name: 'unique_act_slot_role_map', columns: '`slot_id`, `role_id`'},
            {table: 'activity_plan_requirements', name: 'uk_plan_role', columns: '`plan_id`, `role_id`'},
            {
                table: 'activity_plan_requirement_overrides',
                name: 'uk_plan_participant_role',
                columns: '`plan_id`, `user_id`, `guest_id`, `role_id`'
            },
            {table: 'activity_roles', name: 'act_roles_name_plan', columns: '`name`, `plan_id`'},
            {
                table: 'activity_assignments',
                name: 'uk_unique_activity_assignment_user',
                columns: '`slot_id`, `user_id`'
            },
            {table: 'activity_assignments', name: 'uk_activity_assignment_guest', columns: '`slot_id`, `guest_id`'},
            {
                table: 'entity_admin_assignments',
                name: 'uk_entity_admin_assignment_user',
                columns: '`entity_type`, `entity_id`, `user_id`'
            },
            {
                table: 'survey_combinations',
                name: 'combinations_single_entry',
                columns: '`WEEKDAY`, `survey_id`, `nth_week`'
            }
        ];

        const oldForeignKeys: ForeignKeyDef[] = [
            {
                table: 'surveys',
                name: 'FK_9532b923178387169ff592c12a9',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_c0e64c6fe4352a75372af4e98be',
                definition: 'FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_2b4e3f83ce0b4a0d7617ac0cd44',
                definition: 'FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_235dcfd351bc1eb6d12894b7e8f',
                definition: 'FOREIGN KEY (`combination_id`) REFERENCES `survey_combinations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_15c9124bfeb633545c5de42edb6',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'survey_responses',
                name: 'FK_14bcf49cc71d7f857892abbfb0e',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'entity_admin_assignments',
                name: 'FK_d9e6ddc59fdf807a57068e4a717',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_c9be315fed7f07cfc32196eb73d',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_b56fb307a2d9170d1fd91d53240',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignments',
                name: 'FK_aec8db1f4174e3b0f6bfc8fad09',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_9e96938fab1057b20f085550ed0',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_roles',
                name: 'FK_f8218a37990e864e813f6451487',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plans',
                name: 'FK_d4636d5c694bae3fd270f7c266f',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_text_fields',
                name: 'FK_bfaec999480077e410bddc977b3',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_eaed15cf3bb93c39608b4fcd38b',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_d6ad3e7aaa1d11ef848f03a80e5',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_d0ca8a723a711cac289a0572660',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirements',
                name: 'FK_3e411697f33a4269726c347d12d',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_caa6eb650afe861c890f134afa9',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_44fca84f2c94b85a4aa0f857af4',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_3a84aa083a3749f16515d67b131',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_0e34a6eb8333caef959e50f1682',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION'
            },
            {
                table: 'activity_slots',
                name: 'FK_c4e8f0a94193ce0883305a90e88',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'activity_slots',
                name: 'FK_46f987c26b60e3396f22d53735e',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_slots',
                name: 'FK_01ebc30d7c6c9f3c764be121cda',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'activity_slot_role',
                name: 'FK_0302a1df8a7c1ea8bc3cd8f98f0',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'events',
                name: 'FK_918130b4f882fda431503d6f4e0',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_registrations',
                name: 'FK_e42ba7c85b05c49c8de4f360543',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_registrations',
                name: 'FK_52165ba60768fd87815d733e562',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_reg_links',
                name: 'FK_febc2c20c1ea64180fa09040f28',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_reg_links',
                name: 'FK_a2b8c0843d19876a98b16b8461f',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_lists',
                name: 'FK_a801f486411025640abc78bbd91',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_c217003837bbf8a7b3a2c1eeb80',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_assignments',
                name: 'FK_99ffd07a41b38d3a13aadd7ce74',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_assignments',
                name: 'FK_574be0a35d91af3bac4e3f5ee73',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_a0bad64d810ac4e76c23b86785d',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_9cbf247de70a55b58841e7b0941',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_6207edc397ed15fcbf1b87b1927',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_lists',
                name: 'FK_f124e3b4cbdb69f28f796e1cc99',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_dc269892d22b330ef2c60aead83',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_797f953903af106421d5f2cada2',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_33c32c9f3dbd2e9eaa63b7f08bf',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_ee27f34d81abc82359683f84e38',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_ccd3f1ec65169179b395e5ba903',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_items',
                name: 'FK_357c0fbec24aac87ee423ba5168',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            }
        ];

        await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const [table, fk] of newForeignKeys) {
                await dropFkConstraintIfExists(queryRunner, table, fk);
            }
            for (const [table, index] of newUniqueIndexes) {
                await dropIndexIfExists(queryRunner, table, index);
            }

            if (await columnExists(queryRunner, 'activity_assignments', 'updated_at')) {
                await addColumnIfNotExists(queryRunner, 'activity_assignments', 'updatedAt', 'timestamp', 'NOT NULL DEFAULT CURRENT_TIMESTAMP()');
                await queryRunner.query('UPDATE `activity_assignments` SET `updatedAt` = `updated_at` WHERE `updated_at` IS NOT NULL');
                await dropColumnIfExists(queryRunner, 'activity_assignments', 'updated_at');
            }

            if (await columnExists(queryRunner, 'activity_roles', 'title')) {
                await addColumnIfNotExists(queryRunner, 'activity_roles', 'name', 'varchar(50)', 'NULL');
                await queryRunner.query('UPDATE `activity_roles` SET `name` = COALESCE(`name`, LEFT(`title`, 50)) WHERE `name` IS NULL');
            }

            await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'user_id', 'int', 'NULL');
            if (await tableExists(queryRunner, 'profiles') && await columnExists(queryRunner, 'entity_admin_assignments', 'profile_id')) {
                await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                    LEFT JOIN \`profiles\` p ON p.id = e.profile_id
                                         SET e.user_id = COALESCE(e.user_id, p.user_id)
                                         WHERE e.profile_id IS NOT NULL`);
            }
            await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'profile_id');

            for (const mapping of mappings) {
                await this.migrateRelationColumnsDown(queryRunner, mapping);
            }

            if (await columnExists(queryRunner, 'survey_combinations', 'title')) {
                await dropColumnIfExists(queryRunner, 'survey_combinations', 'title');
            }
            await dropColumnIfExists(queryRunner, 'survey_combinations', 'description');
            await dropColumnIfExists(queryRunner, 'survey_combinations', 'profile_id');

            if (await columnExists(queryRunner, 'activity_slots', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_slots` CHANGE `description` `description` text NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `description` `description` text NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'name')) {
                await dropColumnIfExists(queryRunner, 'activity_roles', 'title');
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `name` `name` varchar(50) NOT NULL');
            }

            await this.migrateOwnerToUser(queryRunner, 'drivers_lists');
            await this.migrateOwnerToUser(queryRunner, 'packing_lists');
            await this.migrateOwnerToUser(queryRunner, 'events');
            await this.migrateOwnerToUser(queryRunner, 'activity_plans');
            await this.migrateOwnerToUser(queryRunner, 'surveys');

            if (await tableExists(queryRunner, 'profiles')) {
                await dropIndexIfExists(queryRunner, 'profiles', 'REL_74c607202390168d8cb82bfd1e');
                await queryRunner.query('DROP TABLE IF EXISTS `profiles`');
            }

            for (const index of oldIndexes) {
                await createUniqueIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
            }

            for (const fk of oldForeignKeys) {
                await createConstraintIfNotExists(queryRunner, fk.table, fk.name, fk.definition);
            }
        } finally {
            await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
        }
    }
}
