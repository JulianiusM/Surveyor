/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner, TableForeignKey} from "typeorm";
import {addColumnIfNotExists, columnExists, dropColumnIfExists, tableExists} from "../modules/database/utils/migration-helper";

const TABLE = "event_invoices";
const RECORDER_COLUMN = "recorded_by_profile_id";

export class AddOrganizerInvoices1789603200000 implements MigrationInterface {
    name = "AddOrganizerInvoices1789603200000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;
        const table = await queryRunner.getTable(TABLE);
        const registrationColumn = table?.findColumnByName("registration_id");
        if (registrationColumn && !registrationColumn.isNullable) {
            const nullableRegistration = registrationColumn.clone();
            nullableRegistration.isNullable = true;
            await queryRunner.changeColumn(TABLE, registrationColumn, nullableRegistration);
        }

        if (!await columnExists(queryRunner, TABLE, RECORDER_COLUMN)) {
            // Match the referenced UUID column's exact storage and collation on existing installations.
            const profileId = (await queryRunner.getTable("profiles"))?.findColumnByName("id");
            if (!profileId) throw new Error("Cannot add organizer invoice attribution without profiles.id");
            const recorder = profileId.clone();
            recorder.name = RECORDER_COLUMN;
            recorder.isPrimary = false;
            recorder.isUnique = false;
            recorder.isGenerated = false;
            recorder.generationStrategy = undefined;
            recorder.default = undefined;
            recorder.isNullable = true;
            await queryRunner.addColumn(TABLE, recorder);
        }
        await addColumnIfNotExists(queryRunner, TABLE, "recorded_by_name", "varchar(50)", "NULL");
        const updated = await queryRunner.getTable(TABLE);
        if (!updated?.foreignKeys.some((foreignKey) => foreignKey.columnNames.includes(RECORDER_COLUMN))) {
            await queryRunner.createForeignKey(TABLE, new TableForeignKey({
                name: "FK_event_invoices_recorded_by_profile",
                columnNames: [RECORDER_COLUMN],
                referencedTableName: "profiles",
                referencedColumnNames: ["id"],
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            }));
        }
        // Existing participant invoices keep their registration attribution and all saved settlement data.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;
        const [remaining] = await queryRunner.query(`SELECT COUNT(*) AS count FROM \`${TABLE}\` WHERE \`registration_id\` IS NULL`);
        if (Number(remaining.count) > 0) {
            throw new Error("Cannot revert organizer invoices while pool costs without participant registrations exist. Preserve these costs and use a compatible application version.");
        }
        const table = await queryRunner.getTable(TABLE);
        for (const foreignKey of table?.foreignKeys.filter((key) => key.columnNames.includes(RECORDER_COLUMN)) ?? []) {
            await queryRunner.dropForeignKey(TABLE, foreignKey);
        }
        await dropColumnIfExists(queryRunner, TABLE, RECORDER_COLUMN);
        await dropColumnIfExists(queryRunner, TABLE, "recorded_by_name");
        // The earlier relation was nullable by default; leave its original storage contract intact.
    }
}
