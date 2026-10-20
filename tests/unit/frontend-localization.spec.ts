import {describe, expect, it} from 'vitest';
import {assertRichMessageNodes, catalogVersion, createTranslator, isPlainMessageKey, localeManifest, resolveLocale} from '../../src/modules/localization/translator';

describe('shared request-bound localization', () => {
    it('requires declared nodes and prevents node messages from becoming plain notices', () => {
        expect(isPlainMessageKey('common.save')).toBe(true);
        expect(isPlainMessageKey('activity.recommendations.scheduleHint')).toBe(false);
        expect(() => assertRichMessageNodes('activity.recommendations.scheduleHint', ['add'])).not.toThrow();
        expect(() => assertRichMessageNodes('activity.recommendations.scheduleHint', [])).toThrow('nodes differ');
        expect(() => assertRichMessageNodes('activity.recommendations.scheduleHint', ['add', 'other'])).toThrow('nodes differ');
        expect(() => assertRichMessageNodes('activity.progressIncomplete', ['assigned', 'assigned'])).toThrow('nodes differ');
        const rich = createTranslator('en').rich as (key: string, parameters: Record<string, unknown>) => unknown;
        expect(() => rich('common.save', {})).toThrow('no authored nodes');
        expect(() => rich('activity.progressComplete', {assigned: '{done}', required: 2})).toThrow('Invalid translation parameter');
    });
    it('discovers the same pilot languages for browser and server and resolves regional fallback', () => {
        expect(localeManifest.map(locale => locale.locale)).toEqual(expect.arrayContaining(['de', 'en']));
        expect(catalogVersion).toMatch(/^[a-f\d]{64}$/);
        expect(resolveLocale('DE-de')).toBe('de');
        expect(resolveLocale('en-GB')).toBe('en');
        expect(resolveLocale('de-Qaaa')).toBe('en');
        expect(resolveLocale('zz-ZZ')).toBe('en');
        expect(resolveLocale('invalid locale')).toBe('en');
    });

    it('keeps concurrent request and email translations bound to their own locale', async () => {
        const english = createTranslator('en');
        const german = createTranslator('de');
        const values = await Promise.all([Promise.resolve().then(() => english.t('common.save')),
            Promise.resolve().then(() => german.t('common.save')),
            Promise.resolve().then(() => english.t('api:errors.FORBIDDEN'))]);
        expect(values).toEqual(['Save', 'Speichern', 'You do not have permission for this action.']);
        expect(german.t('api:errors.PACKING_ITEM_FULL', {itemId: 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec'}))
            .toBe('Für diesen Gegenstand liegen bereits genügend Zusagen vor.');
    });

    it('selects complete plural forms using the resolved catalog language', () => {
        expect(createTranslator('de').t('packing.placeCount', {count: 1})).toBe('1 Platz');
        expect(createTranslator('de').t('packing.placeCount', {count: 0})).toBe('0 Plätze');
        expect(createTranslator('zz-ZZ').t('packing.placeCount', {count: 21})).toBe('21 places');
        expect(createTranslator('de').t('overview.matching', {count: 1})).toBe('1 passender Eintrag');
        expect(createTranslator('de').t('overview.matching', {count: 2})).toBe('2 passende Einträge');
        // Preserve the native English overview caption while other localized messages
        // continue selecting their complete cardinal forms from the same catalog owner.
        expect(createTranslator('en').t('overview.matching', {count: 1})).toBe('1 matching entities');
    });

    it('leaves user text uninterpreted and never returns HTML-escaped plain text', () => {
        const {t} = createTranslator('en');
        const name = '<img src=x> {{count}} $t(common.save) {helpLink} & "guest"';
        expect(t('app.activeProfile', {name})).toBe(`Active profile: ${name}`);
    });

    it('rejects malformed JavaScript callers and prevents translation option injection', () => {
        const {t} = createTranslator('de');
        const call = t as (key: string, parameters?: Record<string, unknown>) => string;
        expect(() => call('missing.key')).toThrow('Unknown translation key');
        expect(() => call('app.activeProfile')).toThrow('Missing translation parameter');
        expect(() => call('packing.placeCount', {count: '1'})).toThrow('Invalid translation parameter');
        expect(() => call('packing.placeCount', {count: NaN})).toThrow('Invalid translation parameter');
        expect(() => call('app.activeProfile', {name: 'Guest', lng: 'en'})).toThrow('Unknown translation parameter');
    });
});
