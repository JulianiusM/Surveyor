/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {addColumnIfNotExists, columnExists, dropColumnIfExists, tableExists} from "../modules/database/utils/migration-helper";

export class AddInvoiceShareRounding1789516800000 implements MigrationInterface {
    name = "AddInvoiceShareRounding1789516800000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, "event_invoice_pools")) return;
        const alreadyAdded = await columnExists(queryRunner, "event_invoice_pools", "round_up_shares");
        await addColumnIfNotExists(queryRunner, "event_invoice_pools", "round_up_shares", "tinyint", "NOT NULL DEFAULT 1");
        if (!alreadyAdded) {
            // Preserve settlement records and their original snapshot until an explicit calculation.
            await queryRunner.query("UPDATE `event_invoice_pools` SET `needs_recalculation` = 1, `calculation_revision` = `calculation_revision` + 1 WHERE `status` = 'CLOSED'");
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await tableExists(queryRunner, "event_invoice_pools")) {
            await dropColumnIfExists(queryRunner, "event_invoice_pools", "round_up_shares");
        }
    }
}
