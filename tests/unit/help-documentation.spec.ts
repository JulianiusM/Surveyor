import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    fetchHelpDoc,
    getHelpDocsBasePath,
    renderTrustedHelpMarkdown,
    resolveContextualHelpUrl,
    resolveHelpAssetPath,
    validateTrustedHelpMarkdown,
} from '../../src/controller/helpController';

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
});
