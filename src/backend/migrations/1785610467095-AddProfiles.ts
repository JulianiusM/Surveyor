/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MigrationInterface, QueryRunner} from "typeorm";
import {
    addColumnIfNotExists,
    columnExists,
    createConstraintIfNotExists,
    createIndexIfNotExists,
    createUniqueIndexIfNotExists,
    dropColumnIfExists,
    dropFkConstraintIfExists,
    dropIndexIfExists,
    getMigrationColumnStorage,
    prepareMigrationReferences,
    applyMigrationReferences,
    assertMigrationColumnCanBeRetired,
    assertMigrationForeignKeyNameAvailable,
    sameMigrationColumnStorage,
    tableExists
} from "../modules/database/utils/migration-helper";
import type {MigrationColumnStorage} from '../../types/MigrationTypes';

interface ForeignKeyDef {
    table: string;
    name: string;
    definition: string;
}

interface IndexDef {
    table: string;
    name: string;
    columns: string;
    unique: boolean;
}

interface RelationMapping {
    table: string;
    profile?: { oldUser?: string; oldGuest?: string; };
    entity?: { old: string; type: string; };
    item?: { old: string; type: string; };
}

interface ProfileOwnershipMigrationPlan {
    table: string;
    kind: 'profile' | 'user';
    protectedForeignKeys: readonly string[];
}

export class AddProfiles1785610467095 implements MigrationInterface {
    name = 'AddProfiles1785610467095';

    /** Quote schema-owned identifiers without accepting executable SQL fragments. */
    private identifier(value: string): string {
        return `\`${value.replaceAll('`', '``')}\``;
    }

    /** Reject a loss condition without selecting or printing private record values. */
    private async refuseRows(queryRunner: QueryRunner, sql: string, reason: string, parameters: unknown[] = []): Promise<void> {
        if ((await queryRunner.query(sql, parameters)).length) throw new Error(`Profile migration refused: ${reason}`);
    }

    /** Check actual non-NULL values before interpreting an optional legacy column. */
    private async populated(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
        if (!await columnExists(queryRunner, table, column)) return false;
        return (await queryRunner.query(`SELECT 1 FROM ${this.identifier(table)} WHERE ${this.identifier(column)} IS NOT NULL LIMIT 1`)).length > 0;
    }

