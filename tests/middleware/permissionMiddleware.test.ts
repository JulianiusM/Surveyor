/**
 * Tests for src/middleware/permissionMiddleware.ts
 */

import express from 'express';
import request from 'supertest';
import {
    isAuthenticated,
    isEventPermitted,
    isEventPermittedAPI,
    requireAddRight,
    requireEventParticipant,
    requireManageRight,
    requireOwner,
    requireOwnerAPI,
} from '../../src/middleware/permissionMiddleware';

import {APIError, ExpectedError} from '../../src/modules/lib/errors';
import {isRegisteredForEvent} from '../../src/modules/database/services/EventService';

jest.mock('../../src/modules/database/services/EventService', () => ({
    isRegisteredForEvent: jest.fn(),
}));

// ---- Helpers to build an app around a middleware under test ----
function buildApp(
    mw: any,
    {
        session,
        resource,
        additional,
    }: {
        session?: any;
        resource?: any;
        additional?: any[];
    } = {}
) {
    const app = express();

    // add a query parser/body just in case
    app.use(express.urlencoded({extended: false}));
    app.use(express.json());

    // inject session/resource/additional + flash
    app.use((req, _res, next) => {
        (req as any).session = session || {};
        (req as any).resource = resource;
        (req as any).additional = additional;
        (req as any).flash = jest.fn();
        next();
    });

    app.get('/ok', mw, (_req, res) => res.status(200).json({ok: true}));

    // error adapter to HTTP (like your app would do)
    app.use((err: any, _req: any, res: any, _next: any) => {
        if (err instanceof APIError) {
            return res.status(err.status ?? 500).json({kind: 'api', message: err.message});
        }
        if (err instanceof ExpectedError) {
            return res.status(err.status ?? 500).json({kind: 'expected', message: err.message});
        }
        return res.status(500).json({kind: 'unknown', message: err?.message || 'error'});
    });

    return app;
}

// Convenience to do a GET with optional query
const get = (app: express.Express, path = '/ok') => request(app).get(path);

beforeEach(() => {
    jest.clearAllMocks();
});

