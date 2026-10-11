import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    fetchHelpDoc,
    getHelpDocsBasePath,
    renderTrustedHelpMarkdown,
    resolveHelpAssetPath,
    validateTrustedHelpMarkdown,
} from '../../src/controller/helpController';
import {pilotHelpUrl, resolveContextualHelpUrl, resolvePilotHelpQuery} from '../../src/modules/lib/helpNavigation';

// Application behavior only: these tests also run with docs/ entirely absent.
// Real guide wording, examples, links and images belong to tests/documentation/.
describe('help renderer and source boundaries (synthetic fixtures)', () => {
    it('uses a fixed help root and rejects traversal and executable asset formats', () => {
        expect(path.relative(process.cwd(), getHelpDocsBasePath()).split(path.sep).join('/')).toBe('docs/user-guide');
        expect(resolveHelpAssetPath('../README.md')).toBeNull();
        expect(resolveHelpAssetPath('unsafe.svg')).toBeNull();
        expect(() => fetchHelpDoc('../README')).toThrow('Documentation not found');
    });

    it('removes the permitted metadata and builds heading anchors', () => {
        const result = renderTrustedHelpMarkdown('# Fixture\n<!--\ndocumentation-metadata\naudience: test\n-->\n\n## First task\n\nUse **Start**.');
        expect(result.title).toBe('Fixture');
        expect(result.content).not.toContain('documentation-metadata');
        expect(result.content).toContain('<h2 id="first-task">First task</h2>');
        expect(result.toc).toContainEqual({id: 'first-task', title: 'First task', level: 2});
    });

    it('keeps translated bodies and headings while preserving language-independent deep links', () => {
        const result = renderTrustedHelpMarkdown('# Anleitung\n<!--\ndocumentation-metadata\nheading-anchors: 1:guide; 2:bring-water\n-->\n\n## Wasser mitbringen\n\nFülle deine Flasche auf. [Weiter](#bring-water)',
            'synthetic translation', 'de');
        expect(result.title).toBe('Anleitung');
        expect(result.content).toContain('<h2 id="bring-water">Wasser mitbringen</h2>');
        expect(result.content).toContain('Fülle deine Flasche auf.');
        expect(result.content).not.toContain('Fill your bottle');
        expect(result.toc).toEqual([{id: 'bring-water', title: 'Wasser mitbringen', level: 2}]);
        expect(resolveContextualHelpUrl('/users/profile', 'de')).toBe('/help/getting_started?locale=de#understand-accounts-and-profiles');
        expect(getHelpDocsBasePath('de')).toBe(path.join(getHelpDocsBasePath(), 'de'));
        expect(getHelpDocsBasePath('../../uploads')).toBe(getHelpDocsBasePath());
    });

    it.each([
        '1:guide',
        '1:guide; 3:bring-water',
        '1:guide; 2:guide',
        '1:guide; 2:bad"onclick="run',
    ])('rejects unsafe or mismatched authored heading anchors: %s', anchors => {
        expect(() => renderTrustedHelpMarkdown(`# Anleitung\n<!--\ndocumentation-metadata\nheading-anchors: ${anchors}\n-->\n\n## Wasser mitbringen`,
            'synthetic translation', 'de')).toThrow(/heading anchors/u);
    });

    it.each([
        '<script>alert(1)</script>',
        '<details><summary>Open</summary></details>',
        '<!-- another comment -->',
    ])('rejects raw HTML: %s', html => {
        expect(() => validateTrustedHelpMarkdown(`# Unsafe\n\n${html}`)).toThrow(/raw HTML/iu);
    });

    it.each([
        '[bad](javascript:alert(1))',
        '[bad](data:text/html,hello)',
        '[bad](vbscript:msgbox(1))',
        '[bad](//untrusted.example/path)',
        '[bad](jav&colon;ascript:alert(1))',
    ])('rejects unsafe URI: %s', link => {
        expect(() => validateTrustedHelpMarkdown(`# Unsafe\n\n${link}`)).toThrow(/URI/iu);
    });

    it('accepts ordinary external and same-page links without a guide dependency', () => {
        expect(() => validateTrustedHelpMarkdown('# Safe\n\n[Here](#safe) [Web](https://example.org/) [Mail](mailto:help@example.org) [Phone](tel:+1234567)')).not.toThrow();
        expect(() => validateTrustedHelpMarkdown('# Image\n\n![Remote](https://example.org/image.png)')).toThrow(/packaged file/iu);
    });

    it('maps application routes without reading a documentation file', () => {
        expect(resolveContextualHelpUrl('/users/register')).toBe('/help/getting_started');
        expect(resolveContextualHelpUrl('/users/dashboard')).toBe('/help/dashboard');
        expect(resolveContextualHelpUrl('/survey/123')).toBe('/help/surveys');
        expect(resolveContextualHelpUrl('/packing/123')).toBe('/help/packing_lists');
        expect(resolveContextualHelpUrl('/')).toBe('/help');
    });

    it.each([
        ['search', {}, {q: ''}],
        ['SEARCH', {doc: 'packing_lists'}, {q: ''}],
        ['search', {q: '  packing\n\t list  ', doc: 'events'}, {q: 'packing list'}],
        ['search', {q: ['first', 'second']}, {q: ''}],
        ['packing_lists', {q: 'ignored', doc: 'events'}, {doc: 'packing_lists'}],
        [undefined, {q: 'packing', doc: 'events'}, {q: 'packing'}],
        [undefined, {q: '', doc: 'events'}, {q: ''}],
        [undefined, {doc: 'packing_lists'}, {doc: 'packing_lists'}],
        [undefined, {}, {}],
    ] as const)('shares native path precedence and canonical pilot query selection (%s)', (pathDoc, query, expected) => {
        expect(resolvePilotHelpQuery(pathDoc, query)).toEqual(expected);
    });

    it('bounds enhanced search without changing the native selected article', () => {
        expect(resolvePilotHelpQuery('search', {q: 'x'.repeat(150)})).toEqual({q: 'x'.repeat(100)});
        expect(resolvePilotHelpQuery('packing_lists', {q: 'x'.repeat(150)})).toEqual({doc: 'packing_lists'});
    });

    it.each([
        ['/help/search?doc=events&source=fixture#prompt', '/frontend-pilot/help/search', {q: ''}],
        ['/help/search?q=packing&doc=events#results', '/frontend-pilot/help/search', {q: 'packing'}],
        ['/help/packing_lists?q=ignored&doc=events&source=fixture#task', '/frontend-pilot/help/packing_lists', {doc: 'packing_lists'}],
        ['/help?q=ignored&doc=events&source=fixture#home', '/frontend-pilot/help/readme', {doc: 'readme'}],
    ] as const)('keeps native ignored parameters and fragments inert when adapting %s', (href, pathname, selected) => {
        const source = new URL(href, 'https://fixture.test');
        const target = new URL(pilotHelpUrl(href, 'de'), 'https://fixture.test');
        expect(target.pathname).toBe(pathname);
        expect(target.hash).toBe(source.hash);
        for (const [key, value] of source.searchParams) expect(target.searchParams.get(key)).toBe(value);
        expect(target.searchParams.get('locale')).toBe('de');
        expect(target.searchParams.has('list')).toBe(false);
        const pathDoc = /^\/frontend-pilot\/help\/([^/]+)$/u.exec(target.pathname)?.[1];
        expect(resolvePilotHelpQuery(pathDoc, Object.fromEntries(target.searchParams))).toEqual(selected);
    });

    it('retains ordinary pilot article query links and leaves separate assets/external URLs native', () => {
        expect(pilotHelpUrl('/help/packing_lists?source=fixture#task', 'en'))
            .toBe('/frontend-pilot/help?source=fixture&doc=packing_lists&locale=en#task');
        expect(pilotHelpUrl('/help#home', 'en')).toBe('/frontend-pilot/help?locale=en#home');
        expect(pilotHelpUrl('/help/assets/figure.png?locale=de', 'en')).toBe('/help/assets/figure.png?locale=de');
        expect(pilotHelpUrl('https://example.org/help?q=packing', 'en')).toBe('https://example.org/help?q=packing');
    });
});
