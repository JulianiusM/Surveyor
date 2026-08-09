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

export class AddHeaderImgs1783180919744 implements MigrationInterface {
    name = 'AddHeaderImgs1783180919744'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            "drivers_lists",
            "packing_lists",
            "events",
            "activity_plans",
            "surveys",
        ];

        for (const table of tables) {
            await addColumnIfNotExists(queryRunner, table, "header_img", "varchar(255)", "NULL");
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            "surveys",
            "activity_plans",
            "events",
            "packing_lists",
            "drivers_lists",
        ];

        for (const table of tables) {
            await dropColumnIfExists(queryRunner, table, "header_img");
        }
    }
}
