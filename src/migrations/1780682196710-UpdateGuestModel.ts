import {MigrationInterface, QueryRunner} from "typeorm";

interface ForeignKeyDefinition {
    name: string;
    table: string;
    definition: string;
}

interface IndexDefinition {
    name: string;
    table: string;
    definition: string;
}

interface GuestIdColumnDefinition {
    table: string;
    varcharDefinition: string;
    intDefinition: string;
}

export class UpdateGuestModel1780682196710 implements MigrationInterface {
    name = 'UpdateGuestModel1780682196710'

    private readonly guestIdColumns: GuestIdColumnDefinition[] = [
        {
            table: 'activity_assignment_recommendations',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'packing_assignments',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'drivers_items',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'drivers_assignments',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'event_registrations',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'event_reg_links',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'survey_responses',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'activity_plan_requirement_overrides',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
        {
            table: 'activity_assignments',
            varcharDefinition: '`guest_id` varchar(36) NULL',
            intDefinition: '`guest_id` int NULL',
        },
    ];

    private readonly guestIndexes: IndexDefinition[] = [
        {
            name: 'uk_packing_assignment_guest',
            table: 'packing_assignments',
            definition: 'CREATE UNIQUE INDEX `uk_packing_assignment_guest` ON `packing_assignments` (`item_id`, `guest_id`)',
        },
        {
            name: 'uk_driver_assignment_guest',
            table: 'drivers_assignments',
            definition: 'CREATE UNIQUE INDEX `uk_driver_assignment_guest` ON `drivers_assignments` (`item_id`, `guest_id`)',
        },
        {
            name: 'uk_event_participant',
            table: 'event_registrations',
            definition: 'CREATE UNIQUE INDEX `uk_event_participant` ON `event_registrations` (`event_id`, `user_id`, `guest_id`)',
        },
        {
            name: 'uk_plan_participant_role',
            table: 'activity_plan_requirement_overrides',
            definition: 'CREATE UNIQUE INDEX `uk_plan_participant_role` ON `activity_plan_requirement_overrides` (`plan_id`, `user_id`, `guest_id`, `role_id`)',
        },
        {
            name: 'uk_activity_assignment_guest',
            table: 'activity_assignments',
            definition: 'CREATE UNIQUE INDEX `uk_activity_assignment_guest` ON `activity_assignments` (`slot_id`, `guest_id`)',
        },
    ];

    private readonly guestForeignKeys: ForeignKeyDefinition[] = [
        {
            name: 'FK_caa6eb650afe861c890f134afa9',
            table: 'activity_assignment_recommendations',
            definition: 'ALTER TABLE `activity_assignment_recommendations` ADD CONSTRAINT `FK_caa6eb650afe861c890f134afa9` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION',
        },
        {
            name: 'FK_c217003837bbf8a7b3a2c1eeb80',
            table: 'packing_assignments',
            definition: 'ALTER TABLE `packing_assignments` ADD CONSTRAINT `FK_c217003837bbf8a7b3a2c1eeb80` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_ccd3f1ec65169179b395e5ba903',
            table: 'drivers_items',
            definition: 'ALTER TABLE `drivers_items` ADD CONSTRAINT `FK_ccd3f1ec65169179b395e5ba903` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_dc269892d22b330ef2c60aead83',
            table: 'drivers_assignments',
            definition: 'ALTER TABLE `drivers_assignments` ADD CONSTRAINT `FK_dc269892d22b330ef2c60aead83` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_52165ba60768fd87815d733e562',
            table: 'event_registrations',
            definition: 'ALTER TABLE `event_registrations` ADD CONSTRAINT `FK_52165ba60768fd87815d733e562` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_febc2c20c1ea64180fa09040f28',
            table: 'event_reg_links',
            definition: 'ALTER TABLE `event_reg_links` ADD CONSTRAINT `FK_febc2c20c1ea64180fa09040f28` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_14bcf49cc71d7f857892abbfb0e',
            table: 'survey_responses',
            definition: 'ALTER TABLE `survey_responses` ADD CONSTRAINT `FK_14bcf49cc71d7f857892abbfb0e` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
        },
        {
            name: 'FK_d6ad3e7aaa1d11ef848f03a80e5',
            table: 'activity_plan_requirement_overrides',
            definition: 'ALTER TABLE `activity_plan_requirement_overrides` ADD CONSTRAINT `FK_d6ad3e7aaa1d11ef848f03a80e5` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        },
        {
            name: 'FK_9e96938fab1057b20f085550ed0',
            table: 'activity_assignments',
            definition: 'ALTER TABLE `activity_assignments` ADD CONSTRAINT `FK_9e96938fab1057b20f085550ed0` FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.addColumnIfMissing(queryRunner, 'guests', 'token', '`token` varchar(255) NOT NULL');
        await this.createIndexIfMissing(
            queryRunner,
            'guests',
            'IDX_3d84b6c2d8e540af9da1cf265e',
            'CREATE UNIQUE INDEX `IDX_3d84b6c2d8e540af9da1cf265e` ON `guests` (`token`)'
        );

        for (const foreignKey of this.guestForeignKeys) {
            await this.dropForeignKeyIfExists(queryRunner, foreignKey.table, foreignKey.name);
        }

        for (const index of this.guestIndexes) {
            await this.dropIndexIfExists(queryRunner, index.table, index.name);
        }

        for (const column of this.guestIdColumns) {
            await this.replaceColumnIfNotType(queryRunner, column.table, 'guest_id', 'varchar', column.varcharDefinition);
        }

        await queryRunner.query(`ALTER TABLE ` + this.escapeIdentifier('activity_plans') + ` CHANGE ` + this.escapeIdentifier('allow_overfill_after_full') + ` ` + this.escapeIdentifier('allow_overfill_after_full') + ` tinyint(1) NOT NULL DEFAULT 0`);
        await this.replaceGuestPrimaryKeyIfNotType(queryRunner, 'varchar', '`id` varchar(36) NOT NULL PRIMARY KEY');

        for (const index of this.guestIndexes) {
            await this.createIndexIfMissing(queryRunner, index.table, index.name, index.definition);
        }

        for (const foreignKey of this.guestForeignKeys) {
            await this.addForeignKeyIfMissing(queryRunner, foreignKey);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const foreignKey of [...this.guestForeignKeys].reverse()) {
            await this.dropForeignKeyIfExists(queryRunner, foreignKey.table, foreignKey.name);
        }

        for (const index of [...this.guestIndexes].reverse()) {
            await this.dropIndexIfExists(queryRunner, index.table, index.name);
        }

        for (const column of [...this.guestIdColumns].reverse()) {
            await this.replaceColumnIfNotType(queryRunner, column.table, 'guest_id', 'int', column.intDefinition);
        }

        await this.replaceGuestPrimaryKeyIfNotType(queryRunner, 'int', '`id` int NOT NULL');
        await queryRunner.query(`ALTER TABLE ` + this.escapeIdentifier('activity_plans') + ` CHANGE ` + this.escapeIdentifier('allow_overfill_after_full') + ` ` + this.escapeIdentifier('allow_overfill_after_full') + ` tinyint(1) NOT NULL DEFAULT '0'`);

        for (const index of this.guestIndexes) {
            await this.createIndexIfMissing(queryRunner, index.table, index.name, index.definition);
        }

        for (const foreignKey of this.guestForeignKeys) {
            await this.addForeignKeyIfMissing(queryRunner, foreignKey);
        }

        await this.dropIndexIfExists(queryRunner, 'guests', 'IDX_3d84b6c2d8e540af9da1cf265e');
        await this.dropColumnIfExists(queryRunner, 'guests', 'token');
    }

    private async addColumnIfMissing(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        columnDefinition: string
    ): Promise<void> {
        if (await this.columnExists(queryRunner, tableName, columnName)) {
            return;
        }

        await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier(tableName)} ADD ${columnDefinition}`);
    }

    private async addForeignKeyIfMissing(
        queryRunner: QueryRunner,
        foreignKey: ForeignKeyDefinition
    ): Promise<void> {
        if (await this.foreignKeyExists(queryRunner, foreignKey.table, foreignKey.name)) {
            return;
        }

        await queryRunner.query(foreignKey.definition);
    }

    private async createIndexIfMissing(
        queryRunner: QueryRunner,
        tableName: string,
        indexName: string,
        indexDefinition: string
    ): Promise<void> {
        if (await this.indexExists(queryRunner, tableName, indexName)) {
            return;
        }

        await queryRunner.query(indexDefinition);
    }

    private async replaceColumnIfNotType(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        dataType: string,
        columnDefinition: string
    ): Promise<void> {
        if (await this.columnIsType(queryRunner, tableName, columnName, dataType)) {
            return;
        }

        await this.dropColumnIfExists(queryRunner, tableName, columnName);
        await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier(tableName)} ADD ${columnDefinition}`);
    }

    private async replaceGuestPrimaryKeyIfNotType(
        queryRunner: QueryRunner,
        dataType: string,
        columnDefinition: string
    ): Promise<void> {
        if (await this.columnIsType(queryRunner, 'guests', 'id', dataType)) {
            if (!await this.primaryKeyExists(queryRunner, 'guests')) {
                await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} ADD PRIMARY KEY (${this.escapeIdentifier('id')})`);
            }

            if (dataType === 'int') {
                await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} CHANGE ${this.escapeIdentifier('id')} ${this.escapeIdentifier('id')} int NOT NULL AUTO_INCREMENT`);
            }

            return;
        }

