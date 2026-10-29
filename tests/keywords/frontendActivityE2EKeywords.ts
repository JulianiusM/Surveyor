import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import type {Locale} from '../../src/types/LocalizationTypes';
import {createTranslator} from '../../src/common/localization/translator';
import {createE2EActivityPlan, createE2ELogin} from '../factories/e2eCoreFactory';
import {commandHeadersForE2E, createResourceViaForm, loginForE2E, projectCreationPermissionDisclosure, readVisiblePresentation, expectUsableFrontendLayout} from './e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';

/** Create persisted Activity inputs through the admitted production operations. */
export async function createActivityForE2E(request: APIRequestContext, eventId?: string,
    period: Pick<components['schemas']['ActivityCreateInput'], 'startDate' | 'endDate'> = {startDate: '2030-06-01', endDate: '2030-06-02'}) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EActivityPlan();
    input.title = input.form.title = `P5 duties ${randomUUID().slice(0, 8)}`;
    Object.assign(input.form, {startDate: period.startDate, endDate: period.endDate,
        'defaultPerms[public][0]': 'ACCESS_VIEW',
        slots: JSON.stringify({[period.startDate]: [
                {id: randomUUID(), day: period.startDate, pos: 0, title: 'Breakfast help', description: 'Serve breakfast',
                    startTime: '09:00', endTime: '10:00', maxAssignees: 2},
                {id: randomUUID(), day: period.startDate, pos: 1, title: 'Lunch help', description: 'Prepare lunch',
                    startTime: '12:00', endTime: '13:00', maxAssignees: 1},
            ]}), ...(eventId ? {event_id: eventId} : {})});
    if (eventId) input.createPath += `?eventId=${eventId}`;
    const resource = await createResourceViaForm(request, input);
    return {...resource, view: await readActivityForE2E(request, resource.id)};
}

/** Read the bounded Activity projection without starting recommendation work. */
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

/** Exercise the real keyboard journey. Page keys retain
 * browser scrolling, while Bootstrap's six tab keys wrap and activate in place. */
export async function expectActivityTabKeyboard(page: Page): Promise<void> {
    const tabs = page.locator('main .nav-tabs [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    // Keyboard entry starts at the selected roving tab, after its actual click
    // has activated the associated panel.
    await page.locator('main .nav-tabs [role="tab"][aria-selected="true"]').evaluate(element => (element as HTMLElement).focus({preventScroll: true}));
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
        // The shared tab owner declares its selected panel explicitly.
        const controls = await selected.getAttribute('aria-controls');
        expect(controls).toBeTruthy();
        const target = '#' + controls;
        expect(target).toMatch(/^#tab-(?:schedule|participants|rules)$/u);
        await expect(page.locator(target)).toBeVisible();
        // Page keys keep the browser's default scroll, which may still settle
        // when the final Home restores Schedule. Measure only the preceding keys.
        if (index < 8) expect(await page.evaluate(() => window.scrollY), `Scroll after ${step.key}`).toBe(before);
    }
}

/** Retain an inspectable screenshot and complete visible text/control measures. */
export async function captureActivityPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[], creation = false) {
    await expectUsableFrontendLayout(surface);
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
    return creation ? projectCreationPermissionDisclosure(surface, measured) : measured;
}

/** Preserve the raw schedule and assert its visible saved-slot total. */
export async function captureActivitySchedulePresentation(page: Page, info: TestInfo, name: string,
    surface: Locator, total: number) {
    const selectors = ['h4', 'th', 'small', 'strong', '.badge', '[data-count]', '[data-max]', '.slot', 'button', 'a'];
    const measured = await captureActivityPresentation(page, info, name, surface, selectors);
    const badge = surface.locator('.fs-6').filter({has: page.locator('.bi-card-checklist')}).locator('.badge').first();
    await expect(badge).toHaveText(String(total));
    await expect(badge).toBeVisible();
    return measured;
}

/** Keep complete creation evidence and verify the five visible initial-slot
 * labels, their exact control associations and localized removal action. */
