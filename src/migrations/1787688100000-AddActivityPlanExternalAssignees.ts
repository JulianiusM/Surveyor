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
    dropColumnIfExists,
    tableExists,
} from "../modules/database/utils/migration-helper";

const TABLE = "activity_plans";
const COLUMN = "allow_external_assignees";

export class AddActivityPlanExternalAssignees1787688100000 implements MigrationInterface {
    name = "AddActivityPlanExternalAssignees1787688100000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;
        await addColumnIfNotExists(queryRunner, TABLE, COLUMN, "tinyint", "NOT NULL DEFAULT 0");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;
        await dropColumnIfExists(queryRunner, TABLE, COLUMN);
    }
}