    /** Preserve every actual automatic-update column during a migration backfill. */
    private async timestampAssignments(queryRunner: QueryRunner, table: string, alias = '', assigned: string[] = []): Promise<string> {
        // Explicit self-assignment prevents MariaDB ON UPDATE from replacing historical audit time.
        const columns: {name: string}[] = await queryRunner.query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND LOWER(EXTRA) LIKE '%on update%'`, [table]);
        const prefix = alias ? `${alias}.` : '';
        return columns.filter(column => !assigned.includes(column.name))
            .map(column => `, ${prefix}${this.identifier(column.name)} = ${prefix}${this.identifier(column.name)}`).join('');
    }

    /** Read the actual charset/collation inherited by this migration's authored VARCHAR DDL. */
    private async tableCharacterStorage(queryRunner: QueryRunner, table: string, allowCreation = false) {
        const [existing] = await queryRunner.query(`SELECT t.TABLE_COLLATION AS collation, c.CHARACTER_SET_NAME AS charset
            FROM information_schema.TABLES t JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION
            WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = ?`, [table]);
        if (existing) return existing as {charset: string; collation: string};
        // Only a not-yet-created profiles table inherits DATABASE defaults.
        if (allowCreation && table === 'profiles') {
            const [defaults] = await queryRunner.query(`SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
                FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()`);
            if (defaults) return defaults as {charset: string; collation: string};
        }
        throw new Error(`Profile migration refused: missing ${table} character storage`);
    }

    /** Prove a legacy account reference and its unique existing or planned profile. */
    private async identityProjection(queryRunner: QueryRunner, table: string, column: string,
        account: 'user' | 'guest', hasProfiles: boolean): Promise<string> {
        if (!await this.populated(queryRunner, table, column)) return 'NULL';
        const source = `${account}s`;
        // A populated legacy ID must already match its actual account storage; no cast may invent a match.
        await prepareMigrationReferences(queryRunner, [{table, column, referencedTable: source, referencedColumn: 'id'}]);
        if (hasProfiles) {
            await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table)} t WHERE t.${this.identifier(column)} IS NOT NULL
                AND (SELECT COUNT(*) FROM profiles p WHERE p.${account}_id = t.${this.identifier(column)}) > 1 LIMIT 1`,
            `multiple profiles for ${table}.${column}`);
        }
        // A planned profile key identifies its retained account, not a guessed future UUID.
        const planned = `CONCAT('${account}:', HEX(t.${this.identifier(column)}))`;
        return hasProfiles ? `COALESCE((SELECT CONCAT('profile:', HEX(p.id)) FROM profiles p
            WHERE p.${account}_id = t.${this.identifier(column)}), ${planned})` : planned;
    }

    /** Validate current Profile references before using them as provenance. */
    private async profileProjection(queryRunner: QueryRunner, table: string, column: string, hasProfiles: boolean): Promise<string> {
        if (!await this.populated(queryRunner, table, column)) return 'NULL';
        if (!hasProfiles) throw new Error(`Profile migration refused: ${table}.${column} has no profiles table`);
        await prepareMigrationReferences(queryRunner, [{table, column, referencedTable: 'profiles', referencedColumn: 'id'}]);
        return `(SELECT CONCAT('profile:', HEX(p.id)) FROM profiles p WHERE p.id = t.${this.identifier(column)})`;
    }

    /** Classify all five owners before any FK, index, schema or data statement. */
    private async preflightOwners(queryRunner: QueryRunner, hasProfiles: boolean): Promise<ProfileOwnershipMigrationPlan[]> {
        const owners: ProfileOwnershipMigrationPlan[] = [];
        const profileId = hasProfiles ? await getMigrationColumnStorage(queryRunner, 'profiles', 'id') : null;
        const userId = await getMigrationColumnStorage(queryRunner, 'users', 'id');
        const [context] = await queryRunner.query('SELECT DATABASE() AS selectedDatabase');
        for (const table of ['drivers_lists', 'packing_lists', 'events', 'activity_plans', 'surveys']) {
            const metadata = await queryRunner.getTable(table);
            const owner = await getMigrationColumnStorage(queryRunner, table, 'owner_id');
            if (!metadata || !owner) throw new Error(`Profile migration refused: missing ${table} ownership evidence`);
            const keys = metadata.foreignKeys.filter(key => key.columnNames.includes('owner_id'));
            const numeric = /^(?:tinyint|smallint|mediumint|int|bigint)(?:\(| |$)/u.test(owner.columnType);
            const target = numeric ? 'users' : 'profiles';
            // Existing owner constraints are proof, and remain installed until a verified replacement is ready.
            for (const key of keys) {
                if (!key.name || key.columnNames.length !== 1 || key.referencedColumnNames.length !== 1 || key.referencedColumnNames[0] !== 'id'
                    || ![target, `${context.selectedDatabase}.${target}`].includes(key.referencedTableName)
                    || key.referencedDatabase && key.referencedDatabase !== context.selectedDatabase) {
                    throw new Error(`Profile migration refused: conflicting ${table} ownership constraint`);
                }
            }
            if (!numeric) {
                if (!profileId || !sameMigrationColumnStorage(owner, profileId)) throw new Error(`Profile migration refused: unsupported ${table} profile ownership`);
                await this.profileProjection(queryRunner, table, 'owner_id', hasProfiles);
            } else {
                if (!userId || !sameMigrationColumnStorage(owner, userId)
                    || await this.populated(queryRunner, table, 'owner_id') && keys.length === 0) {
                    throw new Error(`Profile migration refused: unproven ${table} numeric user ownership`);
                }
                await this.identityProjection(queryRunner, table, 'owner_id', 'user', hasProfiles);
                await assertMigrationColumnCanBeRetired(queryRunner, table, 'owner_id');
            }
            if (await columnExists(queryRunner, table, 'owner_profile_id')) {
                // Every populated temporary value must agree with the still-present original source.
                if (numeric) {
                    await assertMigrationColumnCanBeRetired(queryRunner, table, 'owner_profile_id');
                    if (!hasProfiles && await this.populated(queryRunner, table, 'owner_profile_id')) throw new Error('Profile migration refused: unproven temporary owner');
                    if (hasProfiles) {
                        await prepareMigrationReferences(queryRunner, [{table, column: 'owner_profile_id', referencedTable: 'profiles', referencedColumn: 'id'}]);
                        await this.verifyTemporaryOwner(queryRunner, table);
                    }
                } else {
                    await this.profileProjection(queryRunner, table, 'owner_profile_id', hasProfiles);
                    await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table)} WHERE owner_profile_id IS NOT NULL
                        AND NOT (BINARY owner_profile_id <=> BINARY owner_id) LIMIT 1`, `conflicting ${table} temporary owner`);
                }
            }
            owners.push({table, kind: numeric ? 'user' : 'profile', protectedForeignKeys: keys.map(key => key.name!)});
        }
        return owners;
    }

    /** A populated temporary owner may only be the uniquely proven profile of its original User. */
    private async verifyTemporaryOwner(queryRunner: QueryRunner, table: string, complete = false): Promise<void> {
        await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table)} t WHERE
            (t.owner_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = t.owner_id
                AND BINARY p.id = BINARY t.owner_profile_id))
            ${complete ? 'OR (t.owner_id IS NOT NULL AND t.owner_profile_id IS NULL)' : ''} LIMIT 1`,
        `conflicting or incomplete ${table} temporary owner`);
    }

    /** Retire a duplicate source only when its stored value is retained exactly. */
    private async requireAgreeingColumns(queryRunner: QueryRunner, table: string, source: string, destination: string): Promise<void> {
        if (!await columnExists(queryRunner, table, source) || !await columnExists(queryRunner, table, destination)) return;
        await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table)} WHERE ${this.identifier(source)} IS NOT NULL
            AND ${this.identifier(destination)} IS NOT NULL AND NOT (BINARY ${this.identifier(source)} <=> BINARY ${this.identifier(destination)}) LIMIT 1`,
        `conflicting ${table}.${source}/${destination}`);
    }

    /** Project a direct retained parent identity after checking its physical reference and rows. */
    private async directProjection(queryRunner: QueryRunner, table: string, column: string, parent: string): Promise<string> {
        if (!await this.populated(queryRunner, table, column)) return 'NULL';
        await prepareMigrationReferences(queryRunner, [{table, column, referencedTable: parent, referencedColumn: 'id'}]);
        return `(SELECT HEX(parent.id) FROM ${this.identifier(parent)} parent WHERE parent.id = t.${this.identifier(column)})`;
    }

    /** Inspect sibling COALESCE/drop paths without changing their conversion policy. */
    private async preflightRelations(queryRunner: QueryRunner, mappings: RelationMapping[], foreignKeys: ForeignKeyDef[], hasProfiles: boolean) {
        const projections = new Map<string, Map<string, string>>();
        for (const mapping of mappings) {
            const expressions = new Map<string, string>();
            if (mapping.profile) {
                const current = await this.profileProjection(queryRunner, mapping.table, 'profile_id', hasProfiles);
                const user = mapping.profile.oldUser ? await this.identityProjection(queryRunner, mapping.table, mapping.profile.oldUser, 'user', hasProfiles) : 'NULL';
                const guest = mapping.profile.oldGuest ? await this.identityProjection(queryRunner, mapping.table, mapping.profile.oldGuest, 'guest', hasProfiles) : 'NULL';
                // A source that disagrees with another source or destination cannot be dropped.
                await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(mapping.table)} t WHERE
                    (${user} IS NOT NULL AND ${guest} IS NOT NULL AND NOT (BINARY (${user}) <=> BINARY (${guest})))
                    OR (${current} IS NOT NULL AND ${user} IS NOT NULL AND NOT (BINARY (${current}) <=> BINARY (${user})))
                    OR (${current} IS NOT NULL AND ${guest} IS NOT NULL AND NOT (BINARY (${current}) <=> BINARY (${guest}))) LIMIT 1`,
                `conflicting ${mapping.table} identity sources`);
                expressions.set('profile_id', `COALESCE(${current}, ${user}, ${guest})`);
            }
            for (const [column, relation] of [['entity_id', mapping.entity], ['item_id', mapping.item]] as const) {
                if (!relation) continue;
                const definition = foreignKeys.find(key => key.table === mapping.table && key.definition.startsWith(`FOREIGN KEY (\`${column}\`)`));
                const parent = definition && /REFERENCES `([^`]+)`/u.exec(definition.definition)?.[1];
                if (!parent) throw new Error(`Profile migration refused: missing ${mapping.table}.${column} reference definition`);
                await this.requireAgreeingColumns(queryRunner, mapping.table, relation.old, column);
                const current = await this.directProjection(queryRunner, mapping.table, column, parent);
                const legacy = await this.directProjection(queryRunner, mapping.table, relation.old, parent);
                expressions.set(column, `COALESCE(${current}, ${legacy})`);
            }
            projections.set(mapping.table, expressions);
        }
        // Administrator assignments have the same loss risks but a separate historical branch.
        const admin = new Map<string, string>();
        if (await columnExists(queryRunner, 'entity_admin_assignments', 'user_id')) {
            const current = await this.profileProjection(queryRunner, 'entity_admin_assignments', 'profile_id', hasProfiles);
            const user = await this.identityProjection(queryRunner, 'entity_admin_assignments', 'user_id', 'user', hasProfiles);
            await this.refuseRows(queryRunner, `SELECT 1 FROM entity_admin_assignments t WHERE ${current} IS NOT NULL AND ${user} IS NOT NULL
                AND NOT (BINARY (${current}) <=> BINARY (${user})) LIMIT 1`, 'conflicting administrator identity');
            admin.set('profile_id', `COALESCE(${current}, ${user})`);
        } else {
            const type = await this.getColumnType(queryRunner, 'entity_admin_assignments', 'profile_id');
            if (!type && await columnExists(queryRunner, 'entity_admin_assignments', 'profile_uuid')) {
                throw new Error('Profile migration refused: original administrator identity evidence is missing');
            }
            if (type && ['int', 'bigint', 'smallint'].includes(type)) {
                const user = await this.identityProjection(queryRunner, 'entity_admin_assignments', 'profile_id', 'user', hasProfiles);
                if (await columnExists(queryRunner, 'entity_admin_assignments', 'profile_uuid')) {
                    const stagedStorage = await getMigrationColumnStorage(queryRunner, 'entity_admin_assignments', 'profile_uuid');
                    const target = hasProfiles ? await getMigrationColumnStorage(queryRunner, 'profiles', 'id') : null;
                    const planned = !hasProfiles ? await this.tableCharacterStorage(queryRunner, 'profiles', true) : null;
                    if (!stagedStorage || (target ? !sameMigrationColumnStorage(stagedStorage, target)
                        : stagedStorage.columnType !== 'varchar(36)' || stagedStorage.characterSet !== planned?.charset || stagedStorage.collation !== planned?.collation)) {
                        throw new Error('Profile migration refused: unsupported temporary administrator identity storage');
                    }
                    await assertMigrationColumnCanBeRetired(queryRunner, 'entity_admin_assignments', 'profile_uuid');
                    const staged = await this.profileProjection(queryRunner, 'entity_admin_assignments', 'profile_uuid', hasProfiles);
                    await this.refuseRows(queryRunner, `SELECT 1 FROM entity_admin_assignments t WHERE ${staged} IS NOT NULL
                        AND NOT (BINARY (${staged}) <=> BINARY (${user})) LIMIT 1`, 'conflicting temporary administrator identity');
                }
                admin.set('profile_id', user);
            }
        }
        projections.set('entity_admin_assignments', admin);
        return projections;
    }

    /** Admit profile creation only when its existing UUID() representation is lossless. */
    private async preflightProfileCreation(queryRunner: QueryRunner, hasProfiles: boolean): Promise<void> {
        if (!hasProfiles) {
            const guest = await getMigrationColumnStorage(queryRunner, 'guests', 'id');
            const user = await getMigrationColumnStorage(queryRunner, 'users', 'id');
            const defaults = await this.tableCharacterStorage(queryRunner, 'profiles', true);
            if (!guest || guest.columnType !== 'varchar(36)' || guest.characterSet !== defaults?.charset || guest.collation !== defaults?.collation
                || !user || !/^int(?:\([0-9]+\))?$/u.test(user.columnType)) {
                throw new Error('Profile migration refused: legacy profile creation requires a separately reviewed account reference conversion');
            }
            return;
        }
        for (const column of ['id', 'name', 'migration_token', 'migration_token_expiration', 'default_for_owner',
            'user_id', 'guest_id', 'created_at', 'updated_at']) {
            if (!await columnExists(queryRunner, 'profiles', column)) throw new Error('Profile migration refused: incomplete existing profiles table');
        }
        const id = await getMigrationColumnStorage(queryRunner, 'profiles', 'id');
        if (!id || !/^(?:uuid|(?:var)?char\(|(?:var)?binary\()/u.test(id.columnType)) throw new Error('Profile migration refused: unsupported Profile identifier');
        const missing = await queryRunner.query(`SELECT 1 FROM users a LEFT JOIN profiles p ON p.user_id = a.id WHERE p.user_id IS NULL
            UNION ALL SELECT 1 FROM guests a LEFT JOIN profiles p ON p.guest_id = a.id WHERE p.guest_id IS NULL LIMIT 1`);
        if (missing.length) {
            if (/binary/u.test(id.columnType)) throw new Error('Profile migration refused: binary profile creation has no approved UUID encoding');
            const capacity = /char\(([0-9]+)\)/u.exec(id.columnType)?.[1];
            if (capacity && Number(capacity) < 36) throw new Error('Profile migration refused: UUID() exceeds existing profile identifier capacity');
        }
        await this.refuseRows(queryRunner, `SELECT 1 FROM profiles WHERE guest_id IS NOT NULL GROUP BY guest_id HAVING COUNT(*) > 1 LIMIT 1`,
        'multiple profiles for one guest');
    }

    /** Compare the complete physical shape of an unchanged authored sibling reference. */
    private async originalReferenceFits(queryRunner: QueryRunner, table: string, parent: string, storage: MigrationColumnStorage): Promise<boolean> {
        // The historical definitions are signed INT or VARCHAR(36), never an inferred binary UUID.
        if (parent === 'users' || parent === 'survey_combinations') return /^int(?:\([0-9]+\))?$/u.test(storage.columnType);
        if (storage.columnType !== 'varchar(36)') return false;
        const defaults = await this.tableCharacterStorage(queryRunner, table, table === 'profiles');
        return storage.characterSet === defaults.charset && storage.collation === defaults.collation;
    }

    /** Unknown write triggers can alter unrelated rows or timestamps; no such repair is authorized. */
    private async preflightTriggers(queryRunner: QueryRunner, mappings: RelationMapping[], owners: ProfileOwnershipMigrationPlan[]): Promise<void> {
        const updates = [...new Set([...mappings.map(mapping => mapping.table), 'entity_admin_assignments', 'activity_roles',
            'activity_assignments', 'survey_combinations', ...owners.filter(owner => owner.kind === 'user').map(owner => owner.table)])];
        // The canonical assignment-role BEFORE INSERT trigger is not on this write inventory.
        await this.refuseRows(queryRunner, `SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
            AND ((EVENT_OBJECT_TABLE = 'profiles' AND EVENT_MANIPULATION = 'INSERT')
            OR (EVENT_MANIPULATION = 'UPDATE' AND EVENT_OBJECT_TABLE IN (${updates.map(() => '?').join(', ')}))) LIMIT 1`,
        'write triggers require separate preservation review', updates);
    }

    /** Refuse audit-time coercion or precision loss before retiring the legacy tracking column. */
    private async preflightTracking(queryRunner: QueryRunner): Promise<void> {
        if (!await columnExists(queryRunner, 'activity_assignments', 'updatedAt')) return;
        const columns: {name: string; type: string; precision: number | null}[] = await queryRunner.query(`SELECT COLUMN_NAME AS name,
            DATA_TYPE AS type, DATETIME_PRECISION AS precision FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_assignments' AND COLUMN_NAME IN ('updatedAt', 'updated_at')`);
        const source = columns.find(column => column.name === 'updatedAt');
        const destination = columns.find(column => column.name === 'updated_at');
        // The unchanged absent-column definition is TIMESTAMP(6). DATETIME carries
        // different range/timezone semantics and needs a separately reviewed conversion.
        if (!source || source.type !== 'timestamp' || source.precision === null
            || destination && (destination.type !== 'timestamp' || destination.precision === null)
            || Number(source.precision) > Number(destination?.precision ?? 6)) {
            throw new Error('Profile migration refused: audit-time storage conversion could lose precision or range');
        }
        await this.requireAgreeingColumns(queryRunner, 'activity_assignments', 'updatedAt', 'updated_at');
    }

    /** Refuse existing or projected dangling final references before FK checks are changed. */
    private async preflightFinalReferences(queryRunner: QueryRunner, definitions: ForeignKeyDef[], owners: ProfileOwnershipMigrationPlan[], hasProfiles: boolean): Promise<void> {
        for (const definition of definitions) {
            const match = /^FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`id`\)/u.exec(definition.definition);
            if (!match) throw new Error('Profile migration refused: unsupported reference inventory');
            const [, column, parent] = match;
            await assertMigrationForeignKeyNameAvailable(queryRunner, definition.table, definition.name);
            if (owners.some(owner => owner.table === definition.table && column === 'owner_id' && owner.kind === 'user')) continue;
            if (definition.table === 'profiles' && !hasProfiles) continue;
            const adminConversion = definition.table === 'entity_admin_assignments' && column === 'profile_id'
                && ['int', 'bigint', 'smallint'].includes(await this.getColumnType(queryRunner, definition.table, column!) ?? '');
            const child = adminConversion ? null : await getMigrationColumnStorage(queryRunner, definition.table, column!);
            const storage = parent === 'profiles' && !hasProfiles ? null : await getMigrationColumnStorage(queryRunner, parent!, 'id');
            if (!child || adminConversion) {
                // These sibling branches still author varchar(36) or int. Refuse,
                // rather than silently widening A23 into their physical conversion.
                if (storage && !await this.originalReferenceFits(queryRunner, definition.table, parent!, storage)) {
                    throw new Error(`Profile migration refused: unreviewed ${definition.table}.${column} storage conversion`);
                }
                continue;
            }
            if (!storage || !sameMigrationColumnStorage(child, storage)) throw new Error(`Profile migration refused: incompatible final ${definition.table}.${column}`);
            await prepareMigrationReferences(queryRunner, [{table: definition.table, column: column!, referencedTable: parent!, referencedColumn: 'id'}]);
        }
    }

    /** Validate every projected unique key while all original columns and values still exist. */
    private async preflightUniqueIndexes(queryRunner: QueryRunner, definitions: IndexDef[], projections: Map<string, Map<string, string>>): Promise<void> {
        for (const definition of definitions) {
            if (!definition.unique) continue;
            const columns = [...definition.columns.matchAll(/`([^`]+)`/gu)].map(match => match[1]!);
            const values: string[] = [];
            for (const column of columns) {
                let expression = projections.get(definition.table)?.get(column);
                if (!expression && column === 'title' && definition.table === 'activity_roles') {
                    const title = await columnExists(queryRunner, definition.table, 'title') ? 't.title' : 'NULL';
                    const name = await columnExists(queryRunner, definition.table, 'name') ? 't.name' : 'NULL';
                    expression = `COALESCE(${title}, ${name}, CONCAT(t.id, ':role'))`;
                }
                if (!expression) {
                    if (!await columnExists(queryRunner, definition.table, column)) throw new Error(`Profile migration refused: missing unique-key evidence ${definition.table}.${column}`);
                    expression = `t.${this.identifier(column)}`;
                }
                values.push(expression);
            }
            // SQL unique indexes permit repeated rows containing NULL. Compare only complete keys.
            const names = values.map((_, index) => `v${index}`);
            await this.refuseRows(queryRunner, `SELECT 1 FROM (SELECT ${values.map((value, index) => `${value} AS ${names[index]}`).join(', ')}
                FROM ${this.identifier(definition.table)} t) projected WHERE ${names.map(name => `${name} IS NOT NULL`).join(' AND ')}
                GROUP BY ${names.join(', ')} HAVING COUNT(*) > 1 LIMIT 1`, `projected duplicate ${definition.name}`);
        }
    }

    /** Complete the no-loss admission before even changing FOREIGN_KEY_CHECKS. */
    private async preflightUp(queryRunner: QueryRunner, mappings: RelationMapping[], indexes: IndexDef[], foreignKeys: ForeignKeyDef[]) {
        const [checks] = await queryRunner.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
        if (Number(checks?.enabled) !== 1) throw new Error('Profile migration refused: foreign-key checking must already be enabled');
        const hasProfiles = await tableExists(queryRunner, 'profiles');
        await this.preflightProfileCreation(queryRunner, hasProfiles);
        const owners = await this.preflightOwners(queryRunner, hasProfiles);
        await this.preflightTriggers(queryRunner, mappings, owners);
        const projections = await this.preflightRelations(queryRunner, mappings, foreignKeys, hasProfiles);
        // Retired sibling fields may have custom checks/generated/incoming dependencies.
        // Such schemas require their own recovery decision, not silent constraint loss.
        const retirements = mappings.flatMap(mapping => [mapping.profile?.oldUser, mapping.profile?.oldGuest,
            mapping.entity?.old, mapping.item?.old].filter((column): column is string => !!column).map(column => ({table: mapping.table, column})));
        retirements.push({table: 'entity_admin_assignments', column: 'user_id'}, {table: 'activity_roles', column: 'name'},
            {table: 'activity_assignments', column: 'updatedAt'});
        if (['int', 'bigint', 'smallint'].includes(await this.getColumnType(queryRunner, 'entity_admin_assignments', 'profile_id') ?? '')) {
            retirements.push({table: 'entity_admin_assignments', column: 'profile_id'});
        }
        for (const {table, column} of retirements) {
            if (await columnExists(queryRunner, table, column)) await assertMigrationColumnCanBeRetired(queryRunner, table, column);
        }
        await this.requireAgreeingColumns(queryRunner, 'activity_roles', 'name', 'title');
        await this.preflightTracking(queryRunner);
        for (const [table, column] of [['activity_slots', 'description'], ['activity_roles', 'description'],
            ['activity_roles', 'name'], ['activity_roles', 'title'], ['survey_combinations', 'title']]) {
            if (await columnExists(queryRunner, table!, column!)) {
                await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table!)} WHERE CHAR_LENGTH(${this.identifier(column!)}) > 255 LIMIT 1`,
                `text narrowing would lose ${table}.${column}`);
                const storage = await queryRunner.query(`SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
                const defaults = await this.tableCharacterStorage(queryRunner, table!);
                if (storage[0]?.charset !== defaults?.charset || storage[0]?.collation !== defaults?.collation) {
                    throw new Error(`Profile migration refused: unreviewed text storage conversion ${table}.${column}`);
                }
            }
        }
        await this.preflightFinalReferences(queryRunner, foreignKeys, owners, hasProfiles);
        await this.preflightUniqueIndexes(queryRunner, indexes, projections);
        return owners;
    }

    /** Empty-schema reversal only: populated profile/relationship payloads cannot be represented losslessly. */
    private async preflightDown(queryRunner: QueryRunner, tables: readonly string[]): Promise<void> {
        const [checks] = await queryRunner.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
        if (Number(checks?.enabled) !== 1) throw new Error('Profile migration refused: foreign-key checking must already be enabled');
        for (const table of new Set([...tables, 'profiles', 'entity_admin_assignments', 'activity_roles', 'activity_assignments',
            'survey_combinations', 'drivers_lists', 'packing_lists', 'events', 'activity_plans', 'surveys'])) {
            if (await tableExists(queryRunner, table)) {
                await this.refuseRows(queryRunner, `SELECT 1 FROM ${this.identifier(table)} LIMIT 1`,
                `populated ${table} requires the paired database/file backup for rollback`);
            }
        }
    }

    private async getColumnType(queryRunner: QueryRunner, table: string, column: string): Promise<string | null> {
        const result = await queryRunner.query(
            `SELECT DATA_TYPE as dataType
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?`,
            [table, column]
        );

        return result[0]?.dataType?.toLowerCase() ?? null;
    }

    /** Replace only a preflight-proven numeric User owner, retaining source proof until verified. */
    private async migrateOwnerToProfile(queryRunner: QueryRunner, plan: ProfileOwnershipMigrationPlan): Promise<void> {
        if (plan.kind === 'profile') return;
        const {table} = plan;
        const references = await prepareMigrationReferences(queryRunner,
            [{table, column: 'owner_profile_id', referencedTable: 'profiles', referencedColumn: 'id'}]);
        await this.identityProjection(queryRunner, table, 'owner_id', 'user', true);
        await applyMigrationReferences(queryRunner, references);
        await this.verifyTemporaryOwner(queryRunner, table);
        const timestamps = await this.timestampAssignments(queryRunner, table, 't');
        // Retain original owner and audit values while the exact replacement is populated.
        await queryRunner.query(
            `UPDATE \`${table}\` t
                INNER JOIN \`profiles\` p ON p.user_id = t.owner_id
             SET t.owner_profile_id = p.id${timestamps}
             WHERE t.owner_profile_id IS NULL
               AND t.owner_id IS NOT NULL`
        );
        await this.verifyTemporaryOwner(queryRunner, table, true);
        const storage = references[0]!.storage;
        // One ALTER retires the validated old column and renames its replacement;
        // a separate DROP must never leave a populated table without its owner.
        const drops = plan.protectedForeignKeys.map(name => `DROP FOREIGN KEY ${this.identifier(name)}`);
        await queryRunner.query(`ALTER TABLE ${this.identifier(table)} ${[...drops, 'DROP COLUMN `owner_id`',
            `CHANGE COLUMN \`owner_profile_id\` \`owner_id\` ${storage.definition} NULL`].join(', ')}`);
    }

    /** Recover numeric user ownership from profile references during rollback. */
    private async migrateOwnerToUser(queryRunner: QueryRunner, table: string): Promise<void> {
        // Skip absent/already numeric references and retain NULL for profiles with
        // no matching user, as the pre-profile ownership model requires.
        if (!await columnExists(queryRunner, table, 'owner_id')) {
            return;
        }

        const ownerType = await this.getColumnType(queryRunner, table, 'owner_id');
        if (ownerType === 'int' || ownerType === 'bigint' || ownerType === 'smallint') {
            return;
        }

        // Keep the profile reference until the temporary user column is populated.
        await addColumnIfNotExists(queryRunner, table, 'owner_user_id', 'int', 'NULL');
        await queryRunner.query(
            `UPDATE \`${table}\` t
                LEFT JOIN \`profiles\` p ON p.id = t.owner_id
             SET t.owner_user_id = p.user_id
             WHERE t.owner_user_id IS NULL
               AND t.owner_id IS NOT NULL`
        );

        await dropColumnIfExists(queryRunner, table, 'owner_id');
        await queryRunner.query(`ALTER TABLE \`${table}\`
            CHANGE \`owner_user_id\` \`owner_id\` int NULL`);
    }

    private async ensureProfileTable(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`profiles\`
                                 (
                                     \`id\`                         varchar(36)  NOT NULL,
                                     \`name\`                       varchar(50)  NOT NULL,
                                     \`migration_token\`            varchar(255) NULL,
                                     \`migration_token_expiration\` datetime     NULL,
                                     \`default_for_owner\`          tinyint      NOT NULL DEFAULT 0,
                                     \`user_id\`                    int          NULL,
                                     \`guest_id\`                   varchar(36)  NULL,
                                     \`created_at\`                 timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                                     \`updated_at\`                 timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                                     PRIMARY KEY (\`id\`)
                                 ) ENGINE = InnoDB`);

        await createUniqueIndexIfNotExists(queryRunner, 'profiles', 'REL_74c607202390168d8cb82bfd1e', '`guest_id`');
    }

    /** Backfill a table's declared profile/entity/item references before dropping
     * its old columns, preserving any already populated destination values. */
    private async migrateRelationColumnsUp(queryRunner: QueryRunner, mapping: RelationMapping): Promise<void> {
        // Resolve user/guest references through profiles only when the corresponding
        // legacy columns are present; existing profile identifiers take precedence.
        if (mapping.profile) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'profile_id', 'varchar(36)', 'NULL');

            const hasOldUser = mapping.profile.oldUser ? await columnExists(queryRunner, mapping.table, mapping.profile.oldUser) : false;
            const hasOldGuest = mapping.profile.oldGuest ? await columnExists(queryRunner, mapping.table, mapping.profile.oldGuest) : false;

            if (hasOldUser || hasOldGuest) {
                const joins = [];
                const sources = ['t.profile_id'];
                if (hasOldUser && mapping.profile.oldUser) {
                    joins.push(`LEFT JOIN \`profiles\` pu ON pu.user_id = t.\`${mapping.profile.oldUser}\``);
                    sources.push('pu.id');
                }
                if (hasOldGuest && mapping.profile.oldGuest) {
                    joins.push(`LEFT JOIN \`profiles\` pg ON pg.guest_id = t.\`${mapping.profile.oldGuest}\``);
                    sources.push('pg.id');
                }

                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                         ${joins.join('\n                     ')}
                    SET t.profile_id = COALESCE(${sources.join(', ')})${await this.timestampAssignments(queryRunner, mapping.table, 't')} WHERE t.profile_id IS NULL`
                );
            }
        }

        // Entity and item identifiers are direct renames through temporary columns,
        // separate from the identity lookup needed by profile references.
        if (mapping.entity) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'entity_id', mapping.entity.type, 'NULL');
            if (await columnExists(queryRunner, mapping.table, mapping.entity.old)) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\`
                     SET \`entity_id\` = COALESCE(\`entity_id\`, \`${mapping.entity.old}\`)${await this.timestampAssignments(queryRunner, mapping.table)}
                     WHERE \`entity_id\` IS NULL`
                );
            }
        }

        if (mapping.item) {
            await addColumnIfNotExists(queryRunner, mapping.table, 'item_id', mapping.item.type, 'NULL');
            if (await columnExists(queryRunner, mapping.table, mapping.item.old)) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\`
                     SET \`item_id\` = COALESCE(\`item_id\`, \`${mapping.item.old}\`)${await this.timestampAssignments(queryRunner, mapping.table)}
                     WHERE \`item_id\` IS NULL`
                );
            }
        }

        // Remove source columns only after every declared destination is backfilled.
        if (mapping.profile?.oldUser) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.profile.oldUser);
        }
        if (mapping.profile?.oldGuest) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.profile.oldGuest);
        }
        if (mapping.entity?.old) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.entity.old);
        }
        if (mapping.item?.old) {
            await dropColumnIfExists(queryRunner, mapping.table, mapping.item.old);
        }
    }

    /** Restore legacy relation columns using the still-available shared references. */
    private async migrateRelationColumnsDown(queryRunner: QueryRunner, mapping: RelationMapping): Promise<void> {
        // Recreate destinations first. Profile lookup must finish before the shared
        // profile table is removed by the enclosing rollback.
        const hasProfiles = await tableExists(queryRunner, 'profiles');

        if (mapping.profile?.oldUser) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.profile.oldUser, 'int', 'NULL');
        }
        if (mapping.profile?.oldGuest) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.profile.oldGuest, 'varchar(36)', 'NULL');
        }

        if (mapping.entity) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.entity.old, mapping.entity.type, 'NULL');
        }
        if (mapping.item) {
            await addColumnIfNotExists(queryRunner, mapping.table, mapping.item.old, mapping.item.type, 'NULL');
        }

        if (hasProfiles && mapping.profile && await columnExists(queryRunner, mapping.table, 'profile_id')) {
            if (mapping.profile.oldUser) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                        LEFT JOIN \`profiles\` p ON p.id = t.profile_id
                     SET t.\`${mapping.profile.oldUser}\` = COALESCE(t.\`${mapping.profile.oldUser}\`, p.user_id)
                     WHERE t.profile_id IS NOT NULL`
                );
            }
            if (mapping.profile.oldGuest) {
                await queryRunner.query(
                    `UPDATE \`${mapping.table}\` t
                        LEFT JOIN \`profiles\` p ON p.id = t.profile_id
                     SET t.\`${mapping.profile.oldGuest}\` = COALESCE(t.\`${mapping.profile.oldGuest}\`, p.guest_id)
                     WHERE t.profile_id IS NOT NULL`
                );
            }
        }

        // Preserve existing legacy values while copying back entity/item identifiers,
        // then remove the corresponding shared columns.
        if (mapping.entity && await columnExists(queryRunner, mapping.table, 'entity_id')) {
            await queryRunner.query(
                `UPDATE \`${mapping.table}\`
                 SET \`${mapping.entity.old}\` = COALESCE(\`${mapping.entity.old}\`, \`entity_id\`)
                 WHERE \`${mapping.entity.old}\` IS NULL`
            );

            await dropColumnIfExists(queryRunner, mapping.table, 'entity_id');
        }

        if (mapping.item && await columnExists(queryRunner, mapping.table, 'item_id')) {
            await queryRunner.query(
                `UPDATE \`${mapping.table}\`
                 SET \`${mapping.item.old}\` = COALESCE(\`${mapping.item.old}\`, \`item_id\`)
                 WHERE \`${mapping.item.old}\` IS NULL`
            );

            await dropColumnIfExists(queryRunner, mapping.table, 'item_id');
        }

        await dropColumnIfExists(queryRunner, mapping.table, 'profile_id');
    }

    /** Migrate legacy identity references to profiles and shared relation columns,
     * restoring foreign-key checking even if an intermediate DDL operation fails. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        // These inventories preserve the original constraint/index and table order;
        // dependent references are rebuilt only after their data has been converted.
        const oldForeignKeys = [
            ['drivers_items', 'FK_357c0fbec24aac87ee423ba5168'],
            ['drivers_items', 'FK_ccd3f1ec65169179b395e5ba903'],
            ['drivers_items', 'FK_ee27f34d81abc82359683f84e38'],
            ['drivers_assignments', 'FK_33c32c9f3dbd2e9eaa63b7f08bf'],
            ['drivers_assignments', 'FK_797f953903af106421d5f2cada2'],
            ['drivers_assignments', 'FK_dc269892d22b330ef2c60aead83'],
            ['drivers_lists', 'FK_f124e3b4cbdb69f28f796e1cc99'],
            ['packing_items', 'FK_6207edc397ed15fcbf1b87b1927'],
            ['packing_items', 'FK_9cbf247de70a55b58841e7b0941'],
            ['packing_items', 'FK_a0bad64d810ac4e76c23b86785d'],
            ['packing_assignments', 'FK_574be0a35d91af3bac4e3f5ee73'],
            ['packing_assignments', 'FK_99ffd07a41b38d3a13aadd7ce74'],
            ['packing_assignments', 'FK_c217003837bbf8a7b3a2c1eeb80'],
            ['packing_lists', 'FK_a801f486411025640abc78bbd91'],
            ['event_reg_links', 'FK_a2b8c0843d19876a98b16b8461f'],
            ['event_reg_links', 'FK_febc2c20c1ea64180fa09040f28'],
            ['event_registrations', 'FK_52165ba60768fd87815d733e562'],
            ['event_registrations', 'FK_e42ba7c85b05c49c8de4f360543'],
            ['events', 'FK_918130b4f882fda431503d6f4e0'],
            ['activity_slot_role', 'FK_0302a1df8a7c1ea8bc3cd8f98f0'],
            ['activity_slots', 'FK_01ebc30d7c6c9f3c764be121cda'],
            ['activity_slots', 'FK_46f987c26b60e3396f22d53735e'],
            ['activity_slots', 'FK_c4e8f0a94193ce0883305a90e88'],
            ['activity_assignment_recommendations', 'FK_0e34a6eb8333caef959e50f1682'],
            ['activity_assignment_recommendations', 'FK_3a84aa083a3749f16515d67b131'],
            ['activity_assignment_recommendations', 'FK_44fca84f2c94b85a4aa0f857af4'],
            ['activity_assignment_recommendations', 'FK_caa6eb650afe861c890f134afa9'],
            ['activity_plan_requirements', 'FK_3e411697f33a4269726c347d12d'],
            ['activity_plan_requirement_overrides', 'FK_d0ca8a723a711cac289a0572660'],
            ['activity_plan_requirement_overrides', 'FK_d6ad3e7aaa1d11ef848f03a80e5'],
            ['activity_plan_requirement_overrides', 'FK_eaed15cf3bb93c39608b4fcd38b'],
            ['activity_plan_text_fields', 'FK_bfaec999480077e410bddc977b3'],
            ['activity_plans', 'FK_d4636d5c694bae3fd270f7c266f'],
            ['activity_roles', 'FK_f8218a37990e864e813f6451487'],
            ['activity_assignments', 'FK_9e96938fab1057b20f085550ed0'],
            ['activity_assignments', 'FK_aec8db1f4174e3b0f6bfc8fad09'],
            ['activity_assignments', 'FK_b56fb307a2d9170d1fd91d53240'],
            ['activity_assignments', 'FK_c9be315fed7f07cfc32196eb73d'],
            ['entity_admin_assignments', 'FK_d9e6ddc59fdf807a57068e4a717'],
            ['survey_responses', 'FK_14bcf49cc71d7f857892abbfb0e'],
            ['survey_responses', 'FK_15c9124bfeb633545c5de42edb6'],
            ['survey_responses', 'FK_235dcfd351bc1eb6d12894b7e8f'],
            ['survey_responses', 'FK_2b4e3f83ce0b4a0d7617ac0cd44'],
            ['survey_combinations', 'FK_c0e64c6fe4352a75372af4e98be'],
            ['surveys', 'FK_9532b923178387169ff592c12a9']
        ] as const;

        const oldUniqueIndexes = [
            ['drivers_assignments', 'uk_driver_assignment_user'],
            ['drivers_assignments', 'uk_driver_assignment_guest'],
            ['packing_assignments', 'uk_packing_assignment_user'],
            ['packing_assignments', 'uk_packing_assignment_guest'],
            ['event_registrations', 'uk_event_participant'],
            ['activity_slot_role', 'unique_act_slot_role_map'],
            ['activity_plan_requirements', 'uk_plan_role'],
            ['activity_plan_requirement_overrides', 'uk_plan_participant_role'],
            ['activity_roles', 'act_roles_name_plan'],
            ['activity_assignments', 'uk_unique_activity_assignment_user'],
            ['activity_assignments', 'uk_activity_assignment_guest'],
            ['entity_admin_assignments', 'uk_entity_admin_assignment_user'],
            ['survey_combinations', 'combinations_single_entry']
        ] as const;

        const mappings: RelationMapping[] = [
            {
                table: 'drivers_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {table: 'event_reg_links', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'event_registrations', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'activity_slot_role', item: {old: 'slot_id', type: 'varchar(36)'}},
            {
                table: 'activity_slots',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_assignment_recommendations',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_requirements', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_plan_requirement_overrides',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_text_fields', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {table: 'activity_roles', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'survey_responses',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'combination_id', type: 'int'},
                entity: {old: 'survey_id', type: 'varchar(36)'}
            },
            {table: 'survey_combinations', entity: {old: 'survey_id', type: 'varchar(36)'}}
        ];

        const newIndexes: IndexDef[] = [
            {
                table: 'activity_slot_role',
                name: 'unique_act_slot_role_map',
                columns: '`item_id`, `role_id`',
                unique: true
            },
            {
                table: 'activity_plan_requirements',
                name: 'uk_plan_role',
                columns: '`entity_id`, `role_id`',
                unique: true
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'uk_plan_participant_role',
                columns: '`entity_id`, `profile_id`, `role_id`', unique: true
            },
            {table: 'activity_roles', name: 'act_roles_name_plan', columns: '`title`, `entity_id`', unique: true},
            {
                table: 'entity_admin_assignments',
                name: 'uk_entity_admin_assignment_user',
                columns: '`entity_type`, `entity_id`, `profile_id`', unique: true
            },
            {
                table: 'survey_combinations',
                name: 'combinations_single_entry',
                columns: '`WEEKDAY`, `entity_id`, `nth_week`', unique: true
            },
        ];

        const prioNewIndexes: IndexDef[] = [
            {
                table: 'drivers_assignments',
                name: 'FK_b2fa5cb20b56122626e22bce5ee',
                columns: '`item_id`', unique: false
            },
            {
                table: 'event_registrations',
                name: 'FK_28b0a253c87a80a4b013c437f7d',
                columns: '`event_id`',
                unique: false
            },
            {
                table: 'packing_assignments',
                name: 'FK_8424e042fc819f09baadaf30bb8',
                columns: '`item_id`',
                unique: false
            }
        ]

        const newForeignKeys: ForeignKeyDef[] = [
            {
                table: 'profiles',
                name: 'FK_9e432b7df0d182f8d292902d1a2',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
            },
            {
                table: 'profiles',
                name: 'FK_74c607202390168d8cb82bfd1eb',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_65f5d44f8502c7993c5909abf46',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_60fe7fbeb7989e3d57e25497433',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_7dd7dc3d7513cf40f4969f62d59',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_632373c9b9b3e96655056a5e84b',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_lists',
                name: 'FK_f124e3b4cbdb69f28f796e1cc99',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_items',
                name: 'FK_d6105c3023345bcce04315a5348',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_items',
                name: 'FK_4071e785ceac4c6d7099dba956c',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_08a98dc969604d0f178d7c0cdc6',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_806cf12016987469923cc77a3b4',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_lists',
                name: 'FK_a801f486411025640abc78bbd91',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_reg_links',
                name: 'FK_4dfdcde929610d6b678eb836cc2',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_registrations',
                name: 'FK_b074710f3b4c3aca254d0abe3e3',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'events',
                name: 'FK_918130b4f882fda431503d6f4e0',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slot_role',
                name: 'FK_1ed51ea6ae527bc884ad9861fea',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slots',
                name: 'FK_e579c5629494fd4d816c50c667b',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_slots',
                name: 'FK_68a28d504f04eec65cf934c90ea',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_2e18c15367e05aee82757393d95',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_1a55a0030ef6b7b86196836d662',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_6570f82bd747c7f97ba98b142b2',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirements',
                name: 'FK_c7cb790d8ad53f2c7fe28a342ee',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_8d17c638d85a798f61ef1a61552',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_649c9cf6e6fc5e58b31fe218931',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_text_fields',
                name: 'FK_b52f7ff10af34cf2da73143d686',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plans',
                name: 'FK_d4636d5c694bae3fd270f7c266f',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_roles',
                name: 'FK_6891e834b28f40fa0bb3e35cc46',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_6d9982498d8251bef63c3a50209',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_fa9ac67f0e40ba558ced367f643',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_7506e0df035e88c0245f6321bd4',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'entity_admin_assignments',
                name: 'FK_8c6662705ae5eb730b1fb9c9a61',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_8c6c1e7621847e0136637c8e531',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_e4c476f0c2aba82738e89bbd41a',
                definition: 'FOREIGN KEY (`item_id`) REFERENCES `survey_combinations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_af45d53d0468a292c0d19edc731',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_5ba76f6069cd86d911d3f7025c0',
                definition: 'FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_fd1e0eb96ae7d76e1c85363e726',
                definition: 'FOREIGN KEY (`entity_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'surveys',
                name: 'FK_9532b923178387169ff592c12a9',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            }
        ];

        const owners = await this.preflightUp(queryRunner, mappings, [...prioNewIndexes, ...newIndexes], newForeignKeys);
        // MariaDB constraint names compare without case; retain the actual spelling for DDL.
        const protectedOwnerKeys = new Set(owners.flatMap(owner => owner.protectedForeignKeys.map(name => `${owner.table}.${name}`.toLowerCase())));
        // Temporarily release old references, create profiles and migrate their
        // consumers before installing the replacement indexes and foreign keys.
        await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const [table, fk] of oldForeignKeys) {
                if (protectedOwnerKeys.has(`${table}.${fk}`.toLowerCase())) continue;
                await dropFkConstraintIfExists(queryRunner, table, fk);
            }

            for (const index of prioNewIndexes) {
                if (index.unique) {
                    await createUniqueIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                } else {
                    await createIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                }
            }

            for (const [table, index] of oldUniqueIndexes) {
                await dropIndexIfExists(queryRunner, table, index);
            }

            await this.ensureProfileTable(queryRunner);

            await queryRunner.query(`INSERT INTO \`profiles\` (\`id\`, \`name\`, \`migration_token\`,
                                                               \`migration_token_expiration\`,
                                                               \`default_for_owner\`, \`user_id\`, \`guest_id\`,
                                                               \`created_at\`, \`updated_at\`)
                                     SELECT UUID(),
                                            LEFT(COALESCE(NULLIF(TRIM(u.name), ''), u.username), 50),
                                            NULL,
                                            NULL,
                                            1,
                                            u.id,
                                            NULL,
                                            u.created_at,
                                            u.updated_at
                                     FROM \`users\` u
                                              LEFT JOIN \`profiles\` p ON p.user_id = u.id
                                     WHERE p.user_id IS NULL`);

            await queryRunner.query(`INSERT INTO \`profiles\` (\`id\`, \`name\`, \`migration_token\`,
                                                               \`migration_token_expiration\`,
                                                               \`default_for_owner\`, \`user_id\`, \`guest_id\`,
                                                               \`created_at\`, \`updated_at\`)
                                     SELECT UUID(),
                                            LEFT(g.username, 50),
                                            NULL,
                                            NULL,
                                            1,
                                            NULL,
                                            g.id,
                                            g.created_at,
                                            g.updated_at
                                     FROM \`guests\` g
                                              LEFT JOIN \`profiles\` p ON p.guest_id = g.id
                                     WHERE p.guest_id IS NULL`);

            for (const owner of owners) await this.migrateOwnerToProfile(queryRunner, owner);

            await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'profile_id', 'varchar(36)', 'NULL');
            if (await columnExists(queryRunner, 'entity_admin_assignments', 'user_id')) {
                await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                    LEFT JOIN \`profiles\` p ON p.user_id = e.user_id
                                         SET e.profile_id = COALESCE(e.profile_id, p.id)${await this.timestampAssignments(queryRunner, 'entity_admin_assignments', 'e')}
                                         WHERE e.profile_id IS NULL`);
                await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'user_id');
            } else {
                const profileType = await this.getColumnType(queryRunner, 'entity_admin_assignments', 'profile_id');
                if (profileType === 'int' || profileType === 'bigint' || profileType === 'smallint') {
                    await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'profile_uuid', 'varchar(36)', 'NULL');
                    await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                        LEFT JOIN \`profiles\` p ON p.user_id = e.profile_id
                                             SET e.profile_uuid = COALESCE(e.profile_uuid, p.id)${await this.timestampAssignments(queryRunner, 'entity_admin_assignments', 'e')}
                                             WHERE e.profile_id IS NOT NULL`);
                    await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'profile_id');
                    await queryRunner.query('ALTER TABLE `entity_admin_assignments` CHANGE `profile_uuid` `profile_id` varchar(36) NULL');
                }
            }

            for (const mapping of mappings) {
                await this.migrateRelationColumnsUp(queryRunner, mapping);
            }

            await addColumnIfNotExists(queryRunner, 'activity_roles', 'title', 'varchar(255)', 'NULL');
            if (await columnExists(queryRunner, 'activity_roles', 'name')) {
                await queryRunner.query(`UPDATE \`activity_roles\` SET \`title\` = COALESCE(\`title\`, \`name\`)${await this.timestampAssignments(queryRunner, 'activity_roles')} WHERE \`title\` IS NULL`);
                await dropColumnIfExists(queryRunner, 'activity_roles', 'name');
            }
            await queryRunner.query(`UPDATE \`activity_roles\` SET \`title\` = COALESCE(\`title\`, CONCAT(\`id\`, ':role'))${await this.timestampAssignments(queryRunner, 'activity_roles')} WHERE \`title\` IS NULL`);
            await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `title` `title` varchar(255) NOT NULL');

            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'title', 'varchar(255)', 'NULL');
            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'description', 'varchar(255)', 'NULL');
            await addColumnIfNotExists(queryRunner, 'survey_combinations', 'profile_id', 'varchar(36)', 'NULL');
            await queryRunner.query(`UPDATE \`survey_combinations\`
                                     SET \`title\` = COALESCE(\`title\`, CONCAT(\`WEEKDAY\`, ' ', \`nth_week\`))${await this.timestampAssignments(queryRunner, 'survey_combinations')}
                                     WHERE \`title\` IS NULL`);
            await queryRunner.query('ALTER TABLE `survey_combinations` CHANGE `title` `title` varchar(255) NOT NULL');

            if (await columnExists(queryRunner, 'activity_slots', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_slots` CHANGE `description` `description` varchar(255) NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `description` `description` varchar(255) NULL');
            }

            if (await columnExists(queryRunner, 'activity_assignments', 'updatedAt')) {
                await addColumnIfNotExists(queryRunner, 'activity_assignments', 'updated_at', 'timestamp(6)', 'NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)');
                await queryRunner.query(`UPDATE \`activity_assignments\` SET \`updated_at\` = \`updatedAt\`${await this.timestampAssignments(queryRunner, 'activity_assignments', '', ['updated_at'])} WHERE \`updatedAt\` IS NOT NULL`);
                await dropColumnIfExists(queryRunner, 'activity_assignments', 'updatedAt');
            }

            for (const index of newIndexes) {
                if (index.unique) {
                    await createUniqueIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                } else {
                    await createIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                }
            }

            for (const fk of newForeignKeys) {
                if (fk.definition.startsWith('FOREIGN KEY (`owner_id`)')
                    && owners.some(owner => owner.table === fk.table && owner.kind === 'profile' && owner.protectedForeignKeys.length > 0)) continue;
                await createConstraintIfNotExists(queryRunner, fk.table, fk.name, fk.definition);
            }
        } finally {
            await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    /** Reconstruct legacy references before dropping profiles, then reinstall the
     * old constraints; foreign-key checking is restored on success or failure. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        // Rollback uses its own historical mappings and index definitions rather
        // than assuming every new reference has a symmetric legacy equivalent.
        const newForeignKeys = [
            ['surveys', 'FK_9532b923178387169ff592c12a9'],
            ['survey_combinations', 'FK_fd1e0eb96ae7d76e1c85363e726'],
            ['survey_combinations', 'FK_5ba76f6069cd86d911d3f7025c0'],
            ['survey_responses', 'FK_af45d53d0468a292c0d19edc731'],
            ['survey_responses', 'FK_e4c476f0c2aba82738e89bbd41a'],
            ['survey_responses', 'FK_8c6c1e7621847e0136637c8e531'],
            ['entity_admin_assignments', 'FK_8c6662705ae5eb730b1fb9c9a61'],
            ['activity_assignments', 'FK_7506e0df035e88c0245f6321bd4'],
            ['activity_assignments', 'FK_fa9ac67f0e40ba558ced367f643'],
            ['activity_assignments', 'FK_6d9982498d8251bef63c3a50209'],
            ['activity_roles', 'FK_6891e834b28f40fa0bb3e35cc46'],
            ['activity_plans', 'FK_d4636d5c694bae3fd270f7c266f'],
            ['activity_plan_text_fields', 'FK_b52f7ff10af34cf2da73143d686'],
            ['activity_plan_requirement_overrides', 'FK_649c9cf6e6fc5e58b31fe218931'],
            ['activity_plan_requirement_overrides', 'FK_8d17c638d85a798f61ef1a61552'],
            ['activity_plan_requirements', 'FK_c7cb790d8ad53f2c7fe28a342ee'],
            ['activity_assignment_recommendations', 'FK_6570f82bd747c7f97ba98b142b2'],
            ['activity_assignment_recommendations', 'FK_1a55a0030ef6b7b86196836d662'],
            ['activity_assignment_recommendations', 'FK_2e18c15367e05aee82757393d95'],
            ['activity_slots', 'FK_68a28d504f04eec65cf934c90ea'],
            ['activity_slots', 'FK_e579c5629494fd4d816c50c667b'],
            ['activity_slot_role', 'FK_1ed51ea6ae527bc884ad9861fea'],
            ['events', 'FK_918130b4f882fda431503d6f4e0'],
            ['event_registrations', 'FK_b074710f3b4c3aca254d0abe3e3'],
            ['event_reg_links', 'FK_4dfdcde929610d6b678eb836cc2'],
            ['packing_lists', 'FK_a801f486411025640abc78bbd91'],
            ['packing_assignments', 'FK_806cf12016987469923cc77a3b4'],
            ['packing_assignments', 'FK_08a98dc969604d0f178d7c0cdc6'],
            ['packing_items', 'FK_4071e785ceac4c6d7099dba956c'],
            ['packing_items', 'FK_d6105c3023345bcce04315a5348'],
            ['drivers_lists', 'FK_f124e3b4cbdb69f28f796e1cc99'],
            ['drivers_assignments', 'FK_632373c9b9b3e96655056a5e84b'],
            ['drivers_assignments', 'FK_7dd7dc3d7513cf40f4969f62d59'],
            ['drivers_items', 'FK_60fe7fbeb7989e3d57e25497433'],
            ['drivers_items', 'FK_65f5d44f8502c7993c5909abf46'],
            ['profiles', 'FK_74c607202390168d8cb82bfd1eb'],
            ['profiles', 'FK_9e432b7df0d182f8d292902d1a2']
        ] as const;

        const newUniqueIndexes = [
            ['survey_combinations', 'combinations_single_entry'],
            ['entity_admin_assignments', 'uk_entity_admin_assignment_user'],
            ['activity_roles', 'act_roles_name_plan'],
            ['activity_plan_requirement_overrides', 'uk_plan_participant_role'],
            ['activity_plan_requirements', 'uk_plan_role'],
            ['activity_slot_role', 'unique_act_slot_role_map'],
            ['drivers_assignments', 'FK_b2fa5cb20b56122626e22bce5ee'],
            ['event_registrations', 'FK_28b0a253c87a80a4b013c437f7d'],
            ['packing_assignments', 'FK_8424e042fc819f09baadaf30bb8'],
        ] as const;

        const mappings: RelationMapping[] = [
            {table: 'survey_combinations', entity: {old: 'survey_id', type: 'varchar(36)'}},
            {
                table: 'survey_responses',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'combination_id', type: 'int'},
                entity: {old: 'survey_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_roles', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {table: 'activity_plan_text_fields', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_plan_requirement_overrides',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_plan_requirements', entity: {old: 'plan_id', type: 'varchar(36)'}},
            {
                table: 'activity_assignment_recommendations',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                item: {old: 'slot_id', type: 'varchar(36)'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {
                table: 'activity_slots',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'plan_id', type: 'varchar(36)'}
            },
            {table: 'activity_slot_role', item: {old: 'slot_id', type: 'varchar(36)'}},
            {table: 'event_registrations', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {table: 'event_reg_links', profile: {oldUser: 'user_id', oldGuest: 'guest_id'}},
            {
                table: 'packing_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'packing_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_assignments',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            },
            {
                table: 'drivers_items',
                profile: {oldUser: 'user_id', oldGuest: 'guest_id'},
                entity: {old: 'list_id', type: 'varchar(36)'}
            }
        ];

        const oldIndexes: IndexDef[] = [
            {
                table: 'drivers_assignments',
                name: 'uk_driver_assignment_user',
                columns: '`item_id`, `user_id`',
                unique: true
            },
            {
                table: 'drivers_assignments',
                name: 'uk_driver_assignment_guest',
                columns: '`item_id`, `guest_id`',
                unique: true
            },
            {
                table: 'packing_assignments',
                name: 'uk_packing_assignment_user',
                columns: '`item_id`, `user_id`',
                unique: true
            },
            {
                table: 'packing_assignments',
                name: 'uk_packing_assignment_guest',
                columns: '`item_id`, `guest_id`',
                unique: true
            },
            {
                table: 'event_registrations',
                name: 'uk_event_participant',
                columns: '`event_id`, `user_id`, `guest_id`',
                unique: true
            },
            {
                table: 'activity_slot_role',
                name: 'unique_act_slot_role_map',
                columns: '`slot_id`, `role_id`',
                unique: true
            },
            {table: 'activity_plan_requirements', name: 'uk_plan_role', columns: '`plan_id`, `role_id`', unique: true},
            {
                table: 'activity_plan_requirement_overrides',
                name: 'uk_plan_participant_role',
                columns: '`plan_id`, `user_id`, `guest_id`, `role_id`', unique: true
            },
            {table: 'activity_roles', name: 'act_roles_name_plan', columns: '`name`, `plan_id`', unique: true},
            {
                table: 'activity_assignments',
                name: 'uk_unique_activity_assignment_user',
                columns: '`slot_id`, `user_id`', unique: true
            },
            {
                table: 'activity_assignments',
                name: 'uk_activity_assignment_guest',
                columns: '`slot_id`, `guest_id`',
                unique: true
            },
            {
                table: 'entity_admin_assignments',
                name: 'uk_entity_admin_assignment_user',
                columns: '`entity_type`, `entity_id`, `user_id`', unique: true
            },
            {
                table: 'survey_combinations',
                name: 'combinations_single_entry',
                columns: '`WEEKDAY`, `survey_id`, `nth_week`', unique: true
            },
        ];

        const oldForeignKeys: ForeignKeyDef[] = [
            {
                table: 'surveys',
                name: 'FK_9532b923178387169ff592c12a9',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_combinations',
                name: 'FK_c0e64c6fe4352a75372af4e98be',
                definition: 'FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_2b4e3f83ce0b4a0d7617ac0cd44',
                definition: 'FOREIGN KEY (`survey_id`) REFERENCES `surveys` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_235dcfd351bc1eb6d12894b7e8f',
                definition: 'FOREIGN KEY (`combination_id`) REFERENCES `survey_combinations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'survey_responses',
                name: 'FK_15c9124bfeb633545c5de42edb6',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'survey_responses',
                name: 'FK_14bcf49cc71d7f857892abbfb0e',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'entity_admin_assignments',
                name: 'FK_d9e6ddc59fdf807a57068e4a717',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_c9be315fed7f07cfc32196eb73d',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_b56fb307a2d9170d1fd91d53240',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignments',
                name: 'FK_aec8db1f4174e3b0f6bfc8fad09',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_assignments',
                name: 'FK_9e96938fab1057b20f085550ed0',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_roles',
                name: 'FK_f8218a37990e864e813f6451487',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plans',
                name: 'FK_d4636d5c694bae3fd270f7c266f',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_text_fields',
                name: 'FK_bfaec999480077e410bddc977b3',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_eaed15cf3bb93c39608b4fcd38b',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_d6ad3e7aaa1d11ef848f03a80e5',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirement_overrides',
                name: 'FK_d0ca8a723a711cac289a0572660',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_plan_requirements',
                name: 'FK_3e411697f33a4269726c347d12d',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_caa6eb650afe861c890f134afa9',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_44fca84f2c94b85a4aa0f857af4',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_3a84aa083a3749f16515d67b131',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_assignment_recommendations',
                name: 'FK_0e34a6eb8333caef959e50f1682',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION'
            },
            {
                table: 'activity_slots',
                name: 'FK_c4e8f0a94193ce0883305a90e88',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'activity_slots',
                name: 'FK_46f987c26b60e3396f22d53735e',
                definition: 'FOREIGN KEY (`plan_id`) REFERENCES `activity_plans` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
            },
            {
                table: 'activity_slots',
                name: 'FK_01ebc30d7c6c9f3c764be121cda',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'activity_slot_role',
                name: 'FK_0302a1df8a7c1ea8bc3cd8f98f0',
                definition: 'FOREIGN KEY (`slot_id`) REFERENCES `activity_slots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'events',
                name: 'FK_918130b4f882fda431503d6f4e0',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'event_registrations',
                name: 'FK_e42ba7c85b05c49c8de4f360543',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_registrations',
                name: 'FK_52165ba60768fd87815d733e562',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_reg_links',
                name: 'FK_febc2c20c1ea64180fa09040f28',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'event_reg_links',
                name: 'FK_a2b8c0843d19876a98b16b8461f',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_lists',
                name: 'FK_a801f486411025640abc78bbd91',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'packing_assignments',
                name: 'FK_c217003837bbf8a7b3a2c1eeb80',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_assignments',
                name: 'FK_99ffd07a41b38d3a13aadd7ce74',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_assignments',
                name: 'FK_574be0a35d91af3bac4e3f5ee73',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_a0bad64d810ac4e76c23b86785d',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_9cbf247de70a55b58841e7b0941',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'packing_items',
                name: 'FK_6207edc397ed15fcbf1b87b1927',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `packing_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_lists',
                name: 'FK_f124e3b4cbdb69f28f796e1cc99',
                definition: 'FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_dc269892d22b330ef2c60aead83',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_797f953903af106421d5f2cada2',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_assignments',
                name: 'FK_33c32c9f3dbd2e9eaa63b7f08bf',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_ee27f34d81abc82359683f84e38',
                definition: 'FOREIGN KEY (`list_id`) REFERENCES `drivers_lists` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
            },
            {
                table: 'drivers_items',
                name: 'FK_ccd3f1ec65169179b395e5ba903',
                definition: 'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            },
            {
                table: 'drivers_items',
                name: 'FK_357c0fbec24aac87ee423ba5168',
                definition: 'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT'
            }
        ];

        await this.preflightDown(queryRunner, mappings.map(mapping => mapping.table));
        await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const [table, fk] of newForeignKeys) {
                await dropFkConstraintIfExists(queryRunner, table, fk);
            }
            for (const [table, index] of newUniqueIndexes) {
                await dropIndexIfExists(queryRunner, table, index);
            }

            if (await columnExists(queryRunner, 'activity_assignments', 'updated_at')) {
                await addColumnIfNotExists(queryRunner, 'activity_assignments', 'updatedAt', 'timestamp', 'NOT NULL DEFAULT CURRENT_TIMESTAMP()');
                await queryRunner.query('UPDATE `activity_assignments` SET `updatedAt` = `updated_at` WHERE `updated_at` IS NOT NULL');
                await dropColumnIfExists(queryRunner, 'activity_assignments', 'updated_at');
            }

            if (await columnExists(queryRunner, 'activity_roles', 'title')) {
                await addColumnIfNotExists(queryRunner, 'activity_roles', 'name', 'varchar(50)', 'NULL');
                await queryRunner.query('UPDATE `activity_roles` SET `name` = COALESCE(`name`, LEFT(`title`, 50)) WHERE `name` IS NULL');
            }

            await addColumnIfNotExists(queryRunner, 'entity_admin_assignments', 'user_id', 'int', 'NULL');
            if (await tableExists(queryRunner, 'profiles') && await columnExists(queryRunner, 'entity_admin_assignments', 'profile_id')) {
                await queryRunner.query(`UPDATE \`entity_admin_assignments\` e
                    LEFT JOIN \`profiles\` p ON p.id = e.profile_id
                                         SET e.user_id = COALESCE(e.user_id, p.user_id)
                                         WHERE e.profile_id IS NOT NULL`);
            }
            await dropColumnIfExists(queryRunner, 'entity_admin_assignments', 'profile_id');

            for (const mapping of mappings) {
                await this.migrateRelationColumnsDown(queryRunner, mapping);
            }

            if (await columnExists(queryRunner, 'survey_combinations', 'title')) {
                await dropColumnIfExists(queryRunner, 'survey_combinations', 'title');
            }
            await dropColumnIfExists(queryRunner, 'survey_combinations', 'description');
            await dropColumnIfExists(queryRunner, 'survey_combinations', 'profile_id');

            if (await columnExists(queryRunner, 'activity_slots', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_slots` CHANGE `description` `description` text NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'description')) {
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `description` `description` text NULL');
            }
            if (await columnExists(queryRunner, 'activity_roles', 'name')) {
                await dropColumnIfExists(queryRunner, 'activity_roles', 'title');
                await queryRunner.query('ALTER TABLE `activity_roles` CHANGE `name` `name` varchar(50) NOT NULL');
            }

            await this.migrateOwnerToUser(queryRunner, 'drivers_lists');
            await this.migrateOwnerToUser(queryRunner, 'packing_lists');
            await this.migrateOwnerToUser(queryRunner, 'events');
            await this.migrateOwnerToUser(queryRunner, 'activity_plans');
            await this.migrateOwnerToUser(queryRunner, 'surveys');

            if (await tableExists(queryRunner, 'profiles')) {
                await dropIndexIfExists(queryRunner, 'profiles', 'REL_74c607202390168d8cb82bfd1e');
                await queryRunner.query('DROP TABLE IF EXISTS `profiles`');
            }

            for (const index of oldIndexes) {
                if (index.unique) {
                    await createUniqueIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                } else {
                    await createIndexIfNotExists(queryRunner, index.table, index.name, index.columns);
                }
            }

            for (const fk of oldForeignKeys) {
                await createConstraintIfNotExists(queryRunner, fk.table, fk.name, fk.definition);
            }
        } finally {
            await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1');
        }
    }
}
