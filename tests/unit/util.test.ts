/**
 * Unit tests for util helpers (generateUniqueToken, generateUniqueId, date/time helpers,
 * rewriteISOToZone, performAPIAction, getResource, getAdditional, isWithinWindow, ignoreException).
 *
 * The module path below assumes the file is at src/modules/lib/util.ts.
 * If it differs in your repo, adjust the import path accordingly.
 */
import type {Request} from 'express';

// Utility to (re)load the module with mocks in place
async function importWithMocks() {
    jest.resetModules();
    // Mock 'uuid' to be deterministic
    jest.doMock('uuid', () => ({
        __esModule: true,
        v4: () => '00000000-0000-4000-8000-000000000000',
        default: {v4: () => '00000000-0000-4000-8000-000000000000'},
    }));

    // Mock 'crypto' randomBytes to return fixed content (hex string becomes '01' * 32 bytes)
    jest.doMock('crypto', () => ({
        __esModule: true,
        randomBytes: (n: number) => Buffer.alloc(n, 1),
        default: {randomBytes: (n: number) => Buffer.alloc(n, 1)},
    }));

    return await import('../../src/modules/lib/util');
}

describe('util helpers', () => {
    test('generateUniqueToken produces 64-hex chars (deterministic via crypto mock)', async () => {
        const {generateUniqueToken} = await importWithMocks();
        const token = generateUniqueToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        // Buffer.alloc(32,1) => "01" repeated 32 times
        expect(token).toBe('01'.repeat(32));
    });

    test('generateUniqueId delegates to uuid.v4 (deterministic via mock)', async () => {
        const {generateUniqueId} = await importWithMocks();
        const id = generateUniqueId();
        expect(id).toBe('00000000-0000-4000-8000-000000000000');
    });

    test('toLocalISODate / toLocalISOTime use UTC fields and formatting', async () => {
        const {toLocalISODate, toLocalISOTime} = await importWithMocks();
        const d = new Date(Date.UTC(2025, 5, 1, 12, 23, 45)); // 2025-06-01T12:23:45Z
        expect(toLocalISODate(d)).toBe('2025-06-01');
        expect(toLocalISOTime(d)).toBe('2025-06-01T12:23:45');
    });

    test('rewriteISOToZone rewrites offset without changing wall-clock fields (UTC)', async () => {
        const {rewriteISOToZone} = await importWithMocks() as any;
        // No seconds
        expect(rewriteISOToZone('2025-06-01T12:23Z', 'UTC')).toBe('2025-06-01T12:23+00:00');
        // With seconds and millis
        expect(rewriteISOToZone('2025-06-01T12:23:45.123Z', 'UTC')).toBe('2025-06-01T12:23:45.123+00:00');
        // Accepts ISO with offset input; still returns same wall time with target offset
        expect(rewriteISOToZone('2025-06-01T12:23:00+02:00', 'UTC')).toBe('2025-06-01T12:23:00+00:00');
    });

    test('fromISOtoLocal parses up to minutes into a UTC Date', async () => {
        const {fromISOtoLocal} = await importWithMocks();
        const dt = fromISOtoLocal('2025-06-01T12:23:15'); // seconds present
        expect(dt.toISOString()).toBe('2025-06-01T12:23:15.000Z');

        const dt2 = fromISOtoLocal('2025-06-01T12:23'); // seconds omitted -> 00
        expect(dt2.toISOString()).toBe('2025-06-01T12:23:00.000Z');
    });

    test('performAPIAction calls user or guest action, or throws APIError when none present', async () => {
        const {performAPIAction} = await importWithMocks();
        const body = {foo: 'bar'};

        const userAction = jest.fn(async () => {
        });
        const guestAction = jest.fn(async () => {
        });

        // Case 1: user
        const reqUser = {session: {user: {id: 42}}, body} as unknown as Request;
        await performAPIAction(reqUser, {actionUser: userAction, actionGuest: guestAction});
        expect(userAction).toHaveBeenCalledWith(body, 42);
        expect(guestAction).not.toHaveBeenCalled();
        userAction.mockClear();
        guestAction.mockClear();

        // Case 2: guest
        const reqGuest = {session: {guest: {id: 7}}, body} as unknown as Request;
        await performAPIAction(reqGuest, {actionUser: userAction, actionGuest: guestAction});
        expect(guestAction).toHaveBeenCalledWith(body, 7);
        expect(userAction).not.toHaveBeenCalled();
        userAction.mockClear();
        guestAction.mockClear();

        // Case 3: neither -> APIError
        const reqNone = {session: {}, body} as unknown as Request;
        await expect(performAPIAction(reqNone, {actionUser: userAction, actionGuest: guestAction}))
            .rejects.toMatchObject({name: 'APIError', status: 401});
    });

    test('getResource / getAdditional behavior', async () => {
        const {getResource, getAdditional} = await importWithMocks();
        const req = {resource: {event: {id: 1}, user: {id: 2}}} as any;
        expect(getResource(req, 'event')).toEqual({id: 1});
        expect(getResource(req, 'none')).toBeUndefined();

        const list: any[] = [123];
        const out = getAdditional(req, 'user', list);
        expect(out).toBe(list);
        expect(out).toEqual([123, {id: 2}]);
    });

    test('isWithinWindow checks inclusive scheduling window', async () => {
        const {isWithinWindow} = await importWithMocks();
        const start = new Date('2025-01-01T00:00:00Z');
        const end = new Date('2025-01-10T00:00:00Z');
        const a = new Date('2025-01-02T00:00:00Z');
        const d = new Date('2025-01-05T00:00:00Z');
        expect(isWithinWindow(start, end, a, d)).toBe(true);

        const outside = new Date('2025-01-11T00:00:00Z');
        expect(isWithinWindow(start, end, a, outside)).toBe(false);
    });

    test('ignoreException returns value or swallows error with console.warn', async () => {
        const {ignoreException} = await importWithMocks();
        const spy = jest.spyOn(console, 'warn').mockImplementation(() => {
        });

        const ok = await ignoreException(() => 123);
        expect(ok).toBe(123);

        const err = await ignoreException(() => {
            throw new Error('boom');
        });
        expect(err).toBeUndefined();
        expect(spy).toHaveBeenCalled();
    });
});
