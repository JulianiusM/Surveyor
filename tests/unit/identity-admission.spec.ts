import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Request, Response} from 'express';
import type {IdentityAdmission, IdentityAdmissionLimits} from '../../src/types/IdentityAdmissionTypes';
import {createIdentityAdmission} from '../../src/backend/middleware/identityAdmission';
import settings from '../../src/backend/modules/settings';
import {MemoryStore} from 'express-rate-limit';

const owners: IdentityAdmission[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

function admission(overrides: Partial<IdentityAdmissionLimits> = {}): IdentityAdmission {
    const owner = createIdentityAdmission({...settings.value, ...overrides});
    owners.push(owner);
    return owner;
}
function request(ip = '192.0.2.1'): Request {
    return {ip, socket: {remoteAddress: ip}, originalUrl: '/api/v1/auth/login'} as unknown as Request;
}
function response() {
    const headers: Record<string, string> = {};
    const res = {set(name: string, value: string) { headers[name] = value; return this; }} as unknown as Response;
    return {res, headers};
}
const invalidCredentials = () => new Error('Credential rejection', {cause: 'INVALID_CREDENTIALS'});

describe('shared identity HTTP budgets', () => {
    it('retains the client failure budget across changed identifiers and successful authentication', async () => {
        const owner = admission({authLoginFailureClientLimit: 3});
        for (const [index, name] of ['first', 'second'].entries()) {
            const attempt = await owner.login(request(), response().res, name);
            await attempt.account(index + 1);
            await attempt.finish(invalidCredentials());
        }
        const success = await owner.login(request(), response().res, 'valid@example.test');
        await success.account(7);
        await success.verified();
        await success.succeeded();
        await success.finish();
        const thirdFailure = await owner.login(request(), response().res, 'another-name');
        await thirdFailure.account(null);
        await thirdFailure.finish(invalidCredentials());
        const blocked = response();
        await expect(owner.login(request(), blocked.res, 'new-spelling')).rejects.toMatchObject({code: 'RATE_LIMITED', status: 429});
        expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
    });

    it('collapses resolved username/email aliases across clients and clears only successful account history', async () => {
        const owner = admission({authLoginAccountLimit: 2, authLoginFailureClientLimit: 20});
        const first = await owner.login(request('192.0.2.1'), response().res, 'CaseAlias');
        await first.account(42);
        await first.finish(invalidCredentials());
        const success = await owner.login(request('192.0.2.2'), response().res, 'mail@example.test');
        await success.account(42);
        await success.verified();
        await success.succeeded();
        await success.finish();
        for (const [index, alias] of ['casealias', 'MAIL@example.test'].entries()) {
            const failure = await owner.login(request('192.0.2.' + (index + 3)), response().res, alias);
            await failure.account(42);
            await failure.finish(invalidCredentials());
        }
        const blocked = await owner.login(request('192.0.2.5'), response().res, 'another-accepted-alias');
        await expect(blocked.account(42)).rejects.toMatchObject({code: 'RATE_LIMITED'});
        await blocked.finish();
    });

    it('reserves in-flight credential work and does not charge operational failures', async () => {
        const owner = admission({authLoginFailureClientLimit: 2});
        const first = await owner.login(request(), response().res, 'one');
        const second = await owner.login(request(), response().res, 'two');
        await expect(owner.login(request(), response().res, 'three')).rejects.toMatchObject({code: 'RATE_LIMITED'});
        await first.finish(new Error('Identity lookup unavailable'));
        const replacement = await owner.login(request(), response().res, 'four');
        await replacement.finish();
        await second.finish();
    });

    it('keeps all-attempt admission separate and expires failures through the installed store', async () => {
        vi.useFakeTimers();
        const owner = admission({authLoginClientLimit: 2, authLoginFailureClientLimit: 1, authLoginWindowMinutes: 1});
        const failure = await owner.login(request(), response().res, 'unknown');
        await failure.account(null);
        await failure.finish(invalidCredentials());
        await expect(owner.login(request(), response().res, 'other')).rejects.toMatchObject({code: 'RATE_LIMITED'});
        await vi.advanceTimersByTimeAsync(60_001);
        const nextWindow = await owner.login(request(), response().res, 'unknown');
        await nextWindow.finish();
    });

    it('shares recipient pressure across case variants and request sources while retaining generic rejection', async () => {
        const owner = admission({authMailRecipientLimit: 2});
        await owner.mail(request('192.0.2.1'), response().res, 'Recipient@example.test');
        await owner.mail(request('192.0.2.2'), response().res, 'recipient@EXAMPLE.test');
        const blocked = response();
        await expect(owner.mail(request('192.0.2.3'), blocked.res, 'recipient@example.test'))
            .rejects.toMatchObject({code: 'RATE_LIMITED', params: {}});
        expect(blocked.headers['Retry-After']).toBeDefined();
        await owner.mail(request('192.0.2.4'), response().res, 'unknown@example.test');
    });

    it('cannot release a later failure when an older reservation straddles counter expiry', async () => {
        vi.useFakeTimers();
        const owner = admission({authLoginFailureClientLimit: 1, authLoginWindowMinutes: 1});
        const read = MemoryStore.prototype.get;
        let releaseRead!: () => void;
        const delayed = new Promise<void>(resolve => { releaseRead = resolve; });
        let held = false;
        // Exercise a counter read settling after expiry, rather than asserting
        // private call counts. Its result can now describe a successor window.
        vi.spyOn(MemoryStore.prototype, 'get').mockImplementation(async function getAfterExpiry(this: MemoryStore, key: string) {
            if (!held) { held = true; await delayed; }
            return read.call(this, key);
        });
        const older = owner.login(request(), response().res, 'old-request');
        for (let tick = 0; tick < 20; tick++) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(60_001);
        const newer = await owner.login(request(), response().res, 'new-request');
        await newer.account(null);
        await newer.finish(invalidCredentials());
        releaseRead();
        await (await older).finish();
        await expect(owner.login(request(), response().res, 'third-request')).rejects.toMatchObject({code: 'RATE_LIMITED'});
    });

    it.each(['signup', 'guestCreation', 'guestLookup'] as const)('bounds shared %s attempts across consumers', async operation => {
        const owner = admission({authSignupClientLimit: 2, authGuestCreationClientLimit: 2, authGuestLookupClientLimit: 2});
        await owner[operation](request(), response().res);
        await owner[operation](request(), response().res);
        await expect(owner[operation](request(), response().res)).rejects.toMatchObject({code: 'RATE_LIMITED'});
        await owner[operation](request('192.0.2.2'), response().res);
    });
});
