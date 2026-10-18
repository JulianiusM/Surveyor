import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, readVisiblePresentation} from './e2eCoreKeywords';
import {frontendEventHeaders} from './frontendEventE2EKeywords';

/** Seed the unchanged native controller through HTTP. Both renderers later
 * inspect these same records and the same actor, without intercepted delivery. */
export async function createFrontendSurveyFixture(request: APIRequestContext, description = '') {
    await loginForE2E(request, createE2ELogin());
    const input = createE2ESurvey();
    input.title = input.form.title = `P4 monthly survey ${randomUUID().slice(0, 8)}`;
    input.form.description = description;
    const resource = await createResourceViaForm(request, input);
    expect((await request.post(`/survey/${resource.id}/add-combination`, {
        form: {weekday: 'FRI', nthWeek: 'LAST'}, maxRedirects: 0,
    })).status()).toBe(302);
    return resource;
}

/** Read the generated public projection through real admission and persistence. */
export async function readSurveyForE2E(request: APIRequestContext, id: string): Promise<components['schemas']['SurveyView']> {
    const response = await request.get(`/api/v1/surveys/${id}`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['SurveyView']>;
}

/** Observe exactly one integrated command; a visible change alone cannot prove
 * its generated path/method or distinguish SPA delivery from a document POST. */
export async function observeSurveyCommand(page: Page, id: string, suffix: string, method: string,
    act: () => Promise<unknown>, status = 200): Promise<void> {
    const response = page.waitForResponse(result => result.request().method() === method
        && new URL(result.url()).pathname === `/api/v1/surveys/${id}${suffix}`);
    await act();
    expect((await response).status()).toBe(status);
}

/** Capture original pixels and every requested visible control/style/box before
 * comparison. Measurements stay unmodified even when an assertion fails. */
export async function captureSurveyPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[]) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(function releaseFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.mouse.move(0, 0);
    const path = info.outputPath(name + '.png');
    await surface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});
    const presentation = await readVisiblePresentation(surface, selectors);
    await info.attach(name + '-presentation', {body: JSON.stringify(presentation, null, 2), contentType: 'application/json'});
    return presentation;
}
