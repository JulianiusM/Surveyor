import {MigrationInterface, QueryRunner} from "typeorm";

export class AddInvoicePoolCredits1754000000000 implements MigrationInterface {
    name = 'AddInvoicePoolCredits1754000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE event_invoice_pools ADD COLUMN subtract_personal_invoices TINYINT(1) NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE event_invoice_pools ADD COLUMN surcharge_offset_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00`);
        await queryRunner.query(`ALTER TABLE event_invoice_surcharges ADD COLUMN subtract_from_pool TINYINT(1) NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE event_invoice_assignments ADD COLUMN is_exempt TINYINT(1) NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE event_invoice_shares ADD COLUMN invoice_credit_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE event_invoice_shares DROP COLUMN invoice_credit_amount`);
        await queryRunner.query(`ALTER TABLE event_invoice_assignments DROP COLUMN is_exempt`);
        await queryRunner.query(`ALTER TABLE event_invoice_surcharges DROP COLUMN subtract_from_pool`);
        await queryRunner.query(`ALTER TABLE event_invoice_pools DROP COLUMN surcharge_offset_amount`);
        await queryRunner.query(`ALTER TABLE event_invoice_pools DROP COLUMN subtract_personal_invoices`);
    }
}
