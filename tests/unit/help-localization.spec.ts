import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

// Synthetic release files test the runtime boundary without making maintained prose a delivery gate.
const files = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs')>();
    const fs = {
        ...original,
        existsSync: (file: string) => files.has(String(file)),
        statSync: (file: string) => ({isFile: () => files.has(String(file))}),
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

import {
    fetchHelpDoc,
    fetchHelpIndex,
    fetchHelpSearch,
    getHelpDocsBasePath,
    renderTrustedHelpMarkdown,
    resolveHelpAssetPath,
    validateTrustedHelpMarkdown,
} from '../../src/controller/helpController';

function article(title: string, heading: string, anchors: string, body: string): string {
    return `# ${title}\n<!--\ndocumentation-metadata\nheading-anchors: ${anchors}\n-->\n\n## ${heading}\n\n${body}`;
}

describe('localized fixed-source help documents', () => {
    it('selects the complete body, catalog, headings, links and search corpus using one locale', () => {
        const english = getHelpDocsBasePath('en');
        const german = getHelpDocsBasePath('de');
        files.set(path.join(english, 'README.md'), '# Guide\n\n## Bring bottles\n\nFill the bottles. [Packing](PACKING_LISTS.md#take-an-item)');
        files.set(path.join(english, 'PACKING_LISTS.md'), '# Packing\n\n## Take an item\n\nTake bottles.');
        files.set(path.join(german, 'README.md'), article('Anleitung', 'Flaschen mitbringen', '1:guide; 2:bring-bottles', 'Fülle die Flaschen. [Packen](PACKING_LISTS.md#take-an-item)'));
        files.set(path.join(german, 'PACKING_LISTS.md'), article('Packen', 'Gegenstand übernehmen', '1:packing; 2:take-an-item', 'Übernimm die Flaschen.'));
        try {
            const de = fetchHelpIndex('de-DE');
            const en = fetchHelpIndex('en');
            expect(de.locale).toBe('de');
            expect(de.title).toBe('Anleitung');
            expect(de.content).toContain('Fülle die Flaschen.');
            expect(de.content).not.toContain('Fill the bottles.');
            expect(de.content).toContain('/help/packing_lists?locale=de#take-an-item');
            expect(de.toc).toEqual([{id: 'bring-bottles', title: 'Flaschen mitbringen', level: 2}]);
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
            expect(fetchHelpDoc('packing_lists', 'de').content).toContain('id="take-an-item"');
            files.delete(path.join(german, 'PACKING_LISTS.md'));
            expect(() => fetchHelpDoc('packing_lists', 'de')).toThrow('Anleitung nicht gefunden');
        } finally { files.clear(); }
    });

    it('loads and searches an independent translated corpus when every other corpus is absent', () => {
        const german = getHelpDocsBasePath('de');
        files.set(path.join(german, 'README.md'), article('Anleitung', 'Flaschen mitbringen', '1:guide; 2:bring-bottles',
            'Fülle die Flaschen. [Packen](PACKING_LISTS.md#take-an-item)'));
        files.set(path.join(german, 'PACKING_LISTS.md'), article('Packen', 'Gegenstand übernehmen', '1:packing; 2:take-an-item', 'Übernimm die Flaschen.'));
        try {
            expect(fetchHelpIndex('de').toc).toEqual([{id: 'bring-bottles', title: 'Flaschen mitbringen', level: 2}]);
            expect(fetchHelpDoc('packing_lists', 'de').content).toContain('id="take-an-item"');
            expect(fetchHelpSearch('Flaschen', 'de').searchResults).toHaveLength(2);
        } finally { files.clear(); }
    });

    it('keeps article, image and full-size links in the selected language despite authored locale queries', () => {
        const english = getHelpDocsBasePath('en');
        const german = getHelpDocsBasePath('de');
        files.set(path.join(english, 'assets', 'figure.png'), 'English figure');
        files.set(path.join(german, 'assets', 'figure.png'), 'Deutsche Abbildung');
        files.set(path.join(german, 'PACKING_LISTS.md'), '# Packen');
        try {
            const rendered = renderTrustedHelpMarkdown('# Anleitung\n\n![Abbildung](assets/figure.png?locale=en)\n\n[Vollbild](/help/assets/figure.png?locale=en) [Weiter](/help/packing_lists?locale=en#take-an-item) [Datei](PACKING_LISTS.md?locale=en#take-an-item)',
                'synthetic translation', 'de');
            expect(rendered.content).toContain('src="/help/assets/figure.png?locale=de"');
            expect(rendered.content).toContain('href="/help/assets/figure.png?locale=de"');
            expect(rendered.content.match(/href="\/help\/packing_lists\?locale=de#take-an-item"/gu)).toHaveLength(2);
            expect(rendered.content).not.toContain('locale=en');
            expect(resolveHelpAssetPath('figure.png', 'de')).toBe(path.join(german, 'assets', 'figure.png'));
            expect(resolveHelpAssetPath('../assets/figure.png', 'de')).toBeNull();
            files.delete(path.join(german, 'assets', 'figure.png'));
            expect(resolveHelpAssetPath('figure.png', 'de')).toBeNull();
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n![Abbildung](assets/figure.png)', 'synthetic translation', 'de')).toThrow(/packaged file/u);
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n[Vollbild](/help/assets/figure.png?locale=en)', 'synthetic translation', 'de')).toThrow(/packaged file/u);
        } finally { files.clear(); }
    });

    it('rejects cross-language relative article and image paths rather than borrowing their contents', () => {
        const english = getHelpDocsBasePath('en');
        files.set(path.join(english, 'README.md'), '# Guide');
        files.set(path.join(english, 'assets', 'figure.png'), 'English figure');
        try {
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n[Andere Anleitung](../README.md)', 'synthetic translation', 'de')).toThrow(/selected help language/u);
            expect(() => validateTrustedHelpMarkdown('# Anleitung\n\n![Andere Abbildung](../assets/figure.png)', 'synthetic translation', 'de')).toThrow(/packaged file/u);
        } finally { files.clear(); }
    });
});
