import {expect, test} from '@playwright/test';
import {closeModalForE2E, expectVisiblePresentation, openModalForE2E,
    readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {createActivityOverlapForE2E, expectActivityTabKeyboard, observeActivityCommand,
    readActivityForE2E} from '../keywords/frontendActivityE2EKeywords';
import {captureAdvancedActivityPresentation, createAdvancedActivityForE2E, openActivityRulesForE2E, readActivityRecommendationsForE2E,
    readActivityRequirementsForE2E} from '../keywords/frontendActivityAdvancedE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';

for (const width of [1280, 390]) {
    test(`compares saved Rules, coverage, recommendation review and manual moves at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        const dialogs: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
        const plan = await createAdvancedActivityForE2E(page.request, {assigned: true, recommendation: true});
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};

        // The actor, saved inputs, generated provenance and schedule are unchanged
        // between renderers. Only their visible frontend owners differ.
        for (const pilot of [false, true]) {
            const prefix = pilot ? 'vue' : 'native';
            await openActivityRulesForE2E(page, plan, pilot);
            // Entry maintenance must not manufacture a Saved receipt. A hidden
            // inline receipt would steal tab focus and scroll on later disclosure.
            if (pilot) await expect(page.locator('#recommendationPanel').getByRole('alert').filter({hasText: 'Saved'})).toHaveCount(0);
            await expectActivityTabKeyboard(page);
            await (pilot ? page.getByRole('tab', {name: 'Rules & auto-assign', exact: true})
                : page.locator('[data-bs-target="#tab-rules"]')).click();
            if (!pilot) await expect(page.locator('#tab-rules')).toHaveCSS('opacity', '1');
            await expect(page.locator('#recommendationScheduleView [data-rec-id]')).toHaveCount(1);
            const requirements = await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-rules`,
                page.locator('#requirementPanel'), ['.card-header', 'p', 'strong', 'small', 'h6', 'label',
                    'input:not([type="hidden"])', 'select', 'button', '.badge']);
            const coverage = await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-coverage`,
                page.locator('#requirement-participant-status'), ['p', 'input', 'button', '.badge', '.participant-status-cell']);
            const recommendations = await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-recommendations`,
                page.locator('#recommendationPanel'), ['.card-header', 'h5', 'p', '.status-notice', 'small', '.badge', 'th', 'button',
                    '[data-slot-id]', '[data-rec-id]', '[data-recommendation-warnings]']);

            const opener = page.locator(`.slot[data-slot-id="${plan.view.slots[1]!.id}"] [data-add-recommendation]`);
            const modal = page.locator('#addRecommendationModal');
            if (pilot) await opener.click();
            else await openModalForE2E(modal, opener);
            await modal.locator('#addRecommendationOperation').selectOption('REASSIGN');
            await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
            const preview = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname.endsWith('/recommendations/warnings'));
            await modal.locator('#addRecommendationSource').selectOption(plan.view.slots[0]!.id);
            expect((await preview).status()).toBe(200);
            const move = await captureAdvancedActivityPresentation(page, info, `${prefix}-advanced-move-dialog`,
                pilot ? modal : modal.locator('.modal-content'), ['.modal-title', 'label', 'select', '[data-add-warning]', 'button']);
            if (pilot) await modal.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(modal);
            await expect(modal).not.toBeVisible();

            const surfaces = {requirements, coverage, recommendations, move};
            if (pilot) {
                for (const [name, measured] of Object.entries(surfaces)) expectVisiblePresentation(native[name]!, measured);
            } else Object.assign(native, surfaces);
        }
        expect(errors).toEqual([]);
        expect(dialogs).toEqual([]);
    });
}

