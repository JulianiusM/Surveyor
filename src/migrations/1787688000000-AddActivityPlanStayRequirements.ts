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
    createUniqueIndexIfNotExists,
    tableExists,
} from "../modules/database/utils/migration-helper";

const TABLE = "activity_plan_stay_requirements";

export class AddActivityPlanStayRequirements1787688000000 implements MigrationInterface {
    name = "AddActivityPlanStayRequirements1787688000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`stay_days\` smallint NOT NULL,
            \`required_shifts\` smallint NOT NULL,
            \`entity_id\` varchar(36) NOT NULL,
            \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB`);

        // Complete a partially-created table so rerunning this migration is safe.
        await addColumnIfNotExists(queryRunner, TABLE, "id", "int", "NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST");
        await addColumnIfNotExists(queryRunner, TABLE, "stay_days", "smallint", "NOT NULL");
        await addColumnIfNotExists(queryRunner, TABLE, "required_shifts", "smallint", "NOT NULL");
        await addColumnIfNotExists(queryRunner, TABLE, "entity_id", "varchar(36)", "NOT NULL");
        await addColumnIfNotExists(queryRunner, TABLE, "created_at", "timestamp(6)", "NOT NULL DEFAULT CURRENT_TIMESTAMP(6)");
        await addColumnIfNotExists(
            queryRunner,
            TABLE,
            "updated_at",
            "timestamp(6)",
            "NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)",
        );

        await createUniqueIndexIfNotExists(
            queryRunner,
            TABLE,
            "uk_activity_plan_stay_days",
            "\`entity_id\`, \`stay_days\`",
        );

        const existingPlanForeignKeys: Array<{count: number | string}> = await queryRunner.query(`
            SELECT COUNT(*) AS count
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = 'entity_id'
              AND REFERENCED_TABLE_NAME = 'activity_plans'
              AND REFERENCED_COLUMN_NAME = 'id'
        `, [TABLE]);

        if (await tableExists(queryRunner, "activity_plans") && Number(existingPlanForeignKeys[0]?.count ?? 0) === 0) {
            await createConstraintIfNotExists(
                queryRunner,
                TABLE,
                "fk_activity_plan_stay_requirement_plan",
                "FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE",
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS \`${TABLE}\``);
    }
}
