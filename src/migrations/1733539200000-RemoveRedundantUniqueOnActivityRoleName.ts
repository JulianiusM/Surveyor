import {MigrationInterface, QueryRunner} from "typeorm";

export class RemoveRedundantUniqueOnActivityRoleName1733539200000 implements MigrationInterface {
    name = 'RemoveRedundantUniqueOnActivityRoleName1733539200000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Drop the single-column unique constraint on name if it exists
        // Keep the composite unique constraint on (name, plan_id)
        const table = await queryRunner.getTable("activity_roles");
        if (table) {
            const uniqueConstraint = table.indices.find(
                index => index.isUnique && index.columnNames.length === 1 && index.columnNames[0] === "name"
            );
            if (uniqueConstraint) {
                await queryRunner.query(`ALTER TABLE activity_roles DROP INDEX ${uniqueConstraint.name}`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Re-add the single-column unique constraint if needed
        const table = await queryRunner.getTable("activity_roles");
        if (table) {
            const uniqueConstraint = table.indices.find(
                index => index.isUnique && index.columnNames.length === 1 && index.columnNames[0] === "name"
            );
            if (!uniqueConstraint) {
                await queryRunner.query(`ALTER TABLE activity_roles ADD UNIQUE INDEX IDX_2d60b72d2a8637bb9b7fc60e90 (name)`);
            }
        }
    }
}
