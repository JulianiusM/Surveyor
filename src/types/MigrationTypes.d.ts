/** Physical identifier storage read from the selected migration schema. */
export interface MigrationColumnStorage {
    columnType: string;
    characterSet: string | null;
    collation: string | null;
    isNullable: boolean;
    extra: string;
    defaultValue: unknown;
    /** Validated type/character attributes only, without parent identity flags. */
    definition: string;
}

export interface MigrationReference {
    table: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
    foreignKey?: {
        name: string;
        onDelete: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL';
        onUpdate: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL';
    };
}

/** A read-only admission result; application rechecks it before issuing DDL. */
export interface MigrationReferencePlan {
    reference: MigrationReference;
    storage: MigrationColumnStorage;
    action: 'add' | 'align' | 'preserve';
    foreignKeyPresent: boolean;
}
