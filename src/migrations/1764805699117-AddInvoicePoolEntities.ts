import {MigrationInterface, QueryRunner} from "typeorm";

export class AddInvoicePoolEntities1764805699117 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create event_invoice_pools table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_invoice_pools (
                id VARCHAR(36) NOT NULL,
                event_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT NULL,
                status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
                is_default TINYINT(1) NOT NULL DEFAULT 0,
                assign_all TINYINT(1) NOT NULL DEFAULT 1,
                total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                open_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                outstanding_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                additional_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                payable_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                closed_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                CONSTRAINT fk_event_invoice_pool_event
                    FOREIGN KEY (event_id) REFERENCES surveyor.events (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Create event_invoices table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_invoices (
                id INT NOT NULL AUTO_INCREMENT,
                pool_id VARCHAR(36) NOT NULL,
                registration_id INT NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                proof_path VARCHAR(255) NULL,
                proof_name VARCHAR(255) NULL,
                proof_mime VARCHAR(80) NULL,
                description TEXT NULL,
                status ENUM('NEW', 'APPROVED', 'CLOSED') NOT NULL DEFAULT 'NEW',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                CONSTRAINT fk_event_invoice_pool
                    FOREIGN KEY (pool_id) REFERENCES surveyor.event_invoice_pools (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_invoice_registration
                    FOREIGN KEY (registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Create event_invoice_assignments table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_invoice_assignments (
                id INT NOT NULL AUTO_INCREMENT,
                pool_id VARCHAR(36) NOT NULL,
                registration_id INT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                CONSTRAINT fk_event_invoice_assignment_pool
                    FOREIGN KEY (pool_id) REFERENCES surveyor.event_invoice_pools (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_invoice_assignment_registration
                    FOREIGN KEY (registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Create event_pool_takeovers table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_pool_takeovers (
                id INT NOT NULL AUTO_INCREMENT,
                pool_id VARCHAR(36) NOT NULL,
                payer_registration_id INT NOT NULL,
                beneficiary_registration_id INT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE INDEX uniq_pool_beneficiary (pool_id, beneficiary_registration_id),
                CONSTRAINT fk_event_pool_takeover_pool
                    FOREIGN KEY (pool_id) REFERENCES surveyor.event_invoice_pools (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_pool_takeover_payer
                    FOREIGN KEY (payer_registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_pool_takeover_beneficiary
                    FOREIGN KEY (beneficiary_registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Create event_invoice_shares table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_invoice_shares (
                id INT NOT NULL AUTO_INCREMENT,
                pool_id VARCHAR(36) NOT NULL,
                registration_id INT NOT NULL,
                base_share_amount DECIMAL(10, 2) NOT NULL,
                extra_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                share_amount DECIMAL(10, 2) NOT NULL,
                note TEXT NULL,
                is_paid TINYINT(1) NOT NULL DEFAULT 0,
                paid_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                CONSTRAINT fk_event_invoice_share_pool
                    FOREIGN KEY (pool_id) REFERENCES surveyor.event_invoice_pools (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_invoice_share_registration
                    FOREIGN KEY (registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Create event_invoice_surcharges table
        await queryRunner.query(`
            CREATE TABLE surveyor.event_invoice_surcharges (
                id INT NOT NULL AUTO_INCREMENT,
                pool_id VARCHAR(36) NOT NULL,
                registration_id INT NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                note TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                CONSTRAINT fk_event_invoice_surcharge_pool
                    FOREIGN KEY (pool_id) REFERENCES surveyor.event_invoice_pools (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_event_invoice_surcharge_registration
                    FOREIGN KEY (registration_id) REFERENCES surveyor.event_registrations (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_invoice_surcharges`);
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_invoice_shares`);
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_pool_takeovers`);
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_invoice_assignments`);
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_invoices`);
        await queryRunner.query(`DROP TABLE IF EXISTS surveyor.event_invoice_pools`);
    }

}
