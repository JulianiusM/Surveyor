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

/** Read only the bounded Activity projection. Native recommendation entry can
 * perform maintenance/enqueue work and is deliberately absent from these P5 fixtures. */
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

/** Exercise the same real keyboard journey in both renderers. Page keys retain
 * browser scrolling, while Bootstrap's six tab keys wrap and activate in place. */
export async function expectActivityTabKeyboard(page: Page): Promise<void> {
    const tabs = page.locator('main .nav-tabs [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    // Establish keyboard focus without starting Bootstrap's smooth page scroll;
    // only the actual keys below should determine the measured scroll behavior.
    await tabs.first().evaluate(element => (element as HTMLElement).focus({preventScroll: true}));
    // Opening Rules may already have started Bootstrap's smooth scrolling, and
    // Vue renders its focus-selected panel asynchronously. Observe the actual
    // browser position until that setup settles, without canceling its motion.
    await page.evaluate(() => new Promise<void>(resolve => {
        let previous = window.scrollY;
        let stableFrames = 0;
        function observePosition(): void {
            const current = window.scrollY;
            stableFrames = current === previous ? stableFrames + 1 : 0;
            previous = current;
            if (stableFrames >= 3) resolve();
            else requestAnimationFrame(observePosition);
        }
        requestAnimationFrame(observePosition);
    }));
    const steps = [
        {key: 'Home', index: 0}, {key: 'End', index: count - 1},
        {key: 'ArrowRight', index: 0}, {key: 'ArrowDown', index: 1},
        {key: 'ArrowLeft', index: 0}, {key: 'ArrowUp', index: count - 1},
        {key: 'Control+Home', index: 0}, {key: 'Shift+End', index: count - 1},
        {key: 'PageUp', index: count - 1}, {key: 'PageDown', index: count - 1},
        {key: 'Home', index: 0},
    ];
    for (const [index, step] of steps.entries()) {
        const before = await page.evaluate(() => window.scrollY);
        await page.keyboard.press(step.key);
        const selected = tabs.nth(step.index);
        await expect(selected).toBeFocused();
        await expect(selected).toHaveAttribute('aria-selected', 'true');
        // Native Bootstrap declares its panel through data-bs-target. Vue's
        // shared tab owner declares aria-controls; require its explicit link.
        const nativeTarget = await selected.getAttribute('data-bs-target');
        const controls = await selected.getAttribute('aria-controls');
        if (!nativeTarget) expect(controls).toBeTruthy();
        const target = nativeTarget ?? '#' + controls;
        expect(target).toMatch(/^#tab-(?:schedule|participants|rules)$/u);
        await expect(page.locator(target)).toBeVisible();
        // Page keys keep the browser's default scroll, which may still settle
        // when the final Home restores Schedule. Measure only the preceding keys.
        if (index < 8) expect(await page.evaluate(() => window.scrollY), `Scroll after ${step.key}`).toBe(before);
    }
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
