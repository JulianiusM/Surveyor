import {describe, expect, it} from 'vitest';
import type {Request} from 'express';
import {getAccountPageEntry} from '../../src/backend/controller/userController';
import {getEntityViewAdmission} from '../../src/backend/modules/event/linkage';
import {requirePackingCreation} from '../../src/backend/controller/packingController';
import {requireDriversCreation} from '../../src/backend/controller/driversController';
import {requireSurveyCreation} from '../../src/backend/controller/surveyController';
import {readActivityCreateContext} from '../../src/backend/controller/activityController';
import {eventFormContext, requireEventCreation} from '../../src/backend/controller/eventController';
import {createGuestFlow} from '../../src/backend/middleware/guestFlowFactory';
import {packingFlow} from '../../src/backend/routes/packingFlow';
import {driversFlow} from '../../src/backend/routes/driversFlow';
import {surveyFlow} from '../../src/backend/routes/surveyFlow';
import {activityFlow} from '../../src/backend/routes/activityFlow';
import {eventFlow} from '../../src/backend/routes/eventFlow';
import {captureApiActor} from '../../src/backend/modules/api/session';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {User} from '../../src/backend/modules/database/entities/user/User';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import type {EntityType} from '../../src/types/UtilTypes';
import type {EntityBase} from '../../src/types/UserTypes';
import type {GuestFlow} from '../../src/types/GuestFlowTypes';

const resourceTypes: EntityType[] = ['packing', 'drivers', 'survey', 'activity', 'event'];
const resourceId = '84305c09-5386-47bc-b62d-520b8a8edbb2';

/** Exercise actual feature admission configuration with database reads outside this unit boundary. */
function fixtureFlow<Type extends EntityType, Root extends EntityBase>(flow: GuestFlow<Type, Root>, root: EntityBase | null) {
    const row = root as Root | null;
    return createGuestFlow({...flow.config,
        async loadRoot() { return row; },
        async withRoot(_id, operation) { return operation(row); },
    });
}

const resourceFixtures = {
    packing: (root: EntityBase | null) => fixtureFlow(packingFlow, root),
    drivers: (root: EntityBase | null) => fixtureFlow(driversFlow, root),
    survey: (root: EntityBase | null) => fixtureFlow(surveyFlow, root),
    activity: (root: EntityBase | null) => fixtureFlow(activityFlow, root),
    event: (root: EntityBase | null) => fixtureFlow(eventFlow, root),
};

const requireCreation = {
    packing: requirePackingCreation,
    drivers: requireDriversCreation,
    survey: requireSurveyCreation,
    activity: readActivityCreateContext,
    event: requireEventCreation,
};