        if (await this.columnIsType(queryRunner, 'guests', 'id', 'int')) {
            await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} CHANGE ${this.escapeIdentifier('id')} ${this.escapeIdentifier('id')} int NOT NULL`);
        }

        if (await this.primaryKeyExists(queryRunner, 'guests')) {
            await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} DROP PRIMARY KEY`);
        }

        await this.dropColumnIfExists(queryRunner, 'guests', 'id');
        await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} ADD ${columnDefinition}`);

        if (!await this.primaryKeyExists(queryRunner, 'guests')) {
            await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} ADD PRIMARY KEY (${this.escapeIdentifier('id')})`);
        }

        if (dataType === 'int') {
            await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier('guests')} CHANGE ${this.escapeIdentifier('id')} ${this.escapeIdentifier('id')} int NOT NULL AUTO_INCREMENT`);
        }
    }

    private async dropColumnIfExists(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string
    ): Promise<void> {
        if (!await this.columnExists(queryRunner, tableName, columnName)) {
            return;
        }

        await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier(tableName)} DROP COLUMN ${this.escapeIdentifier(columnName)}`);
    }

    private async dropForeignKeyIfExists(
        queryRunner: QueryRunner,
        tableName: string,
        foreignKeyName: string
    ): Promise<void> {
        if (!await this.foreignKeyExists(queryRunner, tableName, foreignKeyName)) {
            return;
        }

        await queryRunner.query(`ALTER TABLE ${this.escapeIdentifier(tableName)} DROP FOREIGN KEY ${this.escapeIdentifier(foreignKeyName)}`);
    }

    private async dropIndexIfExists(
        queryRunner: QueryRunner,
        tableName: string,
        indexName: string
    ): Promise<void> {
        if (!await this.indexExists(queryRunner, tableName, indexName)) {
            return;
        }

        await queryRunner.query(`DROP INDEX ${this.escapeIdentifier(indexName)} ON ${this.escapeIdentifier(tableName)}`);
    }

    private async columnExists(queryRunner: QueryRunner, tableName: string, columnName: string): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
            [tableName, columnName]
        ) as unknown[];

        return rows.length > 0;
    }

    private async columnIsType(
        queryRunner: QueryRunner,
        tableName: string,
        columnName: string,
        dataType: string
    ): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
            [tableName, columnName]
        ) as Array<{DATA_TYPE: string}>;

        return rows.some((row) => row.DATA_TYPE.toLowerCase() === dataType.toLowerCase());
    }

    private async foreignKeyExists(
        queryRunner: QueryRunner,
        tableName: string,
        foreignKeyName: string
    ): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
            [tableName, foreignKeyName]
        ) as unknown[];

        return rows.length > 0;
    }

    private async indexExists(queryRunner: QueryRunner, tableName: string, indexName: string): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
            [tableName, indexName]
        ) as unknown[];

        return rows.length > 0;
    }

    private async primaryKeyExists(queryRunner: QueryRunner, tableName: string): Promise<boolean> {
        const rows = await queryRunner.query(
            `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' AND CONSTRAINT_TYPE = 'PRIMARY KEY' LIMIT 1`,
            [tableName]
        ) as unknown[];

        return rows.length > 0;
    }

    private escapeIdentifier(identifier: string): string {
        return `\`${identifier.replace(/`/g, '``')}\``;
    }
}
