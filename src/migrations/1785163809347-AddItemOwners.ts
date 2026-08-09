/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    createConstraintIfNotExists,
    dropColumnIfExists,
    dropFkConstraintIfExists
} from "../modules/database/utils/migration-helper";

export class AddItemOwners1785163809347 implements MigrationInterface {
    name = 'AddItemOwners1785163809347'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await addColumnIfNotExists(queryRunner, 'packing_items', 'user_id', 'int', 'NULL');
        await addColumnIfNotExists(queryRunner, 'packing_items', 'guest_id', 'varchar(36)', 'NULL');
        await addColumnIfNotExists(queryRunner, 'activity_slots', 'user_id', 'int', 'NULL');
        await addColumnIfNotExists(queryRunner, 'activity_slots', 'guest_id', 'varchar(36)', 'NULL');

        await createConstraintIfNotExists(queryRunner, 'packing_items', 'FK_a0bad64d810ac4e76c23b86785d', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT')
        await createConstraintIfNotExists(queryRunner, 'packing_items', 'FK_9cbf247de70a55b58841e7b0941', 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT')
        await createConstraintIfNotExists(queryRunner, 'activity_slots', 'FK_01ebc30d7c6c9f3c764be121cda', 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT')
        await createConstraintIfNotExists(queryRunner, 'activity_slots', 'FK_c4e8f0a94193ce0883305a90e88', 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await dropFkConstraintIfExists(queryRunner, 'activity_slots', 'FK_c4e8f0a94193ce0883305a90e88');
        await dropFkConstraintIfExists(queryRunner, 'activity_slots', 'FK_01ebc30d7c6c9f3c764be121cda');
        await dropFkConstraintIfExists(queryRunner, 'packing_items', 'FK_9cbf247de70a55b58841e7b0941');
        await dropFkConstraintIfExists(queryRunner, 'packing_items', 'FK_a0bad64d810ac4e76c23b86785d');

        await dropColumnIfExists(queryRunner, 'activity_slots', 'guest_id');
        await dropColumnIfExists(queryRunner, 'activity_slots', 'user_id');
        await dropColumnIfExists(queryRunner, 'packing_items', 'guest_id');
        await dropColumnIfExists(queryRunner, 'packing_items', 'user_id');
    }

}
