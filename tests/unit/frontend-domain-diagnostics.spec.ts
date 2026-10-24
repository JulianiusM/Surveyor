import {describe, expect, it} from 'vitest';
import activityController from '../../src/controller/activityController';
import {classifyArchiveCommandError} from '../../src/controller/entityAdminController';
import type {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {APIError, ExpectedError} from '../../src/modules/lib/errors';
import {ApiProblem, classifyApiError, declaredApiProblem, validatedProblemBody} from '../../src/modules/api/problem';

/** These actual controller checks reject before persistence. No datasource,
 * repository, transaction or business operation is replaced for these cases. */
async function rejection(operation: () => Promise<unknown>): Promise<APIError> {
    try { await operation(); } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        return error as APIError;
    }
    throw new Error('Expected the Activity operation to reject');
}

describe('Actionable controller rejection diagnostics', () => {
    const plan = {id: '11111111-1111-4111-8111-111111111111', startDate: '2030-06-01', endDate: '2030-06-03'} as ActivityPlan;

    it.each([
        {body: {date: '2030-06-04', title: 'Group talk'}, code: 'ACTIVITY_DATE_OUTSIDE_PLAN', message: 'Date outside range'},
        {body: {date: '2030-06-02', title: 'Group talk', startTime: '15:00', endTime: '14:00'},
            code: 'ACTIVITY_TIME_ORDER_INVALID', message: 'End time must be after start time'},
    ])('identifies $code from the existing Activity creation rule', async ({body, code, message}) => {
        const error = await rejection(() => activityController.quickAddSlot(plan, body, {}));
        expect(error).toMatchObject({message, status: 400, data: body, cause: code});
        const problem = classifyApiError(error);
        for (const locale of ['en', 'de']) {
            const response = validatedProblemBody(problem, locale, 'activity-domain-rejection');
            expect(response).toMatchObject({code, status: 400, params: {}});
            expect(response.detail).not.toContain('submitted values');
            expect(response.detail).not.toContain('Group talk');
            expect(response.detail).not.toContain('ACTIVITY_');
        }
    });

    it('explains a reserved role name without changing the existing native rejection', async () => {
        const body = {name: 'default', description: 'Private entered description'};
        const error = await rejection(() => activityController.addActivityRole(plan, body));
        expect(error).toMatchObject({message: 'Missing name', status: 400, data: body, cause: 'ACTIVITY_ROLE_NAME_INVALID'});
        const response = validatedProblemBody(classifyApiError(error), 'de', 'reserved-role');
        expect(response.code).toBe('ACTIVITY_ROLE_NAME_INVALID');
        expect(response.detail).toContain('default');
        expect(response.detail).not.toContain(body.description);
    });

    it('keeps trusted error status and finite declarations as the diagnostic boundary', () => {
        expect(declaredApiProblem(new Error('Private text', {cause: 'ACTIVITY_FULL'}))).toBeNull();
        expect(declaredApiProblem({status: 409, cause: 'ACTIVITY_FULL'})).toBeNull();
        expect(declaredApiProblem(new APIError('Private text', {}, 400, {cause: 'ACTIVITY_FULL'}))).toBeNull();
        expect(declaredApiProblem(new APIError('Private text', {}, 409, {cause: 'FUTURE_ACTIVITY_REASON'}))).toBeNull();
        const profile = new ExpectedError('Private account/profile details', 'error', 400,
            {accountId: 'private-account'}, {cause: 'PROFILE_SELECTION_INVALID'});
        const response = validatedProblemBody(classifyApiError(profile), 'de', 'unavailable-profile');
        expect(response).toMatchObject({code: 'PROFILE_SELECTION_INVALID', status: 400, params: {}});
        expect(JSON.stringify(response)).not.toContain('private-account');
        expect(JSON.stringify(response)).not.toContain(profile.message);
    });

    it('retains a schedule-specific archive diagnostic before the existing parent-change fallback', () => {
        const declared = new ApiProblem('RESOURCE_CONFLICT');
        expect(classifyArchiveCommandError(declared, true)).toBe(declared);
        const unavailable = new APIError('Private native schedule details', {}, 409, {cause: 'ARCHIVE_SCHEDULE_UNAVAILABLE'});
        expect(classifyArchiveCommandError(unavailable, true)).toMatchObject({code: 'ARCHIVE_SCHEDULE_UNAVAILABLE', status: 409});
        expect(classifyArchiveCommandError(new APIError('Native changed-parent details', {}, 409), true))
            .toMatchObject({code: 'ENTITY_CONTEXT_CHANGED', status: 409});
        expect(classifyArchiveCommandError(new APIError('Native inherited archive details', {eventId: plan.id}, 409), false))
            .toMatchObject({code: 'ARCHIVE_INHERITED', status: 409});
    });
});
