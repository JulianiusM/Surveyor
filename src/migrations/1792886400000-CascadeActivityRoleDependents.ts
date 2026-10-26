/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import type {MigrationInterface, QueryRunner} from 'typeorm';

// Every row here belongs to its referenced role. RESTRICT can reject an entire
// plan/event cascade before MariaDB reaches the row's other cascading parent.
const ROLE_DEPENDENT_TABLES = [
    'activity_assignment_roles',
    'activity_slot_role',
    'activity_plan_requirements',
    'activity_plan_requirement_overrides',
];

/** Reserve a schema-wide constraint name distinct from every installed name.
 * MariaDB can reject a same-name drop/add even within one ALTER statement. */
function reserveConstraintName(base: string, existingNames: Set<string>): string {
    let name = base;
    let suffix = 2;
    // Constraint names are case-insensitive and limited to 64 characters. A
    // conflicting custom/install name receives a free deterministic suffix.
    while (existingNames.has(name.toLowerCase())) name = `${base}_${suffix++}`;
    if (name.length > 64) throw new Error('Activity role constraint name exceeds the database limit.');
    existingNames.add(name.toLowerCase());
    return name;
}

/** Align role-dependent lifecycles without deleting records or changing columns.
 * Root deletion remains the existing repository operation and database cascade. */
export class CascadeActivityRoleDependents1792886400000 implements MigrationInterface {
    name = 'CascadeActivityRoleDependents1792886400000';

    /** Existing installs adopt the same cascades as newly synchronized metadata. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.setDeletionRule(queryRunner, 'CASCADE');
    }

    /** Restore the previous restrictions without altering any retained rows. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.setDeletionRule(queryRunner, 'RESTRICT');
    }

    /** Preflight all four relationships, then replace each foreign key in one
     * ALTER statement. MariaDB commits DDL independently, so reruns skip completed
     * tables and never leave a drop/create gap without a foreign key. */
    private async setDeletionRule(queryRunner: QueryRunner, onDelete: 'CASCADE' | 'RESTRICT'): Promise<void> {
        const constraints: {name: string}[] = await queryRunner.query(
            'SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()',
        );
        const existingNames = new Set(constraints.map(constraint => constraint.name.toLowerCase()));
        const replacements = [];
        for (const tableName of ROLE_DEPENDENT_TABLES) {
            const table = await queryRunner.getTable(tableName);
            const foreignKey = table?.foreignKeys.find(key => key.columnNames.length === 1
                && key.columnNames[0] === 'role_id' && key.referencedTableName === 'activity_roles'
                && key.referencedColumnNames.length === 1 && key.referencedColumnNames[0] === 'id');
            if (!foreignKey) throw new Error(`Missing activity role relationship on ${tableName}.`);
            if (foreignKey.onDelete !== onDelete) {
                const name = reserveConstraintName(`FK_${tableName}_role_${onDelete.toLowerCase()}`, existingNames);
                replacements.push({tableName, foreignKey, name});
            }
        }

        // Preserve the referenced database and update action. Distinct names
        // avoid MariaDB's same-name replacement error without dropping integrity
        // between statements. Every metadata identifier is escaped explicitly.
        const escape = queryRunner.dataSource.driver.escape.bind(queryRunner.dataSource.driver);
        for (const {tableName, foreignKey, name} of replacements) {
            const parent = [foreignKey.referencedDatabase, foreignKey.referencedTableName]
                .filter(Boolean).map(name => escape(name!)).join('.');
            await queryRunner.query(`ALTER TABLE ${escape(tableName)}
                DROP FOREIGN KEY ${escape(foreignKey.name!)},
                ADD CONSTRAINT ${escape(name)} FOREIGN KEY (${escape('role_id')})
                REFERENCES ${parent} (${escape('id')})
                ON DELETE ${onDelete} ON UPDATE ${foreignKey.onUpdate ?? 'NO ACTION'}`);
        }
    }
}