export async function captureActivityCreationPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    locale: Locale = 'en') {
    const selectors = ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button'];
    const measured = await captureActivityPresentation(page, info, name, surface, selectors, true);

    const messages = createTranslator(locale);
    const labels = [messages.t('packing.title') + ' *', messages.t('packing.description'),
    messages.t('activity.startTime'), messages.t('activity.endTime'), messages.t('activity.maxParticipants')];
    const failures = await surface.evaluate(function inspectInitialSlotLabels(element, expected) {
        const root = element as HTMLElement;
        const failures: string[] = [];
        const slots = root.querySelectorAll<HTMLElement>('#slotArea .slot');
        if (!slots.length) failures.push('No initial slot to review');

        // Every initial field has exactly one readable label inside its slot.
        for (const slot of slots) {
            const controls = slot.querySelectorAll<HTMLInputElement>('input');
            if (controls.length !== 5 || slot.querySelectorAll('label').length !== 5) {
                failures.push('Initial slot must contain exactly five labelled controls');
                continue;
            }
            for (const [index, control] of Array.from(controls).entries()) {
                const label = control.labels?.[0];
                if (control.labels?.length !== 1 || !label || label.control !== control
                    || !control.id || document.getElementById(control.id) !== control || !slot.contains(label)
                    || label.innerText.replace(/\s+/gu, ' ').trim() !== expected.labels[index]) {
                    failures.push(`Incorrect initial-slot label ${index + 1}`);
                    continue;
                }
                const box = label.getBoundingClientRect();
                const boundary = slot.getBoundingClientRect();
                if (!label.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true})
                    || label.classList.contains('visually-hidden') || box.width <= 0 || box.height <= 0
                    || box.left < boundary.left - 1 || box.right > boundary.right + 1
                    || label.scrollWidth > label.clientWidth + 1) failures.push(`Unreadable initial-slot label ${index + 1}`);
            }
            const remove = slot.querySelectorAll('button');
            if (remove.length !== 1 || remove[0]!.getAttribute('aria-label') !== expected.removeLabel)
                failures.push('Initial slot removal must keep its localized accessible name');
        }

        return failures;
    }, {labels, removeLabel: messages.t('packing.removeRow')});
    expect(failures, 'Initial-slot labels must remain visible and associated').toEqual([]);
    return measured;
}

/** Preview and join through admitted HTTP to prepare a real sibling commitment.
 * Explicit fixture confirmation is separate from the browser review under test. */
export async function assignActivityForE2E(request: APIRequestContext, planId: string, slotId: string): Promise<void> {
    const endpoint = `/api/v1/activity-plans/${planId}/slots/${slotId}`;
    const preview = await request.post(`${endpoint}/warnings`, {headers: await commandHeadersForE2E(request), data: {}});
    expect(preview.status()).toBe(200);
    const data = await preview.json() as components['schemas']['ActivityWarningPreview'];
    const assigned = await request.put(`${endpoint}/self-assignment`, {
        headers: await commandHeadersForE2E(request), data: {assigned: true, overlapConfirmation: data.overlapConfirmation},
    });
    expect(assigned.status()).toBe(200);
}

/** Prepare two Event-linked plans whose real participant has one persisted
 * sibling commitment for the warning and confirmation workflow. */
export async function createActivityOverlapForE2E(request: APIRequestContext) {
    const event = await createFrontendEventFixture(request);
    expect((await request.put(`/api/v1/events/${event.id}/registration`, {
        headers: await commandHeadersForE2E(request),
        data: {arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT']},
    })).status()).toBe(200);
    const target = await createActivityForE2E(request, event.id);
    const sibling = await createActivityForE2E(request, event.id);
    await assignActivityForE2E(request, sibling.id, sibling.view.slots[0]!.id);
    return {target, sibling};
}

/** Capture the current slot baseline before one sparse fixture edit. The actual
 * comparison token preserves the same lost-update boundary as the browser. */
export async function patchActivitySlotForE2E(request: APIRequestContext, planId: string, slotId: string,
    values: components['schemas']['ActivitySlotPatch']): Promise<void> {
    const endpoint = `/api/v1/activity-plans/${planId}/slots/${slotId}`;
    const baseline = await request.get(`${endpoint}/edit-baseline`, {headers: await commandHeadersForE2E(request)});
    expect(baseline.status()).toBe(200);
    const {editToken} = await baseline.json() as components['schemas']['ActivitySlotBaseline'];
    const response = await request.patch(endpoint, {
        headers: {...await commandHeadersForE2E(request), 'If-Match': editToken}, data: values,
    });
    expect(response.status()).toBe(200);
}

/** Obtain a newly persisted role from the real read model after its invariant
 * mutation receipt, without depending on the retired native response envelope. */
export async function createActivityRoleForE2E(request: APIRequestContext, planId: string, name: string): Promise<string> {
    const response = await request.post(`/api/v1/activity-plans/${planId}/roles`, {
        headers: await commandHeadersForE2E(request), data: {name},
    });
    expect(response.status()).toBe(200);
    const view = await readActivityForE2E(request, planId);
    const matching = view.allRoles.filter(role => role.title === name);
    expect(matching).toHaveLength(1);
    return matching[0]!.id;
}
