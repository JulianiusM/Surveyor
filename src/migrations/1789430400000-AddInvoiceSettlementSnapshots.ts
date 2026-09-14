/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {addColumnIfNotExists, dropColumnIfExists, tableExists} from "../modules/database/utils/migration-helper";

export class AddInvoiceSettlementSnapshots1789430400000 implements MigrationInterface {
    name = "AddInvoiceSettlementSnapshots1789430400000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await tableExists(queryRunner, "event_invoice_shares")) {
            // Existing paid markers retain their meaning until their first recalculation.
            await addColumnIfNotExists(queryRunner, "event_invoice_shares", "payment_credit_amount", "decimal(10,2)", "NOT NULL DEFAULT 0.00");
        }
        if (await tableExists(queryRunner, "event_invoice_pools")) {
            await addColumnIfNotExists(queryRunner, "event_invoice_pools", "send_calculation_emails", "tinyint", "NOT NULL DEFAULT 1");
            // Earlier releases did not retain the last calculated inputs; do not invent a baseline.
            await addColumnIfNotExists(queryRunner, "event_invoice_pools", "calculation_snapshot", "json", "NULL");
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await tableExists(queryRunner, "event_invoice_pools")) {
            await dropColumnIfExists(queryRunner, "event_invoice_pools", "calculation_snapshot");
            await dropColumnIfExists(queryRunner, "event_invoice_pools", "send_calculation_emails");
        }
        if (await tableExists(queryRunner, "event_invoice_shares")) {
            await dropColumnIfExists(queryRunner, "event_invoice_shares", "payment_credit_amount");
        }
    }
}
