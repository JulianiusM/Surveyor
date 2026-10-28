import {patchActivitySlotForE2E} from '../keywords/frontendActivityE2EKeywords';
import {commandHeadersForE2E} from '../keywords/e2eCoreKeywords';
import {expect, test, type Locator, type Route} from '@playwright/test';
import type {components} from '../../src/types/api/v1';
import {createTranslator} from '../../src/common/localization/translator';
import {expectUsableFrontendLayout, readControlContracts} from '../keywords/e2eCoreKeywords';
import {createActivityOverlapForE2E, expectActivityTabKeyboard, observeActivityCommand,
    readActivityForE2E} from '../keywords/frontendActivityE2EKeywords';
import {captureAdvancedActivityPresentation, createActivitySwapPairsForE2E, createAdvancedActivityForE2E, openActivityRulesForE2E, readActivityRecommendationsForE2E,
    readActivityRequirementsForE2E, stageActivitySwapForE2E, savePendingActivityRecommendationsForE2E} from '../keywords/frontendActivityAdvancedE2EKeywords';
import {createBrowserReadGate, waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';

/** Check a real control's visible hit target without dispatching its operation.
 * Browser scrolling is allowed to reveal it; its center must remain unobscured. */
async function expectReachableActivityControl(control: Locator): Promise<void> {
    await expect(control).toBeVisible();
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    // Trial clicks run the browser's ordinary actionability and hit-target checks
    // while leaving the current saved state and command count unchanged.
    await control.click({trial: true});
    expect(await control.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return !!hit && element.contains(hit);
    })).toBe(true);
}

// Protect the restored native terminology alongside the real numeric controls.
const activityRequirementWording = [
    'Define exact required shifts and optional participant overrides. Required mode needs one saved value for every possible stay duration.',
    'Baseline shift requirement',
    'Exact shifts by days present',
    'Set per-role required shift counts',
    'Specify event participant-specific required shifts and optional role-scoped overrides. Only registered participants are eligible for overrides.',
    'Required shifts',
] as const;

