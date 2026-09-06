import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    fetchHelpDoc,
    fetchHelpIndex,
    getHelpDocsBasePath,
    renderTrustedHelpMarkdown,
    resolveContextualHelpUrl,
    resolveHelpAssetPath,
    searchHelpDocuments,
    validateTrustedHelpMarkdown,
} from '../../src/controller/helpController';

const repositoryRoot = process.cwd();

function readRepositoryFiles(...relativePaths: string[]): string {
    const files: string[] = [];
    const collect = (candidate: string): void => {
        const stat = fs.statSync(candidate);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(candidate, {withFileTypes: true})) {
                collect(path.join(candidate, entry.name));
            }
        } else if (stat.isFile()) {
            files.push(candidate);
        }
    };
    relativePaths.forEach(relativePath => collect(path.join(repositoryRoot, relativePath)));
    return files.sort().map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');
}

function renderedText(docName: string): string {
    const html = docName === 'readme' ? fetchHelpIndex().content : fetchHelpDoc(docName).content;
    return html
        .replace(/<[^>]+>/gu, ' ')
        .replace(/&nbsp;/gu, ' ')
        .replace(/&amp;/gu, '&')
        .replace(/&#39;/gu, "'")
        .replace(/&quot;/gu, '"')
        .replace(/\s+/gu, ' ')
        .trim();
}

function expectAll(source: string, values: Array<string | RegExp>): void {
    for (const value of values) {
        if (typeof value === 'string') {
            expect(source).toContain(value);
        } else {
            expect(source).toMatch(value);
        }
    }
}

describe('in-app help source and trust boundary', () => {
    it('uses the fixed release-controlled docs/user-guide directory', () => {
        expect(path.relative(repositoryRoot, getHelpDocsBasePath()).split(path.sep).join('/')).toBe('docs/user-guide');
        expect(resolveHelpAssetPath('navigation-at-a-glance.png')).toBeTruthy();
        expect(resolveHelpAssetPath('../README.md')).toBeNull();
        expect(resolveHelpAssetPath('unsafe.svg')).toBeNull();
    });

    it('lists every guide once in task order rather than alphabetical order', () => {
        const help = fetchHelpIndex();
        expect(help.docsGroups.map(group => group.title)).toEqual([
            'Start here',
            'Plan and decide',
            'Organize and share',
            'Advanced',
        ]);
        expect(help.docsList.map(doc => doc.path)).toEqual([
            'readme',
            'getting_started',
            'dashboard',
            'surveys',
            'events',
            'activity_plans',
            'invoice_pools',
            'packing_lists',
            'drivers_lists',
            'permissions',
        ]);
        expect(new Set(help.docsList.map(doc => doc.path)).size).toBe(help.docsList.length);
    });

    it('rejects traversal and unknown document names', () => {
        expect(() => fetchHelpDoc('../README')).toThrow('Documentation not found');
        expect(() => fetchHelpDoc('not-a-guide')).toThrow('Documentation not found');
    });

    it('permits the documentation metadata comment but does not render it', () => {
        const rendered = renderTrustedHelpMarkdown(`# Example\n<!--\ndocumentation-metadata\naudience: test\n-->\n\n## First task\n\nUse **Start**.`);
        expect(rendered.title).toBe('Example');
        expect(rendered.content).not.toContain('documentation-metadata');
        expect(rendered.content).toContain('<h2 id="first-task">First task</h2>');
        expect(rendered.toc).toContainEqual({id: 'first-task', title: 'First task', level: 2});
    });

    it('rejects raw HTML outside the permitted metadata comment', () => {
        expect(() => validateTrustedHelpMarkdown('# Unsafe\n\n<script>alert(1)</script>')).toThrow(/raw HTML/iu);
        expect(() => validateTrustedHelpMarkdown('# Unsafe\n\n<details><summary>Open</summary></details>')).toThrow(/raw HTML/iu);
        expect(() => validateTrustedHelpMarkdown('# Unsafe\n\n<!-- another comment -->')).toThrow(/raw HTML/iu);
    });

    it.each([
        '[bad](javascript:alert(1))',
        '[bad](data:text/html,hello)',
        '[bad](vbscript:msgbox(1))',
        '[bad](//untrusted.example/path)',
        '[bad](jav&colon;ascript:alert(1))',
    ])('rejects unsafe help URI %s', unsafeLink => {
        expect(() => validateTrustedHelpMarkdown(`# Unsafe\n\n${unsafeLink}`)).toThrow(/URI/iu);
    });

    it('allows reviewed internal and ordinary external destinations', () => {
        expect(() => validateTrustedHelpMarkdown([
            '# Safe links',
            '',
            '[Start](GETTING_STARTED.md#choose-how-to-enter-surveyor)',
            '[Section](#safe-links)',
            '[Project](https://example.org/docs)',
            '[Email](mailto:help@example.org)',
            '[Phone](tel:+1234567)',
        ].join('\n'))).not.toThrow();
    });

    it('requires packaged raster assets and rewrites them to the help asset route', () => {
        const rendered = renderTrustedHelpMarkdown([
            '# Visual',
            '',
            '![Navigation map](assets/navigation-at-a-glance.png)',
        ].join('\n'));
        expect(rendered.content).toContain('src="/help/assets/navigation-at-a-glance.png"');
        expect(() => validateTrustedHelpMarkdown('# Bad\n\n![Remote](https://example.org/image.png)')).toThrow(/packaged file/iu);
        expect(() => validateTrustedHelpMarkdown('# Bad\n\n![Missing](assets/missing.png)')).toThrow(/packaged file/iu);
    });

    it('renders every shipped guide through the trusted renderer', () => {
        const index = fetchHelpIndex();
        for (const doc of index.docsList) {
            const rendered = doc.path === 'readme' ? index : fetchHelpDoc(doc.path);
            expect(rendered.content).toContain('<h1 id=');
            expect(rendered.content).not.toContain('documentation-metadata');
            expect(rendered.toc.length).toBeGreaterThan(0);
        }
    });
});

describe('in-app help navigation', () => {
    it('searches tasks and visible control labels across maintained guides', () => {
        const guestResults = searchHelpDocuments('guest recovery');
        expect(guestResults).toContainEqual(expect.objectContaining({title: 'Getting Started with Surveyor'}));

        const controlResults = searchHelpDocuments('Auto-generate');
        expect(controlResults).toContainEqual(expect.objectContaining({title: 'Activity Plans'}));
    });

    it('maps application areas to their contextual guide', () => {
        expect(resolveContextualHelpUrl('/users/register')).toBe('/help/getting_started');
        expect(resolveContextualHelpUrl('/users/dashboard')).toBe('/help/dashboard');
        expect(resolveContextualHelpUrl('/users/profile/manage')).toContain('/help/getting_started#');
        expect(resolveContextualHelpUrl('/guest/recovery')).toContain('/help/getting_started#');
        expect(resolveContextualHelpUrl('/survey/123')).toBe('/help/surveys');
        expect(resolveContextualHelpUrl('/event/123/admin')).toBe('/help/events');
        expect(resolveContextualHelpUrl('/packing/123')).toBe('/help/packing_lists');
        expect(resolveContextualHelpUrl('/activity/123')).toBe('/help/activity_plans');
        expect(resolveContextualHelpUrl('/drivers/123')).toBe('/help/drivers_lists');
        expect(resolveContextualHelpUrl('/')).toBe('/help');
    });
});

describe('critical rendered help contracts', () => {
    it('protects onboarding, recovery, overview, and cumulative-permission instructions', () => {
        const gettingStarted = renderedText('getting_started');
        expectAll(gettingStarted, [
            /activation email/iu,
            /at least eight characters/iu,
            /one letter/iu,
            /one digit/iu,
            'Request access',
            'Your overview',
        ]);

        const overview = renderedText('dashboard');
        expectAll(overview, ['New', 'Your participation', 'Administrable entities']);

        const permissions = renderedText('permissions');
        expectAll(permissions, [/cumulative/iu, /several audiences/iu, /Surveys.*do not use/iu]);

        const visibleSources = readRepositoryFiles(
            'src/views/users',
            'src/views/layout.pug',
            'src/views/modules/module_unified_entity_cards.pug',
            'src/public/js/core/password-validation.ts',
        );
        expectAll(visibleSources, ['Register', 'Your overview', 'Your participation', 'Administrable entities', 'New']);
    });

    it('protects the survey recurring model, collaboration, visibility, and labels', () => {
        const survey = renderedText('surveys');
        expectAll(survey, [
            /primary use.*recurring monthly/iu,
            /one named month.*secondary use case/iu,
            'Yes',
            'Maybe',
            'No',
            'All answers',
            /does not use.*Group Permissions/iu,
            /standalone.*event|cannot be linked.*event/iu,
            /Any participant who has reached the voting page/iu,
            /registered guest/iu,
            /owner-only/iu,
        ]);

        const surveyUi = readRepositoryFiles('src/views/surveyor');
        expectAll(surveyUi, [
            'Add new combination',
            'Weekday',
            'Day in month',
            'Add',
            'Submit',
            'All answers',
            'Yes',
            'Maybe',
            'No',
        ]);
    });

    it('protects packing assignment labels, local Packed state, and counter meanings', () => {
        const packing = renderedText('packing_lists');
        expectAll(packing, [
            'Everyone',
            /existing row.*All/iu,
            'Take',
            'Remove',
            'Assigned / Max',
            'Packed?',
            /stored only in the current browser/iu,
            /Participants.*distinct/iu,
            /Items.*every row/iu,
            /open.*ordinary item/iu,
            /unassigned.*ordinary item/iu,
            /Everyone.*excluded/iu,
        ]);

        const packingUi = readRepositoryFiles('src/views/packing', 'src/public/js');
        expectAll(packingUi, [
            'Everyone',
            'All',
            'Take',
            'Remove',
            'Packed?',
            'Assigned',
            'Max',
        ]);
    });

    it('protects advanced activity requirements and recommendation review labels', () => {
        const activity = renderedText('activity_plans');
        expectAll(activity, [
            'Free',
            'Required',
            'Stay duration requirements',
            /highest to lowest precedence/iu,
            /role-scoped participant override/iu,
            /participant-wide override/iu,
            /role requirement/iu,
            /stay-duration/iu,
            /aggregate coverage.*timetable feasibility/iu,
            'Auto-generate',
            'Pending',
            'Approved',
            'Rejected',
            'Revert to Pending',
            'Add recommendation',
            'Stage unassignment',
            'Stage as approved',
            'Save changes',
            /named-role/iu,
            /protected/iu,
            /roleless/iu,
            /bounded/iu,
            /last resort/iu,
            /overfill/iu,
            /server.*revalid/iu,
        ]);

        const activityUi = readRepositoryFiles('src/views/activity', 'src/public/js/modules/activity');
        expectAll(activityUi, [
            'Free',
            'Required',
            'Stay duration requirements',
            'Auto-generate',
            'Pending',
            'Approved',
            'Rejected',
            'Revert to Pending',
            'Stage unassignment',
            'Add recommendation',
            'Stage as approved',
            'Save changes',
        ]);
    });

    it('protects the drivers-list participant counter decision', () => {
        const drivers = renderedText('drivers_lists');
        expectAll(drivers, [
            /Participants.*distinct profiles assigned as passengers/iu,
            /driver who only offers a ride.*not counted/iu,
            /same passenger.*several rows.*counts once/iu,
            /Drivers.*ride rows/iu,
        ]);
    });
});
