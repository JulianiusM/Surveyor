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
const PLAN_TABLE = "activity_plans";

interface IdColumnMetadata {
    columnType: string;
    characterSet: string | null;
    collation: string | null;
}

function assertSafeSqlName(value: string, label: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
        throw new Error(`Unexpected ${label} in activity plan ID metadata`);
    }
}

async function alignEntityIdWithActivityPlan(queryRunner: QueryRunner): Promise<void> {
    const columns: IdColumnMetadata[] = await queryRunner.query(`
        SELECT COLUMN_TYPE AS columnType,
               CHARACTER_SET_NAME AS characterSet,
               COLLATION_NAME AS collation
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'id'
    `, [PLAN_TABLE]);
    const planId = columns[0];

    if (!planId) {
        throw new Error("Activity plan ID metadata is missing");
    }

    const isTextId = /^(?:var)?char\([1-9][0-9]*\)$/i.test(planId.columnType);
    const isBinaryId = /^(?:var)?binary\([1-9][0-9]*\)$/i.test(planId.columnType);
    const isNativeUuid = /^uuid$/i.test(planId.columnType);
    if (!isTextId && !isBinaryId && !isNativeUuid) {
        throw new Error("Unexpected column type in activity plan ID metadata");
    }

    let characterDefinition = "";
    if (isTextId) {
        if (!planId.characterSet || !planId.collation) {
            throw new Error("Activity plan text ID character metadata is missing");
        }
        assertSafeSqlName(planId.characterSet, "character set");
        assertSafeSqlName(planId.collation, "collation");
        characterDefinition = ` CHARACTER SET ${planId.characterSet} COLLATE ${planId.collation}`;
    }

    // MariaDB 10.7+ uses native UUID columns while older MariaDB/MySQL versions use text UUIDs.
    // Foreign keys require the child to match the referenced column's exact storage definition.
    await queryRunner.query(`ALTER TABLE \`${TABLE}\`
        MODIFY \`entity_id\` ${planId.columnType}${characterDefinition} NOT NULL`);
}

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

        const existingPlanForeignKeys: Array<{count: number | string}> = await queryRunner.query(`
            SELECT COUNT(*) AS count
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = 'entity_id'
              AND REFERENCED_TABLE_NAME = '${PLAN_TABLE}'
              AND REFERENCED_COLUMN_NAME = 'id'
        `, [TABLE]);

        const hasPlanTable = await tableExists(queryRunner, PLAN_TABLE);
        const hasPlanForeignKey = Number(existingPlanForeignKeys[0]?.count ?? 0) > 0;
        if (hasPlanTable && !hasPlanForeignKey) {
            await alignEntityIdWithActivityPlan(queryRunner);
        }

        await createUniqueIndexIfNotExists(
            queryRunner,
            TABLE,
            "uk_activity_plan_stay_days",
            "\`entity_id\`, \`stay_days\`",
        );

        if (hasPlanTable && !hasPlanForeignKey) {
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
