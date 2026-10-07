/** Preserve the established browser-local checklist across both frontend implementations. */
export function packedStorageKey(listId: string, itemId: string): string {
    return `packed_${listId}_${itemId}`;
}

/** Storage is an optional browser facility; blocked storage must not break shared list actions. */
export function readPacked(storage: Pick<Storage, 'getItem'> | undefined, listId: string, itemId: string): boolean {
    try {
        return storage?.getItem(packedStorageKey(listId, itemId)) === '1';
    } catch {
        return false;
    }
}

export function writePacked(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, listId: string,
                            itemId: string, packed: boolean): void {
    try {
        const key = packedStorageKey(listId, itemId);
        if (packed) storage?.setItem(key, '1');
        else storage?.removeItem(key);
    } catch {
        // The current tab's state remains useful even when the browser cannot persist preferences.
    }
}
