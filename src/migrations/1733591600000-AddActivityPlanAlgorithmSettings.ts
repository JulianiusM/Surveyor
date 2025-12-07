import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class AddActivityPlanAlgorithmSettings1733591600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add availability_weight column with default 0.30 (30% availability, 70% fairness)
        const hasAvailabilityWeight = await queryRunner.hasColumn('activity_plans', 'availability_weight');
        if (!hasAvailabilityWeight) {
            await queryRunner.addColumn('activity_plans', new TableColumn({
                name: 'availability_weight',
                type: 'decimal',
                precision: 3,
                scale: 2,
                isNullable: true,
                default: '0.30',
                comment: 'Weight for availability in scoring (0-1). Higher values prioritize limited availability participants.'
            }));
        }

        // Add swap_optimization_iterations column with default 10
        const hasSwapIterations = await queryRunner.hasColumn('activity_plans', 'swap_optimization_iterations');
        if (!hasSwapIterations) {
            await queryRunner.addColumn('activity_plans', new TableColumn({
                name: 'swap_optimization_iterations',
                type: 'smallint',
                isNullable: true,
                default: '10',
                comment: 'Number of iterations for post-assignment swap optimization. 0 to disable.'
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const hasSwapIterations = await queryRunner.hasColumn('activity_plans', 'swap_optimization_iterations');
        if (hasSwapIterations) {
            await queryRunner.dropColumn('activity_plans', 'swap_optimization_iterations');
        }

        const hasAvailabilityWeight = await queryRunner.hasColumn('activity_plans', 'availability_weight');
        if (hasAvailabilityWeight) {
            await queryRunner.dropColumn('activity_plans', 'availability_weight');
        }
    }
}
