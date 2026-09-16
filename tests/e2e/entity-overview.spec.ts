import {expect, request as playwrightRequest, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createE2EEvent, createE2ELogin, createE2EPackingList, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

test('opens real event cards into bounded child pages and finds unloaded children without widening membership', async ({page, baseURL}) => {
    test.setTimeout(120_000);
    await loginForE2E(page.request, createE2ELogin());
    const prefix = `Overview ${randomUUID()}`;
    const eventCase = createE2EEvent();
    eventCase.title = `${prefix} event`;
    Object.assign(eventCase.form, {title: eventCase.title, startDate: '2099-08-05', endDate: '2099-08-07'});
    const event = await createResourceViaForm(page.request, eventCase);
    const children: string[] = [];
    for (let index = 0; index < 26; index++) {
        const childCase = createE2EPackingList();
        childCase.title = `${prefix} item ${String(index).padStart(2, '0')}`;
        childCase.createPath = `/packing/create?eventId=${event.id}`;
        Object.assign(childCase.form, {title: childCase.title, event_id: event.id});
        children.push((await createResourceViaForm(page.request, childCase)).id);
    }
    const surveyCase = createE2ESurvey();
    surveyCase.title = `${prefix} independent survey`;
    surveyCase.form.title = surveyCase.title;
    const survey = await createResourceViaForm(page.request, surveyCase);

    await page.goto('/users/dashboard');
    const region = page.locator('#sec-own-parts-main');
    await region.getByRole('searchbox').fill(prefix);
    const eventCard = region.locator(`.js-item[data-id="${event.id}"]`);
    await expect(eventCard).toBeVisible();
    await expect(region.locator(`.js-item[data-id="${survey.id}"]`)).toBeVisible();
    await expect(region.locator('.js-item')).toHaveCount(2);
    await expect(region.locator(`.js-item[data-id="${children[0]}"]`)).toHaveCount(0);
    await expect(eventCard.locator('.card-title')).toHaveText(event.title);
    await expect(eventCard.locator('a.card-body')).toHaveAttribute('href', event.path);

    const expand = eventCard.getByRole('link', {name: `Show linked entities for ${event.title}`});
    await expand.click();
    await expect(region.getByRole('link', {name: 'Back to overview', exact: true})).toBeVisible();
    await expect(region.locator('.js-item')).toHaveCount(25);
    await expect(region.locator(`.js-item[data-id="${children[0]}"]`)).toBeVisible();
    await expect(region.locator(`.js-item[data-id="${children[25]}"]`)).toHaveCount(0);
    await region.getByRole('link', {name: 'Next', exact: true}).click();
    await expect(region.locator('.js-item')).toHaveCount(3);
    await expect(region.locator(`.js-item[data-id="${children[25]}"]`)).toBeVisible();
    await expect(region.locator(`.js-item[data-id="${children[0]}"]`)).toHaveCount(0);

    // Explicit paging records normal history entries. Back visits the prior child page,
    // then the mixed grid; Forward restores each view without retaining their old DOM.
    await page.goBack();
    await expect(region.locator('.js-item')).toHaveCount(25);
    await expect(region.locator(`.js-item[data-id="${children[0]}"]`)).toBeVisible();
    await page.goBack();
    await expect(region.locator('.js-item')).toHaveCount(2);
    await page.goForward();
    await expect(region.locator('.js-item')).toHaveCount(25);
    await page.goForward();
    await expect(region.locator(`.js-item[data-id="${children[25]}"]`)).toBeVisible();
    await region.getByRole('link', {name: 'Back to overview', exact: true}).click();
    await expect(region.locator('.js-item')).toHaveCount(2);
    await expect(expand).toBeFocused();

    await region.getByRole('searchbox').fill(`${prefix} item 25`);
    await expect(region.locator('.js-item')).toHaveCount(1);
    await expect(eventCard).toContainText('1 of 26 match');
    await expand.click();
    await expect(region.locator('.js-item')).toHaveCount(2);
    await expect(region.locator(`.js-item[data-id="${children[25]}"]`)).toBeVisible();
    await expect(region.locator(`.js-item[data-id="${children[0]}"]`)).toHaveCount(0);

    // The same canonical URL must work through the full-page route without the fetch enhancement.
    const selectedUrl = page.url();
    await page.goto(selectedUrl);
    await expect(region.locator(`.js-item[data-id="${children[25]}"]`)).toBeVisible();
    await expect(region.locator('.js-item')).toHaveCount(2);
    const response = await page.request.get('/api/users/overview', {params: {
        collection: 'participant', region: 'main', participant_main_q: prefix,
        participant_main_event: event.id,
    }});
    expect(response.status()).toBe(200);
    const responseText = JSON.stringify(await response.json());
    expect(responseText).not.toContain(children[0]);
    expect(responseText).not.toContain(event.title);
    expect((await page.request.get('/api/users/overview', {params: {
        collection: 'owner', region: 'main', profileId: randomUUID(),
    }})).status()).toBe(400);
    const anonymous = await playwrightRequest.newContext({baseURL});
    try {
        expect((await anonymous.get('/api/users/overview', {params: {collection: 'owner', region: 'main'}})).status()).toBe(401);
    } finally {
        await anonymous.dispose();
    }
});
