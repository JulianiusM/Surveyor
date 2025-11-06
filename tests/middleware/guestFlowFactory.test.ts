/**
 * Tests for createGuestFlowRouter middleware
 */

import express from 'express';
import request from 'supertest';
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';
import {createGuestFlowRouter} from '../../src/middleware/guestFlowFactory';

// ---- Mocks ----
jest.mock('../../src/modules/renderer', () => ({
    __esModule: true,
    default: {
        renderWithData: (res: any, tpl: string, data: any) =>
            res.status(200).json({tpl, data}),
    },
}));

const sendLinkEmail = jest.fn();
jest.mock('../../src/modules/email', () => ({
    __esModule: true,
    default: {sendLinkEmail: (...args: any[]) => sendLinkEmail(...args)},
}));

jest.mock('../../src/modules/settings', () => ({
    __esModule: true,
    default: {value: {rootUrl: 'http://app.local'}},
}));

jest.mock('../../src/middleware/permissionMiddleware', () => ({
    isAuthenticated: (_req: any, _res: any, next: any) => next(),
    isEventPermitted:
        (_addToEvent: boolean, _eventResFn: any) => (_req: any, _res: any, next: any) => next(),
    requireEventParticipant:
        (_eventResFn: any) => (_req: any, _res: any, next: any) => next(),
    requireOwner:
        (_resFct: any) => (_req: any, _res: any, next: any) => next(),
}));

// Bind :id and ?eventId into req.resources so getResource() can pick them up.
jest.mock('../../src/middleware/paramHandler', () => ({
    paramHandler: (name: string, router: any, getById: any, type: string) => {
        router.param(name, async (req: any, _res: any, next: any, id: string) => {
            const ent = await getById(id);
            req.resources = {...(req.resources || {}), [type]: ent};
            next();
        });
    },
    queryHandler: (name: string, router: any, getById: any, type: string) => {
        router.use(async (req: any, _res: any, next: any) => {
            const id = req.query?.[name] as string | undefined;
            if (id) {
                const ent = await getById(id);
                req.resources = {...(req.resources || {}), [type]: ent};
            }
            next();
        });
    },
}));

jest.mock('../../src/modules/lib/util', () => ({
    // make the controller pull the resource from our req.resources
    getResource: (req: any, type: string) => req.resources?.[type],
}));

// services only used by queryHandler(addToEvent)
jest.mock('../../src/modules/database/services/EventService', () => ({
    getEventById: jest.fn(async (id: string) => ({id, title: `Event ${id}`})),
}));

// ---- Test helpers ----
function makeApp(router: express.Router, withSession?: Partial<any>) {
    const app = express();
    app.use(express.urlencoded({extended: false}));
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as any).session = {...(withSession || {})};
        (req as any).flash = jest.fn(); // we won’t assert this directly
        next();
    });
    app.use(router);

    // error handler to convert controller errors to JSON for assertions
    app.use((err: any, _req: any, res: any, _next: any) => {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                kind: 'validation',
                template: err.template,
                message: err.message,
                data: err.data
            });
        }
        if (err instanceof ExpectedError) {
            return res.status(err.status ?? 400).json({kind: 'expected', level: err.severity, message: err.message});
        }
        return res.status(500).json({kind: 'error', message: err?.message || 'error'});
    });
    return app;
}

// minimal controller config we pass to the factory per test
function makeConfig(overrides: Partial<Parameters<typeof createGuestFlowRouter>[0]> = {}) {
    const base = {
        entityType: 'activity',
        addToEvent: false,
        templates: {create: 'activity/create', view: 'activity/view'},
        buildRedirect: (id: string) => `/activity/${id}`,
        db: {
            getById: async (id: string) => ({id, title: `Plan ${id}`}),
            registerGuest: async (_t: string, _id: string, username: string, email?: string) => ({
                guestId: 77,
                token: 'tok-xyz',
                username,
                email,
            }),
            getGuestInternal: async (guestId: number) => ({id: guestId, email: 'g@x'}),
            getGuestByToken: async (token: string, _t: string, entityId: string) =>
                token === 'tok-xyz' ? ({id: 77, email: 'g@x', entityId}) : null,
            getGuestLinkToken: async () => 'existing-token',
            createGuestLink: async () => 'new-token',
        },
        preprocessCreate: (body: any) => ({ok: true, title: body.title}),
        createEntity: async (_ownerId: number, _data: any) => 'new-123',
        afterCreateItems: async () => {
        },
        fetchForView: async (plan: any, _session: any) => ({plan, x: 1}),
        fetchForDuplicate: async (_plan: any, _session: any) => ({cloned: true}),
        deleteEntity: async () => {
        },
    };
    return {...base, ...overrides} as any;
}

