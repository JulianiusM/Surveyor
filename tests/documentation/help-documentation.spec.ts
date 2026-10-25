/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    fetchHelpDoc,
    fetchHelpIndex,
    renderTrustedHelpMarkdown,
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

/** Preserve the documented priority itself, rather than requiring an old heading's wording. */
function expectTextInOrder(source: string, values: readonly string[]): void {
    let previousEnd = 0;
    for (const value of values) {
        const index = source.indexOf(value, previousEnd);
        expect(index).toBeGreaterThanOrEqual(previousEnd);
        previousEnd = index + value.length;
    }
}

describe('in-app help source and trust boundary', () => {
    it('resolves a maintained packaged help asset', () => {
        expect(resolveHelpAssetPath('navigation-at-a-glance.png')).toBeTruthy();
    });

    it('lists every guide once in task order rather than alphabetical order', () => {
        const help = fetchHelpIndex();
        expect(help.docsGroups.map(group => group.title)).toEqual([
            'Start here',
            'Plan and decide',
            'Organize and share',
            'Advanced',
            'More help',
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
            'localization',
        ]);
        expect(new Set(help.docsList.map(doc => doc.path)).size).toBe(help.docsList.length);
    });

    it('rejects document names absent from the maintained corpus', () => {
        expect(() => fetchHelpDoc('not-a-guide')).toThrow('Documentation not found');
    });

    it('allows a reviewed destination in the maintained guide corpus', () => {
        expect(() => validateTrustedHelpMarkdown('# Safe links\n\n[Start](GETTING_STARTED.md#choose-how-to-enter-surveyor)'))
            .not.toThrow();
    });

    it('requires packaged raster assets and rewrites them to the help asset route', () => {
        const rendered = renderTrustedHelpMarkdown([
            '# Visual',
            '',
            '![Navigation map](assets/navigation-at-a-glance.png)',
        ].join('\n'));
        expect(rendered.content).toContain('src="/help/assets/navigation-at-a-glance.png?locale=en"');
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

        const controlResults = searchHelpDocuments('Auto generate');
        expect(controlResults).toContainEqual(expect.objectContaining({title: 'Activity Plans'}));
    });
});

describe('critical rendered help contracts', () => {
    it('protects onboarding, recovery, overview, and cumulative-permission instructions', () => {
        const gettingStarted = renderedText('getting_started');
        expectAll(gettingStarted, [
            /activation email/iu,
            /at least 8 characters/iu,
            /one letter/iu,
            /one digit/iu,
            'Request access',
            'Your overview',
        ]);

        const overview = renderedText('dashboard');
        expectAll(overview, ['New', 'Your participation', 'Administrable entities']);

        const permissions = renderedText('permissions');
        expectAll(permissions, [/cumulative/iu, /One profile can match several groups/iu, /Surveys.*do not use/iu]);

        const visibleSources = readRepositoryFiles(
            'src/frontend/features/identity',
            'src/frontend/features/overview',
            'src/frontend/components/AppHeader.vue',
            'src/locales/en.json',
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
            /They do not use the Group Permissions matrix/iu,
            /standalone.*event|cannot be linked.*event/iu,
            /Every participant admitted to the voting page may add a combination/iu,
            /registered guest/iu,
            /owner-only/iu,
        ]);

        const surveyUi = readRepositoryFiles('src/frontend/features/surveys', 'src/locales/en.json');
        expectAll(surveyUi, [
            'Add new combination',
            'Weekday',
            'Week of month',
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
            /On an existing list, the editor switch in the Action column is labelled All/iu,
            'Take',
            'Remove',
            'Assigned / Max',
            'Packed?',
            // Preserve the locality/privacy contract without pinning a superseded
            // sentence. Application tests independently verify localStorage behavior.
            /check mark.*Only that browser for that list item/iu,
            /not associated with a Surveyor account or profile/iu,
            /Participants.*distinct/iu,
            /Items.*all rows in the list, including Everyone items/iu,
            /open.*ordinary item/iu,
            /unassigned.*ordinary item/iu,
            /Everyone.*excluded/iu,
        ]);

        const packingUi = readRepositoryFiles('src/frontend/features/packing', 'src/locales/en.json');
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
            /first applicable source in this order wins/iu,
            /role-scoped participant override/iu,
            /participant-wide override/iu,
            /role requirement/iu,
            /stay-duration/iu,
            // The task-first guide names the two visible totals, then distinguishes
            // aggregate coverage from timetable feasibility in its explanation.
            /compares Required shifts with total Slot capacity/iu,
            /Coverage compares the number of required shifts with available places; it does not guarantee that everyone can be assigned/iu,
            'Auto-generate',
            'Pending',
            'Approved',
            'Rejected',
            'Revert to Pending',
            'Add recommendation',
            'Stage unassignment',
            'Stage as approved',
            'Save changes',
            /Automatic generation creates only ordinary slot assignments\. It does not fill named roles/iu,
            /An assignment carrying a named role is never moved automatically/iu,
            /existing assignment without a named role/iu,
            /A workable arrangement can exist even when no suggestion is found/iu,
            /last resort/iu,
            /overfill/iu,
            /Before applying, Surveyor checks the plan and participants again/iu,
        ]);
        expectTextInOrder(activity, [
            '1 A role-scoped participant override',
            '2 A participant-wide override without a role',
            '3 The lowest matching Role requirements value',
            '4 The exact saved Stay duration requirements value',
        ]);

        const activityUi = readRepositoryFiles('src/frontend/features/activity', 'src/locales/en.json');
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
            /Participants.*distinct profiles assigned to one or more driver rows/iu,
            /driver who only offers a ride.*not counted/iu,
            /same passenger assigned to several rows is counted once/iu,
            /Drivers.*ride rows/iu,
        ]);
    });
});
