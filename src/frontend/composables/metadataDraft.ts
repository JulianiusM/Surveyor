import {computed, type Ref} from 'vue';
import type {EntityMetadataEditorHandle} from '../../types/FrontendEntityMetadataTypes';
import type {FrontendMetadataField, FrontendMetadataFieldPolicy, FrontendMetadataSnapshot} from '../../types/FrontendUiTypes';

/** Nullable text fields share empty-string comparison and sparse submission.
 * Features opt in for their own fields; other scalar values stay untouched. */
export function normalizeNullableMetadataText<T>(value: T): T | null {
    return value === '' ? null : value;
}

function copyMetadata<TValues extends object, TMetadata extends FrontendMetadataSnapshot<TValues>>(data: TMetadata): TMetadata {
    // Query results may be Vue readonly proxies; copy the known wire containers without structuredClone.
    return {...data, values: {...data.values}, editableFields: [...data.editableFields]};
}

/**
 * An editor owns its baseline and local values independently of the read cache. Remote snapshots can
 * be offered for review without advancing the baseline token behind an unsaved form. The caller owns
 * its wire projection and field semantics; this algorithm has no feature-specific field branches.
 */
export class MetadataDraft<TValues extends object, TMetadata extends FrontendMetadataSnapshot<TValues>> {
    baseline: TMetadata;
    values: TValues;
    etag: string;
    remote: {data: TMetadata; etag: string} | null = null;
    choices: Partial<Record<FrontendMetadataField<TValues>, 'mine' | 'current'>> = {};
    awaitingAuthority = false;

    constructor(data: TMetadata, etag: string, private readonly policy: FrontendMetadataFieldPolicy<TValues> = {}) {
        this.baseline = copyMetadata<TValues, TMetadata>(data);
        this.values = {...data.values};
        this.etag = etag;
    }

    /** Comparison and submission share the caller's normalization. Missing values still
     * stay omitted; nullable text, booleans and numbers retain their feature-owned meaning. */
    private normalized<TField extends FrontendMetadataField<TValues>>(field: TField, value: TValues[TField]): TValues[TField] {
        const normalize = this.policy[field];
        return normalize ? normalize(value) : value;
    }

