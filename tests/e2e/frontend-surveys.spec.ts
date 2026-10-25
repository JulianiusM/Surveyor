import {expect, test, type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {expectEmbeddedFrontendRefresh, loginForE2E, readControlContracts} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {captureSurveyPresentation, createFrontendSurveyFixture, expectSurveyCardLayout, expectSurveyPageContained, observeSurveyCommand,
    expectSurveyStickyParticipantVisible, readSurveyCardLayout, readSurveyForE2E,
    readSurveyPageOverflow, scrollSurveyTable} from '../keywords/frontendSurveyE2EKeywords';

/** This fixture saved Yes for its first choice and omitted every later choice.
 * The assertions retain the real clipped radios' checked contracts
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

/** Assert the restored native wording and selectable values on the actual field. */
async function expectOccurrenceControl(surface: Locator, creation: boolean): Promise<void> {
    const label = creation ? surface.getByRole('columnheader', {name: 'Week of month', exact: true})
        : surface.locator('label').filter({hasText: /^Day in month:$/u});
    const control = surface.getByRole('combobox', {name: creation ? 'Week of month' : 'Day in month', exact: true});
    await expect(label).toHaveCount(1);
    await expect(control).toHaveCount(1);
    await expect(control.locator('option')).toHaveText(creation ? ['1', '2', '3', '4', 'Last']
        : ['1. day in month', '2. day in month', '3. day in month', '4. day in month',
            'Last (4./5.) day in month']);
    expect(await control.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
        .toEqual(['1', '2', '3', '4', 'LAST']);
    const labelBounds = (await label.boundingBox())!;
    const controlBounds = (await control.boundingBox())!;
    expect(labelBounds.width).toBeGreaterThan(0);
    expect(controlBounds.y).toBeGreaterThanOrEqual(labelBounds.y + labelBounds.height - 1);
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

for (const width of [1280, 390]) {
    test(`renders Survey creation, ballots, named results and collaborative choices at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const survey = await createFrontendSurveyFixture(page.request);
        const initial = await readSurveyForE2E(page.request, survey.id);

        // A partial persisted ballot exercises both the named Yes and the
        // native missing-answer No presentation in the second result column.
        expect((await page.request.put(`/api/v1/surveys/${survey.id}/ballot`, {
            headers: await frontendEventHeaders(page.request), data: {answers: {[initial.combinations[0]!.id]: 'yes'}},
        })).status()).toBe(200);
        await page.request.get('/users/profile');
        const label = 'vue';
        await page.goto(`/survey/create?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await expect(page).toHaveTitle('Create Survey | Surveyor');
        await expect(page.locator('#combinationTable tr')).toHaveCount(1);
        const creationRemove = page.locator('#combinationTable').getByRole('button', {name: 'Remove', exact: true});
        await expect(creationRemove).toHaveCount(1);
        await expect(creationRemove).toBeDisabled();
        await expect(page.locator('#title')).toHaveAttribute('required', '');
        await expect(page.locator('#description')).toBeVisible();
        await expect(page.locator('#headerImg')).toHaveAttribute('type', 'file');
        await captureSurveyPresentation(page, info, `${label}-survey-create`, page.locator('#surveyForm'),
            ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);
        await expectOccurrenceControl(page.locator('#surveyForm'), true);
        await captureSurveyPresentation(page, info, `${label}-survey-create-card`,
            page.locator('main .card').first(), ['h1', 'label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);

        await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await expect(page).toHaveTitle(`Vote on ${survey.title} | Surveyor`);
        const card = page.locator('main .card').first();
        const header = await captureSurveyPresentation(page, info, `${label}-survey-header`, card.locator(':scope > .card-header'),
            ['h1', 'button']);
        const layout = await readSurveyCardLayout(card);
        await expectEmbeddedFrontendRefresh(card.locator(':scope > .card-header'));
        expect(header.content.elements.filter(element => element.refresh)).toHaveLength(1);

        expectSurveyCardLayout(layout);
        const ballot = page.locator('#survey-ballot');
        const results = page.locator('main table').nth(1);
        const addition = page.locator('#survey-add-combination');
        await expect(card.locator(':scope > .card-body h2')).toHaveText(['Your response', 'All answers', 'Add new combination']);
        await expectCompleteBallotContract(ballot.locator('table'), initial.combinations.length);
        await expect(results.locator('tbody tr')).toHaveCount(1);
        const saved = await readSurveyForE2E(page.request, survey.id);
        await expect(results.locator('tbody .sticky-col')).toHaveText(saved.responses[0]!.name);
        await expect(results.locator('tbody label')).toHaveText(initial.combinations.map((_, index) => index === 0 ? 'yes' : 'no'));
        for (const answer of await results.locator('input[type="radio"]').all()) {
            await expect(answer).toBeChecked();
            await expect(answer).toBeDisabled();
        }
        await captureSurveyPresentation(page, info, `${label}-survey-ballot`, ballot,
            ['th', 'td', 'input', 'label', 'button']);
        await captureSurveyPresentation(page, info, `${label}-survey-results`, results,
            ['th', 'td', 'input', 'label']);
        await captureSurveyPresentation(page, info, `${label}-survey-add`, addition,
            ['label', 'select', 'button']);
        await expectOccurrenceControl(addition, false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

        // Survey composes owner settings without event, Access or
        // Administrator panels. General remains the shared dialog surface.
        const opener = page.getByRole('button', {name: 'Entity settings', exact: true});

        await opener.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('[name="title"]')).toBeVisible();
        await expect(dialog.getByRole('tab', {name: 'Actions', exact: true})).toBeVisible();
        await expect(dialog.getByRole('tab', {name: 'Linked event', exact: true})).toHaveCount(0);
        await expect(dialog.getByRole('tab', {name: 'Access', exact: true})).toHaveCount(0);
        await captureSurveyPresentation(page, info, `${label}-survey-settings`, dialog,
            ['h2', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);

        // The same admitted image disclosure must open from the keyboard.
        // Its complete dialog snapshot includes the chooser, hint and Upload,
        // retaining their actual label/control geometry at both viewports.
        const image = dialog.locator('[data-entity-section="image"]');
        await image.locator('summary').press('Enter');
        await expect(image.locator('details')).toHaveJSProperty('open', true);
        await captureSurveyPresentation(page, info, `${label}-survey-settings-image`, dialog,
            ['h2', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);

        // The shared focus owner exposes the complete
        // General→Actions keyboard journey and restores the actual invoker.
        await dialog.getByRole('tab', {name: 'General', exact: true}).focus();
        await page.keyboard.press('ArrowRight');
        const actions = dialog.getByRole('tab', {name: 'Actions', exact: true});
        await expect(actions).toBeFocused();
        await expect(actions).toHaveAttribute('aria-selected', 'true');
        await captureSurveyPresentation(page, info, `${label}-survey-settings-actions`, dialog,
            ['h2', 'h3', 'h5', 'p', 'a', 'button']);

        await expect(dialog.getByRole('link', {name: 'Duplicate', exact: true})).toHaveAttribute('href', `${survey.path}/duplicate`);
        const remove = dialog.getByRole('button', {name: 'Delete permanently', exact: true});
        await expect(remove).toBeEnabled();
        await actions.focus();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(opener).toBeFocused();
        expect(errors).toEqual([]);
    });

    test(`renders empty Survey results and the complete voting card at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const survey = await createFrontendSurveyFixture(page.request);
        await page.request.get('/users/profile');

        const label = 'vue';
        await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        const card = page.locator('main .card').first();
        const body = card.locator(':scope > .card-body');
        await expect(body.locator('h2:visible')).toHaveText(['Your response', 'All answers', 'Add new combination']);
        await expect(body.locator('table:visible')).toHaveCount(1);
        const notice = body.locator('.status-notice').filter({hasText: 'No answers yet…'});
        await expect(notice).toBeVisible();
        await captureSurveyPresentation(page, info, `${label}-survey-empty-results`, notice, []);
        const layout = await readSurveyCardLayout(card);
        expectSurveyCardLayout(layout);
        // Keep the whole surrounding card available for human inspection;
        // the layout check above retains all corresponding sections.
        await captureSurveyPresentation(page, info, `${label}-survey-empty-card`, card,
            ['h1', 'h2', 'th', 'td', 'input', 'label', 'select', 'button']);
    });

    test(`scrolls Survey ballots and results with sticky participants at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const survey = await createFrontendSurveyFixture(page.request, '', {wide: true});
        const initial = await readSurveyForE2E(page.request, survey.id);
        // A partial real ballot keeps both the named answer and omitted No
        // cells in the wide results. No client document or HTTP response is mocked.
        expect((await page.request.put(`/api/v1/surveys/${survey.id}/ballot`, {
            headers: await frontendEventHeaders(page.request), data: {answers: {[initial.combinations[0]!.id]: 'yes'}},
        })).status()).toBe(200);
        await page.request.get('/users/profile');

        const label = 'vue';
        await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await expectSurveyPageContained(page, info, 'vue-survey-page-before-scroll');
        for (const [index, kind] of ['ballot', 'results'].entries()) {
            const table = page.locator('main table').nth(index);
            await expect(table.locator('thead th')).toHaveCount(initial.combinations.length + 1);
            const movement = await scrollSurveyTable(table);
            await captureSurveyPresentation(page, info, `${label}-survey-scrolled-${kind}`, table.locator('..'),
                ['th', 'td', 'input', 'label']);
            await expectSurveyStickyParticipantVisible(table);
            if (kind === 'ballot') await expectCompleteBallotContract(table, initial.combinations.length);
            // Real table scrolling must remain possible; wrapping may
            // improve the required width without reproducing native pixels.
            expect(movement.width).toBeGreaterThan(0);
            expect(movement.overflow).toBeGreaterThan(0);
            expect(movement.scroll).toBeGreaterThan(0);
            await expectSurveyPageContained(page, info, `vue-survey-page-after-${kind}`);
        }
        // Keep actual document movement as evidence alongside local table scrolling.
        const overflow = await readSurveyPageOverflow(page);
        await info.attach(`${label}-survey-page-overflow`, {body: JSON.stringify(overflow, null, 2), contentType: 'application/json'});

        // A fresh German visit exercises the same shared containment owner with
        // longer labels. This remains a real built route, not a substituted DOM.
        await page.goto(`${survey.path}?locale=de`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
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

            // Saved instructions retain the approved escaped-text and line-break contract.
            // Original native failure screenshots remain separate historical evidence.
            await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            await expect(page).toHaveTitle(`Vote on ${survey.title} | Surveyor`);
            const paragraph = page.locator('#planDesc');
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
            await captureSurveyPresentation(page, info, `vue-survey-description-${index}`,
                page.locator('main .card').first(), ['h1', 'h2', 'p', 'th', 'td', 'input', 'label', 'select', 'button']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        expect(errors).toEqual([]);
    });
}

test('creates and duplicates a standalone Survey with image and monthly choices in one document', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P4 SPA survey ${randomUUID().slice(0, 8)}`;
    await page.goto('/?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'survey-create';});
    const navigations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    await page.getByRole('button', {name: 'New', exact: true}).click();
    await page.getByRole('link', {name: 'Survey', exact: true}).click();
    await expect(page).toHaveURL('/survey/create');
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
    await expect(page).toHaveURL(/\/survey\/[a-f0-9-]+$/u);
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
    await expect(page).toHaveURL(`/survey/${id}/duplicate`);
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
    await expect(page).toHaveURL(/\/survey\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    const copy = await readSurveyForE2E(page.request, copyId);
    expect(copy).toMatchObject({title: `${title} copy`, description: original.description, headerUrl: null, responses: [], archived: false});
    expect(copy.combinations.map(({weekday, nthWeek}) => ({weekday, nthWeek})))
        .toEqual(original.combinations.map(({weekday, nthWeek}) => ({weekday, nthWeek})));
    await expect(page).toHaveTitle(`Vote on ${title} copy | Surveyor`);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('survey-create');
    expect(navigations).toEqual([]);
});

test('keeps archived guest ballots isolated, preserves dirty choices during refresh and admits collaborative combinations', async ({page, browser, baseURL}, info) => {
    const survey = await createFrontendSurveyFixture(page.request);
    expect((await page.request.post(`/api/v1/surveys/${survey.id}/archive`, {
        headers: await frontendEventHeaders(page.request),
    })).status()).toBe(200);
    await page.request.get('/users/profile');
    await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const archivedNotice = page.getByRole('status').filter({hasText: /^This entity is archived\.$/u});
    await expect(archivedNotice).toBeVisible();
    await captureSurveyPresentation(page, info, 'vue-survey-archived-notice', archivedNotice, []);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'survey-ballot';});
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
        await guestPage.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(guestPage);
        await expect(guestPage).toHaveURL(`${survey.path}/guest?locale=en`);
        await expect(guestPage).toHaveTitle(`Join «${survey.title}»`);
        await guestPage.evaluate(() => {document.documentElement.dataset.frontendDocument = 'survey-guest';});
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
        expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('survey-ballot');
        expect(navigations).toEqual([]);
        expect(await guestPage.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('survey-guest');
        expect(guestNavigations).toEqual([]);
    } finally {
        await guest.close();
    }
});

test('saves Survey owner properties, image and archive controls before permanent deletion in the same document', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const survey = await createFrontendSurveyFixture(page.request);
    await page.goto(`${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'survey-settings';});
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
    await expect(page).toHaveURL('/users/dashboard');
    expect((await page.request.get(`/api/v1/surveys/${survey.id}`, {headers: await frontendEventHeaders(page.request)})).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('survey-settings');
    expect(navigations).toEqual([]);
});
