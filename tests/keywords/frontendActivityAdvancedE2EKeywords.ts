import {patchActivitySlotForE2E, createActivityRoleForE2E, createActivityForE2E,
    assignActivityForE2E, captureActivityPresentation, readActivityForE2E} from './frontendActivityE2EKeywords';
import {commandHeadersForE2E, createProfileForE2E, selectProfileForE2E, updateEntityMetadataForE2E} from './e2eCoreKeywords';
import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';
import {waitForFrontendHydration} from './frontendDynamicKeywords';

/** Create persisted inputs through the established HTTP owners: registered
 * profiles, saved rules and a pending recommendation when requested. */
export async function createAdvancedActivityForE2E(request: APIRequestContext,
    options: {assigned?: boolean; secondAssigned?: boolean; recommendation?: boolean;
        period?: Pick<components['schemas']['ActivityCreateInput'], 'startDate' | 'endDate'>} = {}) {
    const event = await createFrontendEventFixture(request);
    const attendance = options.period ?? {startDate: '2030-06-01', endDate: '2030-06-04'};
    // Calendar scenarios reuse the existing Event operation before either real
    // registration. Ordinary fixtures retain their original four-day Event and
    // two-day plan; no business or attendance rule is bypassed for the test.
    if (options.period) await updateEntityMetadataForE2E(request, 'events', event.id, options.period);
    expect((await request.put(`/api/v1/events/${event.id}/registration`, {headers: await commandHeadersForE2E(request), data: {arrivalDate: attendance.startDate, departureDate: attendance.endDate, dietary: ['MEAT']}})).status()).toBe(200);
    const plan = await createActivityForE2E(request, event.id, options.period);

    // The base fixture's breakfast occurs on arrival morning. Advanced
    // recommendation application intentionally blocks that time, so choose two
    // eligible, nonoverlapping arrival-afternoon slots for these workflows.
    for (const [index, slot] of plan.view.slots.entries()) {
        await patchActivitySlotForE2E(request, plan.id, slot.id, {
            title: index === 0 ? 'Early duty' : 'Late duty',
            startTime: index === 0 ? '16:00' : '18:00', endTime: index === 0 ? '17:00' : '19:00',
        });
    }
    const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const owner = session.activeProfile!;

    // A second real registration makes participant override and swap choices
    // meaningful. Restore the original actor before returning the shared fixture.
    const name = `P6 participant ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, name);
    const roster = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const other = roster.profiles.find(profile => profile.name === name)!;
    expect(other).toBeTruthy();
    await selectProfileForE2E(request, other.id);
    expect((await request.put(`/api/v1/events/${event.id}/registration`, {headers: await commandHeadersForE2E(request), data: {arrivalDate: attendance.startDate, departureDate: attendance.endDate, dietary: ['MEAT']}})).status()).toBe(200);
    if (options.secondAssigned) await assignActivityForE2E(request, plan.id, plan.view.slots[1]!.id);
    await selectProfileForE2E(request, owner.id);

    const roleId = await createActivityRoleForE2E(request, plan.id, 'Kitchen lead');
    const days = Math.round((Date.parse(plan.view.endDate) - Date.parse(plan.view.startDate)) / 86_400_000) + 1;
    expect((await request.put(`/api/v1/activity-plans/${plan.id}/requirements`, {headers: await commandHeadersForE2E(request), data: {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'CEIL', bindingDeadline: null,
            allowOverfillAfterFull: false, allowExternalAssignees: false,
            allowArrivalDayEvening: true, allowDepartureDayMorning: true,
            roleRequirements: [{roleId, requiredShifts: 0}],
            stayRequirements: Array.from({length: days}, (_, index) => ({stayDays: index + 1,
                requiredShifts: index === 0 ? 0 : index === days - 1 ? 2 : 1})),
            overrides: options.recommendation ? [{profileId: owner.id, roleId: null, requiredShifts: 1}] : [],
        }})).status()).toBe(200);
    if (options.assigned) await assignActivityForE2E(request, plan.id, plan.view.slots[0]!.id);
    if (options.recommendation) {
        await savePendingActivityRecommendationsForE2E(request, plan.id, [{
            itemId: plan.view.slots[1]!.id, profileId: other.id, status: 'PENDING', operation: 'ASSIGN', manual: false,
        }]);
    }
    return {...plan, view: await readActivityForE2E(request, plan.id), event, owner, other, roleId, days, attendance};
}

/** Persist pending review rows through the ordinary batch owner, which records
 * review state but applies only approved rows. Verify no assignment was applied. */
export async function savePendingActivityRecommendationsForE2E(request: APIRequestContext, planId: string,
    recommendations: components['schemas']['ActivityRecommendationInput'][]): Promise<void> {
    expect(recommendations.every(row => row.status === 'PENDING')).toBe(true);
    const response = await request.post(`/api/v1/activity-plans/${planId}/recommendations/apply`, {
        headers: await commandHeadersForE2E(request), data: {recommendations},
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({applied: 0});
}

/** Prepare two independent swaps sharing the same slot directions. Every profile
 * registers and joins through the normal application; no recommendation origin
 * or pair identity is manufactured in persistence. */
export async function createActivitySwapPairsForE2E(request: APIRequestContext) {
    const plan = await createAdvancedActivityForE2E(request, {assigned: true, secondAssigned: true});
    const [first, second] = plan.view.slots;
    // Each slot needs two real occupants. Increasing the existing second slot
    // keeps capacity warnings separate from the review-pairing regression.
    await patchActivitySlotForE2E(request, plan.id, second!.id, {maxAssignees: 2});
    const additional: Array<{id: string; name: string}> = [];

    try {
        for (const slot of [first!, second!]) {
            const name = `Swap participant ${randomUUID().slice(0, 8)}`;
            await createProfileForE2E(request, name);
            const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
            const profile = session.profiles.find(candidate => candidate.name === name);
            expect(profile).toBeTruthy();
            await selectProfileForE2E(request, profile!.id);
            expect((await request.put(`/api/v1/events/${plan.event.id}/registration`, {headers: await commandHeadersForE2E(request), data: {
                    arrivalDate: plan.attendance.startDate, departureDate: plan.attendance.endDate, dietary: ['MEAT'],
                }})).status()).toBe(200);
            await assignActivityForE2E(request, plan.id, slot.id);
            additional.push({id: profile!.id, name});
        }
    } finally {
        // The page under test belongs to the original organizer, independently
        // of which fixture registration/assignment last changed the session.
        await selectProfileForE2E(request, plan.owner.id);
    }

    return {...plan, view: await readActivityForE2E(request, plan.id),
        extraFirst: additional[0]!, extraSecond: additional[1]!};
}

/** Stage one complete swap through the actual manual editor. Its two emitted
 * legs remain a client draft until the separate reviewed application command. */
export async function stageActivitySwapForE2E(page: Page,
    selection: {sourceSlotId: string; targetSlotId: string; profileId: string; counterpartId: string}, stageLabel = 'Stage as approved'): Promise<void> {
    await page.locator(`.slot[data-slot-id="${selection.targetSlotId}"] [data-add-recommendation]`).click();
    const dialog = page.locator('#addRecommendationModal');
    // Use the real participant/source controls so pairing is established by
    // the same intentional staging gesture as an organizer's ordinary swap.
    await dialog.locator('#addRecommendationOperation').selectOption('SWAP');
    await dialog.locator('#addRecommendationParticipant').selectOption(`profile:${selection.profileId}`);
    await dialog.locator('#addRecommendationSource').selectOption(selection.sourceSlotId);
    await dialog.locator('#addRecommendationSwapParticipant').selectOption(selection.counterpartId);
    await dialog.getByRole('button', {name: stageLabel, exact: true}).click();
    await expect(dialog).not.toBeVisible();
}

/** Open the real built route and wait for saved Rules inputs, rather than a
 * framework mount or a response that has not yet populated visible controls. */
export async function openActivityRulesForE2E(page: Page, plan: {path: string; days: number}): Promise<void> {
    await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.getByRole('tab', {name: 'Rules & auto-assign', exact: true}).click();
    await expect(page.locator('#stayRequirementList input[data-stay-days]')).toHaveCount(plan.days);
    await expect(page.locator('#requirementCoverageStatus')).not.toContainText('Loading coverage');
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Saved');
}

/** Capture sticky Rules content at a consistent viewport position.
 * An element screenshot can inherit an earlier capture's scroll state. Align the
 * actual surface before capturing, keeping production positioning untouched. */
export async function captureAdvancedActivityPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[]) {
    // Explicitly settle the browser's real scrolling and sticky layout before
    // the shared screenshot/metric owner measures the unmodified presentation.
    await surface.evaluate(element => element.scrollIntoView({block: 'start', inline: 'nearest', behavior: 'instant'}));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return captureActivityPresentation(page, info, name, surface, selectors);
}

/** Recovery reads observe persisted data without invoking recommendation
 * maintenance or potentially dispatching another generation job. */
export async function readActivityRecommendationsForE2E(request: APIRequestContext, planId: string): Promise<components['schemas']['ActivityRecommendations']> {
    const response = await request.get(`/api/v1/activity-plans/${planId}/recommendations`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['ActivityRecommendations']>;
}

/** Read saved requirement inputs through their independently granted method. */
export async function readActivityRequirementsForE2E(request: APIRequestContext, planId: string): Promise<components['schemas']['ActivityRequirements']> {
    const response = await request.get(`/api/v1/activity-plans/${planId}/requirements`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['ActivityRequirements']>;
}
