/**
 * Unit tests for util helpers (data-driven and keyword-driven approach)
 * Tests: generateUniqueToken, generateUniqueId, date/time helpers,
 * rewriteISOToZone, performAPIAction, getResource, getAdditional, isWithinWindow, ignoreException
 */
import type { Request } from 'express';

// Import test data
import {
    toLocalISODateData,
    toLocalISOTimeData,
    rewriteISOToZoneData,
    fromISOtoLocalData,
    performAPIActionUserData,
    performAPIActionGuestData,
    getResourceData,
    isWithinWindowData,
    ignoreExceptionData,
} from '../data/unit/utilData';

// Utility to (re)load the module with mocks in place
async function importWithMocks() {
    jest.resetModules();
    // Mock 'uuid' to be deterministic
    jest.doMock('uuid', () => ({
        __esModule: true,
        v4: () => '00000000-0000-4000-8000-000000000000',
        default: { v4: () => '00000000-0000-4000-8000-000000000000' },
    }));

    // Mock 'crypto' randomBytes to return fixed content (hex string becomes '01' * 32 bytes)
    jest.doMock('crypto', () => ({
        __esModule: true,
        randomBytes: (n: number) => Buffer.alloc(n, 1),
        default: { randomBytes: (n: number) => Buffer.alloc(n, 1) },
    }));

    return await import('../../src/modules/lib/util');
}

describe('util helpers - Data Driven', () => {
    test('generateUniqueToken produces 64-hex chars (deterministic via crypto mock)', async () => {
        const { generateUniqueToken } = await importWithMocks();
        const token = generateUniqueToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        // Buffer.alloc(32,1) => "01" repeated 32 times
        expect(token).toBe('01'.repeat(32));
    });

    test('generateUniqueId delegates to uuid.v4 (deterministic via mock)', async () => {
        const { generateUniqueId } = await importWithMocks();
        const id = generateUniqueId();
        expect(id).toBe('00000000-0000-4000-8000-000000000000');
    });

    describe('toLocalISODate', () => {
        test.each(toLocalISODateData)('$description', async ({ input, expected }) => {
            const { toLocalISODate } = await importWithMocks();
            const result = toLocalISODate(input);
            expect(result).toBe(expected);
        });
    });

    describe('toLocalISOTime', () => {
        test.each(toLocalISOTimeData)('$description', async ({ input, expected }) => {
            const { toLocalISOTime } = await importWithMocks();
            const result = toLocalISOTime(input);
            expect(result).toBe(expected);
        });
    });

    describe('rewriteISOToZone', () => {
        test.each(rewriteISOToZoneData)('$description', async ({ input, expected }) => {
            const { rewriteISOToZone } = await importWithMocks();
            const result = rewriteISOToZone(input[0], input[1]);
            expect(result).toBe(expected);
        });
    });

    describe('fromISOtoLocal', () => {
        test.each(fromISOtoLocalData)('$description', async ({ input, expected }) => {
            const { fromISOtoLocal } = await importWithMocks();
            const result = fromISOtoLocal(input);
            expect(result.toISOString()).toBe(expected);
        });
    });

    describe('performAPIAction', () => {
        describe('with user session', () => {
            test.each(performAPIActionUserData)(
                '$description',
                async ({ body, session, expectedArgs }) => {
                    const { performAPIAction } = await importWithMocks();
                    const userAction = jest.fn(async () => {});
                    const guestAction = jest.fn(async () => {});

                    const req = { session, body } as unknown as Request;
                    await performAPIAction(req, { actionUser: userAction, actionGuest: guestAction });

                    expect(userAction).toHaveBeenCalledWith(...expectedArgs);
                    expect(guestAction).not.toHaveBeenCalled();
                }
            );
        });

        describe('with guest session', () => {
            test.each(performAPIActionGuestData)(
                '$description',
                async ({ body, session, expectedArgs }) => {
                    const { performAPIAction } = await importWithMocks();
                    const userAction = jest.fn(async () => {});
                    const guestAction = jest.fn(async () => {});

                    const req = { session, body } as unknown as Request;
                    await performAPIAction(req, { actionUser: userAction, actionGuest: guestAction });

                    expect(guestAction).toHaveBeenCalledWith(...expectedArgs);
                    expect(userAction).not.toHaveBeenCalled();
                }
            );
        });

        test('throws APIError when neither user nor guest', async () => {
            const { performAPIAction } = await importWithMocks();
            const userAction = jest.fn(async () => {});
            const guestAction = jest.fn(async () => {});

            const reqNone = { session: {}, body: {} } as unknown as Request;
            await expect(
                performAPIAction(reqNone, { actionUser: userAction, actionGuest: guestAction })
            ).rejects.toMatchObject({ name: 'APIError', status: 401 });
        });
    });

    describe('getResource', () => {
        test.each(getResourceData)('$description', async ({ resource, key, expected }) => {
            const { getResource } = await importWithMocks();
            const req = { resource } as any;
            const result = getResource(req, key);
            expect(result).toEqual(expected);
        });
    });

    describe('getAdditional', () => {
        test('appends resource item to list', async () => {
            const { getAdditional } = await importWithMocks();
            const req = { resource: { event: { id: 1 }, user: { id: 2 } } } as any;
            const list: any[] = [123];
            const result = getAdditional(req, 'user', list);
            expect(result).toBe(list);
            expect(result).toEqual([123, { id: 2 }]);
        });

        test('handles empty list', async () => {
            const { getAdditional } = await importWithMocks();
            const req = { resource: { event: { id: 1 } } } as any;
            const list: any[] = [];
            const result = getAdditional(req, 'event', list);
            expect(result).toEqual([{ id: 1 }]);
        });

        test('handles missing resource key', async () => {
            const { getAdditional } = await importWithMocks();
            const req = { resource: { event: { id: 1 } } } as any;
            const list: any[] = [456];
            const result = getAdditional(req, 'missing', list);
            expect(result).toEqual([456, undefined]);
        });
    });

    describe('isWithinWindow', () => {
        test.each(isWithinWindowData)(
            '$description',
            async ({ start, end, a, d, expected }) => {
                const { isWithinWindow } = await importWithMocks();
                const result = isWithinWindow(start, end, a, d);
                expect(result).toBe(expected);
            }
        );
    });

    describe('ignoreException', () => {
        test.each(ignoreExceptionData)(
            '$description',
            async ({ fn, expected, shouldWarn }) => {
                const { ignoreException } = await importWithMocks();
                const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

                const result = await ignoreException(fn);
                expect(result).toEqual(expected);

                if (shouldWarn) {
                    expect(spy).toHaveBeenCalled();
                } else {
                    expect(spy).not.toHaveBeenCalled();
                }

                spy.mockRestore();
            }
        );
    });
});
