/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {type MigrationInterface, type QueryRunner, TableColumn} from 'typeorm';
import {columnExists, tableExists} from '../modules/database/utils/migration-helper';

/** Add a metadata-only concurrency counter without changing packing contents or assignments. */
export class AddPackingMetadataRevision1791072000000 implements MigrationInterface {
    name = 'AddPackingMetadataRevision1791072000000';

    /** Existing rows begin at zero; synchronized disposable schemas already contain the entity column. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, 'packing_lists')) return;
        if (await columnExists(queryRunner, 'packing_lists', 'metadata_revision')) return;
        await queryRunner.addColumn('packing_lists', new TableColumn({
            name: 'metadata_revision', type: 'int', unsigned: true, isNullable: false, default: '0',
        }));
    }

    /** Downgrade only after disabling conditional v1 writes; the old application has no edit-token protocol. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, 'packing_lists')) return;
        if (!await columnExists(queryRunner, 'packing_lists', 'metadata_revision')) return;
        await queryRunner.dropColumn('packing_lists', 'metadata_revision');
    }
}
