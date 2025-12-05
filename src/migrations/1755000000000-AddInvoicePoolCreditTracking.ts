import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class AddInvoicePoolCreditTracking1755000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn("event_invoice_pools", new TableColumn({
            name: "credit_amount",
            type: "decimal",
            precision: 10,
            scale: 2,
            default: "0.00",
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("event_invoice_pools", "credit_amount");
    }
}
