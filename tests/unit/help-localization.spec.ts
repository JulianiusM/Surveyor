import path from 'node:path';
import fs from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';

// Synthetic release files test the runtime boundary without making maintained prose a delivery gate.
const files = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs')>();
    const fs = {
        ...original,
        existsSync: (file: string) => files.has(String(file)),
        statSync: (file: string) => ({isFile: () => files.has(String(file))}),
        lstatSync: (file: string) => {
            if (!files.has(String(file))) throw Object.assign(new Error('Synthetic Help file absent'), {code: 'ENOENT'});
            return {isFile: () => true, isSymbolicLink: () => false};
        },
        realpathSync: (file: string) => String(file),
        readFileSync: (file: string) => {
            const text = files.get(String(file));
            if (text === undefined) throw new Error('Synthetic help file missing');
            return text;
        },
        readdirSync: (directory: string) => [...files.keys()]
            .filter(file => path.dirname(file) === String(directory))
            .map(file => ({name: path.basename(file), isFile: () => true})),
    };
    return {...original, default: fs};
});

// Runtime discovery is exercised with an additional catalog language without
// committing a fake supported language or modifying generated production output.
vi.mock('../../src/common/localization/generated/manifest.json', async importOriginal => {
    // Vitest exposes the JSON import as an ESM default; its shape still comes
    // directly from generated output rather than a handwritten catalog contract.
    const original = await importOriginal<{default: typeof import('../../src/common/localization/generated/manifest.json')}>();
    return {default: {...original.default,
        locales: [...original.default.locales, {locale: 'nl', nativeName: 'Nederlands', direction: 'ltr'}],
        helpSources: {...original.default.helpSources, nl: 'nl'}}};
});

import {
    fetchHelpDoc,
    fetchHelpIndex,
    fetchHelpSearch,
    renderTrustedHelpMarkdown,
    resolveHelpAssetPath,
    resolveHelpAssetSource,
    validateTrustedHelpMarkdown,
} from '../../src/backend/controller/helpController';

// Specify the approved release layout independently of the production selector.
// Fixtures placed through that selector could accidentally bless a staged-source regression.
const helpSources = {
    native: path.join(process.cwd(), 'docs', 'user-guide'),
    en: path.join(process.cwd(), 'docs', 'user-guide', 'en'),
    de: path.join(process.cwd(), 'docs', 'user-guide', 'de'),
};

function article(title: string, heading: string, anchors: string, body: string): string {
    return `# ${title}\n<!--\ndocumentation-metadata\nheading-anchors: ${anchors}\n-->\n\n## ${heading}\n\n${body}`;
}