/** Assert the requirement labels, values, constraints and readable geometry. */
async function expectActivityRequirementWording(requirements: Locator, days: number): Promise<void> {
    for (const current of activityRequirementWording)
        await expect(requirements.getByText(current, {exact: true})).toBeVisible();
    await expect(requirements.getByText(/^Required shifts: \d+$/u)).toHaveCount(1);
    const baseline = requirements.getByRole('spinbutton', {name: 'Baseline shift requirement', exact: true});
    const override = requirements.getByRole('spinbutton', {name: 'Required shifts', exact: true});
    for (const [control, value] of [[baseline, '2'], [override, '1']] as const)
        expect(await readControlContracts(control)).toMatchObject([{type: 'number', value, min: 0, step: 1, disabled: false}]);
    for (let day = 1; day <= days; day++) {
        const control = requirements.getByRole('spinbutton', {name: `Required shifts for a ${day}-day stay`, exact: true});
        expect(await readControlContracts(control)).toMatchObject([{type: 'number', min: 0, step: 1,
            value: day === 1 ? '0' : day === days ? '2' : '1', disabled: false}]);
    }
    for (const [label, control] of [[requirements.locator('label[for="requiredShifts"]'), baseline],
        [requirements.getByText('Required shifts', {exact: true}), override]] as const) {
        const labelBounds = (await label.boundingBox())!;
        const controlBounds = (await control.boundingBox())!;
        expect(labelBounds.width).toBeGreaterThan(0);
        expect(controlBounds.y).toBeGreaterThanOrEqual(labelBounds.y + labelBounds.height - 1);
        expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await expectUsableFrontendLayout(requirements);
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390]) {
        test(`retains ${locale} Rules Reload focus without a spinner or scroll jump at ${width}px`, async ({page}) => {
            await page.setViewportSize({width, height: 900});
            const plan = await createAdvancedActivityForE2E(page.request);
            const messages = createTranslator(locale);
            await page.goto(`${plan.path}?locale=${locale}`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            await page.getByRole('tab', {name: messages.t('activity.rules'), exact: true}).click();
            await expect(page.locator('[data-requirements-dirty]')).toHaveText(messages.t('activity.requirements.savedBadge'));
            const reload = page.locator('[data-requirements-refresh]');
            const readProgress = page.locator('#requirementPanel').getByRole('status')
                .filter({hasText: messages.t('common.loading')});
            const otherControl = page.locator('#requiredShifts');
            const endpoint = (url: URL) => url.pathname === `/api/v1/activity-plans/${plan.id}/requirements`;

            // Hold only delivery of a genuine authorized backend response. Both
            // cycles use the built application, session and saved requirements;
            // no client fixture can stand in for this integrated read workflow.
            for (const moveFocus of [false, true]) {
                const delivery = createBrowserReadGate();
                const received = createBrowserReadGate();
                const delivered = createBrowserReadGate();
                let intercepted = false;
                async function holdRequirementsDelivery(route: Route): Promise<void> {
                    if (route.request().method() !== 'GET') return route.continue();
                    intercepted = true;
                    try {
                        // The ordinary editor now requests its first saved-stay
                        // page explicitly. Keep query validation separate from
                        // route matching so a changed query fails this assertion.
                        const url = new URL(route.request().url());
                        expect(url.searchParams.getAll('page')).toEqual(['1']);
                        expect(url.searchParams.getAll('section')).toEqual(['stays']);
                        const response = await route.fetch();
                        expect(response.status()).toBe(200);
                        received.release();
                        await delivery.promise;
                        await route.fulfill({response});
                    } finally { delivered.release(); }
                }
                await page.route(endpoint, holdRequirementsDelivery);
                try {
                    await reload.scrollIntoViewIfNeeded();
                    await reload.focus();
                    await expect(reload).toBeFocused();
                    const originalButton = await reload.elementHandle();
                    const before = await page.evaluate(() => ({x: scrollX, y: scrollY}));
                    await reload.click();
                    await received.promise;
                    await expect(reload).toBeDisabled();
                    await expect(reload).toHaveAttribute('aria-busy', 'true');
                    await expect(reload.locator('.spinner-border')).toHaveCount(0);
                    // Reload retains its compact appearance while the owned read
                    // shows progress next to the saved configuration and draft.
                    await expect(readProgress).toBeVisible();

                    // Chromium drops native disabled-button focus to BODY. A
                    // deliberate later focus owner must cancel restoration.
                    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
                    // Deliberate focus cancels restoration. Keep its own native
                    // smooth scrolling out of the completion-only measurement.
                    if (moveFocus) {
                        await otherControl.evaluate(function focusWithoutScrolling(control) {
                            (control as HTMLInputElement).focus({preventScroll: true});
                        });
                    }
                    const waiting = moveFocus ? await page.evaluate(() => ({x: scrollX, y: scrollY})) : before;
                    const completion = page.waitForResponse(response => response.request().method() === 'GET'
                        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/requirements`);
                    delivery.release();
                    expect((await completion).status()).toBe(200);
                    await expect(reload).toBeEnabled();
                    await expect(reload).toHaveAttribute('aria-busy', 'false');
                    await expect(readProgress).toHaveCount(0);
                    if (moveFocus) await expect(otherControl).toBeFocused();
                    else {
                        await expect(reload).toBeFocused();
                        expect(await originalButton!.evaluate(element => element === document.activeElement)).toBe(true);
                    }
                    const after = await page.evaluate(() => ({x: scrollX, y: scrollY}));
                    expect(after.x).toBe(waiting.x);
                    expect(after.y).toBe(waiting.y);
                } finally {
                    delivery.release();
                    await page.unroute(endpoint, holdRequirementsDelivery);
                    if (intercepted) await delivered.promise;
                }
            }
        });
    }
}

for (const width of [1280, 390]) {
    test(`shows saved Rules, coverage, recommendation review and manual moves at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        const dialogs: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
        const plan = await createAdvancedActivityForE2E(page.request, {assigned: true, recommendation: true});
        await page.request.get('/users/profile');


        // Review the real actor's saved inputs, provenance and schedule.
        {
            const prefix = 'vue';
            await openActivityRulesForE2E(page, plan);
            // Entry maintenance reads saved recommendations. A read must not
            // claim a new save through the common page notification owner.
            await expect(page.getByRole('alert').filter({hasText: /^Saved$/u})).toHaveCount(0);
            await expectActivityTabKeyboard(page);
            await (page.getByRole('tab', {name: 'Rules & auto-assign', exact: true})).click();

            await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(1);
            await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-rules`,
                page.locator('#requirementPanel'), ['.card-header', 'p', 'strong', 'small', 'h6', 'label',
                    'input:not([type="hidden"])', 'select', 'button', '.badge']);
            await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-coverage`,
                page.locator('#requirement-participant-status'), ['p', 'input', 'button', '.badge', '.participant-status-cell']);
            // Protect this known warning's rendered readiness independently of
            // the admitted recommendation row before preserving pixels and JSON.
            await expect(page.locator('#recommendationScheduleView [data-rec-id]')
                .getByText('This slot is on your arrival day.', {exact: true})).toBeVisible();
            await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-recommendations`,
                page.locator('#recommendationPanel'), ['.card-header', 'h5', 'p', '.status-notice', 'small', '.badge', 'th', 'button',
                    '[data-slot-id]', '[data-rec-id]', '[data-recommendation-warnings]']);

            const opener = page.locator(`.slot[data-slot-id="${plan.view.slots[1]!.id}"] [data-add-recommendation]`);
            const modal = page.locator('#addRecommendationModal');
            await opener.click();
            await modal.locator('#addRecommendationOperation').selectOption('REASSIGN');
            await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
            const preview = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname.endsWith('/recommendations/warnings'));
            await modal.locator('#addRecommendationSource').selectOption(plan.view.slots[0]!.id);
            expect((await preview).status()).toBe(200);
            // A real response and its visible warning are separate assertions
            // in this capture contract; preserve both without a timing guess.
            await expect(modal.locator('[data-add-warning]')
                .getByText('This slot is on your arrival day.', {exact: true})).toBeVisible();
            await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-move-dialog`,
                modal, ['.modal-title', 'label', 'select', '[data-add-warning]', 'button']);
            await modal.locator('.modal-header .btn-close').click();
            await expect(modal).not.toBeVisible();

            await expectActivityRequirementWording(page.locator('#requirementPanel'), plan.days);
        }
        expect(errors).toEqual([]);
        expect(dialogs).toEqual([]);
    });
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [320, 390, 1280]) {
        test(`keeps ${locale} Rules headings, actions and manual controls usable at ${width}px`, async ({page}, info) => {
            await page.setViewportSize({width, height: 900});
            const messages = createTranslator(locale);
            const plan = await createAdvancedActivityForE2E(page.request, {assigned: true, recommendation: true});
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${plan.path}?locale=${locale}`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            await page.getByRole('tab', {name: messages.t('activity.rules'), exact: true}).click();
            await expect(page.locator('#stayRequirementList input[data-stay-days]')).toHaveCount(plan.days);
            await expect(page.locator('[data-requirements-dirty]')).toHaveText(messages.t('activity.requirements.savedBadge'));
            const requirements = page.locator('#requirementPanel');
            const recommendations = page.locator('#recommendationPanel');
            await expect(recommendations.locator('[data-rec-id]')).toHaveCount(1);

            // Domain provenance stays machine data; both saved and unsaved
            // coverage display its catalog label without translating profile names.
            const coverage = page.locator('#requirement-participant-status');
            await expect(coverage.locator(`[data-participant-key="profile:${plan.owner.id}"] .text-uppercase`))
                .toHaveText(messages.t('activity.requirementSource.override'));
            await expect(coverage.locator(`[data-participant-key="profile:${plan.other.id}"] .text-uppercase`))
                .toHaveText(messages.t('activity.requirementSource.general'));
            await expect(page.getByLabel(messages.t('activity.requirements.mode'), {exact: true})).toHaveValue('REQUIRED');
            await expect(page.getByLabel(messages.t('activity.requirements.baseline'), {exact: true})).toHaveValue('2');
            await expect(page.getByLabel(messages.t('activity.requirements.rounding'), {exact: true})).toHaveValue('CEIL');
            await expect(page.getByLabel(messages.t('activity.requirements.deadline'), {exact: true})).toBeVisible();
            // Visible field labels name the actual controls in every locale;
            // copied native missing associations are not preservation contracts.
            await expect(requirements.getByRole('spinbutton', {name: 'Kitchen lead', exact: true})).toHaveValue('0');
            const savedOverride = requirements.locator('.override-row').first();
            await expect(savedOverride.getByLabel(messages.t('activity.participant'), {exact: true}))
                .toHaveValue('profile:' + plan.owner.id);
            await expect(savedOverride.getByLabel(messages.t('activity.requirements.optionalRole'), {exact: true})).toHaveValue('');
            await expect(savedOverride.getByLabel(messages.t('activity.requirements.requiredShifts'), {exact: true})).toHaveValue('1');
            await expectUsableFrontendLayout(requirements);
            await expectUsableFrontendLayout(coverage);
            await expectReachableActivityControl(page.locator('[data-requirements-refresh]'));

            // Exercise the compact override controls themselves, including their
            // real remove action, rather than certifying an empty form's geometry.
            await page.locator('[data-add-override]').click();
            const addedOverride = page.locator('.override-row').last();
            await addedOverride.locator('[data-override-target="participant"]').selectOption(`profile:${plan.other.id}`);
            await addedOverride.locator('[data-override-target="required"]').fill('0');
            await expectUsableFrontendLayout(addedOverride);
            const remove = addedOverride.getByRole('button', {name: messages.t('activity.requirements.removeOverride'), exact: true});
            await expectReachableActivityControl(remove);
            await remove.click();
            await expect(page.locator('.override-row')).toHaveCount(1);

            await page.locator('#assignmentMode').selectOption('FREE');
            await expect(page.getByRole('button', {name: messages.t('activity.recommendations.auto'), exact: true})).toBeDisabled();
            await page.locator('#assignmentMode').selectOption('REQUIRED');
            await page.locator('#requiredShifts').fill('0');
            for (const input of await page.locator('#stayRequirementList input[data-stay-days]').all()) await input.fill('0');
            const save = page.getByRole('button', {name: messages.t('activity.requirements.saveSettings'), exact: true});
            await expectReachableActivityControl(save);
            await observeActivityCommand(page, plan.id, '/requirements', 'PUT', () => save.click());
            expect((await readActivityRequirementsForE2E(page.request, plan.id)).plan.generalRequiredShifts).toBe(0);
            await expect(page.locator('[data-requirements-dirty]')).toHaveText(messages.t('activity.requirements.savedBadge'));
            // Keep the existing receipt-expiry check. Its overlay must not conceal
            // a clipped action or heading in the stable saved layout below.
            const savedNotice = page.getByRole('alert').filter({hasText: messages.t('activity.requirements.saved')});
            await expect(savedNotice).toBeVisible();
            await expect(savedNotice).not.toBeVisible({timeout: 15000});
            await expectUsableFrontendLayout(requirements);
            await captureAdvancedActivityPresentation(page, info, `vue-${locale}-${width}-rules`, requirements,
                ['.card-header', 'h6', 'small', 'label', 'input:not([type="hidden"])', 'select', 'button', '.badge']);

            await expectUsableFrontendLayout(recommendations);
            for (const action of ['refresh', 'auto', 'apply'])
                await expectReachableActivityControl(page.locator(`[data-recommendations-${action}]`));
            await captureAdvancedActivityPresentation(page, info, `vue-${locale}-${width}-recommendations`, recommendations,
                ['.card-header', 'h5', 'p', '.status-notice', 'small', '.badge', 'button']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);

            const add = page.locator(`.slot[data-slot-id="${plan.view.slots[1]!.id}"] [data-add-recommendation]`);
            await expectReachableActivityControl(add);
            await add.click();
            const modal = page.locator('#addRecommendationModal');
            await expect(modal.getByRole('heading', {name: messages.t('activity.recommendations.add'), exact: true})).toBeVisible();
            await modal.locator('#addRecommendationOperation').selectOption('REASSIGN');
            await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
            await modal.locator('#addRecommendationSource').selectOption(plan.view.slots[0]!.id);
            const stage = modal.getByRole('button', {name: messages.t('activity.recommendations.stage'), exact: true});
            await expect(stage).toBeEnabled();
            await expectUsableFrontendLayout(modal);
            await expectReachableActivityControl(stage);
            await captureAdvancedActivityPresentation(page, info, `vue-${locale}-${width}-manual-dialog`, modal,
                ['.modal-title', 'label', 'select', '[data-add-warning]', 'button']);
            page.once('dialog', dialog => dialog.accept());
            await modal.locator('.modal-header .btn-close').click();
            await expect(modal).not.toBeVisible();
            expect(errors).toEqual([]);
        });
    }
}

test('saves zero requirements and overrides, recovers a dirty draft, and applies a generated exact batch in one document', async ({page}) => {
    test.setTimeout(60000);
    const plan = await createAdvancedActivityForE2E(page.request);
    const maintenance: string[] = [];
    const observedJobs: string[] = [];
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.endsWith(`/activity-plans/${plan.id}/recommendations/entry`)) maintenance.push(pathname);
        if (request.method() === 'GET' && pathname.includes(`/activity-plans/${plan.id}/recommendations/auto/`)) observedJobs.push(pathname);
    });
    await openActivityRulesForE2E(page, plan);
    // Live mode gates generation before saving, just as the native preview does.
    // It must not silently write the persisted Required-mode configuration.
    await page.locator('#assignmentMode').selectOption('FREE');
    await expect(page.locator('[data-recommendations-auto]')).toBeDisabled();
    expect((await readActivityRequirementsForE2E(page.request, plan.id)).plan.assignmentMode).toBe('REQUIRED');
    await page.locator('#assignmentMode').selectOption('REQUIRED');
    await expect(page.locator('[data-recommendations-auto]')).toBeEnabled();
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-advanced';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });

    // Calculate edits only the local table. Its result is still unsaved; then
    // explicitly choose zero for every duration and one participant override.
    await page.locator('#requiredShifts').fill('0');
    await page.locator('[data-requirements-baseline-calc]').click();
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Unsaved changes');
    expect((await readActivityRequirementsForE2E(page.request, plan.id)).plan.generalRequiredShifts).toBe(2);
    await page.locator('#requiredShifts').fill('0');
    for (let day = 1; day <= plan.days; day += 1)
        await page.locator(`#stayRequirementList [data-stay-days="${day}"]`).fill('0');
    await page.locator('[data-add-override]').click();
    await page.locator('[data-override-target="participant"]').selectOption(`profile:${plan.owner.id}`);
    await page.locator('[data-override-target="required"]').fill('0');
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Unsaved changes');
    const savedZero = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/requirements`);
    await page.locator('[data-requirements-save]').last().click();
    expect((await savedZero).status()).toBe(200);
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Saved');
    const zero = await readActivityRequirementsForE2E(page.request, plan.id);
    expect(zero.plan.generalRequiredShifts).toBe(0);
    expect(zero.stayRequirements).toHaveLength(plan.days);
    expect(zero.stayRequirements.every(requirement => requirement.requiredShifts === 0)).toBe(true);
    expect(zero.overrides).toContainEqual(expect.objectContaining({profileId: plan.owner.id, requiredShifts: 0}));
    expect(zero.participants.every(participant => participant.requiredShifts === 0)).toBe(true);

    // Declining Reload keeps the exact visible draft. Accepting it releases the
    // draft only when the saved values have been read again.
    await page.locator('#requiredShifts').fill('7');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('[data-requirements-refresh]').click();
    await expect(page.locator('#requiredShifts')).toHaveValue('7');
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Unsaved changes');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-requirements-refresh]').click();
    await expect(page.locator('#requiredShifts')).toHaveValue('0');
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Saved');

    // The zero override wins while the other registration receives one saved
    // shift. Generation dispatches once; only that domain job is observed.
    await page.locator('#requiredShifts').fill('1');
    for (let day = 1; day <= plan.days; day += 1)
        await page.locator(`#stayRequirementList [data-stay-days="${day}"]`).fill('1');
    await observeActivityCommand(page, plan.id, '/requirements', 'PUT',
        () => page.locator('[data-requirements-save]').last().click());
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Saved');
    expect(maintenance).toHaveLength(1);
    const dispatched = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/recommendations/auto`);
    await page.locator('[data-recommendations-auto]').click();
    const accepted = await dispatched;
    expect(accepted.status()).toBe(202);
    const {job} = await accepted.json() as {job: {id: string}};
    const row = page.locator('#recommendationScheduleView [data-rec-id]');
    await expect(row).toHaveCount(1);
    await expect.poll(() => maintenance.length).toBe(2);
    expect(observedJobs.length).toBeGreaterThan(0);
    expect(observedJobs.every(path => path.endsWith(`/auto/${job.id}`))).toBe(true);
    await row.locator('button[title="Approve"]').click();
    const previewed = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/recommendations/warnings`);
    const applied = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/recommendations/apply`);
    await page.locator('[data-recommendations-apply]').click();
    const preview = await previewed;
    expect(preview.status()).toBe(200);
    const result = await applied;
    expect(result.status()).toBe(200);
    expect(result.request().postDataJSON().recommendations).toEqual(preview.request().postDataJSON().recommendations);
    expect(result.request().postDataJSON().recommendations[0]).toMatchObject({status: 'APPROVED', manual: false});
    expect(await result.json()).toMatchObject({applied: 1, skipped: 0});
    await expect.poll(async () => (await readActivityForE2E(page.request, plan.id)).slots.reduce((total, slot) => total + slot.assignedCount, 0)).toBe(1);
    const persisted = await readActivityRecommendationsForE2E(page.request, plan.id);
    expect(persisted.existingAssignments.map(assignment => assignment.profile.id)).toEqual([plan.other.id]);
    expect(persisted.recommendations).toEqual([]);
    // Native generation completion and the post-application document entry each
    // maintain once. The SPA preserves those triggers without document reloads.
    await expect.poll(() => maintenance.length).toBe(3);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-advanced');
    expect(navigation).toEqual([]);
});

test('observes the initially queued deadline job and adopts saved proposals without another generation trigger', async ({page}) => {
    const plan = await createAdvancedActivityForE2E(page.request);
    const requirements = await readActivityRequirementsForE2E(page.request, plan.id);
    // Set a real past deadline through the existing settings owner, with no
    // recommendation history. The first Vue entry must cause the domain queue.
    const saved = await page.request.put(`/api/v1/activity-plans/${plan.id}/requirements`, {
        headers: await frontendEventHeaders(page.request), data: {
            assignmentMode: requirements.plan.assignmentMode, generalRequiredShifts: requirements.plan.generalRequiredShifts,
            roundingMode: requirements.plan.roundingMode,
            bindingDeadline: '2000-01-01T00:00:00.000Z',
            allowOverfillAfterFull: requirements.plan.allowOverfillAfterFull,
            allowExternalAssignees: requirements.plan.allowExternalAssignees,
            allowArrivalDayEvening: requirements.plan.allowArrivalDayEvening,
            allowDepartureDayMorning: requirements.plan.allowDepartureDayMorning,
            roleRequirements: requirements.roleRequirements.map(row => ({roleId: row.roleId, requiredShifts: row.requiredShifts})),
            stayRequirements: requirements.stayRequirements,
            overrides: requirements.overrides.map(row => ({profileId: row.profileId, roleId: row.roleId, requiredShifts: row.requiredShifts})),
        },
    });
    expect(saved.status()).toBe(200);
    const requests: Array<{method: string; path: string}> = [];
    page.on('request', request => requests.push({method: request.method(), path: new URL(request.url()).pathname}));
    const entered = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/activity-plans/${plan.id}/recommendations/entry`));
    await openActivityRulesForE2E(page, plan);
    const entry = await entered;
    expect(entry.status()).toBe(200);
    const workspace = await entry.json() as {autoGenerationJob: {id: string}};
    expect(workspace.autoGenerationJob.id).toBeTruthy();
    await expect(page.locator('#recommendationScheduleView [data-rec-id]').first()).toBeVisible();
    await expect.poll(() => requests.some(request => request.method === 'GET'
        && request.path.endsWith(`/recommendations/auto/${workspace.autoGenerationJob.id}`))).toBe(true);
    expect(requests.filter(request => request.path.endsWith('/recommendations/entry'))).toHaveLength(1);
    expect(requests.filter(request => request.method === 'POST' && request.path.endsWith('/recommendations/auto'))).toEqual([]);
    expect(requests.some(request => request.method === 'GET' && request.path.endsWith(`/activity-plans/${plan.id}/recommendations`))).toBe(true);
});

