/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    dropColumnIfExists,
    tableExists,
} from "../modules/database/utils/migration-helper";

const TABLE = "activity_assignment_recommendations";

export class AddActivityRecommendationReviewState1788134600000 implements MigrationInterface {
    name = "AddActivityRecommendationReviewState1788134600000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        await addColumnIfNotExists(queryRunner, TABLE, "is_manual", "tinyint", "NOT NULL DEFAULT 0");
        await addColumnIfNotExists(queryRunner, TABLE, "is_hidden", "tinyint", "NOT NULL DEFAULT 0");
        await queryRunner.query(
            `UPDATE \`${TABLE}\` SET \`is_hidden\` = 1 WHERE \`status\` IN ('APPLIED', 'REJECTED')`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, TABLE)) return;

        await dropColumnIfExists(queryRunner, TABLE, "is_hidden");
        await dropColumnIfExists(queryRunner, TABLE, "is_manual");
    }
}
