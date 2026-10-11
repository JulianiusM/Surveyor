import type {PilotMetadataField, PilotMetadataFieldPolicy, PilotMetadataSnapshot} from '../../types/FrontendPilotUiTypes';

function copyMetadata<TValues extends object, TMetadata extends PilotMetadataSnapshot<TValues>>(data: TMetadata): TMetadata {
    // Query results may be Vue readonly proxies; copy the known wire containers without structuredClone.
    return {...data, values: {...data.values}, editableFields: [...data.editableFields]};
}

/**
 * An editor owns its baseline and local values independently of the read cache. Remote snapshots can
 * be offered for review without advancing the baseline token behind an unsaved form. The caller owns
 * its wire projection and field semantics; this algorithm has no feature-specific field branches.
 */
export class MetadataDraft<TValues extends object, TMetadata extends PilotMetadataSnapshot<TValues>> {
    baseline: TMetadata;
    values: TValues;
    etag: string;
    remote: {data: TMetadata; etag: string} | null = null;
    choices: Partial<Record<PilotMetadataField<TValues>, 'mine' | 'current'>> = {};
    awaitingAuthority = false;

    constructor(data: TMetadata, etag: string, private readonly policy: PilotMetadataFieldPolicy<TValues> = {}) {
        this.baseline = copyMetadata<TValues, TMetadata>(data);
        this.values = {...data.values};
        this.etag = etag;
    }

    /** Comparison and submission share the caller's normalization. Missing values still
     * stay omitted; nullable text, booleans and numbers retain their feature-owned meaning. */
    private normalized<TField extends PilotMetadataField<TValues>>(field: TField, value: TValues[TField]): TValues[TField] {
        const normalize = this.policy[field];
        return normalize ? normalize(value) : value;
    }

    private sameValue<TField extends PilotMetadataField<TValues>>(field: TField, left: TValues[TField], right: TValues[TField]): boolean {
        return this.normalized(field, left) === this.normalized(field, right);
    }

    /** Compare only authorized, explicitly present fields; untouched values never become PATCH defaults. */
    get patch(): Partial<TValues> {
        const patch: Partial<TValues> = {};
        // Confirmed values are presentation, not another editable baseline. Only a
        // subsequent authoritative read can supply permission/token for a new PATCH.
        if (this.awaitingAuthority) return patch;
        for (const field of this.baseline.editableFields) {
            if (this.sameValue(field, this.values[field], this.baseline.values[field])) continue;
            const mine = this.values[field];
            if (mine === undefined) continue;
            const value = this.normalized(field, mine);
            if (value !== undefined) patch[field] = value;
        }
        return patch;
    }

    get dirty(): boolean {
        return Object.keys(this.patch).length > 0;
    }

    get conflicts(): PilotMetadataField<TValues>[] {
        if (!this.remote) return [];
        const conflicts: PilotMetadataField<TValues>[] = [];
        for (const field of this.remote.data.editableFields) {
            const original = this.baseline.values[field];
            const mine = this.values[field];
            const current = this.remote.data.values[field];
            if (!this.sameValue(field, mine, original) && !this.sameValue(field, current, original)
                && !this.sameValue(field, mine, current)) conflicts.push(field);
        }
        return conflicts;
    }

    /** Refresh untouched fields immediately; overlapping edits retain their original comparison baseline. */
    receive(data: TMetadata, etag: string): void {
        if (!this.dirty) this.accept(data, etag);
        else if (etag !== this.etag) {
            const changed = Object.keys(this.patch) as PilotMetadataField<TValues>[];
            const overlap = changed.some(field => !data.editableFields.includes(field)
                || !this.sameValue(field, data.values[field], this.baseline.values[field]));
            if (overlap) this.offerReview(data, etag);
            else {
                // Another client changed only untouched fields. Adopt those current values and
                // their token while preserving this sparse draft; no conflict ceremony is needed.
                const mine = {...this.values};
                this.accept(data, etag);
                for (const field of changed) {
                    if (mine[field] !== undefined) this.values[field] = mine[field];
                }
            }
        }
    }

    /** Retain the values acknowledged by the server without adopting its permissions
     * or token. The feature must fence reads started before confirmation and obtain
     * fresh authority before enabling another write. A failed follow-up remains saved. */
    confirm(data: TMetadata): void {
        this.values = {...data.values};
        this.remote = null;
        this.choices = {};
        this.awaitingAuthority = true;
    }

    /** An unknown write needs deliberate review even when the authoritative token has not changed. */
    offerReview(data: TMetadata, etag: string): void {
        // Repeated reads of the same snapshot must not erase choices made in the open review.
        if (this.remote?.etag !== etag) this.choices = {};
        this.remote = {data: copyMetadata<TValues, TMetadata>(data), etag};
    }

    /** A caller invokes this only after deliberate review; it never issues a write or selects a conflict. */
    review(): boolean {
        if (!this.remote || this.conflicts.some(field => !this.choices[field])) return false;
        const current = this.remote;
        const merged = {...current.data.values};
        for (const field of current.data.editableFields) {
            const mine = this.values[field];
            const original = this.baseline.values[field];
            const retain = !this.sameValue(field, mine, original) && this.choices[field] !== 'current';
            if (retain && mine !== undefined) merged[field] = mine;
        }
        this.accept(current.data, current.etag);
        this.values = merged;
        return true;
    }

    /** Only an authoritative read of a clean/confirmed draft or explicit review replaces
     * the baseline. Command confirmation itself uses confirm and never advances authority. */
    accept(data: TMetadata, etag: string): void {
        this.baseline = copyMetadata<TValues, TMetadata>(data);
        this.values = {...data.values};
        this.etag = etag;
        this.remote = null;
        this.choices = {};
        this.awaitingAuthority = false;
    }
}
