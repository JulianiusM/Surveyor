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

const TABLE = "event_invoices";

export class AddInvoiceReviewHistory1787875200000 implements MigrationInterface {
    name = "AddInvoiceReviewHistory1787875200000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        await addColumnIfNotExists(queryRunner, TABLE, "corrected_amount", "decimal(10,2)", "NULL");
        await addColumnIfNotExists(queryRunner, TABLE, "corrected_description", "text", "NULL");
        await addColumnIfNotExists(queryRunner, TABLE, "rejection_reason", "text", "NULL");
        await queryRunner.query(`ALTER TABLE \`${TABLE}\`
            CHANGE \`status\` \`status\` enum ('NEW', 'APPROVED', 'REJECTED', 'CLOSED') NOT NULL DEFAULT 'NEW'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        await queryRunner.query(`UPDATE \`${TABLE}\` SET \`status\` = 'NEW' WHERE \`status\` = 'REJECTED'`);
        await queryRunner.query(`ALTER TABLE \`${TABLE}\`
            CHANGE \`status\` \`status\` enum ('NEW', 'APPROVED', 'CLOSED') NOT NULL DEFAULT 'NEW'`);
        await dropColumnIfExists(queryRunner, TABLE, "rejection_reason");
        await dropColumnIfExists(queryRunner, TABLE, "corrected_description");
        await dropColumnIfExists(queryRunner, TABLE, "corrected_amount");
    }
}
