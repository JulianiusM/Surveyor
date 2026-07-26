import {MigrationInterface, QueryRunner} from "typeorm";

export class AddNightBasedInvoiceDist1785039317554 implements MigrationInterface {
    name = 'AddNightBasedInvoiceDist1785039317554'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`distribution_method\` \`distribution_method\` enum ('EQUAL', 'TIME_BASED', 'NIGHTS') NOT NULL DEFAULT 'EQUAL'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`event_invoice_pools\` CHANGE \`distribution_method\` \`distribution_method\` enum ('EQUAL', 'TIME_BASED') NOT NULL DEFAULT 'EQUAL'`);
    }

}
