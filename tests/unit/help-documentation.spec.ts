import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    fetchHelpDoc,
    getHelpDocsBasePath,
    renderTrustedHelpMarkdown,
    resolveHelpAssetPath,
    validateTrustedHelpMarkdown,
} from '../../src/controller/helpController';
import {frontendHelpUrl, resolveContextualHelpUrl, resolveFrontendHelpQuery} from '../../src/modules/lib/helpNavigation';

// Application behavior only: these tests also run with docs/ entirely absent.
// Real guide wording, examples, links and images belong to tests/documentation/.
describe('help renderer and source boundaries (synthetic fixtures)', () => {
    it('uses a fixed help root and rejects traversal and executable asset formats', () => {
        expect(path.relative(process.cwd(), getHelpDocsBasePath()).split(path.sep).join('/')).toBe('docs/user-guide/en');
        expect(path.relative(process.cwd(), getHelpDocsBasePath('en')).split(path.sep).join('/'))
            .toBe('docs/user-guide/en');
        expect(path.relative(process.cwd(), getHelpDocsBasePath('de')).split(path.sep).join('/'))
            .toBe('docs/user-guide/de');
        // Staging holds documentation drafts only. This expectation is independent of
        // the selector and protects the reviewed language corpus boundary.
        expect(getHelpDocsBasePath('en')).not.toContain('frontend-migration');
        expect(getHelpDocsBasePath('de')).not.toContain('frontend-migration');
        expect(getHelpDocsBasePath('en')).not.toContain('frontend-help');
        expect(getHelpDocsBasePath()).not.toContain('user-docs');
        expect(getHelpDocsBasePath('../../uploads')).toBe(getHelpDocsBasePath('en'));
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
        expect(resolveContextualHelpUrl('/users/profile/manage')).toContain('/help/getting_started#');
        expect(resolveContextualHelpUrl('/users/profile', 'de')).toBe('/help/getting_started?locale=de#understand-accounts-and-profiles');
        expect(resolveContextualHelpUrl('/guest/recovery')).toContain('/help/getting_started#');
        expect(resolveContextualHelpUrl('/survey/123')).toBe('/help/surveys');
        expect(resolveContextualHelpUrl('/event/123/admin')).toBe('/help/events');
        expect(resolveContextualHelpUrl('/packing/123')).toBe('/help/packing_lists');
        expect(resolveContextualHelpUrl('/activity/123')).toBe('/help/activity_plans');
        expect(resolveContextualHelpUrl('/drivers/123')).toBe('/help/drivers_lists');
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
    ] as const)('shares native path precedence and canonical frontend query selection (%s)', (pathDoc, query, expected) => {
        expect(resolveFrontendHelpQuery(pathDoc, query)).toEqual(expected);
    });

    it('bounds enhanced search without changing the native selected article', () => {
        expect(resolveFrontendHelpQuery('search', {q: 'x'.repeat(150)})).toEqual({q: 'x'.repeat(100)});
        expect(resolveFrontendHelpQuery('packing_lists', {q: 'x'.repeat(150)})).toEqual({doc: 'packing_lists'});
    });

    it.each([
        ['/help/search?doc=events&source=fixture#prompt', '/help/search', {q: ''}],
        ['/help/search?q=packing&doc=events#results', '/help/search', {q: 'packing'}],
        ['/help/packing_lists?q=ignored&doc=events&source=fixture#task', '/help/packing_lists', {doc: 'packing_lists'}],
        ['/help?q=packing&doc=events&source=fixture#home', '/help', {q: 'packing'}],
    ] as const)('retains canonical query selection, article path precedence and fragments for %s', (href, pathname, selected) => {
        const source = new URL(href, 'https://fixture.test');
        const target = new URL(frontendHelpUrl(href, 'de'), 'https://fixture.test');
        expect(target.pathname).toBe(pathname);
        expect(target.hash).toBe(source.hash);
        for (const [key, value] of source.searchParams) expect(target.searchParams.get(key)).toBe(value);
        expect(target.searchParams.get('locale')).toBe('de');
        expect(target.searchParams.has('list')).toBe(false);
        const pathDoc = /^\/help\/([^/]+)$/u.exec(target.pathname)?.[1];
        expect(resolveFrontendHelpQuery(pathDoc, Object.fromEntries(target.searchParams))).toEqual(selected);
    });

    it('retains ordinary frontend article query links and leaves separate assets/external URLs native', () => {
        expect(frontendHelpUrl('/help/packing_lists?source=fixture#task', 'en'))
            .toBe('/help?source=fixture&doc=packing_lists&locale=en#task');
        expect(frontendHelpUrl('/help#home', 'en')).toBe('/help?locale=en#home');
        expect(frontendHelpUrl('/help/assets/figure.png?locale=de', 'en')).toBe('/help/assets/figure.png?locale=de');
        expect(frontendHelpUrl('https://example.org/help?q=packing', 'en')).toBe('https://example.org/help?q=packing');
    });
});
