import {permissionMessageKeys} from './generated/permissions';
import type {Translator} from '../../types/LocalizationTypes';

/** An older loaded editor must not invent or translate an arbitrary server-provided key. */
export function permissionLabel(key: string, translate: Translator): string {
    if (!Object.hasOwn(permissionMessageKeys, key)) return translate('common.error');
    return translate(permissionMessageKeys[key as keyof typeof permissionMessageKeys]);
}
