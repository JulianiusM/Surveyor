import type {PackingPackedRead} from '../../../types/PackingChecklistTypes';

/** Packing owns its established browser-local checklist across both frontend implementations. */
export function packedStorageKey(listId: string, itemId: string): string {
    return `packed_${listId}_${itemId}`;
}

/** Read the checklist key without treating inaccessible storage as an unchecked value.
 * The page retains its current-tab fallback and presents failure through the shared notice. */
export function readPacked(storage: Pick<Storage, 'getItem'> | undefined, listId: string, itemId: string): PackingPackedRead {
    // A rejected browser storage getter arrives as an absent facility. A working
    // getItem returning null is different: it authoritatively means unchecked.
    if (!storage) return {packed: false, available: false};

    try {
        return {packed: storage.getItem(packedStorageKey(listId, itemId)) === '1', available: true};
    } catch {
        // Do not leak browser exception text or silently overwrite a local choice.
        // The caller must keep the unavailable-read warning until recovery succeeds.
        return {packed: false, available: false};
    }
}

/** Persist only this explicit personal checkbox change, reporting failure to its owning page.
 * False leaves that item pending in memory; background list reads never retry the write. */
export function writePacked(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, listId: string,
                            itemId: string, packed: boolean): boolean {
    if (!storage) return false;

    try {
        // Preserve the key/value and removal contract for both checked and
        // unchecked changes. No server/profile state participates in this operation.
        const key = packedStorageKey(listId, itemId);
        if (packed) storage.setItem(key, '1');
        else storage.removeItem(key);
        return true;
    } catch {
        // A quota/security failure must remain visible even if reads still work.
        // The caller retains the selected value until explicit Retry or departure.
        return false;
    }
}
