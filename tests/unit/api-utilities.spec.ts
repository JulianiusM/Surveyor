import {describe, expect, it} from 'vitest';
import {APIError} from '../../src/modules/lib/errors';
import {enforceAssignmentItemScope} from '../../src/middleware/assignFlowFactory';
import {coerceLimit, enforceChildResourceScope, performAPIAction, SQL_ALLOW_LIST} from '../../src/modules/lib/util';
import {createApiActionCase, createApiRequest, createRecordingAction} from '../factories/apiActionFactory';
import {createQueryLimitCase} from '../factories/queryLimitFactory';

describe('API contract behavior suite', () => {
    describe('authenticated API action guard', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('passes the request body and profile id to protected API actions', async () => {
            const apiCase = createApiActionCase();
            const action = createRecordingAction();

            await performAPIAction(apiCase.request, action);

            expect(action.calls).toEqual([{body: apiCase.expectedBody, profileId: apiCase.expectedProfileId}]);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('passes nested payloads without reshaping client input', async () => {
            const request = createApiRequest({
                profileId: 'profile-2',
                body: {items: [{id: 'item-1', quantity: 2}], meta: {source: 'api'}},
            });
            const action = createRecordingAction();

            await performAPIAction(request, action);

            expect(action.calls).toEqual([{body: request.body, profileId: 'profile-2'}]);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rejects protected actions without an authenticated profile', async () => {
            await expect(performAPIAction(createApiRequest({body: {title: 'No profile'}}), createRecordingAction())).rejects.toMatchObject({
                name: APIError.name,
                message: 'Unknown user',
                status: 401,
            });
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('does not invoke protected actions when authentication is missing', async () => {
            const action = createRecordingAction();

            await expect(performAPIAction(createApiRequest({body: {title: 'Do not call'}}), action)).rejects.toBeInstanceOf(APIError);

            expect(action.calls).toEqual([]);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('treats an empty profile id as unauthenticated', async () => {
            await expect(performAPIAction(createApiRequest({profileId: '', body: {title: 'Empty profile'}}), createRecordingAction())).rejects.toMatchObject({
                status: 401,
            });
        });
    });

    describe('assignment resource boundary', () => {
        it('accepts an assignment item only when it belongs to the resource in the route', async () => {
            await expect(enforceAssignmentItemScope(
                'plan-1',
                'slot-1',
                async () => 'plan-1',
            )).resolves.toBeUndefined();
        });

        it('rejects an assignment item taken from a different resource', async () => {
            await expect(enforceAssignmentItemScope(
                'plan-1',
                'slot-from-plan-2',
                async () => 'plan-2',
            )).rejects.toMatchObject({status: 404});
        });

        it('does not expose resolver failures for unknown assignment items', async () => {
            await expect(enforceAssignmentItemScope(
                'plan-1',
                'missing-slot',
                async () => {
                    throw new Error('database details');
                },
            )).rejects.toMatchObject({
                status: 404,
                message: 'Assignment item not found in this resource',
            });
        });
    });

    describe('nested API resource boundary', () => {
        it('accepts child resources only under their actual parent', () => {
            expect(() => enforceChildResourceScope('list-1', 'list-1', 'item-1')).not.toThrow();
        });

        it('rejects a child ID combined with a different parent URL', () => {
            expect(() => enforceChildResourceScope('list-1', 'list-2', 'item-2')).toThrowError(
                expect.objectContaining({status: 404}),
            );
        });
    });

    describe('list limit input shaping', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('uses the requested API limit when it is within bounds', () => {
            const limitCase = createQueryLimitCase();
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('falls back to the endpoint default for non-numeric limits', () => {
            const limitCase = createQueryLimitCase({input: 'many', expectedLimit: 10});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('caps list limits at the endpoint maximum to protect expensive queries', () => {
            const limitCase = createQueryLimitCase({input: '100', expectedLimit: 25});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('uses endpoint-specific defaults for optional list limits', () => {
            const limitCase = createQueryLimitCase({input: undefined, defaultLimit: 50, maxLimit: 100, expectedLimit: 50});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('raises empty list limits to the minimum page size', () => {
            const limitCase = createQueryLimitCase({input: '', expectedLimit: 1});
            expect(coerceLimit(limitCase.input, limitCase.defaultLimit, limitCase.maxLimit)).toBe(limitCase.expectedLimit);
        });
    });

    describe('search query allow-list contract', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows ordinary names used by user and entity search endpoints', () => {
            expect(SQL_ALLOW_LIST.test('summer camp')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows email fragments used by participant search endpoints', () => {
            expect(SQL_ALLOW_LIST.test('camper@example.com')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('allows plus and dash characters used in real account identifiers', () => {
            expect(SQL_ALLOW_LIST.test('alex+driver-1')).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rejects very short broad searches that would create noisy scans', () => {
            expect(SQL_ALLOW_LIST.test('ab')).toBe(false);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rejects SQL wildcard and statement characters from search input', () => {
            expect(SQL_ALLOW_LIST.test("%' OR 1=1 --")).toBe(false);
        });
    });
});
