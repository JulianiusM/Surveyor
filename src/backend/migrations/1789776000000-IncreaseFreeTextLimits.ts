/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {columnExists} from "../modules/database/utils/migration-helper";

const columns = [
    {table: "activity_roles", column: "description", type: "text"},
    {table: "activity_slots", column: "description", type: "text"},
    {table: "drivers_items", column: "description", type: "text"},
    {table: "packing_items", column: "description", type: "text"},
    {table: "survey_combinations", column: "description", type: "text"},
    {table: "event_registration_dietary", column: "additional_info", type: "varchar(4000)"},
];

export class IncreaseFreeTextLimits1789776000000 implements MigrationInterface {
    name = "IncreaseFreeTextLimits1789776000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const {table, column, type} of columns) {
            if (!await columnExists(queryRunner, table, column)) continue;
            await queryRunner.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${type} NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // MariaDB DDL commits implicitly. Check every column before narrowing any of them.
        for (const {table, column} of columns) {
            if (!await columnExists(queryRunner, table, column)) continue;
            const rows = await queryRunner.query(
                `SELECT 1 FROM \`${table}\` WHERE CHAR_LENGTH(\`${column}\`) > 255 LIMIT 1`,
            );
            if (rows.length) {
                throw new Error(`Cannot revert free-text limits: ${table}.${column} contains more than 255 characters. Preserve the longer content and use a compatible application version.`);
            }
        }
        for (const {table, column} of columns) {
            if (!await columnExists(queryRunner, table, column)) continue;
            await queryRunner.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` varchar(255) NULL`);
        }
    }
}
