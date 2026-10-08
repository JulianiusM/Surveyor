import type {components} from '../../types/api/v1';

type Metadata = components['schemas']['PackingMetadata'];
type Patch = components['schemas']['PackingMetadataPatch'];
type Field = Metadata['editableFields'][number];

function copyMetadata(data: Metadata): Metadata {
    // Query results may be Vue readonly proxies; copy the known wire containers without structuredClone.
    return {...data, values: {...data.values}, editableFields: [...data.editableFields]};
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
            if (this.values[field] === this.baseline.values[field]) continue;
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
        return this.remote.data.editableFields.filter(field => {
            const original = this.baseline.values[field];
            const mine = this.values[field];
            const current = this.remote!.data.values[field];
            return mine !== original && current !== original && mine !== current;
        });
    }

    receive(data: Metadata, etag: string): void {
        if (!this.dirty) this.accept(data, etag);
        else if (etag !== this.etag) {
            const changed = Object.keys(this.patch) as Field[];
            const overlap = changed.some(field => !data.editableFields.includes(field)
                || data.values[field] !== this.baseline.values[field]);
            if (overlap) this.remote = {data: copyMetadata(data), etag};
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

    /** A caller invokes this only after deliberate review; it never issues a write or selects a conflict. */
    review(): boolean {
        if (!this.remote || this.conflicts.some(field => !this.choices[field])) return false;
        const current = this.remote;
        const merged = {...current.data.values};
        for (const field of current.data.editableFields) {
            const mine = this.values[field];
            const original = this.baseline.values[field];
            const retain = mine !== original && this.choices[field] !== 'current';
            if (field === 'title' && retain && mine !== undefined && mine !== null) merged.title = mine;
            if (field === 'description' && retain && mine !== undefined) merged.description = mine;
        }
        this.accept(current.data, current.etag);
        this.values = merged;
        return true;
    }

    accept(data: Metadata, etag: string): void {
        this.baseline = copyMetadata(data);
        this.values = {...data.values};
        this.etag = etag;
        this.remote = null;
        this.choices = {};
    }
}
