import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import express from 'express';
import session from 'express-session';
import flash from 'express-flash';
import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {NextFunction, Request, Response} from 'express';
import * as userController from '../../src/backend/controller/userController';
import {captureApiActor} from '../../src/backend/modules/api/session';
import {asyncHandler} from '../../src/backend/modules/lib/asyncHandler';
import {PERM} from '../../src/backend/modules/lib/permissions';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import * as userService from '../../src/backend/modules/database/services/UserService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import activityRouter from '../../src/backend/routes/activity';
import eventRouter from '../../src/backend/routes/event';
import {createActivityPlanWithSlot, createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let server: http.Server;
let origin: string;
let owner: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    const app = express();
    app.set('view engine', 'pug');
    app.set('views', path.resolve('src/backend/views'));
    app.use(express.json());
    app.use(session({secret: 'retained-output-real-identity-fixture', resave: false, saveUninitialized: false,
        store: userService.createSessionStore(AppDataSource.manager)}));
    app.use(flash());
    // Exercise the real identity operations and serialized database-backed Session.
    app.post('/login', asyncHandler(async function login(req, res) {
        // Native output rendering already initializes flash storage. Establish
        // that existing state before measuring request-local actor hydration.
        req.flash('fixture');
        const actor = await captureApiActor(req);
        const committed = await userController.loginUserWithSession(req.body, req,
            {context: actor.context, prepareResult: () => req.sessionID});
        req.session = committed.session;
        res.json({sid: req.sessionID});
    }));
    app.post('/guest-login', asyncHandler(async function guestLogin(req, res) {
        req.flash('fixture');
        await userController.loginGuest(req.body.id, req.body.token, req.session);
        res.json({sid: req.sessionID});
    }));
    app.use(asyncHandler(async function captureOutputActor(req, _res, next) {
        await captureApiActor(req);
        next();
    }));
    app.use('/activity', activityRouter);
    app.use('/event', eventRouter);
    app.use(function outputError(error: {status?: number; code?: string}, _req: Request, res: Response, _next: NextFunction) {
        res.status(error.status ?? 500).json({code: error.code ?? 'OUTPUT_REJECTED'});
    });
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing output fixture listener');
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeIntegrationDatabase();
});

describe('retained outputs share captured identity and audience grants', () => {
    it.each(['account', 'guest'] as const)('admits %s audience exports without writing hydrated relations into the Session', async kind => {
        let login: Awaited<ReturnType<typeof fetch>>;
        if (kind === 'account') {
            const username = `output-${randomUUID()}`;
            const id = await userService.registerUser(username, 'Output viewer', 'initial-secret', `${username}@example.invalid`);
            await userService.activateUser(id);
            login = await fetch(`${origin}/login`, {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, password: 'initial-secret'})});
        } else {
            const guest = await userService.createGuest(`Output guest ${randomUUID()}`);
            login = await fetch(`${origin}/guest-login`, {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: guest.id, token: guest.token})});
        }
        expect(login.status).toBe(200);
        const cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
        const {sid} = await login.json() as {sid: string};
        const stored = (await AppDataSource.getRepository(Session).findOneByOrFail({id: sid})).json;
        const raw = JSON.parse(stored);
        expect(raw.profile.user).toBeUndefined();
        expect(raw.profile.guest).toBeUndefined();

        const plan = await createActivityPlanWithSlot(owner.id);
        const event = await createIntegrationEvent(owner.id, 'Audience export Event');
        const poolId = await invoiceService.createPool(event, 'Saved empty ledger', undefined, 'EQUAL', false, true, false, [], false);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        pool.status = 'CLOSED';
        await AppDataSource.transaction(manager => invoiceService.savePool(pool, manager));
        const audience = kind === 'account' ? 'authenticated' : 'guest';
        await adminService.updatePerms('activity', plan, {public: 0, guest: 0, authenticated: 0,
            [audience]: PERM.ACCESS_VIEW | PERM.DATA_EXPORT});
        await adminService.updatePerms('event', event, {public: 0, guest: 0, authenticated: 0,
            [audience]: PERM.ACCESS_VIEW | PERM.DATA_EXPORT | PERM.ACCESS_PARTICIPANTS | PERM.MANAGE_ASSIGNMENTS});

        for (const [url, media] of [[`/activity/${plan}/export/schedule`, 'text/html'],
        [`/event/${event}/export/participants`, 'application/pdf'],
        [`/event/${event}/export/invoice-pools/${pool.id}/shares`, 'application/pdf']]) {
            const response = await fetch(origin + url, {headers: {Cookie: cookie}, redirect: 'manual'});
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain(media);
            expect(response.headers.get('set-cookie')).toBeNull();
            const bytes = Buffer.from(await response.arrayBuffer());
            if (media === 'application/pdf') expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
            else expect(bytes.toString()).toContain('Camp activity plan');
        }
        // Actor hydration is request-local; normal store touch may update expiry,
        // while the stored identity and original middleware object remain untouched.
        expect((await AppDataSource.getRepository(Session).findOneByOrFail({id: sid})).json).toBe(stored);

        await adminService.updatePerms('activity', plan, {[audience]: 0});
        await adminService.updatePerms('event', event, {[audience]: 0});
        for (const url of [`/activity/${plan}/export/schedule`, `/event/${event}/export/participants`,
        `/event/${event}/export/invoice-pools/${pool.id}/shares`]) {
            const denied = await fetch(origin + url, {headers: {Cookie: cookie}, redirect: 'manual'});
            expect(denied.status).toBe(403);
            await denied.text();
        }
    });
});
