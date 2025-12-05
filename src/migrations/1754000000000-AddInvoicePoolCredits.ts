import {MigrationInterface, QueryRunner} from "typeorm";

export class AddInvoicePoolCredits1754000000000 implements MigrationInterface {
    name = 'AddInvoicePoolCredits1754000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Make migration idempotent by checking if columns exist before adding
        const hasSubtractPersonalInvoices = await queryRunner.hasColumn('event_invoice_pools', 'subtract_personal_invoices');
        if (!hasSubtractPersonalInvoices) {
            await queryRunner.query(`ALTER TABLE event_invoice_pools ADD COLUMN subtract_personal_invoices TINYINT(1) NOT NULL DEFAULT 1`);
        }
        
        const hasSurchargeOffsetAmount = await queryRunner.hasColumn('event_invoice_pools', 'surcharge_offset_amount');
        if (!hasSurchargeOffsetAmount) {
            await queryRunner.query(`ALTER TABLE event_invoice_pools ADD COLUMN surcharge_offset_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00`);
        }
        
        const hasSubtractFromPool = await queryRunner.hasColumn('event_invoice_surcharges', 'subtract_from_pool');
        if (!hasSubtractFromPool) {
            await queryRunner.query(`ALTER TABLE event_invoice_surcharges ADD COLUMN subtract_from_pool TINYINT(1) NOT NULL DEFAULT 1`);
        }
        
        const hasIsExempt = await queryRunner.hasColumn('event_invoice_assignments', 'is_exempt');
        if (!hasIsExempt) {
            await queryRunner.query(`ALTER TABLE event_invoice_assignments ADD COLUMN is_exempt TINYINT(1) NOT NULL DEFAULT 0`);
        }
        
        const hasInvoiceCreditAmount = await queryRunner.hasColumn('event_invoice_shares', 'invoice_credit_amount');
        if (!hasInvoiceCreditAmount) {
            await queryRunner.query(`ALTER TABLE event_invoice_shares ADD COLUMN invoice_credit_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE event_invoice_shares DROP COLUMN invoice_credit_amount`);
        await queryRunner.query(`ALTER TABLE event_invoice_assignments DROP COLUMN is_exempt`);
        await queryRunner.query(`ALTER TABLE event_invoice_surcharges DROP COLUMN subtract_from_pool`);
        await queryRunner.query(`ALTER TABLE event_invoice_pools DROP COLUMN surcharge_offset_amount`);
        await queryRunner.query(`ALTER TABLE event_invoice_pools DROP COLUMN subtract_personal_invoices`);
    }
}
