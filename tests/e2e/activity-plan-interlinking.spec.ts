import {randomUUID} from 'node:crypto';
import {expect, test, type Page} from '@playwright/test';
import {createE2EActivityPlan, createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

/** Setup uses production HTTP commands; assertions exercise actual Pug and bundled browser modules. */
async function createLinkedReview(page: Page) {
    await loginForE2E(page.request, createE2ELogin());
    const eventCase = createE2EEvent();
    eventCase.form.startDate = '2027-06-01';
    eventCase.form.endDate = '2027-06-03';
    const event = await createResourceViaForm(page.request, eventCase);
    expect((await page.request.post('/api/event/' + event.id + '/register', {
        data: {arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT']},
    })).ok()).toBe(true);
    async function createPlan(title: string) {
        const planCase = createE2EActivityPlan();
        planCase.title = title;
        planCase.createPath = '/activity/create?eventId=' + event.id;
        planCase.form = {...planCase.form, title, event_id: event.id, startDate: eventCase.form.startDate, endDate: eventCase.form.endDate,
            slots: JSON.stringify({'2027-06-02': [{
                id: randomUUID(), title: 'Shared-time duty', day: '2027-06-02',
                startTime: '09:00', endTime: '10:00', maxAssignees: 2, pos: 0,
            }]})} as typeof planCase.form;
        const plan = await createResourceViaForm(page.request, planCase);
        const response = await page.request.get('/api/activity/' + plan.id + '/recommendations');
        expect(response.ok()).toBe(true);
        const data = (await response.json()).data;
        return {...plan, slotId: data.slots[0].id as string, profileId: data.participantOptions[0].profileId as string};
    }
    const first = await createPlan('Duties requiring review');
    const second = await createPlan('Optional overlapping activity');
    expect((await page.request.post('/api/activity/' + second.id + '/assign', {data: {itemId: second.slotId}})).ok()).toBe(true);
    return {first, second};
}

test('keeps manual overlap warnings visible after cancellation and applies only after explicit confirmation', async ({page}) => {
    test.setTimeout(60000);
    const {first, second} = await createLinkedReview(page);
    await page.clock.install();
    await page.goto(first.path);
    await page.getByRole('tab', {name: 'Rules & auto-assign'}).click();
    await page.locator('[data-add-recommendation]').click();
    await page.locator('#addRecommendationParticipant').selectOption('profile:' + first.profileId);
    await expect(page.locator('[data-add-warning]')).toContainText(second.title);
    await page.getByRole('button', {name: 'Stage as approved'}).click();
    const warning = page.locator('[data-recommendation-warnings]');
    await expect(warning).toHaveAttribute('role', 'status');
    await expect(warning).toContainText(second.title);
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    await page.locator('#assignmentWarningCancel').click();
    await expect(page.locator('#assignmentWarningModal')).not.toBeVisible();
    await page.clock.fastForward(11000);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('before confirming');
    await expect(page.locator('[data-recommendations-auto]')).toBeDisabled();
    const unsaved = (await (await page.request.get('/api/activity/' + first.id + '/recommendations')).json()).data;
    expect(unsaved.existingAssignments).toHaveLength(0);
    expect(unsaved.recommendations).toHaveLength(0);
    await page.locator('[data-recommendations-apply]').click();
    await page.getByRole('button', {name: 'Confirm overlapping changes'}).click();
    await expect(page.locator('[data-recommendations-alert]')).toContainText('Applied 1; skipped 0');
    await page.clock.fastForward(1000);
    await expect(page.locator('[data-recommendations-alert]')).toContainText('Applied 1; skipped 0');
    const confirmed = (await (await page.request.get('/api/activity/' + first.id + '/recommendations')).json()).data;
    const foreign = (await (await page.request.get('/api/activity/' + second.id + '/recommendations')).json()).data;
    expect(confirmed.existingAssignments).toHaveLength(1);
    expect(foreign.existingAssignments).toHaveLength(1);
});

test('shows persistent Required-over-Free warnings for generated work before confirming the overlap', async ({page}) => {
    test.setTimeout(60000);
    const {first, second} = await createLinkedReview(page);
    expect((await page.request.post('/api/activity/' + first.id + '/requirements', {data: {
        assignmentMode: 'REQUIRED', roleRequirements: [], overrides: [],
        stayRequirements: [1, 2, 3].map((stayDays) => ({stayDays, requiredShifts: 1})),
    }})).ok()).toBe(true);
    await page.goto(first.path);
    await page.getByRole('tab', {name: 'Rules & auto-assign'}).click();
    await page.locator('[data-recommendations-auto]').click();
    const warning = page.locator('[data-recommendation-warnings]');
    await expect(warning).toContainText('Required takes precedence over Free');
    await expect(warning).toContainText('Discuss this conflict with the participant before confirming');
    await expect(warning).toContainText(second.title);
    await page.locator('#recommendationScheduleView button[title="Approve"]').click();
    await page.locator('[data-recommendations-apply]').click();
    await expect(page.locator('#assignmentWarningModal')).toBeVisible();
    await expect(page.locator('#assignmentWarningList')).toContainText('Required takes precedence over Free');
    await page.locator('#assignmentWarningCancel').click();
    await expect(warning).toBeVisible();
    await page.locator('[data-recommendations-apply]').click();
    await page.getByRole('button', {name: 'Confirm overlapping changes'}).click();
    await expect(page.locator('[data-recommendations-alert]')).toContainText('Applied 1; skipped 0');
    const foreign = (await (await page.request.get('/api/activity/' + second.id + '/recommendations')).json()).data;
    expect(foreign.existingAssignments).toHaveLength(1);
});
