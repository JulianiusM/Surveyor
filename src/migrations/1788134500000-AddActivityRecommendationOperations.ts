/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    createConstraintIfNotExists,
    dropColumnIfExists,
    dropFkConstraintIfExists,
    tableExists,
} from "../modules/database/utils/migration-helper";

const TABLE = "activity_assignment_recommendations";
const SOURCE_FK = "fk_activity_recommendation_source_item";
const SLOT_TABLE = "activity_slots";

interface IdColumnMetadata {
    columnType: string;
    characterSet: string | null;
    collation: string | null;
}

function assertSafeSqlName(value: string, label: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
        throw new Error(`Unexpected ${label} in activity slot ID metadata`);
    }
}

async function alignSourceItemIdWithActivitySlot(queryRunner: QueryRunner): Promise<void> {
    const columns: IdColumnMetadata[] = await queryRunner.query(`
        SELECT COLUMN_TYPE AS columnType,
               CHARACTER_SET_NAME AS characterSet,
               COLLATION_NAME AS collation
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'id'
    `, [SLOT_TABLE]);
    const slotId = columns[0];
    if (!slotId) throw new Error("Activity slot ID metadata is missing");

    const isTextId = /^(?:var)?char\([1-9][0-9]*\)$/i.test(slotId.columnType);
    const isBinaryId = /^(?:var)?binary\([1-9][0-9]*\)$/i.test(slotId.columnType);
    const isNativeUuid = /^uuid$/i.test(slotId.columnType);
    if (!isTextId && !isBinaryId && !isNativeUuid) {
        throw new Error("Unexpected column type in activity slot ID metadata");
    }

    let characterDefinition = "";
    if (isTextId) {
        if (!slotId.characterSet || !slotId.collation) {
            throw new Error("Activity slot text ID character metadata is missing");
        }
        assertSafeSqlName(slotId.characterSet, "character set");
        assertSafeSqlName(slotId.collation, "collation");
        characterDefinition = ` CHARACTER SET ${slotId.characterSet} COLLATE ${slotId.collation}`;
    }

    const sourceColumns: IdColumnMetadata[] = await queryRunner.query(`
        SELECT COLUMN_TYPE AS columnType,
               CHARACTER_SET_NAME AS characterSet,
               COLLATION_NAME AS collation
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = 'source_item_id'
    `, [TABLE]);
    const sourceItemId = sourceColumns[0];
    const storageMatches = sourceItemId
        && sourceItemId.columnType.toLowerCase() === slotId.columnType.toLowerCase()
        && (sourceItemId.characterSet ?? "").toLowerCase() === (slotId.characterSet ?? "").toLowerCase()
        && (sourceItemId.collation ?? "").toLowerCase() === (slotId.collation ?? "").toLowerCase();
    if (storageMatches) return;

    await queryRunner.query(`ALTER TABLE \`${TABLE}\`
        MODIFY \`source_item_id\` ${slotId.columnType}${characterDefinition} NULL`);
}

export class AddActivityRecommendationOperations1788134500000 implements MigrationInterface {
    name = "AddActivityRecommendationOperations1788134500000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        await addColumnIfNotExists(
            queryRunner,
            TABLE,
            "operation",
            "enum('ASSIGN','REASSIGN','UNASSIGN')",
            "NOT NULL DEFAULT 'ASSIGN'",
        );
        await addColumnIfNotExists(queryRunner, TABLE, "source_item_id", "varchar(36)", "NULL");
        await alignSourceItemIdWithActivitySlot(queryRunner);
        const table = await queryRunner.getTable(TABLE);
        const hasSourceForeignKey = table?.foreignKeys.some(
            (foreignKey) => foreignKey.columnNames.includes("source_item_id"),
        ) ?? false;
        if (!hasSourceForeignKey) {
            await createConstraintIfNotExists(
                queryRunner,
                TABLE,
                SOURCE_FK,
                "FOREIGN KEY (`source_item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE",
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        const table = await queryRunner.getTable(TABLE);
        for (const foreignKey of table?.foreignKeys.filter(
            (candidate) => candidate.columnNames.includes("source_item_id"),
        ) ?? []) {
            await queryRunner.dropForeignKey(TABLE, foreignKey);
        }
        await dropFkConstraintIfExists(queryRunner, TABLE, SOURCE_FK);
        await dropColumnIfExists(queryRunner, TABLE, "source_item_id");
        await dropColumnIfExists(queryRunner, TABLE, "operation");
    }
}