describe('localized fixed-source help documents', () => {
    afterEach(() => { files.clear(); vi.restoreAllMocks(); });

    it('retains a newly discovered interface locale when its entire Help corpus is absent', () => {
        files.set(path.join(helpSources.native, 'README.md'), '# Native-only guide\n\nDo not borrow native instructions.');
        files.set(path.join(helpSources.en, 'README.md'), article('Frontend guide', 'Take an item', '1:guide; 2:take-an-item',
            'Take bottles. [Packing](PACKING_LISTS.md#take-an-item) ![Frontend figure](assets/figure.png)'));
        files.set(path.join(helpSources.en, 'PACKING_LISTS.md'), article('Frontend packing', 'Take an item',
            '1:packing; 2:take-an-item', 'Take bottles.'));
        files.set(path.join(helpSources.en, 'assets', 'figure.png'), 'Reviewed English frontend figure');

        const page = fetchHelpIndex('nl-NL');
        expect(page.locale).toBe('nl');
        expect(page.contentLocale).toBe('en');
        expect(page.fallbackToEnglish).toBe(true);
        expect(page.content).toContain('Take bottles.');
        expect(page.content).not.toContain('Native-only');
        expect(page.content).toContain('/help/packing_lists?locale=nl#take-an-item');
        expect(page.content).toContain('/help/assets/figure.png?locale=en');
        expect(page.docsList).toEqual(expect.arrayContaining([expect.objectContaining({
            title: 'Frontend packing', contentLocale: 'en', url: '/help/packing_lists?locale=nl',
        })]));
        const search = fetchHelpSearch('bottles', 'nl');
        expect(search.locale).toBe('nl');
        expect(search.fallbackToEnglish).toBe(true);
        expect(search.searchResults).toHaveLength(2);
        expect(search.searchResults?.every(result => result.contentLocale === 'en' && result.url.includes('locale=nl'))).toBe(true);
        expect(resolveHelpAssetSource('figure.png', 'nl')).toBeNull();
        expect(resolveHelpAssetSource('figure.png', 'en')).toEqual({filePath: path.join(helpSources.en, 'assets', 'figure.png'), locale: 'en'});
    });

    it('merges absent translated topics into navigation and search without duplicating available articles', () => {
        files.set(path.join(helpSources.en, 'README.md'), '# Guide\n\nEnglish bottles.');
        files.set(path.join(helpSources.en, 'PACKING_LISTS.md'), '# Packing\n\nEnglish bottles.');
        files.set(path.join(helpSources.de, 'README.md'), '# Anleitung\n\nDeutsche Flaschen. [Packen](PACKING_LISTS.md)');

        const page = fetchHelpIndex('de');
        expect(page.contentLocale).toBe('de');
        expect(page.fallbackToEnglish).toBe(true);
        expect(page.docsList).toHaveLength(2);
        expect(page.docsList).toEqual(expect.arrayContaining([
            expect.objectContaining({title: 'Anleitung', contentLocale: 'de'}),
            expect.objectContaining({title: 'Packing', contentLocale: 'en'}),
        ]));
        expect(page.content).toContain('/help/packing_lists?locale=de');
        expect(fetchHelpSearch('bottles', 'de').searchResults).toEqual([
            expect.objectContaining({title: 'Packing', contentLocale: 'en', url: '/help/packing_lists?locale=de'}),
        ]);
        expect(() => fetchHelpDoc('../packing_lists', 'de')).toThrow('Anleitung nicht gefunden');
        expect(() => fetchHelpDoc('nonexistent', 'de')).toThrow('Anleitung nicht gefunden');
    });

    it('fails existing unsafe, invalid and unreadable translations rather than replacing them with English', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        files.set(path.join(helpSources.en, 'README.md'), '# Guide\n\nSafe reviewed English.');
        const localizedPath = path.join(helpSources.de, 'README.md');
        files.set(localizedPath, '# Anleitung\n\n<script>alert(1)</script>');
        expect(() => fetchHelpIndex('de')).toThrow('Die Anleitung konnte nicht geladen werden');
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
        files.set(localizedPath, article('Anleitung', 'Aufgabe', '1:guide; 3:wrong-level', 'Lokale Anleitung.'));
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
        const readFile = fs.readFileSync;
        vi.spyOn(fs, 'readFileSync').mockImplementation(function readUnavailable(file, options) {
            if (String(file) === localizedPath) throw new Error('Synthetic unreadable localized file');
            return readFile(file, options);
        });
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
    });

    it('rejects malformed release entries and realpath escapes instead of treating them as absent translations', () => {
        const localizedPath = path.join(helpSources.de, 'README.md');
        files.set(localizedPath, '# Anleitung');
        files.set(path.join(helpSources.en, 'README.md'), '# Guide');
        const inspectFile = fs.lstatSync;
        vi.spyOn(fs, 'lstatSync').mockImplementation(function inspectDirectory(file) {
            if (String(file) === localizedPath) return {...inspectFile(file), isFile: () => false} as ReturnType<typeof fs.lstatSync>;
            return inspectFile(file);
        });
        expect(() => fetchHelpDoc('readme', 'de')).toThrow(/regular file/u);
        vi.restoreAllMocks();
        vi.spyOn(fs, 'lstatSync').mockImplementation(function inspectSymlink(file) {
            if (String(file) === localizedPath) return {...inspectFile(file), isSymbolicLink: () => true} as ReturnType<typeof fs.lstatSync>;
            return inspectFile(file);
        });
        expect(() => fetchHelpDoc('readme', 'de')).toThrow(/regular file/u);
        vi.restoreAllMocks();
        const canonicalPath = fs.realpathSync;
        vi.spyOn(fs, 'realpathSync').mockImplementation(function inspectEscape(file) {
            return String(file) === localizedPath ? path.join(process.cwd(), 'uploads', 'README.md') : canonicalPath(file);
        });
        expect(() => fetchHelpDoc('readme', 'de')).toThrow(/regular file/u);
    });
    it('selects the complete body, catalog, headings, links and search corpus using one locale', () => {
        const english = helpSources.en;
        const german = helpSources.de;
        const native = helpSources.native;
        files.set(path.join(process.cwd(), 'docs', 'frontend-migration', 'staged', 'user-guide', 'README.md'),
            '# Unpublished draft\n\nThis staged content must never become an application article.');
        files.set(path.join(process.cwd(), 'docs', 'frontend-help', 'en', 'README.md'),
            '# Retired source\n\nThe former alternate corpus must never become an application article.');
        files.set(path.join(process.cwd(), 'docs', 'user-docs', 'README.md'),
            '# Incorrect alias\n\nThe rejected alias must never become an application article.');
        files.set(path.join(native, 'README.md'), '# Native guide\n\n## Native task\n\nOriginal English body. [Packing](PACKING_LISTS.md#native-task)');
        files.set(path.join(native, 'PACKING_LISTS.md'), '# Native packing\n\n## Auto-generate\n\nChoose Auto-generate.');
        files.set(path.join(english, 'README.md'), '# Guide\n\n## Bring bottles\n\nFill the bottles. [Packing](PACKING_LISTS.md#take-an-item)');
        files.set(path.join(english, 'PACKING_LISTS.md'), '# Packing\n\n## Take an item\n\nTake bottles.'
            + '\n\n## Auto-generate\n\n- Choose **Auto-generate** to add rows.\n\n---'
            + '\n\n| Label | Action |\n|---|---:|\n| Auto-generate | Add rows |');
        files.set(path.join(german, 'README.md'), article('Anleitung', 'Flaschen mitbringen', '1:guide; 2:bring-bottles', 'Fülle die Flaschen. [Packen](PACKING_LISTS.md#take-an-item)'));
        files.set(path.join(german, 'PACKING_LISTS.md'), article('Packen', 'Gegenstand übernehmen', '1:packing; 2:take-an-item', 'Übernimm die Flaschen.'));
        try {
            const de = fetchHelpIndex('de-DE');
            const en = fetchHelpIndex('en');
            // An omitted locale uses the same reviewed English corpus, including
            // catalog groups, stable links and exact visible-control searches.
            const original = fetchHelpIndex();
            expect(original).toEqual(en);
            expect(original.content).not.toContain('Original English body.');
            expect(original.content).toContain('/help/packing_lists?locale=en#take-an-item');
            expect(fetchHelpSearch('Auto-generate').searchResults).toEqual([expect.objectContaining({title: 'Packing'})]);
            expect(fetchHelpSearch('Auto generate').searchResults).toEqual([expect.objectContaining({title: 'Packing'})]);
            expect(de.locale).toBe('de');
            expect(de.contentLocale).toBe('de');
            expect(de.fallbackToEnglish).toBe(false);
            expect(de.title).toBe('Anleitung');
            expect(de.content).toContain('Fülle die Flaschen.');
            expect(de.content).not.toContain('Fill the bottles.');
            expect(de.content).toContain('/help/packing_lists?locale=de#take-an-item');
            expect(de.toc).toEqual([{id: 'bring-bottles', title: 'Flaschen mitbringen', level: 2}]);
            expect(de.content).toContain('<h2 id="bring-bottles">Flaschen mitbringen</h2>');
            expect(de.docsGroups[0].title).toBe('Erste Schritte');
            expect(de.docsList.every(doc => doc.url.endsWith('locale=de'))).toBe(true);
            expect(en.content).toContain('Fill the bottles.');
            expect(en.docsGroups[0].title).toBe('Start here');
            const search = fetchHelpSearch('  Flaschen  ', 'de');
            expect(search.locale).toBe('de');
            expect(search.searchQuery).toBe('Flaschen');
            expect(search.searchResults).toHaveLength(2);
            expect(search.searchResults?.every(result => result.url.includes('?locale=de'))).toBe(true);
            expect(search.searchResults?.some(result => result.url.endsWith('#bring-bottles'))).toBe(true);
            expect(fetchHelpSearch('Flaschen', 'en').searchResults).toEqual([]);
            // A visible hyphenated control remains an exact query and also matches
            // its unpunctuated component words, within the selected corpus only.
            const controlSearch = fetchHelpSearch('  Auto-generate  ', 'en');
            expect(controlSearch.searchQuery).toBe('Auto-generate');
            expect(controlSearch.searchResults).toEqual([expect.objectContaining({
                title: 'Packing', url: '/help/packing_lists?locale=en#auto-generate', sectionTitle: 'Auto-generate',
            })]);
            expect(controlSearch.searchResults?.[0].excerpt).toContain('Auto-generate Choose Auto-generate to add rows.');
            expect(controlSearch.searchResults?.[0].excerpt).not.toContain('---');
            expect(fetchHelpSearch('Auto generate', 'en').searchResults).toEqual(controlSearch.searchResults);
            expect(fetchHelpSearch('Auto-generate', 'de').searchResults).toEqual([]);
            expect(fetchHelpDoc('packing_lists', 'de').content).toContain('id="take-an-item"');
            files.delete(path.join(german, 'PACKING_LISTS.md'));
            const fallback = fetchHelpDoc('packing_lists', 'de');
            expect(fallback.locale).toBe('de');
            expect(fallback.contentLocale).toBe('en');
            expect(fallback.fallbackToEnglish).toBe(true);
            expect(fallback.content).toContain('Take bottles.');
        } finally { files.clear(); }
    });

    it('loads and searches an independent translated corpus when every other corpus is absent', () => {
        const german = helpSources.de;
        files.set(path.join(german, 'README.md'), article('Anleitung', 'Flaschen mitbringen', '1:guide; 2:bring-bottles',
            'Fülle die Flaschen. [Packen](PACKING_LISTS.md#take-an-item)'));
        files.set(path.join(german, 'PACKING_LISTS.md'), article('Packen', 'Gegenstand übernehmen', '1:packing; 2:take-an-item', 'Übernimm die Flaschen.'));
        try {
            expect(fetchHelpIndex('de').toc).toEqual([{id: 'bring-bottles', title: 'Flaschen mitbringen', level: 2}]);
            expect(fetchHelpDoc('packing_lists', 'de').content).toContain('id="take-an-item"');
            expect(fetchHelpSearch('Flaschen', 'de').searchResults).toHaveLength(2);
        } finally { files.clear(); }
    });

    it('keeps same-language article, image and full-size references in their selected corpus', () => {
        const english = helpSources.en;
        const german = helpSources.de;
        files.set(path.join(english, 'assets', 'figure.png'), 'English figure');
        files.set(path.join(german, 'assets', 'figure.png'), 'Deutsche Abbildung');
        files.set(path.join(german, 'PACKING_LISTS.md'), '# Packen');
        try {
            const rendered = renderTrustedHelpMarkdown('# Anleitung\n\n![Abbildung](assets/figure.png?locale=de)\n\n[Vollbild](/help/assets/figure.png?locale=de) [Weiter](/help/packing_lists?locale=de#take-an-item) [Datei](PACKING_LISTS.md?locale=de#take-an-item)',
                'synthetic translation', 'de');
            expect(rendered.content).toContain('src="/help/assets/figure.png?locale=de"');
            expect(rendered.content).toContain('href="/help/assets/figure.png?locale=de"');
            expect(rendered.content.match(/href="\/help\/packing_lists\?locale=de#take-an-item"/gu)).toHaveLength(2);
            expect(rendered.content).not.toContain('locale=en');
            expect(resolveHelpAssetPath('figure.png', 'de')).toBe(path.join(german, 'assets', 'figure.png'));
            expect(resolveHelpAssetPath('../assets/figure.png', 'de')).toBeNull();
            files.delete(path.join(german, 'assets', 'figure.png'));
            expect(resolveHelpAssetPath('figure.png', 'de')).toBeNull();
            expect(resolveHelpAssetSource('figure.png', 'de')).toBeNull();
            expect(() => renderTrustedHelpMarkdown('# Anleitung\n\n![Abbildung](assets/figure.png)\n\n[Vollbild](/help/assets/figure.png?locale=de)',
                'synthetic translation', 'de')).toThrow(/packaged file/u);
            files.delete(path.join(english, 'assets', 'figure.png'));
            expect(resolveHelpAssetPath('figure.png', 'de')).toBeNull();
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n![Abbildung](assets/figure.png)', 'synthetic translation', 'de')).toThrow(/packaged file/u);
        } finally { files.clear(); }
    });

    it('rejects cross-language relative article and image paths rather than borrowing their contents', () => {
        const english = helpSources.en;
        files.set(path.join(english, 'README.md'), '# Guide');
        files.set(path.join(english, 'assets', 'figure.png'), 'English figure');
        try {
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n[Andere Anleitung](../README.md)', 'synthetic translation', 'de')).toThrow(/selected help language/u);
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n![Andere Abbildung](../assets/figure.png)', 'synthetic translation', 'de')).toThrow(/packaged file/u);
        } finally { files.clear(); }
    });

    it.each([
        '![Abbildung](assets/figure.png?locale=en)',
        '[Vollbild](/help/assets/figure.png?locale=en)',
        '[Vollbild](/help/assets/figure.png?locale=en#full-size)',
        '[Weiter](/help/packing_lists?locale=en#task)',
        '[Datei](PACKING_LISTS.md?locale=en#task)',
        '[Index](/help?locale=en)',
        '[Index](/help?doc=packing_lists&locale=en)',
        '[Suche](/help/search?locale=en&q=packing)',
    ])('rejects explicitly authored other-language Help references: %s', reference => {
        files.set(path.join(helpSources.de, 'PACKING_LISTS.md'), '# Packen');
        files.set(path.join(helpSources.de, 'assets', 'figure.png'), 'Deutsche Abbildung');
        files.set(path.join(helpSources.en, 'assets', 'figure.png'), 'English figure');
        expect(() => validateTrustedHelpMarkdown(`# Anleitung\n\n${reference}`, 'synthetic translation', 'de'))
            .toThrow(/only their own language/u);
    });

    it.each([
        ['de', 'de-DE'],
        ['en', 'en-US'],
    ] as const)('retains supported same-corpus regional hints in %s authored references', (locale, hint) => {
        files.set(path.join(helpSources[locale], 'PACKING_LISTS.md'), '# Guide');
        files.set(path.join(helpSources[locale], 'assets', 'figure.png'), 'Reviewed same-language figure');
        const markdown = `# Guide\n\n![Figure](assets/figure.png?locale=${hint}) [Full size](/help/assets/figure.png?locale=${hint})`
            + ` [Next](PACKING_LISTS.md?locale=${hint}) [Index](/help?locale=${hint})`;
        const rendered = renderTrustedHelpMarkdown(markdown, 'synthetic regional hint', locale);
        expect(rendered.content).toContain(`/help/assets/figure.png?locale=${locale}`);
        expect(rendered.content).toContain(`/help/packing_lists?locale=${locale}`);
        expect(rendered.fallbackToEnglish).toBe(false);
        expect(resolveHelpAssetSource('figure.png', locale)).toMatchObject({locale});
    });

    it.each(['fr', 'not_a_locale', ''])('rejects unsupported or malformed authored English hints instead of defaulting them: %s', hint => {
        files.set(path.join(helpSources.en, 'assets', 'figure.png'), 'Reviewed English figure');
        expect(() => validateTrustedHelpMarkdown(`# Guide\n\n![Figure](assets/figure.png?locale=${hint})`, 'synthetic unsupported hint', 'en'))
            .toThrow(/only their own language/u);
    });

    it.each([
        '![Abbildung](assets/figure.png)',
        '[Vollbild](/help/assets/figure.png?locale=de)',
    ])('selects a complete English article for a missing translated figure dependency: %s', reference => {
        files.set(path.join(helpSources.native, 'README.md'), '# Native reference\n\nOriginal native body.');
        files.set(path.join(helpSources.en, 'README.md'), article('English overview', 'Bring bottles', '1:overview; 2:bring-bottles',
            'English bottles. ![English figure](assets/english-figure.png) [Full size](/help/assets/english-figure.png?locale=en) [Next](PACKING_LISTS.md)'));
        files.set(path.join(helpSources.en, 'PACKING_LISTS.md'), '# Packing');
        files.set(path.join(helpSources.en, 'assets', 'english-figure.png'), 'Reviewed English figure');
        files.set(path.join(helpSources.de, 'README.md'), article('Deutsche Übersicht', 'Flaschen mitbringen', '1:overview; 2:bring-bottles',
            `Deutsche Flaschen. ${reference}`));

        const page = fetchHelpIndex('de');
        const topic = fetchHelpDoc('readme', 'de');
        for (const result of [page, topic]) {
            expect(result).toMatchObject({locale: 'de', contentLocale: 'en', fallbackToEnglish: true, title: 'English overview'});
            expect(result.content).toContain('English bottles.');
            expect(result.content).not.toContain('Deutsche Flaschen.');
            expect(result.content).toContain('src="/help/assets/english-figure.png?locale=en"');
            expect(result.content).toContain('href="/help/assets/english-figure.png?locale=en"');
            expect(result.content).toContain('/help/packing_lists?locale=de');
            expect(result.toc).toEqual([{id: 'bring-bottles', title: 'Bring bottles', level: 2}]);
            expect(result.docsList.find(doc => doc.path === 'readme')).toMatchObject({title: 'English overview', contentLocale: 'en', url: '/help?locale=de'});
        }
        expect(fetchHelpSearch('Flaschen', 'de').searchResults).toEqual([]);
        expect(fetchHelpSearch('bottles', 'de').searchResults).toEqual([expect.objectContaining({
            title: 'English overview', contentLocale: 'en', url: '/help?locale=de#bring-bottles',
        })]);
        expect(resolveHelpAssetSource('figure.png', 'de')).toBeNull();
        expect(resolveHelpAssetSource('english-figure.png', 'de')).toBeNull();
        expect(fetchHelpIndex().content).toContain('English bottles.');
        expect(fetchHelpIndex().content).not.toContain('Original native body.');
    });

    it.each([
        '<script>alert(1)</script>',
        '[Unsafe](javascript:alert(1))',
        '[Other language](/help/packing_lists?locale=en)',
        '[Other figure](../en/assets/figure.png)',
    ])('never hides unsafe translated content behind a missing-figure fallback: %s', unsafe => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        files.set(path.join(helpSources.en, 'README.md'), '# English overview\n\nReviewed English.');
        files.set(path.join(helpSources.en, 'assets', 'figure.png'), 'Reviewed English figure');
        files.set(path.join(helpSources.de, 'README.md'), `# Deutsche Übersicht\n\n![Fehlende Abbildung](assets/figure.png)\n\n${unsafe}`);
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
        expect(() => fetchHelpIndex('de')).toThrow('Die Anleitung konnte nicht geladen werden');
        // General search retains its existing invalid-matching-article skip,
        // instead of selecting or indexing a replacement English body.
        expect(fetchHelpSearch('Übersicht', 'de').searchResults).toEqual([]);
    });

    it('requires valid translated anchors and a complete English replacement before falling back', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const localizedPath = path.join(helpSources.de, 'README.md');
        const englishPath = path.join(helpSources.en, 'README.md');
        files.set(localizedPath, article('Deutsche Übersicht', 'Aufgabe', '1:overview; 3:wrong-level', '![Abbildung](assets/figure.png)'));
        files.set(englishPath, '# English overview\n\nReviewed English.');
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');

        files.set(localizedPath, article('Deutsche Übersicht', 'Aufgabe', '1:overview; 2:task', '![Abbildung](assets/figure.png)'));
        files.set(englishPath, '# English overview\n\n![Missing English figure](assets/figure.png)');
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
        files.set(path.join(helpSources.en, 'assets', 'figure.png'), 'Reviewed English figure');
        expect(fetchHelpDoc('readme', 'de')).toMatchObject({contentLocale: 'en', title: 'English overview'});
    });

    it('rejects malformed or unreadable translated figure files even when complete English exists', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        files.set(path.join(helpSources.en, 'README.md'), '# English overview\n\nReviewed English.');
        files.set(path.join(helpSources.de, 'README.md'), '# Deutsche Übersicht\n\n![Abbildung](assets/figure.png)');
        const figurePath = path.join(helpSources.de, 'assets', 'figure.png');
        files.set(figurePath, 'Translated figure');
        const inspectFile = fs.lstatSync;
        vi.spyOn(fs, 'lstatSync').mockImplementation(function rejectFigureReleaseEntry(file) {
            if (String(file) === figurePath) throw Object.assign(new Error('Synthetic inaccessible figure'), {code: 'EACCES'});
            return inspectFile(file);
        });
        expect(() => resolveHelpAssetSource('figure.png', 'de')).toThrow('Synthetic inaccessible figure');
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
        vi.restoreAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(fs, 'lstatSync').mockImplementation(function rejectFigureSymlink(file) {
            if (String(file) === figurePath) return {...inspectFile(file), isSymbolicLink: () => true} as ReturnType<typeof fs.lstatSync>;
            return inspectFile(file);
        });
        expect(() => resolveHelpAssetSource('figure.png', 'de')).toThrow(/regular file/u);
        expect(() => fetchHelpDoc('readme', 'de')).toThrow('Die Anleitung konnte nicht geladen werden');
    });
});
