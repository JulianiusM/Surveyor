import {expect, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {closeModalForE2E, expectVisiblePresentation, loginForE2E, openModalForE2E,
    readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {captureSurveyPresentation, createFrontendSurveyFixture, observeSurveyCommand,
    readSurveyForE2E} from '../keywords/frontendSurveyE2EKeywords';

for (const width of [1280, 390]) {
    test(`compares native Survey creation, ballots, named results and collaborative choices at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const survey = await createFrontendSurveyFixture(page.request);
        const initial = await readSurveyForE2E(page.request, survey.id);
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};

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
            await expect(page.locator('#combinationTable tr')).toHaveCount(1);
            const creation = await captureSurveyPresentation(page, info, `${label}-survey-create`, page.locator('#surveyForm'),
                ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);
            if (pilot) expectVisiblePresentation(native.creation!, creation);
            else native.creation = creation;

            await page.goto(`${prefix}${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
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
                expectVisiblePresentation(native.ballot!, ballotPresentation);
                expectVisiblePresentation(native.results!, resultsPresentation);
                expectVisiblePresentation(native.addition!, additionPresentation);
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
            if (pilot) await dialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(nativeModal);
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
    await page.locator('#title').fill(title);
    await page.locator('#description').fill('Choose our monthly meeting\nBring your own lunch.');
    await page.locator('#headerImg').setInputFiles('src/public/img/logo.png');
    await page.locator('#combinationTable select').nth(0).selectOption('FRI');
    await page.locator('#combinationTable select').nth(1).selectOption('LAST');
    await page.locator('#addCombinationBtn').click();
    await page.locator('#combinationTable tr').nth(1).locator('select').nth(0).selectOption('WED');
    await page.locator('#combinationTable tr').nth(1).locator('select').nth(1).selectOption('3');
    await expect(page.getByText('Group Permissions', {exact: true})).toHaveCount(0);
    const created = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/surveys');
    await page.getByRole('button', {name: 'Create Survey', exact: true}).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/survey\/[a-f0-9-]+$/u);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    const original = await readSurveyForE2E(page.request, id);
    expect(original).toMatchObject({title, description: 'Choose our monthly meeting\nBring your own lunch.', responses: [],
        headerUrl: `/api/v1/surveys/${id}/header`});
    expect(original.combinations).toEqual(expect.arrayContaining([
        expect.objectContaining({weekday: 'FRI', nthWeek: 'LAST'}), expect.objectContaining({weekday: 'WED', nthWeek: '3'}),
    ]));
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
    await expect(page.locator('#title')).toHaveValue(title);
    await expect(page.locator('#headerImg')).toHaveValue('');
    await page.locator('#title').fill(`${title} copy`);
    const duplicated = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/surveys');
    await page.getByRole('button', {name: 'Create Survey', exact: true}).click();
    expect((await duplicated).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/survey\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    expect(await readSurveyForE2E(page.request, copyId)).toMatchObject({title: `${title} copy`, headerUrl: null, responses: [], archived: false});
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-create');
    expect(navigations).toEqual([]);
});

test('keeps guest ballots isolated, preserves dirty choices during refresh and admits collaborative combinations', async ({page, browser, baseURL}) => {
    const survey = await createFrontendSurveyFixture(page.request);
    await page.goto(`/frontend-pilot${survey.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
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
        await guestPage.locator('#guest-name').fill(`P4 guest ${randomUUID().slice(0, 8)}`);
        await observeSurveyCommand(guestPage, survey.id, '/guest', 'POST',
            () => guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click());
        await expect(guestPage.locator('#survey-ballot')).toBeVisible();
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
        expect((await readSurveyForE2E(guest.request, survey.id)).ownAnswers[first.id]).toBe('maybe');
        await expect(page.locator('main table').nth(1).locator('tbody tr')).toHaveCount(2);
        expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-ballot');
        expect(navigations).toEqual([]);
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
    await observeSurveyCommand(page, survey.id, '/restore', 'POST',
        () => settings.getByRole('button', {name: 'Restore for everyone', exact: true}).click());
    expect((await readSurveyForE2E(page.request, survey.id)).archived).toBe(false);
    await observeSurveyCommand(page, survey.id, '', 'DELETE',
        () => settings.getByRole('button', {name: 'Delete permanently', exact: true}).click());
    await expect(page).toHaveURL('/frontend-pilot');
    expect((await page.request.get(`/api/v1/surveys/${survey.id}`, {headers: await frontendEventHeaders(page.request)})).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('survey-settings');
    expect(navigations).toEqual([]);
});
