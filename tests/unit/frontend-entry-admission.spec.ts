import {describe, expect, it} from 'vitest';
import type {Request} from 'express';
import {getAccountPageEntry} from '../../src/controller/userController';
import {getEntityViewAdmission} from '../../src/controller/entityAdminController';
import {readPackingCreateEntry} from '../../src/modules/packing/api';
import {captureApiActor} from '../../src/modules/api/session';
import {contractValidator} from '../../src/modules/api/contracts';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

describe('shared server-owned page admission', () => {
    it('admits account creation and sends guests/anonymous users to login with the exact duplicate return', async () => {
        const destination = '/frontend-pilot/packing/84305c09-5386-47bc-b62d-520b8a8edbb2/duplicate';
        const result = await readPackingCreateEntry({}, destination);
        expect(result).toEqual({entry: {kind: 'redirect', url: `/frontend-pilot/users/login?next=${encodeURIComponent(destination)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
        expect(contractValidator('PackingCreateEntry')(result)).toBe(true);
        expect(getAccountPageEntry({auth: {guest: new Guest()}, profile: new Profile()}, '/users/login', '/activity/source/duplicate').kind)
            .toBe('redirect');
        expect((await readPackingCreateEntry({auth: {user: new User()}, profile: new Profile()})).entry).toEqual({kind: 'render'});
        expect((await readPackingCreateEntry({auth: {user: new User()}})).context).toBeNull();
        expect(Object.hasOwn(result, 'selectedEvent')).toBe(false);
        const contextual = await readPackingCreateEntry({}, destination, 'unadmitted-context');
        expect(contextual.selectedEvent).toBeNull();
        expect(contractValidator('PackingCreateEntry')(contextual)).toBe(true);
    });

    it('preserves standalone guest entry and attached anonymous denial before any DB-dependent checks', async () => {
        const root = {id: 'source', ownerId: 'owner', eventId: null};
        expect(await getEntityViewAdmission('packing', root, {})).toBe('guest');
        expect(await getEntityViewAdmission('packing', {...root, eventId: 'event'}, {})).toBe('event-registration-required');
        expect(await getEntityViewAdmission('packing', root, {profile: new Profile()})).toBe('render');
    });

    it('keeps document logout evidence until native logout, while API expiry clears invalid identity', async () => {
        function request(): Request {
            const stored = {auth: {user: new User(), guest: new Guest()}, profile: new Profile(),
                frontendContext: 'captured-context', tokens: {id_token: 'provider-logout-evidence'},
                save(done: (error?: unknown) => void) { done(); }};
            return {session: stored, sessionID: 'fixture', sessionStore: {
                get(_id: string, done: (error: unknown, session: typeof stored) => void) { done(null, stored); },
                createSession(req: Request) { req.session = stored as unknown as Request['session']; },
            }} as unknown as Request;
        }
        const document = request();
        await expect(captureApiActor(document, true)).rejects.toMatchObject({code: 'AUTH_REQUIRED'});
        expect(document.session.tokens).toEqual({id_token: 'provider-logout-evidence'});
        expect(document.session.auth?.user).toBeDefined();
        const api = request();
        await expect(captureApiActor(api)).rejects.toMatchObject({code: 'AUTH_REQUIRED'});
        expect(api.session.tokens).toBeUndefined();
        expect(api.session.auth).toBeUndefined();
        expect(api.session.frontendContext).not.toBe('captured-context');
    });

    it('does not mistake an unavailable session store for an expired identity', async () => {
        const failure = new Error('fixture store unavailable');
        const req = {session: {frontendContext: 'known'}, sessionID: 'fixture',
            sessionStore: {get(_id: string, done: (error: Error) => void) { done(failure); }}} as unknown as Request;
        await expect(captureApiActor(req, true)).rejects.toBe(failure);
        expect(req.session.frontendContext).toBe('known');
    });
});