// ---- Tests ----
describe('guestFlowRouter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /create renders create template (no event)', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()));
        const res = await request(app).get('/create');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('activity/create');
        // eventId omitted (undefined)
    });

    test('POST /create happy path redirects to buildRedirect', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()), {user: {id: 5}});
        const res = await request(app).post('/create').send({title: 'My Plan'});
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/activity/new-123');
    });

    test('POST /create validation error from preprocess', async () => {
        const cfg = makeConfig({
            preprocessCreate: () => ({error: {msg: 'Bad', data: {a: 1}}}),
        });
        const app = makeApp(createGuestFlowRouter(cfg), {user: {id: 1}});
        const res = await request(app).post('/create').send({});
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('validation');
        expect(res.body.template).toBe('activity/create');
    });

    test('POST /create wraps createEntity errors as ValidationError', async () => {
        const cfg = makeConfig({
            createEntity: async () => {
                throw new Error('boom');
            },
        });
        const app = makeApp(createGuestFlowRouter(cfg), {user: {id: 1}});
        const res = await request(app).post('/create').send({title: 'x'});
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('validation');
        expect(res.body.template).toBe('activity/create');
    });

    test('GET /:id/guest renders guest registration unless session present', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()));
        const res = await request(app).get('/abc/guest');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('users/register-guest');
        expect(res.body.data).toMatchObject({entityType: 'activity', entityId: 'abc', title: 'Plan abc'});
    });

    test('POST /:id/guest registers, emails link, redirects to entity', async () => {
        const cfg = makeConfig();
        const app = makeApp(createGuestFlowRouter(cfg));
        const res = await request(app).post('/abc/guest').send({username: 'guest1', email: 'g@x'});
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/activity/abc');
        // mail with built link
        expect(sendLinkEmail).toHaveBeenCalledTimes(1);
        const link = (sendLinkEmail.mock.calls[0] as any[])[1];
        expect(link).toBe('http://app.local/activity/abc/edit/tok-xyz');
    });

    test('POST /:id/guest requires username', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()));
        const res = await request(app).post('/abc/guest').send({username: '', email: 'g@x'});
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('validation');
        expect(res.body.template).toBe('users/register-guest');
    });

    test('GET /:id/edit/:token switches to guest on valid token; 401 otherwise', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()));
        const ok = await request(app).get('/abc/edit/tok-xyz');
        expect(ok.status).toBe(302);
        expect(ok.headers.location).toBe('/activity/abc');

        const bad = await request(app).get('/abc/edit/bad-token');
        expect(bad.status).toBe(401);
        expect(bad.body.kind).toBe('expected');
    });

    test('GET /:id/duplicate renders duplicate form', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()), {user: {id: 1}});
        const res = await request(app).get('/abc/duplicate');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('activity/create');
        expect(res.body.data).toMatchObject({
            isDuplicate: true,
            title: 'Copy of Plan abc',
            entity: {id: 'abc', title: 'Plan abc'},
            data: {cloned: true},
        });
    });

    test('POST /:id/delete deletes and redirects to dashboard', async () => {
        const del = jest.fn(async () => {
        });
        const cfg = makeConfig({deleteEntity: del});
        const app = makeApp(createGuestFlowRouter(cfg), {user: {id: 1}});
        const res = await request(app).post('/abc/delete');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/users/dashboard');
        expect(del).toHaveBeenCalled();
    });

    test('SAFE-ZONE: user session passes through and renders view', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()), {user: {id: 99}});
        const res = await request(app).get('/abc');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('activity/view');
        expect(res.body.data).toMatchObject({plan: {id: 'abc', title: 'Plan abc'}, x: 1});
    });

    test('SAFE-ZONE: guest session ensures link token (create if missing), emails, then renders view', async () => {
        const cfg = makeConfig({
            db: {
                ...makeConfig().db,
                getGuestLinkToken: async () => null,       // force creation
                createGuestLink: async () => 'new-token',
            },
        });
        const app = makeApp(createGuestFlowRouter(cfg), {guest: {id: 77, email: 'g@x'}});
        const res = await request(app).get('/abc');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('activity/view');
        expect(sendLinkEmail).toHaveBeenCalledTimes(1);
        expect((sendLinkEmail.mock.calls[0] as any[])[1]).toBe('http://app.local/activity/abc/edit/new-token');
    });

    test('SAFE-ZONE: no session redirects to /:id/guest', async () => {
        const app = makeApp(createGuestFlowRouter(makeConfig()));
        const res = await request(app).get('/abc');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/activity/abc/guest');
    });

    test('GET /:id returns 400 ValidationError when fetchForView falsy', async () => {
        const cfg = makeConfig({fetchForView: async () => null});
        const app = makeApp(createGuestFlowRouter(cfg), {user: {id: 1}});
        const res = await request(app).get('/abc');
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('validation');
        expect(res.body.template).toBe('activity/view');
    });

    test('GET /create with addToEvent uses queryHandler (eventId in data)', async () => {
        const cfg = makeConfig({addToEvent: true});
        const app = makeApp(createGuestFlowRouter(cfg), {user: {id: 1}});
        const res = await request(app).get('/create?eventId=E1');
        expect(res.status).toBe(200);
        expect(res.body.tpl).toBe('activity/create');
        // we at least see the eventId fed back
        expect(res.body.data).toMatchObject({eventId: 'E1'});
    });
});
