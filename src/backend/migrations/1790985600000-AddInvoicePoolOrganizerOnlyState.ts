/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {tableExists} from "../modules/database/utils/migration-helper";

/** Add the independent organizer-invoice state to existing installations. */
export class AddInvoicePoolOrganizerOnlyState1790985600000 implements MigrationInterface {
    name = "AddInvoicePoolOrganizerOnlyState1790985600000";

    /** Extend the existing OPEN/CLOSED enum without changing any pool's current state. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Bootstrap may already contain the final enum; missing tables follow the established migration pattern.
        if (!await tableExists(queryRunner, "event_invoice_pools")) return;
        const status = (await queryRunner.getTable("event_invoice_pools"))?.findColumnByName("status");
        if (!status) return;
        if (status.enum?.includes("ORGANIZER_ONLY")) return;

        // Append the new state while preserving the existing values and OPEN creation default.
        // This migration changes schema only; no submission access or financial data is rewritten.
        await queryRunner.query("ALTER TABLE `event_invoice_pools` MODIFY `status` enum('OPEN','CLOSED','ORGANIZER_ONLY') NOT NULL DEFAULT 'OPEN'");
    }

    /** Restore the previous enum only when no pool still requires organizer-only invoice access. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, "event_invoice_pools")) return;
        // Refuse to silently reopen participant submissions or calculate pools as a side effect of a downgrade.
        const [restricted] = await queryRunner.query("SELECT COUNT(*) AS count FROM `event_invoice_pools` WHERE `status` = 'ORGANIZER_ONLY'");
        if (Number(restricted.count) > 0) {
            throw new Error("Cannot remove the organizer-only invoice pool state while pools still use it. Open participant invoices or calculate and close those pools first.");
        }
        // Existing OPEN/CLOSED records and all their invoices, shares, snapshots, and revisions remain intact.
        await queryRunner.query("ALTER TABLE `event_invoice_pools` MODIFY `status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN'");
    }
}
