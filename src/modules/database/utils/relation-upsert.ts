import type {
    ColumnEntry,
    DualParty,
    GuestKey,
    IdInput,
    Maybe,
    PartialRecord,
    RelationEntry,
    UserKey,
    UserOrGuestKey
} from "../../../types/UtilTypes";
import {DeepPartial, FindOperator, FindOptionsWhere, IsNull, ObjectLiteral, Repository} from "typeorm";

const userKey: UserKey = "user";
const guestKey: GuestKey = "guest";

/* ----------------------------------------------------------------------------
 * Core builders (arrays-in): already generic & safe
 * ------------------------------------------------------------------------- */

export function buildGenericWhere<
    E,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(opts: {
    relations?: ReadonlyArray<RelationEntry<E, RKeys>>;
    columns?: ReadonlyArray<ColumnEntry<E, CKeys>>;
    party?: { leftKey: LKey; rightKey: RKey; selector: DualParty<LKey, RKey> };
}): FindOptionsWhere<E> {
    const where: any = {};

    for (const rel of opts.relations ?? []) {
        const {key, id} = rel;
        if (id === undefined) continue; // omit
        where[key] = id === null ? IsNull() : {id};
    }

    if (opts.party) {
        const {leftKey, rightKey, selector} = opts.party;
        if (selector.kind === leftKey) {
            where[leftKey] = selector.id === null ? IsNull() : {id: selector.id};
        } else if (selector.kind === rightKey) {
            where[rightKey] = selector.id === null ? IsNull() : {id: selector.id};
        } else {
            throw new Error(
                `buildGenericWhere: selector.kind "${String(
                    selector.kind
                )}" must be "${String(leftKey)}" or "${String(rightKey)}".`
            );
        }
    }

    for (const col of opts.columns ?? []) {
        const {key, value} = col;
        if (value === undefined) continue; // omit
        where[key] = value === null ? IsNull() : value; // FindOperator passes through
    }

    return where as FindOptionsWhere<E>;
}

export function buildGenericCreate<
    E,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(opts: {
    relations?: ReadonlyArray<RelationEntry<E, RKeys>>;
    columns?: ReadonlyArray<ColumnEntry<E, CKeys>>;
    party?: { leftKey: LKey; rightKey: RKey; selector: DualParty<LKey, RKey> };
}): DeepPartial<E> {
    const data: any = {};

    for (const rel of opts.relations ?? []) {
        const {key, id} = rel;
        if (id === undefined) continue; // omit
        data[key] = id === null ? null : {id};
    }

    if (opts.party) {
        const {leftKey, rightKey, selector} = opts.party;
        if (selector.kind === leftKey) {
            data[leftKey] = selector.id === null ? null : {id: selector.id};
        } else if (selector.kind === rightKey) {
            data[rightKey] = selector.id === null ? null : {id: selector.id};
        } else {
            throw new Error(
                `buildGenericCreate: selector.kind "${String(
                    selector.kind
                )}" must be "${String(leftKey)}" or "${String(rightKey)}".`
            );
        }
    }

    for (const col of opts.columns ?? []) {
        const {key, value} = col;
        if (value === undefined) continue; // omit

        // CREATE payloads must not contain FindOperator
        if (value instanceof FindOperator) {
            throw new Error(
                `buildGenericCreate: FindOperator provided for column "${String(
                    key
                )}" is not allowed in create payloads.`
            );
        }
        data[key] = value; // primitive or null
    }

    return data as DeepPartial<E>;
}

/* ----------------------------------------------------------------------------
 * Convenience wrappers (object-in): better inference & ergonomics
 * ------------------------------------------------------------------------- */

/** Convert { relKey: id|null|undefined } into RelationEntry[] with key inference */
export function toRelationEntries<
    E,
    Keys extends keyof E & string
>(obj?: PartialRecord<Keys, Maybe<IdInput>>): RelationEntry<E, Keys>[] {
    if (!obj) return [];
    const out: RelationEntry<E, Keys>[] = [];
    (Object.keys(obj) as Keys[]).forEach((k) => {
        out.push({key: k, id: obj[k]});
    });
    return out;
}

/** Convert { colKey: value|null|undefined } into ColumnEntry[] with key inference */
export function toColumnEntries<
    E,
    Keys extends keyof E & string,
    V = any
>(obj?: PartialRecord<Keys, Maybe<V | FindOperator<V>>>): ColumnEntry<E, Keys, V>[] {
    if (!obj) return [];
    const out: ColumnEntry<E, Keys, V>[] = [];
    (Object.keys(obj) as Keys[]).forEach((k) => {
        out.push({key: k, value: obj[k] as any});
    });
    return out;
}

/** Derive DualParty from a simple object like { user?: id|null; guest?: id|null } */
export function partyFromObject<
    LKey extends string,
    RKey extends string
>(
    values: PartialRecord<LKey | RKey, Maybe<IdInput>>,
    leftKey: LKey,
    rightKey: RKey
): DualParty<LKey, RKey> {
    const left = values[leftKey];
    const right = values[rightKey];
    const provided = (left !== undefined ? 1 : 0) + (right !== undefined ? 1 : 0);
    if (provided !== 1) {
        throw new Error(
            `partyFromObject: provide exactly one of "${leftKey}" or "${rightKey}" (use null to target NULL).`
        );
    }
    return left !== undefined
        ? {kind: leftKey, id: left}
        : {kind: rightKey, id: right!};
}

