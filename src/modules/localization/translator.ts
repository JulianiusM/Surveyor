/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */
import {createInstance} from 'i18next';
import type {i18n, TFunction} from 'i18next';
import resources from './generated/resources.json';
import manifest from './generated/manifest.json';
import type {Locale, LocaleDefinition, LocalizationContext, MessageKey, Translator} from '../../types/LocalizationTypes';

/** Public names and available languages come from discovery, never a second manually maintained registry. */
export const localeManifest: readonly LocaleDefinition[] = Object.freeze(manifest.locales.map(locale => Object.freeze({...locale})) as LocaleDefinition[]);
export const catalogVersion: string = manifest.version;

/** The same locale definition owns interface messages and its fixed, release-shipped help corpus. */
export function helpSourceDirectory(requestedLocale?: string | null): string {
    return manifest.helpSources[resolveLocale(requestedLocale)];
}

/** Keep script subtags intact; an unsupported script must not silently select a different script's catalog. */
function findSupportedLocale(value?: string | null): Locale | undefined {
    try {
        if (typeof value === 'string' && value) {
            const requested = new Intl.Locale(value);
            const candidates = [requested.baseName, requested.script ? `${requested.language}-${requested.script}` : requested.language];
            for (const candidate of candidates) {
                const found = localeManifest.find(locale => locale.locale.toLowerCase() === candidate.toLowerCase());
                if (found) return found.locale;
            }
        }
    } catch {
        // Invalid browser hints are harmless. Preference mutations validate membership separately.
    }
    return undefined;
}

export function resolveLocale(value?: string | null): Locale {
    return findSupportedLocale(value) ?? 'en';
}

/** Negotiate all ordered hints before falling back; an unsupported first hint is not an English preference. */
export function resolvePreferredLocale(values: readonly string[]): Locale {
    for (const value of values) {
        const locale = findSupportedLocale(value);
        if (locale) return locale;
    }
    return 'en';
}

/**
 * Bind plain-text translations to one request/recipient. Resources are already bundled, so initialization
 * is synchronous; no asynchronous loader or process-global changeLanguage can mix simultaneous locales.
 * HTML/Pug/Vue/email/PDF owners must escape or create text nodes at their own output boundary.
 */
export function createLocalizationInstance(requestedLocale?: string | null): i18n {
    const locale = resolveLocale(requestedLocale);
    const instance = createInstance();
    // A Vue binding can update its resources during development. Keep its writable store
    // separate from concurrent server requests and other applications using this module.
    void instance.init({resources: structuredClone(resources), lng: locale, fallbackLng: 'en', defaultNS: 'ui', ns: Object.keys(resources.en),
        initAsync: false, returnNull: false, returnEmptyString: false, saveMissing: false,
        interpolation: {escapeValue: false, skipOnVariables: true}});
    if (!instance.isInitialized) throw new Error('Bundled localization resources did not initialize synchronously');
    return instance;
}

/** The Vue binding supplies its reactive translator; all other owners use a fixed request locale.
 * Both paths keep the same generated key/parameter checks and interpolation boundary. */
export function createTranslator(requestedLocale?: string | null, translation?: TFunction): LocalizationContext {
    const locale = resolveLocale(requestedLocale);
    const fixed = translation ?? createLocalizationInstance(locale).getFixedT(locale);

    /** Runtime guards also protect JavaScript/Pug callers and prevent options injection through parameters. */
    function translate(key: MessageKey, parameters: Record<string, unknown> = {}): string {
        if (!Object.hasOwn(manifest.messages, key)) throw new Error(`Unknown translation key: ${key}`);
        const contract = manifest.messages[key];
        const values: Record<string, string | number | boolean> = {};
        for (const name of Object.keys(parameters)) {
            if (!Object.hasOwn(contract.parameters, name)) throw new Error(`Unknown translation parameter: ${name}`);
        }
        for (const name of contract.required) {
            if (!Object.hasOwn(parameters, name)) throw new Error(`Missing translation parameter: ${name}`);
        }
        for (const [name, type] of Object.entries(contract.parameters)) {
            if (!Object.hasOwn(parameters, name)) continue;
            const value = parameters[name];
            if (typeof value !== (type === 'integer' ? 'number' : type)
                || (typeof value === 'number' && (!Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))))) {
                throw new Error(`Invalid translation parameter: ${name}`);
            }
            values[name] = value as string | number | boolean;
        }
        // Only count has library meaning here. Other values stay inside replace, so a value named
        // lng/defaultValue cannot override the fixed language or activate a different message.
        const count = typeof values.count === 'number' ? values.count : undefined;
        return fixed(key, {replace: values, ...(count === undefined ? {} : {count})});
    }
    return Object.freeze({locale, t: translate as Translator});
}
