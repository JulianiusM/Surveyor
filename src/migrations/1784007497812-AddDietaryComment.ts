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

export class AddDietaryComment1784007497812 implements MigrationInterface {
    name = 'AddDietaryComment1784007497812'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await addColumnIfNotExists(queryRunner, "events", "allow_diet_comment", "tinyint(1)", "NOT NULL DEFAULT '0'");
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\`
            CHANGE \`choice\` \`choice\` enum ('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES', 'COMMENT') NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE
                                 FROM \`event_registration_dietary\`
                                 WHERE \`choice\` = 'COMMENT'`);
        await queryRunner.query(`ALTER TABLE \`event_registration_dietary\`
            CHANGE \`choice\` \`choice\` enum ('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES') NOT NULL`);
        await dropColumnIfExists(queryRunner, "events", "allow_diet_comment");
    }

}
