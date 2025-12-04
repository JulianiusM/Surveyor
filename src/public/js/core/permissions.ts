/**
 * Core permissions utilities
 * Handles permission loading and checking
 */

import type { PermBundle, PermType, PermView } from "../../../types/PermissionTypes";

/**
 * Permission constants (duplicated from server-side for client use)
 */
export const PERM = {
    EDIT_TITLE: 1 << 0,
    EDIT_DESC: 1 << 1,
    EDIT_CAPACITY: 1 << 2,
    EDIT_META: 1 << 3,

    ITEM_ADD: 1 << 4,
    ITEM_EDIT: 1 << 5,
    ITEM_DELETE: 1 << 6,

    MANAGE_ASSIGNMENTS: 1 << 7,
    MANAGE_REQUIREMENTS: 1 << 8,
    MANAGE_REGISTRATIONS: 1 << 9,
    MANAGE_PERMISSIONS: 1 << 16,

    DATA_EXPORT: 1 << 10,
    DATA_DUPLICATE: 1 << 11,

    ACCESS_REGISTRATION: 1 << 12,
    ACCESS_VIEW: 1 << 13,
    ACCESS_CREATE: 1 << 14,
    ACCESS_ADMIN: 1 << 15,
    ACCESS_PARTICIPANTS: 1 << 17,
} as const;

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
        itemHas: (id: string, key: keyof typeof PERM) => getItem(id).has(key),
        itemAllow: (id: string, key: keyof typeof PERM, parentKey?: keyof typeof PERM) => getItem(id).allow(key, parentKey),
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
