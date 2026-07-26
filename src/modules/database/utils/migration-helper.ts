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