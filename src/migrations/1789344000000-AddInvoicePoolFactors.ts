/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {addColumnIfNotExists, columnExists, dropColumnIfExists, tableExists} from "../modules/database/utils/migration-helper";

export class AddInvoicePoolFactors1789344000000 implements MigrationInterface {
    name = "AddInvoicePoolFactors1789344000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await tableExists(queryRunner, "event_invoice_assignments")) {
            await addColumnIfNotExists(queryRunner, "event_invoice_assignments", "factor", "decimal(10,4)", "NOT NULL DEFAULT 1.0000");
        }
        if (await tableExists(queryRunner, "event_invoice_pools")) {
            // Preserve previously calculated shares and payment statuses during upgrades.
            const hasRecalculationFlag = await columnExists(queryRunner, "event_invoice_pools", "needs_recalculation");
            await addColumnIfNotExists(queryRunner, "event_invoice_pools", "needs_recalculation", "tinyint", "NOT NULL DEFAULT 0");
            await addColumnIfNotExists(queryRunner, "event_invoice_pools", "calculation_revision", "int unsigned", "NOT NULL DEFAULT 0");
            if (!hasRecalculationFlag) {
                await queryRunner.query("UPDATE `event_invoice_pools` SET `needs_recalculation` = 1 WHERE `status` = 'CLOSED'");
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await tableExists(queryRunner, "event_invoice_pools")) {
            await dropColumnIfExists(queryRunner, "event_invoice_pools", "calculation_revision");
            await dropColumnIfExists(queryRunner, "event_invoice_pools", "needs_recalculation");
        }
        if (await tableExists(queryRunner, "event_invoice_assignments")) {
            await dropColumnIfExists(queryRunner, "event_invoice_assignments", "factor");
        }
    }
}