test('keeps both manual swap legs together and saves swap, unassignment and assignment without reloading', async ({page}) => {
    test.setTimeout(60000);
    const plan = await createAdvancedActivityForE2E(page.request, {assigned: true, secondAssigned: true});
    await openActivityRulesForE2E(page, plan);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-swaps';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    const [first, second] = plan.view.slots;

    /** Stage the public modal's complete reciprocal move, preserving its sources
     * until the reviewed application commits both legs together. */
    async function stageSwap(): Promise<void> {
        await stageActivitySwapForE2E(page, {sourceSlotId: first!.id, targetSlotId: second!.id,
            profileId: plan.owner.id, counterpartId: plan.other.id});
        await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(2);
    }
    await stageSwap();
    const rows = page.locator('#recommendationScheduleView [data-rec-id]');
    await rows.first().locator('button[title="Revert to Pending"]').click();
    await expect(rows.locator('.badge').filter({hasText: /^Pending$/u})).toHaveCount(2);
    await rows.first().locator('button[title="Approve"]').click();
    await expect(rows.locator('.badge').filter({hasText: /^Approved$/u})).toHaveCount(2);
    await rows.first().getByRole('button', {name: /Remove manual operation/u}).click();
    await expect(rows).toHaveCount(0);
    await stageSwap();
    const swapping = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/recommendations/apply`);
    await page.locator('[data-recommendations-apply]').click();
    const swapped = await swapping;
    expect(swapped.status()).toBe(200);
    const batch = swapped.request().postDataJSON().recommendations as components['schemas']['ActivityRecommendationReview']['recommendations'];
    expect(batch).toHaveLength(2);
    expect(batch).toEqual(expect.arrayContaining([
        expect.objectContaining({operation: 'REASSIGN', itemId: first!.id, sourceItemId: second!.id}),
        expect.objectContaining({operation: 'REASSIGN', itemId: second!.id, sourceItemId: first!.id}),
    ]));
    expect(batch[0]!.swapGroup).toEqual(expect.any(String));
    expect(batch[0]!.swapGroup).not.toBe('');
    expect(batch[1]!.swapGroup).toBe(batch[0]!.swapGroup);
    expect(await swapped.json()).toMatchObject({applied: 2, skipped: 0});
    await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments)
        .toEqual(expect.arrayContaining([
            expect.objectContaining({item: expect.objectContaining({id: second!.id}), profile: expect.objectContaining({id: plan.owner.id})}),
            expect.objectContaining({item: expect.objectContaining({id: first!.id}), profile: expect.objectContaining({id: plan.other.id})}),
        ]));

    await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(0);
    await page.locator(`.slot[data-slot-id="${second!.id}"] [data-unassign-recommendation][data-profile-id="${plan.owner.id}"]`).click();
    await observeActivityCommand(page, plan.id, '/recommendations/apply', 'POST',
        () => page.locator('[data-recommendations-apply]').click());
    await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments.length).toBe(1);
    await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(0);
    await page.locator(`.slot[data-slot-id="${first!.id}"] [data-add-recommendation]`).click();
    const modal = page.locator('#addRecommendationModal');
    await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
    await modal.getByRole('button', {name: 'Stage as approved', exact: true}).click();
    await observeActivityCommand(page, plan.id, '/recommendations/apply', 'POST',
        () => page.locator('[data-recommendations-apply]').click());
    await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments.length).toBe(2);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-swaps');
    expect(navigation).toEqual([]);
});

for (const scenario of [
    {restored: false, locale: 'en', width: 1280, label: 'a newly staged English desktop'},
    {restored: true, locale: 'en', width: 1280, label: 'a restored English desktop'},
    {restored: true, locale: 'de', width: 390, label: 'a restored German mobile'},
] as const) {
    test(`keeps two swaps independent in ${scenario.label} review`, async ({page}, info) => {
        test.setTimeout(60000);
        const {restored, locale} = scenario;
        const messages = createTranslator(locale);
        await page.setViewportSize({width: scenario.width, height: 900});
        const plan = await createActivitySwapPairsForE2E(page.request);
        const [first, second] = plan.view.slots;
        const pairs = [[plan.owner, plan.other], [plan.extraFirst, plan.extraSecond]] as const;

        if (restored) {
            // Save pending rows through the existing review operation, without applying
            // any assignment. Stored REASSIGN rows deliberately have no pair ID.
            const recommendations: components['schemas']['ActivityRecommendationReview']['recommendations'] = [];
            for (const [incoming, outgoing] of pairs) {
                recommendations.push({itemId: second!.id, sourceItemId: first!.id, profileId: incoming.id,
                    status: 'PENDING', operation: 'REASSIGN', manual: true});
                recommendations.push({itemId: first!.id, sourceItemId: second!.id, profileId: outgoing.id,
                    status: 'PENDING', operation: 'REASSIGN', manual: true});
            }
            await savePendingActivityRecommendationsForE2E(page.request, plan.id, recommendations);
            const saved = await readActivityRecommendationsForE2E(page.request, plan.id);
            expect(saved.recommendations).toHaveLength(4);
            for (const recommendation of saved.recommendations) expect(recommendation).not.toHaveProperty('swapGroup');
        }

        await page.goto(`${plan.path}?locale=${locale}`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await page.getByRole('tab', {name: messages.t('activity.rules'), exact: true}).click();
        await expect(page.locator('[data-requirements-dirty]')).toHaveText(messages.t('activity.requirements.savedBadge'));
        const rows = page.locator('#recommendationScheduleView [data-rec-id]');
        if (!restored) {
            for (const [incoming, outgoing] of pairs) {
                await stageActivitySwapForE2E(page, {sourceSlotId: first!.id, targetSlotId: second!.id,
                    profileId: incoming.id, counterpartId: outgoing.id}, messages.t('activity.recommendations.stage'));
            }
        }
        await expect(rows).toHaveCount(4);
        await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'two-activity-swaps';});
        // A row carries its own profile attribute, so direct matching is kept
        // separate from descendants that may contain other assignment controls.
        const selected = page.locator(`#recommendationScheduleView [data-rec-id][data-profile-id="${plan.extraFirst.id}"]`);
        const counterpart = page.locator(`#recommendationScheduleView [data-rec-id][data-profile-id="${plan.extraSecond.id}"]`);
        const originalPair = page.locator(`#recommendationScheduleView [data-rec-id][data-profile-id="${plan.owner.id}"], #recommendationScheduleView [data-rec-id][data-profile-id="${plan.other.id}"]`);
        const chooser = page.locator('#recommendationPairDialog');

        /** Resolve a legacy move through its visible organizer choice. Even a
         * unique reciprocal option must never supply unconfirmed pairing intent. */
        async function confirmSavedSwapCounterpart(profileName: string): Promise<void> {
            await expect(chooser).toBeVisible();
            // Select the intended person, preserving the exact option identity
            // emitted by the current review instead of inventing a pair token.
            const choice = chooser.locator('#recommendationPairCounterpart');
            const option = choice.locator('option').filter({hasText: profileName});
            await expect(option).toHaveCount(1);
            const value = await option.getAttribute('value');
            expect(value).toBeTruthy();
            await choice.selectOption(value!);
            await chooser.locator('#recommendationPairConfirm').click();
            await expect(chooser).not.toBeVisible();
        }

        const action = restored ? 'approve' : 'revert';
        await selected.getByRole('button', {name: messages.t(`activity.recommendations.${action}`), exact: true}).click();

        if (restored) {
            await expect(chooser).toBeVisible();
            await expectUsableFrontendLayout(chooser);
            await captureAdvancedActivityPresentation(page, info, 'restored-swap-counterpart-choice', chooser,
                ['.modal-title', 'p', 'label', 'select', 'button']);
            await chooser.locator('#recommendationPairCancel').click();
            await expect(chooser).not.toBeVisible();
            await expect(rows.locator('.badge').filter({hasText: messages.t('activity.recommendations.pending')})).toHaveCount(4);
            await selected.getByRole('button', {name: messages.t('activity.recommendations.approve'), exact: true}).click();
            await confirmSavedSwapCounterpart(plan.extraSecond.name);
        } else await expect(chooser).not.toBeVisible();

        const selectedStatus = messages.t(restored ? 'activity.recommendations.approved' : 'activity.recommendations.pending');
        const untouchedStatus = messages.t(restored ? 'activity.recommendations.pending' : 'activity.recommendations.approved');
        await expect(selected.locator('.badge').filter({hasText: selectedStatus})).toHaveCount(1);
        await expect(counterpart.locator('.badge').filter({hasText: selectedStatus})).toHaveCount(1);
        await expect(originalPair.locator('.badge').filter({hasText: untouchedStatus})).toHaveCount(2);
        await selected.getByRole('button', {name: messages.t('activity.recommendations.removeFor', {name: plan.extraFirst.name}), exact: true}).click();
        await expect(rows).toHaveCount(2);
        await expect(originalPair).toHaveCount(2);
        await expect(chooser).not.toBeVisible();

        // Recreate only the removed pair. The final reviewed command carries
        // explicit, distinct pair provenance for all four eligible moves.
        await stageActivitySwapForE2E(page, {sourceSlotId: first!.id, targetSlotId: second!.id,
            profileId: plan.extraFirst.id, counterpartId: plan.extraSecond.id}, messages.t('activity.recommendations.stage'));
        await expect(rows).toHaveCount(4);
        if (restored) {
            await page.locator(`#recommendationScheduleView [data-rec-id][data-profile-id="${plan.owner.id}"]`)
                .getByRole('button', {name: messages.t('activity.recommendations.approve'), exact: true}).click();
            await confirmSavedSwapCounterpart(plan.other.name);
        }
        await expect(rows.locator('.badge').filter({hasText: messages.t('activity.recommendations.approved')})).toHaveCount(4);
        const applying = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/recommendations/apply`);
        await page.locator('[data-recommendations-apply]').click();
        const applied = await applying;
        expect(applied.status()).toBe(200);
        expect(await applied.json()).toMatchObject({applied: 4, skipped: 0});
        const submitted = applied.request().postDataJSON().recommendations as Array<Record<string, unknown>>;
        expect(submitted).toHaveLength(4);
        for (const recommendation of submitted) {
            expect(Object.keys(recommendation).sort()).toEqual(expect.arrayContaining(['itemId', 'manual', 'operation', 'profileId', 'sourceItemId', 'status', 'swapGroup']));
            expect(Object.keys(recommendation).every(key => ['id', 'itemId', 'manual', 'operation', 'profileId', 'sourceItemId', 'status', 'swapGroup'].includes(key))).toBe(true);
        }
        const swapGroups = pairs.map(([incoming, outgoing]) => {
            const pair = submitted.filter(row => row.profileId === incoming.id || row.profileId === outgoing.id);
            expect(pair).toHaveLength(2);
            const group = pair[0]!.swapGroup;
            expect(group).toEqual(expect.any(String));
            expect(group).not.toBe('');
            expect(pair[1]!.swapGroup).toBe(group);
            return group;
        });
        expect(new Set(swapGroups).size).toBe(2);
        await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments)
            .toEqual(expect.arrayContaining(pairs.flatMap(([incoming, outgoing]) => [
                expect.objectContaining({item: expect.objectContaining({id: second!.id}), profile: expect.objectContaining({id: incoming.id})}),
                expect.objectContaining({item: expect.objectContaining({id: first!.id}), profile: expect.objectContaining({id: outgoing.id})}),
            ])));
        expect((await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments).toHaveLength(4);
        expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('two-activity-swaps');
    });
}

test('relinks an Event with live advanced drafts and retires those workspaces on unlink without replay', async ({page}) => {
    test.setTimeout(60000);
    const plan = await createAdvancedActivityForE2E(page.request, {assigned: true, recommendation: true});
    const destination = await createFrontendEventFixture(page.request);
    expect((await page.request.put(`/api/v1/events/${destination.id}/registration`, {headers: await commandHeadersForE2E(page.request), data: {
        arrivalDate: plan.attendance.startDate, departureDate: plan.attendance.endDate, dietary: ['MEAT'],
    }})).status()).toBe(200);
    await openActivityRulesForE2E(page, plan);
    await page.locator('#requiredShifts').fill('7');
    const requirementInput = await page.locator('#requiredShifts').elementHandle();
    await page.locator(`.slot[data-slot-id="${plan.view.slots[1]!.id}"] [data-add-recommendation]`).click();
    const editor = page.locator('#addRecommendationModal');
    await editor.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
    await editor.getByRole('button', {name: 'Stage as approved', exact: true}).click();
    await expect(editor).not.toBeVisible();
    const manualRow = page.locator(`#recommendationScheduleView [data-rec-id=""][data-profile-id="${plan.owner.id}"]`);
    await expect(manualRow).toHaveCount(1);
    const manualElement = await manualRow.elementHandle();
    const baseline = await readActivityRecommendationsForE2E(page.request, plan.id);
    const writes: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET' && path.startsWith(`/api/v1/activity-plans/${plan.id}/`)) writes.push(path);
    });
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-live-relink';});

    /** The shared settings owner changes only its explicit relationship draft.
     * Advanced editors remain independent until unlink releases their admission. */
    async function changeLink(target: {id: string; title: string} | null): Promise<void> {
        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const dialog = page.locator('.frontend-dialog');
        await dialog.getByRole('tab', {name: 'Linked event', exact: true}).click();
        if (target) {
            await dialog.getByRole('searchbox', {name: 'Search events', exact: true}).fill(target.title);
            await dialog.locator(`[data-event-id="${target.id}"]`).click();
        } else await dialog.getByRole('button', {name: 'No event', exact: true}).click();
        page.once('dialog', confirmation => confirmation.accept());
        await observeActivityCommand(page, plan.id, '/event', 'PUT',
            () => dialog.getByRole('button', {name: 'Save event link', exact: true}).click());
        await expect.poll(async () => (await readActivityForE2E(page.request, plan.id)).currentEventId).toBe(target?.id ?? null);
        await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(dialog).not.toBeVisible();
    }

    await changeLink(destination);
    // Relinking keeps the same resource, actor and admitted advanced owners.
    // Neither a server snapshot nor a settings save may replace these local inputs.
    await expect(page.locator('#requiredShifts')).toHaveValue('7');
    expect(await requirementInput!.evaluate(element => element === document.getElementById('requiredShifts'))).toBe(true);
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Unsaved changes');
    await expect(manualRow).toHaveCount(1);
    expect(await manualElement!.evaluate(element => element.isConnected)).toBe(true);
    expect((await readActivityRequirementsForE2E(page.request, plan.id)).plan.generalRequiredShifts).toBe(2);
    expect((await readActivityRecommendationsForE2E(page.request, plan.id)).existingAssignments).toEqual(baseline.existingAssignments);

    await changeLink(null);
    // Unlink deliberately releases advanced Event context. Its private forms
    // disappear; the independently admitted schedule and saved assignments remain.
    await expect(page.locator('#requirementPanel')).toHaveCount(0);
    await expect(page.locator('#recommendationPanel')).toHaveCount(0);
    await expect(page.getByRole('tab', {name: 'Schedule', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-schedule')).toBeVisible();
    expect((await readActivityForE2E(page.request, plan.id)).slots[0]!.assignees).toEqual(plan.view.slots[0]!.assignees);
    expect(writes.filter(path => path.endsWith('/event'))).toHaveLength(2);
    expect(writes.some(path => /\/(requirements|recommendations\/apply|recommendations\/entry|recommendations\/auto)$/u.test(path))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-live-relink');
});

test('retains manual warnings after cancellation and rejects a stale overlap review before applying the newly reviewed batch', async ({page}) => {
    test.setTimeout(60000);
    const {target, sibling} = await createActivityOverlapForE2E(page.request);
    await page.clock.install();
    // Keep this review about a confirmable sibling overlap. Arrival-morning
    // placement is independently blocking in the established recommendation owner.
    for (const plan of [target, sibling]) {
        await patchActivitySlotForE2E(page.request, plan.id, plan.view.slots[0]!.id, {startTime: '16:00', endTime: '17:00'});
    }
    const session = await (await page.request.get('/api/v1/session')).json() as {activeProfile: {id: string}};
    await page.goto(`${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.getByRole('tab', {name: 'Rules & auto-assign', exact: true}).click();
    await page.locator(`.slot[data-slot-id="${target.view.slots[0]!.id}"] [data-add-recommendation]`).click();
    const modal = page.locator('#addRecommendationModal');
    await modal.locator('#addRecommendationParticipant').selectOption(`profile:${session.activeProfile.id}`);
    await expect(modal.locator('[data-add-warning]')).toContainText(sibling.title);
    await modal.getByRole('button', {name: 'Stage as approved', exact: true}).click();
    const warnings = page.locator('[data-recommendation-warnings]');
    await expect(warnings).toContainText(sibling.title);
    await expect(warnings).toHaveAttribute('role', 'status');
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    await page.locator('#assignmentWarningCancel').click();
    await expect(page.locator('#assignmentWarningModal')).not.toBeVisible();
    await page.clock.fastForward(11_000);
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText('before confirming');
    await page.clock.resume();
    expect((await readActivityRecommendationsForE2E(page.request, target.id)).existingAssignments).toEqual([]);

    // Another real command changes the observed collision after confirmation
    // opens. The old digest must fail without persisting the staged review.
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    await patchActivitySlotForE2E(page.request, sibling.id, sibling.view.slots[0]!.id, {startTime: '16:15', endTime: '17:15'});
    await observeActivityCommand(page, target.id, '/recommendations/apply', 'POST',
        () => page.getByRole('button', {name: 'Confirm overlapping changes', exact: true}).click(), 409);
    const staleReview = await readActivityRecommendationsForE2E(page.request, target.id);
    expect(staleReview.existingAssignments).toEqual([]);
    expect(staleReview.recommendations).toEqual([]);
    await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(1);
    await expect(warnings).toBeVisible();
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    await observeActivityCommand(page, target.id, '/recommendations/apply', 'POST',
        () => page.getByRole('button', {name: 'Confirm overlapping changes', exact: true}).click());
    await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, target.id)).existingAssignments.length).toBe(1);
    expect((await readActivityRecommendationsForE2E(page.request, sibling.id)).existingAssignments).toHaveLength(1);
});

test('retains generated Required-over-Free overlap warnings until the exact batch is explicitly confirmed', async ({page}) => {
    test.setTimeout(90_000);
    const {target, sibling} = await createActivityOverlapForE2E(page.request);
    // Both actual commitments share an eligible arrival-afternoon time. The
    // Required generator must expose its conflict with the existing Free plan.
    for (const plan of [target, sibling])
        await patchActivitySlotForE2E(page.request, plan.id, plan.view.slots[0]!.id, {startTime: '16:00', endTime: '17:00'});
    // The original regression has one target duty. Keep no nonoverlapping
    // alternative that the generator could correctly prefer instead.
    expect((await page.request.delete(`/api/v1/activity-plans/${target.id}/slots/${target.view.slots[1]!.id}`, {
        headers: await commandHeadersForE2E(page.request),
    })).status()).toBe(200);
    expect((await page.request.put(`/api/v1/activity-plans/${target.id}/requirements`, {
        headers: await commandHeadersForE2E(page.request), data: {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 1, roundingMode: 'CEIL', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false,
            allowArrivalDayEvening: true, allowDepartureDayMorning: true,
            roleRequirements: [], overrides: [],
            stayRequirements: [1, 2].map(stayDays => ({stayDays, requiredShifts: 1})),
        },
    })).status()).toBe(200);
    await openActivityRulesForE2E(page, {...target, days: 2});
    await observeActivityCommand(page, target.id, '/recommendations/auto', 'POST',
        () => page.locator('[data-recommendations-auto]').click(), 202);
    const row = page.locator('#recommendationScheduleView [data-rec-id]');
    await expect(row).toHaveCount(1);
    const warning = page.locator('[data-recommendation-warnings]');
    await expect(warning).toContainText('Required takes precedence over Free');
    await expect(warning).toContainText('Discuss this conflict with the participant before confirming');
    await expect(warning).toContainText(sibling.title);
    await row.locator('button[title="Approve"]').click();
    await page.locator('[data-recommendations-apply]').click();
    const review = page.getByRole('dialog').filter({has: page.locator('#assignmentWarningModal')});
    await expect(review).toBeVisible();
    await expect(review).toContainText('Required takes precedence over Free');
    await page.locator('#assignmentWarningCancel').click();
    await expect(review).toBeHidden();
    await expect(warning).toBeVisible();
    expect((await readActivityRecommendationsForE2E(page.request, target.id)).existingAssignments).toEqual([]);
    await page.locator('[data-recommendations-apply]').click();
    const applied = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${target.id}/recommendations/apply`);
    await review.getByRole('button', {name: 'Confirm overlapping changes', exact: true}).click();
    const receipt = await applied;
    expect(receipt.status()).toBe(200);
    expect(await receipt.json()).toMatchObject({applied: 1, skipped: 0});
    await expect.poll(async () => (await readActivityRecommendationsForE2E(page.request, target.id)).existingAssignments.length).toBe(1);
    expect((await readActivityRecommendationsForE2E(page.request, sibling.id)).existingAssignments).toHaveLength(1);
});
