import {QueryRunner} from "typeorm";

export async function columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
        `,
        [table, column]
    );

    return result[0].count > 0;
}

export async function constraintExists(
    queryRunner: QueryRunner,
    table: string,
    constraint: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND CONSTRAINT_NAME = ?
        `,
        [table, constraint]
    );

    return result[0].count > 0;
}

export async function addColumn(queryRunner: QueryRunner, table: string, column: string, type: string, params: string = '') {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD \`${column}\` ${type} ${params}`);
}

export async function addColumnIfNotExists(queryRunner: QueryRunner, table: string, column: string, type: string, params?: string) {
    if (!await columnExists(queryRunner, table, column)) {
        return await addColumn(queryRunner, table, column, type, params);
    }
}

export async function dropColumn(queryRunner: QueryRunner, table: string, column: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP COLUMN \`${column}\``);
}

export async function dropColumnIfExists(queryRunner: QueryRunner, table: string, column: string) {
    if (await columnExists(queryRunner, table, column)) {
        return await dropColumn(queryRunner, table, column);
    }
}

export async function createConstraint(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD CONSTRAINT \`${constraint}\` ${definition}`);
}

export async function createConstraintIfNotExists(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    if (!await constraintExists(queryRunner, table, constraint)) {
        return await createConstraint(queryRunner, table, constraint, definition);
    }
}

export async function dropFkConstraint(queryRunner: QueryRunner, table: string, constraint: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP FOREIGN KEY \`${constraint}\``);
}

export async function dropFkConstraintIfExists(queryRunner: QueryRunner, table: string, constraint: string) {
    if (await constraintExists(queryRunner, table, constraint)) {
        return await dropFkConstraint(queryRunner, table, constraint);
    }
}