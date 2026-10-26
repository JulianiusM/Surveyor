import {describe, expect, it} from 'vitest';
import {classifyApiError, validatedProblemBody} from '../../src/backend/modules/api/problem';
import {APIError} from '../../src/backend/modules/lib/errors';

describe('Event business rejection transport', () => {
    it.each([
        ['EVENT_FULL', 403], ['EVENT_DATE_UPDATES_CLOSED', 403], ['EVENT_DIET_UPDATES_CLOSED', 403],
        ['EVENT_DEADLINE_PASSED', 403], ['EVENT_DATES_INVALID', 400], ['EVENT_TOKEN_USED', 409],
        ['EVENT_ALLERGY_INFO_REQUIRED', 400], ['EVENT_COMMENT_REQUIRED', 400], ['EVENT_MEAL_REQUIRED', 400],
        ['EVENT_VEGETARIAN_CONFLICT', 400], ['EVENT_VEGAN_CONFLICT', 400], ['EVENT_CANCELLATION_CLOSED', 403],
        ['EVENT_TIMEZONE_INVALID', 400], ['EVENT_START_AFTER_END', 400], ['EVENT_DEADLINE_INVALID', 400],
        ['EVENT_LINK_ACCOUNT_REQUIRED', 401],
    ] as const)('retains the known %s outcome without disclosing native error data', (cause, status) => {
        const native = new APIError('Native private diagnostic', {email: 'private@example.test'}, status, {cause});
        const problem = classifyApiError(native);
        expect(problem).toMatchObject({code: cause, status});
        const body = validatedProblemBody(problem, 'en', 'event-test');
        expect(body).toMatchObject({code: cause, status, messageKey: `api:errors.${cause}`, params: {}});
        expect(body.detail).not.toBe('Native private diagnostic');
        expect(JSON.stringify(body)).not.toContain('private@example.test');
        expect(native.message).toBe('Native private diagnostic');
        expect(native.status).toBe(status);
    });

    it('never interprets matching prose or external cause-shaped objects as Event policy', () => {
        expect(classifyApiError(new APIError('Event is full', {}, 403)).code).toBe('FORBIDDEN');
        expect(classifyApiError({cause: 'EVENT_FULL', status: 403}).code).toBe('INTERNAL_ERROR');
    });
});