/** Build WHERE from object-shaped inputs with strong inference */
export function buildWhereFromObjects<
    E,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(args: {
    relations?: PartialRecord<RKeys, Maybe<IdInput>>;
    columns?: PartialRecord<CKeys, Maybe<any | FindOperator<any>>>;
    party?: {
        values: PartialRecord<LKey | RKey, Maybe<IdInput>>;
        leftKey: LKey;
        rightKey: RKey;
    };
}): FindOptionsWhere<E> {
    const relations = toRelationEntries<E, RKeys>(args.relations);
    const columns = toColumnEntries<E, CKeys>(args.columns);

    const party = args.party
        ? {
            leftKey: args.party.leftKey,
            rightKey: args.party.rightKey,
            selector: partyFromObject(
                args.party.values,
                args.party.leftKey,
                args.party.rightKey
            ),
        }
        : undefined;

    return buildGenericWhere<E, RKeys, CKeys, LKey, RKey>({
        relations,
        columns,
        party,
    });
}

/** WHERE: assumes E has `user` and `guest` relations. */
export function buildWhereFromObjectsAuthed<
    E extends Record<UserOrGuestKey, any>,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
>(
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any>>;
        party?: PartialRecord<UserOrGuestKey, Maybe<IdInput>>;
    }
): FindOptionsWhere<E> {
    return buildWhereFromObjects<E, RKeys, CKeys, UserKey, GuestKey>({
        relations: args.relations,
        columns: args.columns,
        party: args.party
            ? {values: args.party, leftKey: userKey, rightKey: guestKey}
            : undefined,
    });
}

/** Build CREATE from object-shaped inputs with strong inference */
export function buildCreateFromObjects<
    E,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(args: {
    relations?: PartialRecord<RKeys, Maybe<IdInput>>;
    columns?: PartialRecord<CKeys, Maybe<any>>; // no FindOperator allowed
    party?: {
        values: PartialRecord<LKey | RKey, Maybe<IdInput>>;
        leftKey: LKey;
        rightKey: RKey;
    };
}): DeepPartial<E> {
    const relations = toRelationEntries<E, RKeys>(args.relations);
    const columns = toColumnEntries<E, CKeys>(args.columns);

    const party = args.party
        ? {
            leftKey: args.party.leftKey,
            rightKey: args.party.rightKey,
            selector: partyFromObject(
                args.party.values,
                args.party.leftKey,
                args.party.rightKey
            ),
        }
        : undefined;

    return buildGenericCreate<E, RKeys, CKeys, LKey, RKey>({
        relations,
        columns,
        party,
    });
}

export function buildCreateFromObjectsAuthed<
    E extends PartialRecord<UserOrGuestKey, any>,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
>(
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any>>;
        party?: PartialRecord<UserOrGuestKey, Maybe<IdInput>>;
    }
): DeepPartial<E> {
    return buildCreateFromObjects<E, RKeys, CKeys, UserKey, GuestKey>({
        relations: args.relations,
        columns: args.columns,
        party: args.party
            ? {values: args.party, leftKey: userKey, rightKey: guestKey}
            : undefined,
    });
}

/* ----------------------------------------------------------------------------
 * High-level convenience: findOne / ensureOne (upsert-ish) with inference
 * ------------------------------------------------------------------------- */

/** Find one entity using object-shaped inputs. */
export async function findOneByObjects<
    E extends ObjectLiteral,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(
    repo: Repository<E>,
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any | FindOperator<any>>>;
        party?: { values: PartialRecord<LKey | RKey, Maybe<IdInput>>; leftKey: LKey; rightKey: RKey };
    }
): Promise<E | null> {
    const where = buildWhereFromObjects<E, RKeys, CKeys, LKey, RKey>(args);
    return repo.findOne({where});
}

export async function findOneByObjectsAuthed<
    E extends ObjectLiteral,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string
>(
    repo: Repository<E>,
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any | FindOperator<any>>>;
        party?: PartialRecord<UserOrGuestKey, Maybe<IdInput>>
    }
): Promise<E | null> {
    let party = undefined;
    if (args.party !== undefined) {
        party = {
            values: args.party,
            leftKey: userKey,
            rightKey: guestKey
        }
    }
    return findOneByObjects(repo, {
        relations: args.relations,
        columns: args.columns,
        party
    })
}

/** Ensure one entity exists; if not, create it (no FindOperators in CREATE). */
export async function ensureOneByObjects<
    E extends ObjectLiteral,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string,
    LKey extends keyof E & string,
    RKey extends keyof E & string
>(
    repo: Repository<E>,
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any>>;
        party?: { values: PartialRecord<LKey | RKey, Maybe<IdInput>>; leftKey: LKey; rightKey: RKey };
    }
): Promise<E> {
    const where = buildWhereFromObjects<E, RKeys, CKeys, LKey, RKey>(args);
    let entity = await repo.findOne({where});
    if (!entity) {
        const data = buildCreateFromObjects<E, RKeys, CKeys, LKey, RKey>(args);
        entity = repo.create(data);
        await repo.save(entity);
    }
    return entity;
}

export async function ensureOneByObjectsAuthed<
    E extends ObjectLiteral,
    RKeys extends keyof E & string,
    CKeys extends keyof E & string
>(
    repo: Repository<E>,
    args: {
        relations?: PartialRecord<RKeys, Maybe<IdInput>>;
        columns?: PartialRecord<CKeys, Maybe<any>>;
        party?: PartialRecord<UserOrGuestKey, Maybe<IdInput>>
    }
): Promise<E> {
    let party = undefined;
    if (args.party !== undefined) {
        party = {
            values: args.party,
            leftKey: userKey,
            rightKey: guestKey
        }
    }
    return ensureOneByObjects(repo, {
        relations: args.relations,
        columns: args.columns,
        party
    })
}