describe('shared server-owned page admission', () => {
    it('admits account creation and sends guests/anonymous users to login with the exact duplicate return', async () => {
        const destination = '/packing/84305c09-5386-47bc-b62d-520b8a8edbb2/duplicate';
        const result = await packingFlow.readCreateEntry({}, destination);
        expect(result).toEqual({entry: {kind: 'redirect', url: `/users/login?next=${encodeURIComponent(destination)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
        expect(contractValidator('EntityCreationEntry')(result)).toBe(true);
        expect(getAccountPageEntry({auth: {guest: new Guest()}, profile: new Profile()}, '/users/login', '/activity/source/duplicate').kind)
            .toBe('redirect');
        expect((await packingFlow.readCreateEntry({auth: {user: new User()}, profile: new Profile()})).entry).toEqual({kind: 'render'});
        expect((await packingFlow.readCreateEntry({auth: {user: new User()}})).context).toBeNull();
        expect(Object.hasOwn(result, 'selectedEvent')).toBe(false);
        const contextual = await packingFlow.readCreateEntry({}, destination, 'unadmitted-context');
        expect(contextual.selectedEvent).toBeNull();
        expect(contractValidator('EntityCreationEntry')(contextual)).toBe(true);
    });

    it('preserves standalone guest entry and attached anonymous denial before any DB-dependent checks', async () => {
        const root = {id: 'source', ownerId: 'owner', eventId: null};
        expect(await getEntityViewAdmission('packing', root, {})).toBe('guest');
        expect(await getEntityViewAdmission('packing', {...root, eventId: 'event'}, {})).toBe('event-registration-required');
        expect(await getEntityViewAdmission('packing', root, {profile: new Profile()})).toBe('render');
    });

    it.each(resourceTypes)('shares %s guest/detail admission without disclosing private root fields', async type => {
        const root = {id: resourceId, title: 'Public guest title', ownerId: 'private-owner', description: 'Private detail'};
        const session = {profile: new Profile()};
        const flow = resourceFixtures[type](root);
        expect(await resourceFixtures[type](null).readResourceEntry(resourceId, 'guest', session))
            .toEqual({entry: {kind: 'denied', status: 404, messageKey: `${type}.notFound`}, guest: null});
        expect(await flow.readResourceEntry(resourceId, 'detail', {}))
            .toEqual({entry: {kind: 'redirect', url: `/${type}/${resourceId}/guest`, notice: null}, guest: null});
        expect(await flow.readResourceEntry(resourceId, 'detail', session))
            .toEqual({entry: {kind: 'render'}, guest: null});
        const guest = await flow.readResourceEntry(resourceId, 'guest', {});
        expect(guest).toEqual({entry: {kind: 'render'}, guest: {id: resourceId, title: 'Public guest title'}});
        expect(contractValidator('EntityResourceEntry')(guest)).toBe(true);
        expect(await flow.readResourceEntry(resourceId, 'guest', session))
            .toEqual({entry: {kind: 'redirect', url: `/${type}/${resourceId}`, notice: null}, guest: null});
        expect(await flow.readGuestEntry(resourceId)).toEqual({id: resourceId, title: 'Public guest title'});
        expect(root.description).toBe('Private detail');
    });

    it.each(['packing', 'drivers', 'activity'] as const)('keeps %s attached denial before anonymous detail redirects', async type => {
        const root = {id: resourceId, title: 'Public title', ownerId: 'owner', eventId: 'private-event'};
        const flow = resourceFixtures[type](root);
        expect(await flow.readResourceEntry(resourceId, 'detail', {}))
            .toEqual({entry: {kind: 'denied', status: 400, messageKey: `${type}.eventRegistrationRequired`}, guest: null});
        expect(await flow.readResourceEntry(resourceId, 'guest', {}))
            .toEqual({entry: {kind: 'render'}, guest: {id: resourceId, title: 'Public title'}});
    });

    it('carries Event token navigation without changing the token or making attendance', async () => {
        const root = {id: resourceId, title: 'Event', ownerId: 'owner'};
        const query = new URLSearchParams({regToken: 'opaque +&? token'});
        const flow = resourceFixtures.event(root);
        expect(await flow.readResourceEntry(resourceId, 'detail', {}, query.get('regToken')!))
            .toEqual({entry: {kind: 'redirect', url: `/event/${resourceId}/guest?${query}`, notice: null}, guest: null});
        expect(await flow.readResourceEntry(resourceId, 'guest', {profile: new Profile()}, query.get('regToken')!))
            .toEqual({entry: {kind: 'redirect', url: `/event/${resourceId}?${query}`, notice: null}, guest: null});
        expect(query.get('regToken')).toBe('opaque +&? token');
    });

    it('preserves feature-owned input identifier spelling without changing the authoritative row', async () => {
        const root = {id: resourceId, title: 'Public title', ownerId: 'owner'};
        const requestedId = resourceId.toUpperCase();
        for (const type of ['activity', 'survey', 'event'] as const) {
            const entry = await resourceFixtures[type](root).readResourceEntry(requestedId, 'detail', {});
            expect(entry.entry).toEqual({kind: 'redirect', url: `/${type}/${requestedId}/guest`, notice: null});
        }
        expect((await resourceFixtures.activity(root).readResourceEntry(requestedId, 'guest', {})).guest)
            .toEqual({id: requestedId, title: 'Public title'});
        expect((await resourceFixtures.event(root).readResourceEntry(requestedId, 'guest', {})).guest)
            .toEqual({id: resourceId, title: 'Public title'});
        expect(root.id).toBe(resourceId);
    });

    it('adopts common creation admission in every feature while retaining event-context and Survey differences', async () => {
        const entries = [
            packingFlow.readCreateEntry({}, '/packing/source/duplicate', 'private-event'),
            driversFlow.readCreateEntry({}, '/drivers/source/duplicate', 'private-event'),
            surveyFlow.readCreateEntry({}, '/survey/source/duplicate'),
            activityFlow.readCreateEntry({}, '/activity/source/duplicate', 'private-event'),
            eventFlow.readCreateEntry({}, '/event/source/duplicate'),
        ];
        const results = await Promise.all(entries);
        for (const [index, type] of resourceTypes.entries()) {
            expect(results[index]).toMatchObject({entry: {kind: 'redirect',
                url: `/users/login?next=${encodeURIComponent(`/${type}/source/duplicate`)}`,
                notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
        }
        expect(results[0]).toHaveProperty('selectedEvent', null);
        expect(results[1]).toHaveProperty('selectedEvent', null);
        expect(results[3]).toHaveProperty('selectedEvent', null);
        expect(results[2]).not.toHaveProperty('selectedEvent');
        expect(results[4]).not.toHaveProperty('selectedEvent');
        const account = {auth: {user: new User()}, profile: new Profile()};
        expect(await surveyFlow.readCreateEntry(account)).toEqual({entry: {kind: 'render'}, context: {}});
        expect(await eventFlow.readCreateEntry(account)).toEqual({entry: {kind: 'render'}, context: eventFormContext()});
    });

    it.each(resourceTypes)('retains %s creation command identity and account diagnostics', type => {
        expect(() => requireCreation[type]({})).toThrowError(expect.objectContaining({code: 'AUTH_REQUIRED'}));
        const profile = Object.assign(new Profile(), {id: 'profile'});
        expect(() => requireCreation[type]({profile, auth: {guest: new Guest()}}))
            .toThrowError(expect.objectContaining({code: 'FORBIDDEN'}));
        expect(() => requireCreation[type]({profile, auth: {user: new User()}})).not.toThrow();
        // Event historically admits an account's profile object; other commands
        // require an identifier. Preserve that contract rather than tightening it.
        const idless = {profile: new Profile(), auth: {user: new User()}};
        if (type === 'event') expect(() => requireCreation[type](idless)).not.toThrow();
        else expect(() => requireCreation[type](idless)).toThrowError(expect.objectContaining({code: 'AUTH_REQUIRED'}));
    });

    it('keeps document logout evidence until native logout', async () => {
        function request(): Request {
            const stored = {auth: {user: new User(), guest: new Guest()}, profile: new Profile(),
                frontendContext: 'captured-context', frontendCsrfToken: 'captured-csrf',
                tokens: {id_token: 'provider-logout-evidence'},
                save(done: (error?: unknown) => void) { done(); }};
            return {session: stored, sessionID: 'fixture', sessionStore: {
                get(_id: string, done: (error: unknown, session: typeof stored) => void) { done(null, stored); },
                createSession(req: Request) { req.session = stored as unknown as Request['session']; },
            }} as unknown as Request;
        }
        const document = request();
        await expect(captureApiActor(document)).rejects.toMatchObject({code: 'AUTH_REQUIRED'});
        expect(document.session.tokens).toEqual({id_token: 'provider-logout-evidence'});
        expect(document.session.auth?.user).toBeDefined();
        // Admission rejects invalid server evidence without clearing it. Explicit
        // native logout remains the owner of provider cleanup and session writes.
    });

    it('does not mistake an unavailable session store for an expired identity', async () => {
        const failure = new Error('fixture store unavailable');
        const req = {session: {frontendContext: 'known'}, sessionID: 'fixture',
            sessionStore: {get(_id: string, done: (error: Error) => void) { done(failure); }}} as unknown as Request;
        await expect(captureApiActor(req)).rejects.toBe(failure);
        expect(req.session.frontendContext).toBe('known');
    });
});
