/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from 'typeorm';
import {tableExists} from '../modules/database/utils/migration-helper';

export class AddInvoiceRetraction1789689600000 implements MigrationInterface {
    name = "AddInvoiceRetraction1789689600000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, "event_invoices")) return;
        const status = (await queryRunner.getTable("event_invoices"))?.findColumnByName("status");
        if (!status || status.enum?.includes("RETRACTED")) return;
        await queryRunner.query("ALTER TABLE `event_invoices` MODIFY `status` enum('NEW','APPROVED','REJECTED','CLOSED','RETRACTED') NOT NULL DEFAULT 'NEW'");
    }

    /** Restore the previous status domain only when no retracted history is present. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, "event_invoices")) return;
        // MariaDB enum narrowing would discard the meaning of retained history;
        // fail before DDL instead of coercing or deleting those invoices.
        const [retracted] = await queryRunner.query("SELECT COUNT(*) AS count FROM `event_invoices` WHERE `status` = 'RETRACTED'");
        if (Number(retracted.count) > 0) {
            throw new Error("Cannot revert invoice retraction while retracted invoices exist. Preserve their history and use a compatible application version.");
        }
        await queryRunner.query("ALTER TABLE `event_invoices` MODIFY `status` enum('NEW','APPROVED','REJECTED','CLOSED') NOT NULL DEFAULT 'NEW'");
    }
}
