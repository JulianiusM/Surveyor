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
import {addColumnIfNotExists, dropColumnIfExists} from "../modules/database/utils/migration-helper";

export class AddRegistrationDeadlineSettings1786335515684 implements MigrationInterface {
    name = 'AddRegistrationDeadlineSettings1786335515684'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await addColumnIfNotExists(queryRunner, 'events', 'allow_reg_date_update', 'tinyint', 'NOT NULL DEFAULT \'0\'');
        await addColumnIfNotExists(queryRunner, 'events', 'allow_reg_cancel', 'tinyint', 'NOT NULL DEFAULT \'0\'');
        await addColumnIfNotExists(queryRunner, 'events', 'allow_reg_diet_update', 'tinyint', 'NOT NULL DEFAULT \'0\'');
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`activity_plans\`
            CHANGE \`allow_overfill_after_full\` \`allow_overfill_after_full\` tinyint NOT NULL DEFAULT 0`);
        await dropColumnIfExists(queryRunner, 'evente', 'allow_reg_diet_update');
        await dropColumnIfExists(queryRunner, 'evente', 'allow_reg_cancel');
        await dropColumnIfExists(queryRunner, 'evente', 'allow_reg_date_update');
    }

}
