import type {components} from '../../types/api/v1';

type Metadata = components['schemas']['PackingMetadata'];
type Patch = components['schemas']['PackingMetadataPatch'];
type Field = Metadata['editableFields'][number];

function copyMetadata(data: Metadata): Metadata {
    // Query results may be Vue readonly proxies; copy the known wire containers without structuredClone.
    return {...data, values: {...data.values}, editableFields: [...data.editableFields]};
}

/** Empty optional text has the same wire meaning as null. Missing projected fields stay missing. */
function sameValue(field: Field, left: string | null | undefined, right: string | null | undefined): boolean {
    if (field !== 'description') return left === right;
    return (left === '' ? null : left) === (right === '' ? null : right);
}

/**
 * An editor owns its baseline and local values independently of the read cache. Remote snapshots can
 * be offered for review without advancing the baseline token behind an unsaved form.
 */
export class MetadataDraft {
    baseline: Metadata;
    values: Metadata['values'];
    etag: string;
    remote: {data: Metadata; etag: string} | null = null;
    choices: Partial<Record<Field, 'mine' | 'current'>> = {};

    constructor(data: Metadata, etag: string) {
        this.baseline = copyMetadata(data);
        this.values = {...data.values};
        this.etag = etag;
    }

    /** Compare only authorized, explicitly present fields; untouched values never become PATCH defaults. */
    get patch(): Patch {
        const patch: Patch = {};
        for (const field of this.baseline.editableFields) {
            if (sameValue(field, this.values[field], this.baseline.values[field])) continue;
            if (field === 'title' && this.values.title !== undefined) patch.title = this.values.title;
            if (field === 'description' && this.values.description !== undefined) {
                patch.description = this.values.description === '' ? null : this.values.description;
            }
        }
        return patch;
    }

    get dirty(): boolean {
        return Object.keys(this.patch).length > 0;
    }

    get conflicts(): Field[] {
        if (!this.remote) return [];
        const conflicts: Field[] = [];
        for (const field of this.remote.data.editableFields) {
            const original = this.baseline.values[field];
            const mine = this.values[field];
            const current = this.remote.data.values[field];
            if (!sameValue(field, mine, original) && !sameValue(field, current, original)
                && !sameValue(field, mine, current)) conflicts.push(field);
        }
        return conflicts;
    }

    /** Refresh untouched fields immediately; overlapping edits retain their original comparison baseline. */
    receive(data: Metadata, etag: string): void {
        if (!this.dirty) this.accept(data, etag);
        else if (etag !== this.etag) {
            const changed = Object.keys(this.patch) as Field[];
            const overlap = changed.some(field => !data.editableFields.includes(field)
                || !sameValue(field, data.values[field], this.baseline.values[field]));
            if (overlap) this.offerReview(data, etag);
            else {
                // Another client changed only untouched fields. Adopt those current values and
                // their token while preserving this sparse draft; no conflict ceremony is needed.
                const mine = {...this.values};
                this.accept(data, etag);
                for (const field of changed) {
                    if (field === 'title' && mine.title !== undefined) this.values.title = mine.title;
                    if (field === 'description' && mine.description !== undefined) this.values.description = mine.description;
                }
            }
        }
    }

    /** An unknown write needs deliberate review even when the authoritative token has not changed. */
    offerReview(data: Metadata, etag: string): void {
        // Repeated reads of the same snapshot must not erase choices made in the open review.
        if (this.remote?.etag !== etag) this.choices = {};
        this.remote = {data: copyMetadata(data), etag};
    }

    /** A caller invokes this only after deliberate review; it never issues a write or selects a conflict. */
    review(): boolean {
        if (!this.remote || this.conflicts.some(field => !this.choices[field])) return false;
        const current = this.remote;
        const merged = {...current.data.values};
        for (const field of current.data.editableFields) {
            const mine = this.values[field];
            const original = this.baseline.values[field];
            const retain = !sameValue(field, mine, original) && this.choices[field] !== 'current';
            if (field === 'title' && retain && mine !== undefined && mine !== null) merged.title = mine;
            if (field === 'description' && retain && mine !== undefined) merged.description = mine;
        }
        this.accept(current.data, current.etag);
        this.values = merged;
        return true;
    }

    /** Only a clean draft, confirmed write, or explicit review may replace the editor's baseline. */
    accept(data: Metadata, etag: string): void {
        this.baseline = copyMetadata(data);
        this.values = {...data.values};
        this.etag = etag;
        this.remote = null;
        this.choices = {};
    }
}
