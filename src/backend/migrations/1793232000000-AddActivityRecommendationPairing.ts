import type {MigrationInterface, QueryRunner} from 'typeorm';
import {addColumnIfNotExists, dropColumnIfExists, tableExists} from '../modules/database/utils/migration-helper';

/** Preserve legacy uncertainty instead of guessing swap intent from reciprocal slot IDs. */
export class AddActivityRecommendationPairing1793232000000 implements MigrationInterface {
    name = 'AddActivityRecommendationPairing1793232000000';

    /** Add explicit reviewed pairing without changing any saved operation or assignment. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, 'activity_assignment_recommendations')) return;
        // Default false deliberately keeps every existing row unresolved. Only
        // an organizer decision or newly generated independent operation sets it.
        await addColumnIfNotExists(queryRunner, 'activity_assignment_recommendations', 'pairing_known', 'tinyint', 'NOT NULL DEFAULT 0');
        await addColumnIfNotExists(queryRunner, 'activity_assignment_recommendations', 'swap_group',
            'varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'NULL');
    }

    /** Remove only pairing metadata when explicitly rolling back the matching release. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!await tableExists(queryRunner, 'activity_assignment_recommendations')) return;
        // A code rollback must not discard reviewed intent. Check either column
        // independently because a failed/partial upgrade may have only one of them.
        const knownColumns: string[] = [];
        if (await queryRunner.hasColumn('activity_assignment_recommendations', 'pairing_known')) knownColumns.push('`pairing_known` <> 0');
        if (await queryRunner.hasColumn('activity_assignment_recommendations', 'swap_group')) knownColumns.push('`swap_group` IS NOT NULL');
        if (knownColumns.length) {
            const known = await queryRunner.query(`SELECT 1 FROM \`activity_assignment_recommendations\` WHERE ${knownColumns.join(' OR ')} LIMIT 1`);
            if (known.length) throw new Error('Reviewed Activity pairing exists; restore the paired database backup instead of dropping provenance');
        }
        // Unknown legacy rows have no reviewed metadata to lose. Both preflight
        // checks finish before the first column can be removed.
        await dropColumnIfExists(queryRunner, 'activity_assignment_recommendations', 'swap_group');
        await dropColumnIfExists(queryRunner, 'activity_assignment_recommendations', 'pairing_known');
    }
}
