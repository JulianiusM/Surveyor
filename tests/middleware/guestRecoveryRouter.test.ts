import express from 'express';
import request from 'supertest';
import {ValidationError} from '../../src/modules/lib/errors';
import {createGuestRecoveryRouter} from '../../src/middleware/guestRecoveryRouter';
import * as testData from '../data/middleware/guestRecoveryRouterData';

jest.mock('../../src/modules/renderer', () => ({
    __esModule: true,
    default: {
        renderWithData: (res: any, tpl: string, data: any) =>
            res.status(200).json({tpl, data}),
    },
}));

const sendGuestRecoveryEmail = jest.fn();
jest.mock('../../src/modules/email', () => ({
    __esModule: true,
    default: {
        sendGuestRecoveryEmail: (...args: any[]) => sendGuestRecoveryEmail(...args),
    },
}));

jest.mock('../../src/modules/settings', () => ({
    __esModule: true,
    default: {value: {rootUrl: 'http://app.local'}},
}));

jest.mock('../../src/middleware/paramHandler', () => ({
    paramHandler: (name: string, router: any, getById: any, type: string) => {
        router.param(name, async (req: any, _res: any, next: any, id: string) => {
            const ent = await getById(id);
            req.resources = {...(req.resources || {}), [type]: ent};
            next();
        });
    },
}));

jest.mock('../../src/modules/lib/util', () => ({
    getResource: (req: any, type: string) => req.resources?.[type],
}));

function makeApp(router: express.Router) {
    const app = express();
    app.use(express.urlencoded({extended: false}));
    app.use(express.json());
    app.use((req, _res, next) => {
        (req as any).session = {};
        (req as any).flash = jest.fn();
        next();
    });
    app.use(router);

    app.use((err: any, _req: any, res: any, _next: any) => {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                kind: 'validation',
                template: err.template,
                message: err.message,
                data: err.data
            });
        }
        return res.status(500).json({kind: 'error', message: err?.message || 'error'});
    });
    return app;
}

function makeConfig(overrides: Partial<Parameters<typeof createGuestRecoveryRouter>[0]> = {}) {
    const base = {
        entityType: 'activity',
        buildRedirect: (id: string) => `/activity/${id}`,
        db: {
            getById: async (id: string) => ({id, title: `Plan ${id}`}),
            getGuestLinksForEntityByEmail: async () => ([{entityType: 'activity', entityId: 'abc', token: 'existing-token'}]),
        },
    };
    return {
        ...base,
        ...overrides,
        db: {...base.db, ...(overrides as any).db},
    } as any;
}

describe('guestRecoveryRouter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each(testData.guestRecoveryData)(
        '$description',
        async ({method, path, body, expected}) => {
            const app = makeApp(createGuestRecoveryRouter(makeConfig()));
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
            if (expected.recoveryLinks) {
                expect(sendGuestRecoveryEmail).toHaveBeenCalledTimes(1);
                expect((sendGuestRecoveryEmail.mock.calls[0] as any[])[1]).toEqual(expected.recoveryLinks);
            }
            if (expected.kind) {
                expect(res.body.kind).toBe(expected.kind);
                expect(res.body.template).toBe(expected.template);
            }
        }
    );
});
