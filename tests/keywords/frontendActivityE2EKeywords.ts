import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import {createE2EActivityPlan, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, readVisiblePresentation} from './e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';

/** Create production records through the unchanged native form. The resulting
 * actor and records are shared by the native comparator and built Vue routes. */
export async function createActivityForE2E(request: APIRequestContext, eventId?: string) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EActivityPlan();
    input.title = input.form.title = `P5 duties ${randomUUID().slice(0, 8)}`;
    Object.assign(input.form, {startDate: '2030-06-01', endDate: '2030-06-02',
        'defaultPerms[public][0]': 'ACCESS_VIEW',
        slots: JSON.stringify({'2030-06-01': [
            {id: randomUUID(), day: '2030-06-01', pos: 0, title: 'Breakfast help', description: 'Serve breakfast',
                startTime: '09:00', endTime: '10:00', maxAssignees: 2},
            {id: randomUUID(), day: '2030-06-01', pos: 1, title: 'Lunch help', description: 'Prepare lunch',
                startTime: '12:00', endTime: '13:00', maxAssignees: 1},
        ]}), ...(eventId ? {event_id: eventId} : {})});
    if (eventId) input.createPath += `?eventId=${eventId}`;
    const resource = await createResourceViaForm(request, input);
    return {...resource, view: await readActivityForE2E(request, resource.id)};
}

/** Read only the bounded Activity projection. Recommendation reads can perform
 * maintenance/enqueue work and are deliberately absent from these P5 fixtures. */
export async function readActivityForE2E(request: APIRequestContext, planId: string): Promise<components['schemas']['ActivityView']> {
    const response = await request.get(`/api/v1/activity-plans/${planId}`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['ActivityView']>;
}

/** Settings are a separately admitted projection; persisted automation state is
 * verified there rather than inferred from an optimistic button label. */
export async function readActivitySettingsForE2E(request: APIRequestContext, planId: string): Promise<components['schemas']['ActivitySettings']> {
    const response = await request.get(`/api/v1/activity-plans/${planId}/settings`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['ActivitySettings']>;
}

/** Observe the real generated operation rather than inferring a write from a
 * refreshed card. Commands remain single attempts through integrated middleware. */
export async function observeActivityCommand(page: Page, planId: string, suffix: string, method: string,
    action: () => Promise<unknown>, status = 200): Promise<void> {
    const response = page.waitForResponse(result => result.request().method() === method
        && new URL(result.url()).pathname === `/api/v1/activity-plans/${planId}${suffix}`);
    await action();
    expect((await response).status()).toBe(status);
}

/** Native Bootstrap panes become measurable before their fade is painted.
 * Compare only the actually shown, fully opaque pane after tab activation. */
export async function waitForNativeActivityPane(pane: Locator): Promise<void> {
    await expect(pane).toHaveClass(/\bshow\b/u);
    await expect(pane).toHaveCSS('opacity', '1');
}

/** Retain an inspectable screenshot and complete visible text/control measures.
 * The caller compares corresponding same-actor native and Vue surfaces. */
export async function captureActivityPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[]) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(function releaseFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.mouse.move(0, 0);
    const path = info.outputPath(`${name}.png`);
    await surface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});
    const measured = await readVisiblePresentation(surface, selectors);
    const evidence = JSON.stringify(measured, null, 2);
    await writeFile(info.outputPath(`${name}-presentation.json`), evidence);
    await info.attach(`${name}-presentation`, {body: evidence, contentType: 'application/json'});
    return measured;
}

/** Preview and join through native HTTP to prepare a real sibling commitment.
 * Explicit fixture confirmation is separate from the Vue review being tested. */
export async function assignActivityThroughNative(request: APIRequestContext, planId: string, slotId: string): Promise<void> {
    const preview = await request.post(`/api/activity/${planId}/slot/${slotId}/warnings`, {data: {}});
    expect(preview.status()).toBe(200);
    const {data} = await preview.json() as {data: {overlapConfirmation?: string}};
    const assigned = await request.post(`/api/activity/${planId}/assign`, {
        data: {itemId: slotId, overlapConfirmation: data.overlapConfirmation},
    });
    expect(assigned.status()).toBe(200);
}

/** Prepare two Event-linked plans whose real participant has one sibling
 * commitment. Both native and Vue warning readers see the same persisted overlap. */
export async function createActivityOverlapForE2E(request: APIRequestContext) {
    const event = await createFrontendEventFixture(request);
    expect((await request.post(`/api/event/${event.id}/register`, {
        data: {arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT']},
    })).status()).toBe(200);
    const target = await createActivityForE2E(request, event.id);
    const sibling = await createActivityForE2E(request, event.id);
    await assignActivityThroughNative(request, sibling.id, sibling.view.slots[0]!.id);
    return {target, sibling};
}
