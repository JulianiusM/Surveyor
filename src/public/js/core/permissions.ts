/**
 * Core permissions utilities
 * Handles permission loading and checking
 */

import type { PermBundle, PermType, PermView } from "../../../types/PermissionTypes";

/**
 * JSON reviver for deserializing Map objects
 * @param key Property key
 * @param value Property value
 * @returns Deserialized value
 */
export function jsonReviver(key: any, value: any): any {
    if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        }
    }
    return value;
}

/**
 * Restore a PermView object from serialized data
 * @param data Serialized permission view data
 * @param parentData Optional parent permission data
 * @returns Restored PermView object
 */
function restorePermView(data: Partial<PermView>, parentData?: Partial<PermView>): PermView {
    const selfHas = (k: PermType) => (data.bits ? data.bits[k] : false) ?? false;
    const parentHas = (k: PermType) => (parentData?.bits ? parentData.bits[k] : false) ?? false;

    return {
        mask: data.mask!,
        parentMask: data.parentMask!,
        has: selfHas,
        allow: (k, parentKey) => selfHas(k) || parentHas(k),
        all: (...keys) => keys.every(selfHas),
        any: (...keys) => keys.some(selfHas),
        bits: data.bits!
    };
}

/**
 * Restore a PermBundle from serialized data
 * @param data Serialized permission bundle data
 * @returns Restored PermBundle object
 */
function restorePermBundle(data: Partial<PermBundle>): PermBundle {
    const entity = restorePermView(data.entity!);
    const itemMap = data.items!;
    
    for (let key of itemMap.keys()) {
        itemMap.set(key, restorePermView(itemMap.get(key)!, entity));
    }

    const empty = restorePermView({ mask: 0, parentMask: entity.mask, bits: {} }, entity);
    const getItem = (id: string) => itemMap.get(id) ?? empty;

    const bundle: PermBundle = {
        entity: restorePermView(data.entity!),
        items: itemMap,
        item: getItem,
        itemHas: (id: string, key: PermType) => getItem(id).has(key),
        itemAllow: (id: string, key: PermType, parentKey?: PermType) => getItem(id).allow(key, parentKey),
    };

    return bundle;
}

/**
 * Load permissions from window.PERM_DATA
 * Restores permission bundle and stores it in window.PERMS
 */
export function loadPerms(): void {
    // @ts-ignore
    if (window.PERM_DATA) {
        // @ts-ignore
        window.PERMS = restorePermBundle(JSON.parse(window.PERM_DATA, jsonReviver));
    }
}
