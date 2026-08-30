/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    columnExists,
    createConstraintIfNotExists,
    dropColumnIfExists,
    dropFkConstraintIfExists,
    tableExists,
} from "../modules/database/utils/migration-helper";

const TABLE = "activity_assignment_recommendations";
const SOURCE_FK = "fk_activity_recommendation_source_item";

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
        const sourceColumnAlreadyExists = await columnExists(queryRunner, TABLE, "source_item_id");
        if (!sourceColumnAlreadyExists) {
            await addColumnIfNotExists(queryRunner, TABLE, "source_item_id", "varchar(36)", "NULL");
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
