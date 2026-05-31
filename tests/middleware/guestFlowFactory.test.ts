import express from 'express';
import request from 'supertest';
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';
import {createGuestFlowRouter} from '../../src/middleware/guestFlowFactory';
import * as testData from '../data/middleware/guestFlowFactoryData';

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
    default: {
        sendLinkEmail: (...args: any[]) => sendLinkEmail(...args),
    },
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
    requirePermission: (_getEntity: any, _requiredPerm: any) => (_req: any, _res: any, next: any) => next(),
    optionalPermission: (_getData: any, _requiredPerm: any, _getEntity: any) => (_req: any, _res: any, next: any) => next(),
    attachPermMeta: (_entityType: any, _idSupplyer?: any) => (_req: any, _res: any, next: any) => next(),
    attachPermBundle: (_getEntity: any, _getItems: any) => (_req: any, _res: any, next: any) => next(),
    attachAdminData: (_entityType: any, _idSupplyer?: any) => (_req: any, _res: any, next: any) => next(),
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
    // mock getItemFromEntityPermFct to return an empty function
    getItemFromEntityPermFct: jest.fn(() => async () => []),
}));

// services only used by queryHandler(addToEvent) and create route
jest.mock('../../src/modules/database/services/EventService', () => ({
    getEventById: jest.fn(async (id: string) => ({id, title: `Event ${id}`})),
    getActiveManagedEventsForUser: jest.fn(async () => []),
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
            registerGuest: async (_t: string, _id: string) => ({
                guestId: 77,
                token: 'tok-xyz',
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

    test(testData.getCreateRouteData.description, async () => {
        const {method, path, expected} = testData.getCreateRouteData;
        const app = makeApp(createGuestFlowRouter(makeConfig()), {user: {id: 1}});
        const res = await request(app)[method](path);
        expect(res.status).toBe(expected.status);
        expect(res.body.tpl).toBe(expected.tpl);
    });

    test.each(testData.postCreateData)(
        '$description',
        async ({path, body, session, configOverrides, expected}) => {
            const cfg = configOverrides ? makeConfig(configOverrides) : makeConfig();
            const app = makeApp(createGuestFlowRouter(cfg), session);
            const res = await request(app).post(path).send(body);
            
            expect(res.status).toBe(expected.status);
            if (expected.location) {
                expect(res.headers.location).toBe(expected.location);
            }
            if (expected.kind) {
                expect(res.body.kind).toBe(expected.kind);
                expect(res.body.template).toBe(expected.template);
            }
        }
    );

    test.each(testData.guestRegistrationData)(
        '$description',
        async ({method, path, body, configOverrides, expected}) => {
            const baseCfg = makeConfig();
            const cfg = configOverrides
                ? makeConfig({...configOverrides, db: {...baseCfg.db, ...(configOverrides as any).db}})
                : baseCfg;
            const app = makeApp(createGuestFlowRouter(cfg));
            const res = await request(app)[method](path).send(body || {});
            
            expect(res.status).toBe(expected.status);
            if (expected.tpl) {
                expect(res.body.tpl).toBe(expected.tpl);
                if (expected.data) {
                    expect(res.body.data).toMatchObject(expected.data);
                }
            }
            if (expected.location) {
                expect(res.headers.location).toBe(expected.location);
            }
            if (expected.emailLink) {
                expect(sendLinkEmail).toHaveBeenCalledTimes(1);
                const link = (sendLinkEmail.mock.calls[0] as any[])[1];
                expect(link).toBe(expected.emailLink);
            }
            if (expected.kind) {
                expect(res.body.kind).toBe(expected.kind);
                expect(res.body.template).toBe(expected.template);
            }
        }
    );

    test.each(testData.editTokenData)(
        '$description',
        async ({method, path, expected}) => {
            const app = makeApp(createGuestFlowRouter(makeConfig()));
            const res = await request(app)[method](path);
            
            expect(res.status).toBe(expected.status);
            if (expected.location) {
                expect(res.headers.location).toBe(expected.location);
            }
            if (expected.kind) {
                expect(res.body.kind).toBe(expected.kind);
            }
        }
    );

    test(testData.duplicateData.description, async () => {
        const {method, path, session, expected} = testData.duplicateData;
        const app = makeApp(createGuestFlowRouter(makeConfig()), session);
        const res = await request(app)[method](path);
        
        expect(res.status).toBe(expected.status);
        expect(res.body.tpl).toBe(expected.tpl);
        expect(res.body.data).toMatchObject(expected.data);
    });

    test(testData.deleteData.description, async () => {
        const {method, path, session, expected} = testData.deleteData;
        const del = jest.fn(async () => {});
        const cfg = makeConfig({deleteEntity: del});
        const app = makeApp(createGuestFlowRouter(cfg), session);
        const res = await request(app)[method](path);
        
        expect(res.status).toBe(expected.status);
        expect(res.headers.location).toBe(expected.location);
        if (expected.deleteCalled) {
            expect(del).toHaveBeenCalled();
        }
    });

    test.each(testData.safeZoneData)(
        '$description',
        async ({method, path, session, configOverrides, expected}) => {
            const baseCfg = makeConfig();
            const cfg = configOverrides 
                ? makeConfig({db: {...baseCfg.db, ...configOverrides.db}})
                : baseCfg;
            const app = makeApp(createGuestFlowRouter(cfg), session);
            const res = await request(app)[method](path);
            
            expect(res.status).toBe(expected.status);
            if (expected.tpl) {
                expect(res.body.tpl).toBe(expected.tpl);
                if (expected.data) {
                    expect(res.body.data).toMatchObject(expected.data);
                }
            }
            if (expected.location) {
                expect(res.headers.location).toBe(expected.location);
            }
            if (expected.emailLink) {
                expect(sendLinkEmail).toHaveBeenCalledTimes(1);
                expect((sendLinkEmail.mock.calls[0] as any[])[1]).toBe(expected.emailLink);
            }
        }
    );

    test(testData.validationData.description, async () => {
        const {method, path, session, configOverrides, expected} = testData.validationData;
        const cfg = makeConfig(configOverrides);
        const app = makeApp(createGuestFlowRouter(cfg), session);
        const res = await request(app)[method](path);
        
        expect(res.status).toBe(expected.status);
        expect(res.body.kind).toBe(expected.kind);
        expect(res.body.template).toBe(expected.template);
    });

    test(testData.addToEventData.description, async () => {
        const {method, path, session, configOverrides, expected} = testData.addToEventData;
        const cfg = makeConfig(configOverrides);
        const app = makeApp(createGuestFlowRouter(cfg), session);
        const res = await request(app)[method](path);
        
        expect(res.status).toBe(expected.status);
        expect(res.body.tpl).toBe(expected.tpl);
        expect(res.body.data).toMatchObject(expected.data);
    });
});
