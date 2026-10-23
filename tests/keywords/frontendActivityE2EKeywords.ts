import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import type {Locale} from '../../src/types/LocalizationTypes';
import {createTranslator} from '../../src/modules/localization/translator';
import {createE2EActivityPlan, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, projectCreationPermissionDisclosure, readVisiblePresentation, expectUsableFrontendLayout} from './e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';

/** Create production records through the unchanged native form. The resulting
 * actor and records are shared by the native comparator and built Vue routes. */
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
    // Keyboard entry starts at the selected roving tab. Focusing an inactive
    // native tab before its load-time initializer runs can bypass its real owner;
    // the selected Rules tab was already activated through the actual click.
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
    selectors: string[], creation = false) {
    if (new URL(page.url()).pathname.startsWith('/frontend-pilot')) await expectUsableFrontendLayout(surface);
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

/** Preserve raw schedule evidence and verify R9's approved total separately.
 * Bootstrap hides native's empty badge. After asserting the real visible Vue
 * total, omit only that added node from the comparison value. The live DOM and
 * artifacts stay untouched; all other text, controls and styles stay covered. */
export async function captureActivitySchedulePresentation(page: Page, info: TestInfo, name: string,
    surface: Locator, total: number) {
    const selectors = ['h4', 'th', 'small', 'strong', '.badge', '[data-count]', '[data-max]', '.slot', 'button', 'a'];
    const measured = await captureActivityPresentation(page, info, name, surface, selectors);
    const badge = surface.locator('.fs-6').filter({has: page.locator('.bi-card-checklist')}).locator('.badge').first();
    const pilot = new URL(page.url()).pathname.startsWith('/frontend-pilot');
    await expect(badge).toHaveText(pilot ? String(total) : '');
    if (!pilot) return measured;
    await expect(badge).toBeVisible();

    // Find this exact visible node in the measured selector order. No other
    // empty badge, number or feature text becomes a comparator exception.
    const index = await surface.evaluate(function totalBadgeIndex(root, selectors) {
        const badge = root.querySelector('.bi-card-checklist')?.closest('span')?.querySelector('.badge');
        return Array.from(root.querySelectorAll<HTMLElement>(selectors.join(',')))
            .filter(node => node.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true}))
            .indexOf(badge as HTMLElement);
    }, selectors);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(measured.content.elements[index]!.text).toBe(String(total));
    const label = createTranslator('en').t('activity.slots') + total;
    expect(measured.content.text.split(label)).toHaveLength(2);

    return {...measured, content: {...measured.content,
        text: measured.content.text.replace(label, createTranslator('en').t('activity.slots')),
        elements: measured.content.elements.filter((_element, current) => current !== index)},
        geometry: measured.geometry.filter((_rectangle, current) => current !== index + 1)};
}

/** Keep raw creation evidence while comparing the approved R4/R6 label addition.
 * Native IMP-017 remains open: only Vue's five validated initial-slot label nodes
 * are projected out of the comparator. Controls, constraints, paint and all other
 * text remain covered; the live document and saved evidence are never rewritten. */
export async function captureActivityCreationPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    locale: Locale = 'en') {
    const selectors = ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button'];
    const measured = await captureActivityPresentation(page, info, name, surface, selectors, true);
    if (!new URL(page.url()).pathname.startsWith('/frontend-pilot')) return measured;

    const messages = createTranslator(locale);
    const labels = [messages.t('packing.title') + ' *', messages.t('packing.description'),
        messages.t('activity.startTime'), messages.t('activity.endTime'), messages.t('activity.maxParticipants')];
    const projection = await surface.evaluate(function compareInitialSlotLabels(element, expected) {
        const root = element as HTMLElement;
        const failures: string[] = [];
        const omitted = new Set<HTMLElement>();
        // Its separate shared projection already checked the opened disclosure.
        // Retain the same exact heading exception while reviewing slot labels.
        const permissionHeading = root.querySelector<HTMLElement>('[data-creation-permissions] .accordion-header');
        if (permissionHeading) omitted.add(permissionHeading);
        const slots = root.querySelectorAll<HTMLElement>('#slotArea .slot');
        if (!slots.length) failures.push('No initial slot to review');

        // Admit only the exact added field set. An extra, hidden or incorrectly
        // associated label is a failure, never another comparator exception.
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
                omitted.add(label);
            }
            const remove = slot.querySelectorAll('button');
            if (remove.length !== 1 || remove[0]!.getAttribute('aria-label') !== expected.removeLabel)
                failures.push('Initial slot removal must keep its localized accessible name');
        }

        /** Read complete unaffected subtrees through their original innerText.
         * Descend only around the exact admitted label nodes, retaining every
         * other text subtree and block separation without matching label words. */
        function comparisonText(current: HTMLElement): string {
            if (omitted.has(current)) return '';
            if (!Array.from(omitted).some(label => current.contains(label))) return current.innerText;
            // Only a containing ancestor needs decomposition. Unaffected child
            // subtrees keep the browser's original rendered text as one piece.
            const parts: string[] = [];
            for (const child of current.childNodes) {
                if (child instanceof HTMLElement) parts.push(comparisonText(child));
                else if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? '');
            }
            return parts.join(' ');
        }

        const elements = Array.from(root.querySelectorAll<HTMLElement>(expected.selectors.join(',')))
            .filter(node => node.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true})
                && !permissionHeading?.contains(node));
        return {failures, text: comparisonText(root).replace(/\s+/gu, ' ').trim(),
            elements: elements.map((node, index) => ({index, omitted: omitted.has(node),
                text: comparisonText(node).replace(/\s+/gu, ' ').trim()}))};
    }, {selectors, labels, removeLabel: messages.t('packing.removeRow')});
    expect(projection.failures, 'Approved initial-slot labels must remain visible and associated').toEqual([]);
    expect(projection.elements).toHaveLength(measured.content.elements.length);

    // Return a separate comparison value. The screenshot and raw measured JSON
    // above still include every new label, position and original field property.
    const retained = projection.elements.filter(element => !element.omitted);
    return {content: {...measured.content, text: projection.text,
        elements: retained.map(element => ({...measured.content.elements[element.index]!, text: element.text}))},
        geometry: [measured.geometry[0]!, ...retained.map(element => measured.geometry[element.index + 1]!)]};
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