test('uses German advanced Activity labels and saved requirements in the built mobile application', async ({page}, info) => {
    await page.setViewportSize({width: 390, height: 900});
    const plan = await createAdvancedActivityForE2E(page.request);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/frontend-pilot${plan.path}?locale=de`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.getByRole('tab', {name: 'Regeln & automatische Zuweisung', exact: true}).click();
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Gespeichert');
    await expect(page.getByLabel('Zuweisungsmodus', {exact: true})).toHaveValue('REQUIRED');
    await page.locator('#assignmentMode').selectOption('FREE');
    await expect(page.getByRole('button', {name: 'Automatisch erstellen', exact: true})).toBeDisabled();
    await page.locator('#assignmentMode').selectOption('REQUIRED');
    await page.locator('#requiredShifts').fill('0');
    for (const input of await page.locator('#stayRequirementList input[data-stay-days]').all()) await input.fill('0');
    await observeActivityCommand(page, plan.id, '/requirements', 'PUT',
        () => page.getByRole('button', {name: 'Einstellungen speichern', exact: true}).click());
    expect((await readActivityRequirementsForE2E(page.request, plan.id)).plan.generalRequiredShifts).toBe(0);
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Gespeichert');
    // Inspect the saved form after its normal success notice expires, so a live
    // sticky flash cannot hide the heading or make its clipped actions look valid.
    const savedNotice = page.getByRole('alert').filter({hasText: 'Anforderungseinstellungen gespeichert'});
    await expect(savedNotice).toBeVisible();
    await expect(savedNotice).not.toBeVisible({timeout: 15000});
    await captureAdvancedActivityPresentation(page, info, 'vue-german-mobile-rules', page.locator('#requirementPanel'),
        ['label', 'input:not([type="hidden"])', 'select', 'button', '.badge']);
    await captureAdvancedActivityPresentation(page, info, 'vue-german-mobile-recommendations', page.locator('#recommendationPanel'),
        ['.card-header', 'h5', 'p', '.status-notice', 'small', '.badge', 'button']);

    await page.locator(`.slot[data-slot-id="${plan.view.slots[0]!.id}"] [data-add-recommendation]`).click();
    const modal = page.locator('#addRecommendationModal');
    await expect(modal.getByRole('heading', {name: 'Vorschlag hinzufügen', exact: true})).toBeVisible();
    await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
    await expect(modal.getByRole('button', {name: 'Als genehmigt vormerken', exact: true})).toBeEnabled();
    await captureAdvancedActivityPresentation(page, info, 'vue-german-mobile-manual-dialog', modal,
        ['.modal-title', 'label', 'select', '[data-add-warning]', 'button']);
    page.once('dialog', dialog => dialog.accept());
    await modal.locator('.modal-header .btn-close').click();
    await expect(modal).not.toBeVisible();
    expect(errors).toEqual([]);
});

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
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'activity-advanced';});
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
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('activity-advanced');
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
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'activity-swaps';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    const [first, second] = plan.view.slots;

    /** Stage the public modal's complete reciprocal move, preserving its sources
     * until the reviewed application commits both legs together. */
    async function stageSwap(): Promise<void> {
        await page.locator(`.slot[data-slot-id="${second!.id}"] [data-add-recommendation]`).click();
        const modal = page.locator('#addRecommendationModal');
        await modal.locator('#addRecommendationOperation').selectOption('SWAP');
        await modal.locator('#addRecommendationParticipant').selectOption(`profile:${plan.owner.id}`);
        await modal.locator('#addRecommendationSource').selectOption(first!.id);
        await modal.locator('#addRecommendationSwapParticipant').selectOption(plan.other.id);
        await modal.getByRole('button', {name: 'Stage as approved', exact: true}).click();
        await expect(modal).not.toBeVisible();
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
    const batch = swapped.request().postDataJSON().recommendations as Array<{itemId: string; sourceItemId: string; operation: string}>;
    expect(batch).toHaveLength(2);
    expect(batch).toEqual(expect.arrayContaining([
        expect.objectContaining({operation: 'REASSIGN', itemId: first!.id, sourceItemId: second!.id}),
        expect.objectContaining({operation: 'REASSIGN', itemId: second!.id, sourceItemId: first!.id}),
    ]));
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
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('activity-swaps');
    expect(navigation).toEqual([]);
});

test('retains manual warnings after cancellation and rejects a stale overlap review before applying the newly reviewed batch', async ({page}) => {
    test.setTimeout(60000);
    const {target, sibling} = await createActivityOverlapForE2E(page.request);
    // Keep this review about a confirmable sibling overlap. Arrival-morning
    // placement is independently blocking in the established recommendation owner.
    for (const plan of [target, sibling]) {
        expect((await page.request.post(`/api/activity/${plan.id}/slot/${plan.view.slots[0]!.id}/attr`, {
            data: {startTime: '16:00', endTime: '17:00'},
        })).status()).toBe(200);
    }
    const session = await (await page.request.get('/api/v1/session')).json() as {activeProfile: {id: string}};
    await page.goto(`/frontend-pilot${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
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
    await expect(warnings).toBeVisible();
    expect((await readActivityRecommendationsForE2E(page.request, target.id)).existingAssignments).toEqual([]);

    // Another real command changes the observed collision after confirmation
    // opens. The old digest must fail without persisting the staged review.
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    expect((await page.request.post(`/api/activity/${sibling.id}/slot/${sibling.view.slots[0]!.id}/attr`, {
        data: {startTime: '16:15', endTime: '17:15'},
    })).status()).toBe(200);
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
