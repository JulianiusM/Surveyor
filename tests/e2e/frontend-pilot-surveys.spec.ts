import {expect, test, type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {expectEmbeddedFrontendRefresh, expectVisiblePresentation, loginForE2E, openModalForE2E,
    readControlContracts, readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {captureSurveyPresentation, createFrontendSurveyFixture, expectSurveyActionsPresentation, expectSurveyCardLayout, expectSurveyPageContained, observeSurveyCommand,
    expectSurveyStickyParticipantVisible, readSurveyCardLayout, readSurveyForE2E,
    readSurveyPageOverflow, scrollSurveyTable} from '../keywords/frontendSurveyE2EKeywords';

/** This fixture saved Yes for its first choice and omitted every later choice.
 * The shared comparator must retain the real clipped radios' checked contracts
 * alongside their painted labels, rather than silently omitting those fields. */
async function expectCompleteBallotContract(table: Locator, combinations: number): Promise<void> {
    const inputs = table.locator('input[type="radio"]');
    const controls = await readControlContracts(inputs);
    expect(controls).toHaveLength(combinations * 3);
    const expected: boolean[] = [];
    const values: string[] = [];
    for (let index = 0; index < combinations; index++) {
        expected.push(index === 0, false, index !== 0);
        values.push('yes', 'maybe', 'no');
    }
    expect(controls.map(control => control && 'checked' in control ? control.checked : undefined)).toEqual(expected);
    expect(await inputs.evaluateAll(function readChoiceValues(elements) {
        return elements.map(element => (element as HTMLInputElement).value);
    })).toEqual(values);
}

/** Assert the corrected occurrence label and actual field before projecting its
 * exact wording difference from the unchanged native monthly-week/day labels. */
async function expectOccurrenceControl(surface: Locator, creation: boolean): Promise<void> {
    const label = creation ? surface.getByRole('columnheader', {name: 'Occurrence in month', exact: true})
        : surface.locator('label').filter({hasText: /^Occurrence in month:$/u});
    const control = surface.getByRole('combobox', {name: 'Occurrence in month', exact: true});
    await expect(label).toHaveCount(1);
    await expect(control).toHaveCount(1);
    await expect(control.locator('option')).toHaveText(creation ? ['1', '2', '3', '4', 'Last']
        : ['Occurrence 1 in month', 'Occurrence 2 in month', 'Occurrence 3 in month', 'Occurrence 4 in month',
            'Last (4th/5th) occurrence in month']);
    expect(await control.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
        .toEqual(['1', '2', '3', '4', 'LAST']);
    const labelBounds = (await label.boundingBox())!;
    const controlBounds = (await control.boundingBox())!;
    expect(labelBounds.width).toBeGreaterThan(0);
    expect(controlBounds.y).toBeGreaterThanOrEqual(labelBounds.y + labelBounds.height - 1);
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

/** Only these fixed English form labels/options intentionally differ from native.
 * Raw screenshots/presentations stay untouched; values, constraints, other text,
 * styling and geometry retain the existing comparator. */
function projectOccurrenceLabels(presentation: Awaited<ReturnType<typeof readVisiblePresentation>>, creation: boolean):
    Awaited<ReturnType<typeof readVisiblePresentation>> {
    const wording = creation ? [['Occurrence in month', 'Week of month']]
        : [['Occurrence in month:', 'Day in month:'],
            ...['1', '2', '3', '4'].map(nth => [`Occurrence ${nth} in month`, `${nth}. day in month`]),
            ['Last (4th/5th) occurrence in month', 'Last (4./5.) day in month']];
    function nativeLabel(text: string): string {
        for (const [current, original] of wording) text = text.replaceAll(current!, original!);
        return text;
    }
    return {...presentation, content: {...presentation.content, text: nativeLabel(presentation.content.text),
        elements: presentation.content.elements.map(element => ({...element, text: nativeLabel(element.text),
            field: element.field?.options ? {...element.field,
                options: element.field.options.map(option => ({...option, text: nativeLabel(option.text)}))} : element.field}))}};
}

/** The requested single-choice protection deliberately disables only the last
 * creation Remove action. Compare every remaining field, label and style after
 * asserting that state and the exact approved occurrence wording separately. */
function expectSurveyCreationPresentation(native: Awaited<ReturnType<typeof readVisiblePresentation>>,
    pilot: Awaited<ReturnType<typeof readVisiblePresentation>>): void {
    const nativeRemove = native.content.elements.filter(isRemove);
    const pilotRemove = pilot.content.elements.filter(isRemove);
    expect(nativeRemove).toHaveLength(1);
    expect(pilotRemove).toHaveLength(1);
    expect(nativeRemove[0]!.field).toEqual({disabled: false});
    expect(pilotRemove[0]!.field).toEqual({disabled: true});
    const wording = projectOccurrenceLabels(pilot, true);
    const compared = {...wording, content: {...wording.content, elements: wording.content.elements.map(element =>
        isRemove(element) ? {...element, field: {...element.field!, disabled: false}} : element)}};
    expectVisiblePresentation(native, compared);

    function isRemove(element: typeof native.content.elements[number]): boolean {
        return element.text === 'Remove' && !!element.field && 'disabled' in element.field;
    }
}

for (const width of [1280, 390]) {
    test(`compares native Survey creation, ballots, named results and collaborative choices at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const survey = await createFrontendSurveyFixture(page.request);
        const initial = await readSurveyForE2E(page.request, survey.id);
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};
        let nativeLayout: Awaited<ReturnType<typeof readSurveyCardLayout>>;

        // A partial persisted ballot exercises both the named Yes and the
        // native missing-answer No presentation in the second result column.
        expect((await page.request.post(`/survey/${survey.id}/submit`, {
            form: {[initial.combinations[0]!.id]: 'yes'}, maxRedirects: 0,
        })).status()).toBe(302);
        await page.request.get('/users/profile');
        for (const pilot of [false, true]) {
            const prefix = pilot ? '/frontend-pilot' : '';
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${prefix}/survey/create?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await expect(page).toHaveTitle('Create Survey | Surveyor');
            await expect(page.locator('#combinationTable tr')).toHaveCount(1);
            const creationRemove = page.locator('#combinationTable').getByRole('button', {name: 'Remove', exact: true});
            await expect(creationRemove).toHaveCount(1);
            if (pilot) await expect(creationRemove).toBeDisabled();
            else await expect(creationRemove).toBeEnabled();
            const creation = await captureSurveyPresentation(page, info, `${label}-survey-create`, page.locator('#surveyForm'),
                ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);
            if (pilot) {
                await expectOccurrenceControl(page.locator('#surveyForm'), true);
                expectSurveyCreationPresentation(native.creation!, creation);
            }
            else native.creation = creation;
            const creationCard = await captureSurveyPresentation(page, info, `${label}-survey-create-card`,
                page.locator('main .card').first(), ['h1', 'label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);
            if (pilot) expectSurveyCreationPresentation(native.creationCard!, creationCard);
            else native.creationCard = creationCard;

            await page.goto(`${prefix}${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await expect(page).toHaveTitle(`Vote on ${survey.title} | Surveyor`);
            const card = page.locator('main .card').first();
            const header = await captureSurveyPresentation(page, info, `${label}-survey-header`, card.locator(':scope > .card-header'),
                ['h1', 'button']);
            const layout = await readSurveyCardLayout(card);
            if (pilot) {
                await expectEmbeddedFrontendRefresh(card.locator(':scope > .card-header'));
                expect(header.content.elements.filter(element => element.refresh)).toHaveLength(1);
                expectVisiblePresentation(native.header!, header);
                expectSurveyCardLayout(nativeLayout!, layout);
            } else {
                native.header = header;
                nativeLayout = layout;
            }
            const ballot = page.locator(pilot ? '#survey-ballot' : 'main form[action$="/submit"]');
            const results = page.locator('main table').nth(1);
            const addition = page.locator(pilot ? '#survey-add-combination' : 'main form[action$="/add-combination"]');
            const ballotPresentation = await captureSurveyPresentation(page, info, `${label}-survey-ballot`, ballot,
                ['th', 'td', 'input', 'label', 'button']);
            const resultsPresentation = await captureSurveyPresentation(page, info, `${label}-survey-results`, results,
                ['th', 'td', 'input', 'label']);
            const additionPresentation = await captureSurveyPresentation(page, info, `${label}-survey-add`, addition,
                ['label', 'select', 'button']);
            if (pilot) {
                await expectOccurrenceControl(addition, false);
                expectVisiblePresentation(native.ballot!, ballotPresentation);
                expectVisiblePresentation(native.results!, resultsPresentation);
                expectVisiblePresentation(native.addition!, projectOccurrenceLabels(additionPresentation, false));
            } else {
                native.ballot = ballotPresentation;
                native.results = resultsPresentation;
                native.addition = additionPresentation;
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

            // Survey composes owner settings without event, Access or
            // Administrator panels. General remains the shared dialog surface.
            const opener = page.getByRole('button', {name: 'Entity settings', exact: true});
            const nativeModal = page.locator('#entityPropertiesModal');
            if (pilot) await opener.click();
            else await openModalForE2E(nativeModal, opener);
            const dialog = pilot ? page.getByRole('dialog') : nativeModal.locator('.modal-content');
            await expect(dialog.locator('[name="title"]')).toBeVisible();
            await expect(dialog.getByRole('tab', {name: 'Actions', exact: true})).toBeVisible();
            await expect(dialog.getByRole('tab', {name: 'Linked event', exact: true})).toHaveCount(0);
            await expect(dialog.getByRole('tab', {name: 'Access', exact: true})).toHaveCount(0);
            const general = await captureSurveyPresentation(page, info, `${label}-survey-settings`, dialog,
                ['h2', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);
            if (pilot) expectVisiblePresentation(native.general!, general);
            else native.general = general;

            // The same admitted image disclosure must open from the keyboard.
            // Its complete dialog snapshot includes the chooser, hint and Upload,
            // retaining their actual label/control geometry at both viewports.
            const image = dialog.locator('[data-entity-section="image"]');
            await image.locator('summary').press('Enter');
            await expect(image.locator('details')).toHaveJSProperty('open', true);
            const expanded = await captureSurveyPresentation(page, info, `${label}-survey-settings-image`, dialog,
                ['h2', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);
            if (pilot) expectVisiblePresentation(native.expanded!, expanded);
            else native.expanded = expanded;

            // Both native Bootstrap and the Vue focus owner expose the same
            // General→Actions keyboard journey and restore the actual invoker.
            await dialog.getByRole('tab', {name: 'General', exact: true}).focus();
            await page.keyboard.press('ArrowRight');
            const actions = dialog.getByRole('tab', {name: 'Actions', exact: true});
            await expect(actions).toBeFocused();
            await expect(actions).toHaveAttribute('aria-selected', 'true');
            const actionPanel = await captureSurveyPresentation(page, info, `${label}-survey-settings-actions`, dialog,
                ['h2', 'h3', 'h5', 'p', 'a', 'button']);
            if (pilot) expectSurveyActionsPresentation(native.actions!, actionPanel);
            else native.actions = actionPanel;
            await expect(dialog.getByRole('link', {name: 'Duplicate', exact: true})).toHaveAttribute('href', `${prefix}${survey.path}/duplicate`);
            const remove = dialog.getByRole('button', {name: 'Delete permanently', exact: true});
            await expect(remove).toBeEnabled();
            await actions.focus();
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
            await expect(opener).toBeFocused();
        }
        expect(errors).toEqual([]);
    });

    test(`compares the empty Survey results and complete voting card at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const survey = await createFrontendSurveyFixture(page.request);
        await page.request.get('/users/profile');
        let nativeNotice: Awaited<ReturnType<typeof readVisiblePresentation>>;
        let nativeLayout: Awaited<ReturnType<typeof readSurveyCardLayout>>;

        for (const pilot of [false, true]) {
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const card = page.locator('main .card').first();
            const body = card.locator(':scope > .card-body');
            await expect(body.locator('h2:visible')).toHaveText(['Your response', 'All answers', 'Add new combination']);
            await expect(body.locator('table:visible')).toHaveCount(1);
            const notice = body.locator('.status-notice').filter({hasText: 'No answers yet…'});
            await expect(notice).toBeVisible();
            const presentation = await captureSurveyPresentation(page, info, `${label}-survey-empty-results`, notice, []);
            const layout = await readSurveyCardLayout(card);
            if (pilot) {
                expectVisiblePresentation(nativeNotice!, presentation);
                expectSurveyCardLayout(nativeLayout!, layout);
            } else {
                nativeNotice = presentation;
                nativeLayout = layout;
            }
            // Keep the whole surrounding card available for human inspection;
            // the layout check above retains all corresponding sections.
            await captureSurveyPresentation(page, info, `${label}-survey-empty-card`, card,
                ['h1', 'h2', 'th', 'td', 'input', 'label', 'select', 'button']);
        }
    });

    test(`scrolls native and Vue Survey ballots and results with sticky participants at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const survey = await createFrontendSurveyFixture(page.request, '', {wide: true});
        const initial = await readSurveyForE2E(page.request, survey.id);
        // A partial real ballot keeps both the named answer and omitted No
        // cells in the wide results. No client document or HTTP response is mocked.
        expect((await page.request.post(`${survey.path}/submit`, {
            form: {[initial.combinations[0]!.id]: 'yes'}, maxRedirects: 0,
        })).status()).toBe(302);
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};

        for (const pilot of [false, true]) {
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            if (pilot) await expectSurveyPageContained(page, info, 'vue-survey-page-before-scroll');
            for (const [index, kind] of ['ballot', 'results'].entries()) {
                const table = page.locator('main table').nth(index);
                await expect(table.locator('thead th')).toHaveCount(initial.combinations.length + 1);
                const movement = await scrollSurveyTable(table);
                const presentation = await captureSurveyPresentation(page, info, `${label}-survey-scrolled-${kind}`, table.locator('..'),
                    ['th', 'td', 'input', 'label']);
                if (pilot) {
                    expectVisiblePresentation(native[kind]!, presentation);
                    await expectSurveyStickyParticipantVisible(table);
                    if (kind === 'ballot') await expectCompleteBallotContract(table, initial.combinations.length);
                    // Real table scrolling must remain possible; wrapping may
                    // improve the required width without reproducing native pixels.
                    expect(movement.width).toBeGreaterThan(0);
                    expect(movement.overflow).toBeGreaterThan(0);
                    expect(movement.scroll).toBeGreaterThan(0);
                    await expectSurveyPageContained(page, info, `vue-survey-page-after-${kind}`);
                } else native[kind] = presentation;
            }
            // Retain the unchanged native document movement as evidence. Direct
            // R4/R6 requires Vue's complete tables to scroll locally instead of
            // reproducing that inherited whole-page usability defect (IMP-075).
            const overflow = await readSurveyPageOverflow(page);
            await info.attach(`${label}-survey-page-overflow`, {body: JSON.stringify(overflow, null, 2), contentType: 'application/json'});
        }

        // A fresh German visit exercises the same shared containment owner with
        // longer labels. This remains a real built route, not a substituted DOM.
        await page.goto(`/frontend-pilot${survey.path}?locale=de`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expectSurveyPageContained(page, info, 'vue-de-survey-page-before-scroll');
        for (const [index, kind] of ['ballot', 'results'].entries()) {
            const table = page.locator('main table').nth(index);
            await expect(table.locator('thead th')).toHaveCount(initial.combinations.length + 1);
            await scrollSurveyTable(table);
            await expectSurveyStickyParticipantVisible(table);
            if (kind === 'ballot') await expectCompleteBallotContract(table, initial.combinations.length);
            await captureSurveyPresentation(page, info, `vue-de-survey-scrolled-${kind}`, table.locator('..'),
                ['th', 'td', 'input', 'label']);
            await expectSurveyPageContained(page, info, `vue-de-survey-page-after-${kind}`);
        }

        // The final choice still uses its real radio/label and browser arrow
        // navigation. Changing the local draft neither pans the document nor
        // submits a ballot implicitly, and persistence keeps the prior answer.
        const last = initial.combinations.at(-1)!;
        const ballot = page.locator('#survey-ballot');
        const no = ballot.locator(`input[name="${last.id}"][value="no"]`);
        const yes = ballot.locator(`input[name="${last.id}"][value="yes"]`);
        let ballotWrites = 0;
        page.on('request', request => {
            if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/v1/surveys/${survey.id}/ballot`) ballotWrites++;
        });
        await ballot.locator(`label[for="no-${last.id}"]`).click();
        await expect(no).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(yes).toBeFocused();
        await expect(yes).toBeChecked();
        await expectSurveyStickyParticipantVisible(ballot.locator('table'));
        await expectSurveyPageContained(page, info, 'vue-de-survey-page-after-keyboard');
        const saved = await readSurveyForE2E(page.request, survey.id);
        expect(saved.ownAnswers[last.id] ?? 'no').toBe('no');
        expect(ballotWrites).toBe(0);
    });

    test(`renders saved Survey instructions as escaped single and multiline text at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const descriptions = ['Bring your own lunch.', 'Choose our monthly meeting\nBring <strong>your own</strong> lunch.'];

        for (const [index, description] of descriptions.entries()) {
            const survey = await createFrontendSurveyFixture(page.request, description);
            await page.request.get('/users/profile');

            // Keep the unchanged native failure visible in the evidence. R1
            // approves rendering saved instructions only in the Vue frontend;
            // its text/height difference is therefore deliberate, not normalized.
            for (const pilot of [false, true]) {
                await page.goto(`${pilot ? '/frontend-pilot' : ''}${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
                if (pilot) await waitForPilotHydration(page);
                await expect(page).toHaveTitle(`Vote on ${survey.title} | Surveyor`);
                const paragraph = page.locator('#planDesc');
                if (pilot) {
                    await expect(paragraph).toBeVisible();
                    expect(await paragraph.innerText()).toBe(description);
                    await expect(paragraph.locator('br')).toHaveCount(description.split('\n').length - 1);
                    await expect(paragraph.locator('strong')).toHaveCount(0);
                    await expect(paragraph).toHaveCSS('margin-top', '8px');
                    await expect(paragraph).toHaveCSS('margin-bottom', '0px');

                    // Inspect the surrounding content too: the description must
                    // precede the ballot heading without overlap. Cropping only
                    // the ballot form missed the original description spacing.
                    const descriptionBox = await paragraph.boundingBox();
                    const headingBox = await page.getByRole('heading', {name: 'Your response', exact: true}).boundingBox();
                    expect(descriptionBox).not.toBeNull();
                    expect(headingBox).not.toBeNull();
                    expect(headingBox!.y).toBeGreaterThanOrEqual(descriptionBox!.y + descriptionBox!.height - 1);
                } else {
                    expect(await paragraph.textContent()).toBe('');
                }
                await captureSurveyPresentation(page, info, `${pilot ? 'vue' : 'native'}-survey-description-${index}`,
                    page.locator('main .card').first(), ['h1', 'h2', 'p', 'th', 'td', 'input', 'label', 'select', 'button']);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
            }
        }
        expect(errors).toEqual([]);
    });
}

test('creates and duplicates a standalone Survey with image and monthly choices in one document', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P4 SPA survey ${randomUUID().slice(0, 8)}`;
    await page.goto('/frontend-pilot?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'survey-create';});
    const navigations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    await page.getByRole('button', {name: 'New', exact: true}).click();
    await page.getByRole('link', {name: 'Survey', exact: true}).click();
    await expect(page).toHaveURL('/frontend-pilot/survey/create');
    await expect(page).toHaveTitle('Create Survey | Surveyor');
    await page.locator('#title').fill(title);
    await page.locator('#description').fill('Choose our monthly meeting\nBring your own lunch.');
    await page.locator('#headerImg').setInputFiles('src/public/img/logo.png');
    await page.locator('#combinationTable select').nth(0).selectOption('FRI');
    await page.locator('#combinationTable select').nth(1).selectOption('LAST');
    await page.locator('#addCombinationBtn').click();
    await page.locator('#combinationTable tr').nth(1).locator('select').nth(0).selectOption('WED');
    await page.locator('#combinationTable tr').nth(1).locator('select').nth(1).selectOption('3');
    // Draft rows retain independent DOM identity even while their selections
    // match. The persisted schema forbids identical recurring choices, so remove
    // this temporary peer before submitting the valid two-choice creation.
    await page.locator('#addCombinationBtn').click();
    await page.locator('#combinationTable tr').nth(2).locator('select').nth(0).selectOption('FRI');
    await page.locator('#combinationTable tr').nth(2).locator('select').nth(1).selectOption('LAST');
    await page.locator('#combinationTable tr').nth(2).getByRole('button', {name: 'Remove', exact: true}).click();
    await expect(page.locator('#combinationTable tr')).toHaveCount(2);
    await expect(page.locator('#combinationTable tr').first().locator('select').nth(0)).toHaveValue('FRI');
    await expect(page.locator('#combinationTable tr').first().locator('select').nth(1)).toHaveValue('LAST');
    await expect(page.getByText('Group Permissions', {exact: true})).toHaveCount(0);
    const created = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/surveys');
    await page.getByRole('button', {name: 'Create Survey', exact: true}).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/survey\/[a-f0-9-]+$/u);
    await expect(page).toHaveTitle(`Vote on ${title} | Surveyor`);
    expect(await page.locator('#planDesc').innerText()).toBe('Choose our monthly meeting\nBring your own lunch.');
    const id = new URL(page.url()).pathname.split('/').pop()!;
    const original = await readSurveyForE2E(page.request, id);
    expect(original).toMatchObject({title, description: 'Choose our monthly meeting\nBring your own lunch.', responses: [],
        headerUrl: `/api/v1/surveys/${id}/header`});
    expect(original.combinations).toEqual(expect.arrayContaining([
        expect.objectContaining({weekday: 'FRI', nthWeek: 'LAST'}), expect.objectContaining({weekday: 'WED', nthWeek: '3'}),
    ]));
    expect(original.combinations).toHaveLength(2);
    expect(await (await page.request.get(original.headerUrl!, {headers: await frontendEventHeaders(page.request)})).body())
        .toEqual(readFileSync('src/public/img/logo.png'));

    // Copy an answered source so an empty copied result actually proves that
    // duplication excludes ballots, independently of its image exclusion.
    expect((await page.request.put(`/api/v1/surveys/${id}/ballot`, {
        headers: await frontendEventHeaders(page.request),
        data: {answers: {[original.combinations[0]!.id]: 'yes'}},
    })).status()).toBe(200);
    expect((await readSurveyForE2E(page.request, id)).responses).toHaveLength(1);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await settings.getByRole('link', {name: 'Duplicate', exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/survey/${id}/duplicate`);
    await expect(page).toHaveTitle('Create Survey | Surveyor');
    await expect(page.locator('#title')).toHaveValue(title);
    await expect(page.locator('#description')).toHaveValue(original.description!);
    await expect(page.locator('#combinationTable tr')).toHaveCount(original.combinations.length);
    for (const [index, combination] of original.combinations.entries()) {
        const row = page.locator('#combinationTable tr').nth(index);
        await expect(row.locator('select').nth(0)).toHaveValue(combination.weekday);
        await expect(row.locator('select').nth(1)).toHaveValue(combination.nthWeek);
    }
    await expect(page.locator('#headerImg')).toHaveValue('');
    await page.locator('#title').fill(`${title} copy`);
    const duplicated = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/surveys');
    await page.getByRole('button', {name: 'Create Survey', exact: true}).click();
    expect((await duplicated).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/survey\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    const copy = await readSurveyForE2E(page.request, copyId);
    expect(copy).toMatchObject({title: `${title} copy`, description: original.description, headerUrl: null, responses: [], archived: false});
    expect(copy.combinations.map(({weekday, nthWeek}) => ({weekday, nthWeek})))
        .toEqual(original.combinations.map(({weekday, nthWeek}) => ({weekday, nthWeek})));
    await expect(page).toHaveTitle(`Vote on ${title} copy | Surveyor`);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-create');
    expect(navigations).toEqual([]);
});

test('keeps archived guest ballots isolated, preserves dirty choices during refresh and admits collaborative combinations', async ({page, browser, baseURL}, info) => {
    const survey = await createFrontendSurveyFixture(page.request);
    expect((await page.request.post(`/api/v1/surveys/${survey.id}/archive`, {
        headers: await frontendEventHeaders(page.request),
    })).status()).toBe(200);
    await page.request.get('/users/profile');
    await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    const nativeNotice = await captureSurveyPresentation(page, info, 'native-survey-archived-notice',
        page.getByRole('status').filter({hasText: /^This entity is archived\.$/u}), []);
    await page.goto(`/frontend-pilot${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const archivedNotice = page.getByRole('status').filter({hasText: /^This entity is archived\.$/u});
    await expect(archivedNotice).toBeVisible();
    expectVisiblePresentation(nativeNotice, await captureSurveyPresentation(page, info, 'vue-survey-archived-notice', archivedNotice, []));
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'survey-ballot';});
    const navigations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    const initial = await readSurveyForE2E(page.request, survey.id);
    const first = initial.combinations[0]!;
    await page.locator(`label[for="yes-${first.id}"]`).click();

    const guest = await browser.newContext({baseURL});
    try {
        const guestPage = await guest.newPage();
        await guestPage.goto(`/frontend-pilot${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(guestPage);
        await expect(guestPage).toHaveURL(`/frontend-pilot${survey.path}/guest?locale=en`);
        await expect(guestPage).toHaveTitle(`Join «${survey.title}»`);
        await guestPage.evaluate(() => {document.documentElement.dataset.pilotDocument = 'survey-guest';});
        const guestNavigations: string[] = [];
        guestPage.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === guestPage.mainFrame()) guestNavigations.push(request.url());
        });
        await guestPage.locator('#guest-name').fill(`P4 guest ${randomUUID().slice(0, 8)}`);
        await observeSurveyCommand(guestPage, survey.id, '/guest', 'POST',
            () => guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click());
        await expect(guestPage.locator('#survey-ballot')).toBeVisible();
        await expect(guestPage).toHaveTitle(`Vote on ${survey.title} | Surveyor`);
        await expect(guestPage.getByRole('status').filter({hasText: /^This entity is archived\.$/u})).toBeVisible();
        await expect(guestPage.getByRole('button', {name: 'Entity settings', exact: true})).toHaveCount(0);
        await guestPage.locator('#survey-add-weekday').selectOption('SUN');
        await guestPage.locator('#survey-add-nth').selectOption('4');
        await observeSurveyCommand(guestPage, survey.id, '/combinations', 'POST',
            () => guestPage.locator('#survey-add-combination').getByRole('button', {name: 'Add', exact: true}).click());
        const expanded = await readSurveyForE2E(page.request, survey.id);
        const added = expanded.combinations.find(combination => combination.weekday === 'SUN')!;
        expect(expanded.responses).toEqual([]);
        await guestPage.locator(`label[for="maybe-${first.id}"]`).click();
        await observeSurveyCommand(guestPage, survey.id, '/ballot', 'PUT',
            () => guestPage.locator('#survey-ballot').getByRole('button', {name: 'Submit', exact: true}).click());

        // Refresh must merge a newly observed column while preserving the
        // owner's intentional Yes selection and defaulting its new choice No.
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        await expect(page.locator(`#yes-${first.id}`)).toBeChecked();
        await expect(page.locator(`#no-${added.id}`)).toBeChecked();
        await observeSurveyCommand(page, survey.id, '/ballot', 'PUT',
            () => page.locator('#survey-ballot').getByRole('button', {name: 'Submit', exact: true}).click());
        const submitted = await readSurveyForE2E(page.request, survey.id);
        expect(submitted.ownAnswers).toMatchObject({[first.id]: 'yes', [added.id]: 'no'});
        expect(submitted.responses).toHaveLength(2);
        expect(submitted.archived).toBe(true);
        expect((await readSurveyForE2E(guest.request, survey.id)).ownAnswers[first.id]).toBe('maybe');
        await expect(page.locator('main table').nth(1).locator('tbody tr')).toHaveCount(2);
        expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-ballot');
        expect(navigations).toEqual([]);
        expect(await guestPage.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-guest');
        expect(guestNavigations).toEqual([]);
    } finally {
        await guest.close();
    }
});

test('saves Survey owner properties, image and archive controls before permanent deletion in the same document', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const survey = await createFrontendSurveyFixture(page.request);
    await page.goto(`/frontend-pilot${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'survey-settings';});
    const navigations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    const title = `${survey.title} changed`;
    await settings.locator('[name="title"]').fill(title);
    await settings.locator('[name="description"]').fill('Owner instructions');
    await observeSurveyCommand(page, survey.id, '/metadata', 'PATCH',
        () => settings.getByRole('button', {name: 'Save properties', exact: true}).click());
    expect(await readSurveyForE2E(page.request, survey.id)).toMatchObject({title, description: 'Owner instructions'});

    const imageSection = settings.locator('[data-entity-section="image"]');
    await imageSection.locator('summary').click();
    await imageSection.locator('input[type="file"]').setInputFiles('src/public/img/logo.png');
    await observeSurveyCommand(page, survey.id, '/header', 'PUT',
        () => imageSection.getByRole('button', {name: 'Upload', exact: true}).click());
    const headerUrl = (await readSurveyForE2E(page.request, survey.id)).headerUrl!;
    expect(await (await page.request.get(headerUrl, {headers: await frontendEventHeaders(page.request)})).body())
        .toEqual(readFileSync('src/public/img/logo.png'));
    await observeSurveyCommand(page, survey.id, '/header', 'DELETE',
        () => imageSection.getByRole('button', {name: 'Remove image', exact: true}).click());
    expect((await readSurveyForE2E(page.request, survey.id)).headerUrl).toBeNull();

    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await observeSurveyCommand(page, survey.id, '/archive', 'POST',
        () => settings.getByRole('button', {name: 'Archive for everyone', exact: true}).click());
    expect((await readSurveyForE2E(page.request, survey.id)).archived).toBe(true);
    await settings.locator('.modal-header .btn-close').click();
    const archivedNotice = page.getByRole('status').filter({hasText: /^This entity is archived\.$/u});
    await expect(archivedNotice).toBeVisible();
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await observeSurveyCommand(page, survey.id, '/restore', 'POST',
        () => settings.getByRole('button', {name: 'Restore for everyone', exact: true}).click());
    expect((await readSurveyForE2E(page.request, survey.id)).archived).toBe(false);
    await settings.locator('.modal-header .btn-close').click();
    await expect(archivedNotice).toHaveCount(0);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await observeSurveyCommand(page, survey.id, '', 'DELETE',
        () => settings.getByRole('button', {name: 'Delete permanently', exact: true}).click());
    await expect(page).toHaveURL('/frontend-pilot/users/dashboard');
    expect((await page.request.get(`/api/v1/surveys/${survey.id}`, {headers: await frontendEventHeaders(page.request)})).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-settings');
    expect(navigations).toEqual([]);
});