// -------------------- Owner checks --------------------
describe('requireOwner / requireOwnerAPI', () => {
    test('allows when session user owns resource', async () => {
        const app = buildApp(requireOwner(), {
            session: {user: {id: 1}},
            resource: {ownerId: 1},
        });
        const res = await get(app);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('allows when ownership via additional (userId)', async () => {
        const app = buildApp(requireOwner(), {
            session: {user: {id: 5}},
            resource: {ownerId: 99},
            additional: [{userId: 5}],
        });
        const res = await get(app);
        expect(res.status).toBe(200);
    });

    test('allows when ownership via additional (guestId)', async () => {
        const app = buildApp(requireOwner(), {
            session: {guest: {id: 7}},
            resource: {ownerId: 99},
            additional: [{guestId: 7}],
        });
        const res = await get(app);
        expect(res.status).toBe(200);
    });

    test('forbids when not owner (ExpectedError variant)', async () => {
        const app = buildApp(requireOwner(), {
            session: {user: {id: 2}},
            resource: {ownerId: 1},
        });
        const res = await get(app);
        expect(res.status).toBe(403);
        expect(res.body.kind).toBe('expected');
    });

    test('forbids when not owner (APIError variant)', async () => {
        const app = buildApp(requireOwnerAPI(), {
            session: {user: {id: 2}},
            resource: {ownerId: 1},
        });
        const res = await get(app);
        expect(res.status).toBe(403);
        expect(res.body.kind).toBe('api');
    });
});

// -------------------- Event participation --------------------
describe('requireEventParticipant / API', () => {
    test('allows when isRegisteredForEvent returns true', async () => {
        (isRegisteredForEvent as jest.Mock).mockResolvedValue(true);
        const app = buildApp(requireEventParticipant(), {
            session: {user: {id: 10}},
            resource: {eventId: 'E1'},
        });
        const res = await get(app);
        expect(isRegisteredForEvent).toHaveBeenCalledWith({userId: 10, guestId: undefined}, 'E1');
        expect(res.status).toBe(200);
    });

    test('forbids when not registered and not owner', async () => {
        (isRegisteredForEvent as jest.Mock).mockResolvedValue(false);
        const app = buildApp(requireEventParticipant(), {
            session: {user: {id: 11}},
            resource: {eventId: 'E2', ownerId: 99},
        });
        const res = await get(app);
        expect(res.status).toBe(403);
        expect(res.body.kind).toBe('expected');
    });

    test('non-event resources bypass event check (allowed)', async () => {
        (isRegisteredForEvent as jest.Mock).mockClear();
        const app = buildApp(requireEventParticipant(), {
            session: {user: {id: 1}},
            resource: {ownerId: 999}, // no eventId
        });
        const res = await get(app);
        expect(isRegisteredForEvent).not.toHaveBeenCalled();
        expect(res.status).toBe(200);
    });
});

// -------------------- Manage & Add rights --------------------
describe('requireManageRight / requireAddRight', () => {
    test('guestManage grants access when identified (user)', async () => {
        const app = buildApp(requireManageRight(), {
            session: {user: {id: 4}},
            resource: {guestManage: true}, // no owner/event participation necessary
        });
        const res = await get(app);
        expect(res.status).toBe(200);
    });

    test('guestAdd grants access when identified (guest)', async () => {
        const app = buildApp(requireAddRight(), {
            session: {guest: {id: 55}},
            resource: {allowGuestAdd: true},
        });
        const res = await get(app);
        expect(res.status).toBe(200);
    });

    test('no identification -> guestManage/guestAdd do not grant', async () => {
        (isRegisteredForEvent as jest.Mock).mockResolvedValue(false);
        const app = buildApp(requireAddRight(), {
            session: {}, // not identified
            resource: {allowGuestAdd: true, guestManage: true},
        });
        const res = await get(app);
        expect(res.status).toBe(403);
    });
});

// -------------------- useEvent guard --------------------
describe('isEventPermitted (useEvent toggle)', () => {
    test('useEvent=false + eventId query -> 400 (ExpectedError variant)', async () => {
        const app = buildApp(isEventPermitted(false), {
            session: {user: {id: 1}},
            resource: {ownerId: 1},
        });
        const res = await request(app).get('/ok?eventId=E123');
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('expected');
    });

    test('useEvent=false + eventId query -> 400 (APIError variant)', async () => {
        const app = buildApp(isEventPermittedAPI(false), {
            session: {user: {id: 1}},
            resource: {ownerId: 1},
        });
        const res = await request(app).get('/ok?eventId=E123');
        expect(res.status).toBe(400);
        expect(res.body.kind).toBe('api');
    });

    test('useEvent=true does not 400 when eventId present', async () => {
        const app = buildApp(isEventPermitted(true), {
            session: {user: {id: 1}},
            resource: {ownerId: 1},
        });
        const res = await request(app).get('/ok?eventId=E123');
        expect(res.status).toBe(200);
    });
});

// -------------------- isAuthenticated --------------------
describe('isAuthenticated', () => {
    test('passes through when user in session', () => {
        const req: any = {session: {user: {id: 1}}};
        const res: any = {};
        const next = jest.fn();
        isAuthenticated(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('redirects to /users/login and flashes when not authenticated', () => {
        const flash = jest.fn();
        const redirect = jest.fn();
        const req: any = {session: {}, flash};
        const res: any = {
            redirect,
        };
        const next = jest.fn();
        isAuthenticated(req, res, next);
        expect(flash).toHaveBeenCalledWith('info', 'You must be logged in to access this site.');
        expect(redirect).toHaveBeenCalledWith('/users/login');
        expect(next).not.toHaveBeenCalled();
    });
});
