import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createActivityForE2E, assignActivityThroughNative, captureActivityPresentation, readActivityForE2E,
    waitForNativeActivityPane} from './frontendActivityE2EKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';
import {waitForPilotHydration} from './frontendDynamicKeywords';

/** Create shared persisted inputs through the established HTTP owners. Both
 * renderers use these same registered profiles, saved rules and recommendation. */
export async function createAdvancedActivityForE2E(request: APIRequestContext,
    options: {assigned?: boolean; secondAssigned?: boolean; recommendation?: boolean;
        period?: Pick<components['schemas']['ActivityCreateInput'], 'startDate' | 'endDate'>} = {}) {
    const event = await createFrontendEventFixture(request);
    const attendance = options.period ?? {startDate: '2030-06-01', endDate: '2030-06-04'};
    // Calendar scenarios reuse the existing Event operation before either real
    // registration. Ordinary fixtures retain their original four-day Event and
    // two-day plan; no business or attendance rule is bypassed for the test.
    if (options.period) expect((await request.post(`/api/event/${event.id}/update`, {data: options.period})).status()).toBe(200);
    expect((await request.post(`/api/event/${event.id}/register`, {
        data: {arrivalDate: attendance.startDate, departureDate: attendance.endDate, dietary: ['MEAT']},
    })).status()).toBe(200);
    const plan = await createActivityForE2E(request, event.id, options.period);

    // The native fixture's breakfast occurs on arrival morning. Advanced
    // recommendation application intentionally blocks that time, so choose two
    // eligible, nonoverlapping arrival-afternoon slots for these workflows.
    for (const [index, slot] of plan.view.slots.entries()) {
        expect((await request.post(`/api/activity/${plan.id}/slot/${slot.id}/attr`, {data: {
            title: index === 0 ? 'Early duty' : 'Late duty',
            startTime: index === 0 ? '16:00' : '18:00', endTime: index === 0 ? '17:00' : '19:00',
        }})).status()).toBe(200);
    }
    const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const owner = session.activeProfile!;

    // A second real registration makes participant override and swap choices
    // meaningful. Restore the original actor before returning the shared fixture.
    const name = `P6 participant ${randomUUID().slice(0, 8)}`;
    expect((await request.post('/users/profile/create', {form: {name}, maxRedirects: 0})).status()).toBe(302);
    const roster = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const other = roster.profiles.find(profile => profile.name === name)!;
    expect(other).toBeTruthy();
    expect((await request.get(`/users/profile/change/${other.id}`, {maxRedirects: 0})).status()).toBe(302);
    expect((await request.post(`/api/event/${event.id}/register`, {
        data: {arrivalDate: attendance.startDate, departureDate: attendance.endDate, dietary: ['MEAT']},
    })).status()).toBe(200);
    if (options.secondAssigned) await assignActivityThroughNative(request, plan.id, plan.view.slots[1]!.id);
    expect((await request.get(`/users/profile/change/${owner.id}`, {maxRedirects: 0})).status()).toBe(302);

    const roles = await request.post(`/api/activity/${plan.id}/roles`, {data: {name: 'Kitchen lead'}});
    expect(roles.status()).toBe(200);
    const roleId = ((await roles.json()).data as Array<{id: number}>)[0]!.id;
    const days = Math.round((Date.parse(plan.view.endDate) - Date.parse(plan.view.startDate)) / 86_400_000) + 1;
    expect((await request.post(`/api/activity/${plan.id}/requirements`, {data: {
        assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'CEIL', bindingDeadline: null,
        allowOverfillAfterFull: false, allowExternalAssignees: false,
        allowArrivalDayEvening: true, allowDepartureDayMorning: true,
        roleRequirements: [{roleId, requiredShifts: 0}],
        stayRequirements: Array.from({length: days}, (_, index) => ({stayDays: index + 1,
            requiredShifts: index === 0 ? 0 : index === days - 1 ? 2 : 1})),
        overrides: options.recommendation ? [{profileId: owner.id, roleId: null, requiredShifts: 1}] : [],
    }})).status()).toBe(200);
    if (options.assigned) await assignActivityThroughNative(request, plan.id, plan.view.slots[0]!.id);
    if (options.recommendation) {
        expect((await request.post(`/api/activity/${plan.id}/recommendations`, {data: {recommendations: [{
            itemId: plan.view.slots[1]!.id, profileId: other.id, status: 'PENDING', operation: 'ASSIGN', manual: false,
        }]}})).status()).toBe(200);
    }
    return {...plan, view: await readActivityForE2E(request, plan.id), event, owner, other, roleId, days};
}

/** Open the real built route and wait for saved Rules inputs, rather than a
 * framework mount or a response that has not yet populated visible controls. */
export async function openActivityRulesForE2E(page: Page, plan: {path: string; days: number}, pilot = true): Promise<void> {
    await page.goto(`${pilot ? '/frontend-pilot' : ''}${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    if (pilot) await waitForPilotHydration(page);
    if (pilot) await page.getByRole('tab', {name: 'Rules & auto-assign', exact: true}).click();
    else await page.locator('[data-bs-target="#tab-rules"]').click();
    if (!pilot) await waitForNativeActivityPane(page.locator('#tab-rules'));
    await expect(page.locator('#stayRequirementList input[data-stay-days]')).toHaveCount(plan.days);
    await expect(page.locator('#requirementCoverageStatus')).not.toContainText('Loading coverage');
    await expect(page.locator('[data-requirements-dirty]')).toHaveText('Saved');
    // Compare the stable saved form after the native read-success notice has
    // completed its normal lifetime, rather than mismatched feedback moments.
    if (!pilot) await expect(page.locator('[data-requirements-alert]')).not.toBeVisible({timeout: 15000});
}

/** Compare sticky Rules content at the same viewport position in both renderers.
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