    private sameValue<TField extends FrontendMetadataField<TValues>>(field: TField, left: TValues[TField], right: TValues[TField]): boolean {
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

    /** Offer Mine/Current only for different local and remote edits to the same
     * original field. Equal normalized edits need no choice; lost write permission
     * is handled by overlappingChanges rather than inventing an editable field. */
    get conflicts(): FrontendMetadataField<TValues>[] {
        if (!this.remote) return [];
        const conflicts: FrontendMetadataField<TValues>[] = [];

        // Choices belong only to fields the reviewed projection still permits.
        // Compare both edits with their common original, then exclude equal local
        // and remote outcomes so normalization does not create a false conflict.
        for (const field of this.remote.data.editableFields) {
            const original = this.baseline.values[field];
            const mine = this.values[field];
            const current = this.remote.data.values[field];
            if (!this.sameValue(field, mine, original) && !this.sameValue(field, current, original)
                && !this.sameValue(field, mine, current)) conflicts.push(field);
        }
        return conflicts;
    }

    /** Independent review controls compare touched original/current values until
     * an admitted read or explicit review advances authority. Merely typing the
     * remote value must not adopt its token; returning to the original value does
     * remove that field from the sparse draft. Per-field choice presentation uses
     * conflicts separately, since equal local/remote values need no Mine/Current choice. */
    get overlappingChanges(): boolean {
        if (!this.remote) return false;

        // Keep this authority warning separate from Mine/Current choices: an
        // edited field still needs review when its permission or original remote
        // value changed, even when the user has typed the same value as the server.
        for (const field of this.baseline.editableFields) {
            if (this.sameValue(field, this.values[field], this.baseline.values[field])) continue;
            if (!this.remote.data.editableFields.includes(field)
                || !this.sameValue(field, this.remote.data.values[field], this.baseline.values[field])) return true;
        }
        return false;
    }

    /** Refresh untouched fields immediately; overlapping edits retain their original comparison baseline. */
    receive(data: TMetadata, etag: string): void {
        if (!this.dirty) this.accept(data, etag);
        else if (etag !== this.etag) {
            const changed = Object.keys(this.patch) as FrontendMetadataField<TValues>[];
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

    /** Independent controls can display remote changes to untouched fields while
     * another field remains conflicted. Keep each overlapping field's original value
     * and the reviewed token, but adopt equal local/remote values without a conflict.
     * The caller still decides when to review and which local values to retain; this
     * operation does not submit, acknowledge uncertainty or calculate permissions. */
    receiveIndependent(data: TMetadata, etag: string): void {
        if (!this.dirty) {
            this.accept(data, etag);
            return;
        }

        let overlap = false;
        for (const field of this.baseline.editableFields) {
            if (!data.editableFields.includes(field)) {
                overlap = true;
                continue;
            }

            const original = this.baseline.values[field];
            const mine = this.values[field];
            const current = data.values[field];
            if (this.sameValue(field, mine, original)) {
                this.values[field] = current;
                this.baseline.values[field] = current;
            } else if (this.sameValue(field, mine, current)) {
                this.baseline.values[field] = current;
            } else if (!this.sameValue(field, original, current)) {
                overlap = true;
            }
        }

        if (overlap) {
            this.offerReview(data, etag);
            return;
        }

        // A fresh token is safe only after every changed field is reconciled.
        // Accept the whole authoritative projection, then restore its sparse draft.
        const patch = this.patch;
        this.accept(data, etag);
        Object.assign(this.values, patch);
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

        // Start from the reviewed server projection, then retain only explicit
        // local changes to its still-editable fields. Removed fields cannot become
        // sparse writes, and explicit Current choices keep the server value.
        for (const field of current.data.editableFields) {
            const mine = this.values[field];
            const original = this.baseline.values[field];
            const retain = !this.sameValue(field, mine, original) && this.choices[field] !== 'current';
            if (retain && mine !== undefined) merged[field] = mine;
        }

        // Adopt the reviewed permissions/token before reinstating the merged
        // local draft. Review grants no write; a later Save submits its sparse diff
        // against this newly accepted baseline instead of the retired original.
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

/** Expose the mounted editor's public workflow through a feature field adapter.
 * Both Packing and Event retain one underlying draft/command owner. These
 * derived flags follow ref replacement and create no second state or cache. */
export function useMetadataEditorHandle(editor: Readonly<Ref<EntityMetadataEditorHandle | null>>) {
    // A field adapter can exist before its editor mounts or after it retires.
    // Preserve the established absent-editor defaults without inventing authority.
    const pending = computed(() => editor.value?.pending ?? false);
    const refreshing = computed(() => editor.value?.refreshing ?? false);
    const unknown = computed(() => editor.value?.unknown ?? false);
    const dirty = computed(() => editor.value?.dirty ?? false);
    const awaitingAuthority = computed(() => editor.value?.awaitingAuthority ?? false);
    const retryAvailable = computed(() => editor.value?.retryAvailable ?? true);

    /** Ask the current mounted editor; no stale component handle is retained. */
    function mayLeave(): boolean {
        return editor.value?.mayLeave() ?? true;
    }

    /** The editor owns deliberate review, draft retention and read recovery. */
    function refresh(discard = false): Promise<void> | undefined {
        return editor.value?.refresh(discard);
    }

    /** Settings awaits the same editor's related read, including its failures. */
    function refreshAfterSettings(discard = false): Promise<void> | undefined {
        return editor.value?.refreshAfterSettings(discard);
    }

    return {mayLeave, pending, refreshing, unknown, dirty, awaitingAuthority, retryAvailable, refresh, refreshAfterSettings};
}
