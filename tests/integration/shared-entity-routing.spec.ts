import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import session from 'express-session';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {attachAssignRoleRoutes, attachAssignRoutes} from '../../src/backend/middleware/assignFlowFactory';
import {createEntityHeaderUpdateRouter} from '../../src/backend/middleware/entityHeaderUpdateHandler';
import {createUserSearchApiRouter} from '../../src/backend/middleware/adminApiFactory';
import {createGuestFlow, createGuestFlowApiRouter} from '../../src/backend/middleware/guestFlowFactory';
import {packingFlow} from '../../src/backend/routes/packingFlow';
import {activityFlow} from '../../src/backend/routes/activityFlow';
import {ApiProblem, handleApiProblem} from '../../src/backend/modules/api/problem';
import settings from '../../src/backend/modules/settings';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {User} from '../../src/backend/modules/database/entities/user/User';
import type {ApiActor} from '../../src/types/ApiTypes';
import type {components} from '../../src/types/api/v1';
import {prepareFileUploader} from '../../src/backend/modules/lib/fileCommons';

const entityId = '84305c09-5386-47bc-b62d-520b8a8edbb2';
const itemId = '52a92e09-e6c5-47ce-9eea-6329be8415f4';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async function disposeRoutingFixtures(): Promise<void> {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
});

/** Exercise real HTTP, Session/context middleware, generated contracts and shared routing.
 * Feature persistence is an injected callback outside this component boundary. A supplied
 * captured actor represents prior ORM hydration; it makes no account/permission claim. */
async function routingFixture(configure: (app: express.Express) => void, capturedActor?: ApiActor) {
    const temporaryRoot = path.resolve('.temp');
    await fs.mkdir(temporaryRoot, {recursive: true});
    const directory = await fs.mkdtemp(path.join(temporaryRoot, 'surveyor-shared-routing-'));
    const store = new session.MemoryStore();
    const app = express();
    const server = http.createServer(app);
    cleanups.push(dispose);

    app.use(express.json());
    app.use(session({secret: 'shared-entity-routing-fixture', store, resave: false, saveUninitialized: false}));
    if (capturedActor) {
        // This server-owned fixture models an already hydrated actor. Browser
        // headers/body never select it, and production middleware is unchanged.
        app.use(function supplyCapturedActor(req, _res, next) {
            req.apiActor = capturedActor;
            next();
        });
    }
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The routing fixture listener has no port.');
    const origin = `http://127.0.0.1:${address.port}`;
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin,
        headerImgDir: path.relative(process.cwd(), directory)});
    configure(app);
    app.use(handleApiProblem);

    function headers(extra: Record<string, string> = {}) {
        return {Origin: origin, 'X-Surveyor-Api-Compatibility': apiCompatibility, 'X-Surveyor-Locale': 'en', ...extra};
    }

    /** Close owned infrastructure, then verify the exact workspace fixture before removal. */
    async function dispose(): Promise<void> {
        if (server.listening) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        await new Promise<void>((resolve, reject) => store.clear(error => error ? reject(error) : resolve()));
        const actualRoot = await fs.realpath(temporaryRoot);
        const actualDirectory = await fs.realpath(directory);
        if (path.dirname(actualDirectory) !== actualRoot || !path.basename(actualDirectory).startsWith('surveyor-shared-routing-')) {
            throw new Error('Refusing to remove an unexpected shared-routing fixture directory.');
        }
        await fs.rm(actualDirectory, {recursive: true, force: true});
    }

    return {origin, directory, headers};
}

/** Real multipart reception writes these request-owned bytes inside the isolated upload directory. */
function imageUpload(): FormData {
    const form = new FormData();
    form.set('image', new Blob(['shared routing upload fixture'], {type: 'image/jpeg'}), 'fixture.jpg');
    return form;
}

describe('shared entity routing components', () => {
    it('retains the real uploader media, extension and rejected-file boundary', async function admitsReviewedUploadMedia() {
        const fixture = await routingFixture(app => {
            const upload = prepareFileUploader(settings.value.headerImgDir, true, true).single('file');
            app.post('/media', function receiveFixtureUpload(req, res) {
                // The real parser and disk storage run unchanged; only this
                // fixture's final response is outside the production boundary.
                upload(req, res, function completeFixtureUpload(error) {
                    if (error) { res.status(400).json({rejected: true}); return; }
                    res.json({name: req.file?.filename, mime: req.file?.mimetype});
                });
            });
        });

        // Matching accepted media retain case-normalized extensions. Filename
        // and MIME rejection must not leave an additional stored file behind.
        for (const [filename, mime, status] of [
            ['image.JPG', 'image/jpeg', 200], ['image.png', 'image/png', 200], ['image.gif', 'image/gif', 200],
            ['proof.pdf', 'application/pdf', 200], ['image.svg', 'image/svg+xml', 400],
            ['forged.txt', 'image/png', 400], ['unknown.png', 'application/octet-stream', 400],
        ] as const) {
            const form = new FormData();
            form.set('file', new Blob(['retained upload bytes'], {type: mime}), filename);
            const result = await fetch(fixture.origin + '/media', {method: 'POST', body: form});
            expect(result.status, filename).toBe(status);
            if (status === 200) {
                const saved = await result.json() as {name: string; mime: string};
                expect(saved.mime).toBe(mime);
                expect(path.extname(saved.name)).toBe(path.extname(filename).toLowerCase());
                expect(await fs.readFile(path.join(fixture.directory, saved.name), 'utf8')).toBe('retained upload bytes');
            }
        }
        expect(await fs.readdir(fixture.directory)).toHaveLength(4);
    });

    it('admits and validates scoped searches before spending the shared limiter budget', async () => {
        const actor: ApiActor = {context: null, auth: {user: Object.assign(new User(), {id: 7})},
            profile: Object.assign(new Profile(), {id: entityId, userId: 7})};
        const observed: Array<{id: string; actor: ApiActor; query: string}> = [];
        const fixture = await routingFixture(app => {
            const router = express.Router();
            createUserSearchApiRouter<'packing'>(router, {
                entityType: 'packing', parameter: 'listId',
                search: {operation: 'searchPackingProfiles', requireProfile: false,
                    async read({id, actor: captured, query}) {
                        // Persistence/grants are outside this component boundary.
                        // Observe only values crossing the actual transport owner.
                        observed.push({id, actor: captured as ApiActor, query: String(query.q)});
                        return {data: []};
                    }},
            });
            app.use('/api/v1/packing-lists', router);
        }, actor);
        const url = `${fixture.origin}/api/v1/packing-lists/${entityId}/profiles?q=Camp`;
        const first = await fetch(url, {headers: fixture.headers()});
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual([]);
        const remaining = Number(first.headers.get('ratelimit-remaining'));
        expect(first.headers.get('ratelimit-limit')).toBe('120');

        // Neither stale context nor an undeclared actor selector may spend the
        // admitted search budget or reach the scoped business projection.
        const changed = await fetch(url, {headers: fixture.headers({'X-Surveyor-Context': 'obsolete-context'})});
        expect(changed.status).toBe(409);
        expect((await changed.json()).code).toBe('SESSION_CONTEXT_CHANGED');
        expect(changed.headers.get('ratelimit-remaining')).toBeNull();
        const invalid = await fetch(`${url}&profileId=${itemId}`, {headers: fixture.headers()});
        expect(invalid.status).toBe(400);
        expect((await invalid.json()).code).toBe('VALIDATION_FAILED');
        expect(invalid.headers.get('ratelimit-remaining')).toBeNull();
        expect(observed).toHaveLength(1);

        const accepted = await fetch(url, {headers: fixture.headers()});
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual([]);
        expect(Number(accepted.headers.get('ratelimit-remaining'))).toBe(remaining - 1);
        expect(observed).toEqual([{id: entityId, actor, query: 'Camp'}, {id: entityId, actor, query: 'Camp'}]);
        expect(observed.every(call => call.actor === actor)).toBe(true);
    });

    it('registers the real guest flow create-entry without creating a session or exposing Event context', async () => {
        const fixture = await routingFixture(app => app.use('/api/v1/packing-lists', createGuestFlowApiRouter(packingFlow)));
        const destination = `/packing/${entityId}/duplicate`;
        const query = new URLSearchParams({returnTo: destination, eventId: itemId});
        const response = await fetch(`${fixture.origin}/api/v1/packing-lists/create-entry?${query}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.json()).toEqual({entry: {kind: 'redirect',
            url: `/users/login?next=${encodeURIComponent(destination)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null, selectedEvent: null});
    });

    it('cleans invalid creation uploads and retains a notified Activity image after a later feature failure', async () => {
        const actor: ApiActor = {context: null, auth: {user: Object.assign(new User(), {id: 7})},
            profile: Object.assign(new Profile(), {id: entityId, userId: 7})};
        let calls = 0;
        let retainedPath: string | undefined;
        const flow = createGuestFlow({...activityFlow.config,
            async create(_input, file, captured, lifecycle) {
                expect(captured).toBe(actor);
                calls++;
                retainedPath = file?.path;
                // This outside feature hook models its existing root commit
                // notification followed by a separate defaults-stage rejection.
                lifecycle.retainImage();
                throw new ApiProblem('FORBIDDEN');
            },
        });
        const fixture = await routingFixture(app => app.use('/api/v1/activity-plans', createGuestFlowApiRouter(flow)), actor);
        const invalidForm = imageUpload();
        invalidForm.set('data', '{invalid json');
        const invalid = await fetch(`${fixture.origin}/api/v1/activity-plans`, {
            method: 'POST', headers: fixture.headers(), body: invalidForm});
        expect(invalid.status).toBe(400);
        await invalid.arrayBuffer();
        expect(calls).toBe(0);
        await expect.poll(() => fs.readdir(fixture.directory)).toEqual([]);

        const form = imageUpload();
        form.set('data', JSON.stringify({title: 'Plan', description: '', startDate: '2026-10-26', endDate: '2026-10-26',
            eventId: null, slots: [], defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0}}));
        const laterFailure = await fetch(`${fixture.origin}/api/v1/activity-plans`, {
            method: 'POST', headers: fixture.headers(), body: form});
        expect(laterFailure.status).toBe(403);
        expect((await laterFailure.json()).code).toBe('FORBIDDEN');
        expect(calls).toBe(1);
        expect(retainedPath).toBeDefined();
        expect(await fs.readFile(retainedPath!, 'utf8')).toBe('shared routing upload fixture');
    });

    it('rejects changed context and invalid assignment input before invoking a feature operation', async () => {
        const calls: Array<{actor: ApiActor; body: components['schemas']['ActivityAssignmentInput']}> = [];
        const fixture = await routingFixture(app => {
            const router = express.Router();
            attachAssignRoleRoutes(router, {
                path: '/:planId/slots/:slotId/self-assignment', entityParameter: 'planId', itemParameter: 'slotId',
                requireProfile: false,
                command: {operation: 'setActivityAssignment', delivery: 'invariant', result: {changed: true},
                    async execute({actor, body}) { calls.push({actor, body}); }},
            });
            app.use('/api/v1/activity-plans', router);
        });
        const url = `${fixture.origin}/api/v1/activity-plans/${entityId}/slots/${itemId}/self-assignment`;
        const changed = await fetch(url, {method: 'PUT', headers: fixture.headers({'Content-Type': 'application/json',
            'X-Surveyor-Context': 'not-the-captured-context'}), body: JSON.stringify({assigned: 'invalid'})});
        expect((await changed.json()).code).toBe('SESSION_CONTEXT_CHANGED');
        expect(changed.status).toBe(409);
        expect(calls).toEqual([]);

        // Unknown identity fields must fail generated decoding before a domain
        // callback can treat submitted data as its captured server actor.
        const invalid = await fetch(url, {method: 'PUT', headers: fixture.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({assigned: true, profileId: itemId})});
        expect(invalid.status).toBe(400);
        expect((await invalid.json()).code).toBe('VALIDATION_FAILED');
        expect(calls).toEqual([]);

        const accepted = await fetch(url, {method: 'PUT', headers: fixture.headers({'Content-Type': 'application/json'}),
            body: JSON.stringify({assigned: true, role: 'Cook'})});
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual({changed: true});
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({body: {assigned: true, role: 'Cook'}, actor: {context: null, profile: null}});
        expect(calls[0].actor.auth).toBeUndefined();
    });

    it('passes the captured profile and prepares Drivers replies before a feature reports successful completion', async () => {
        const actor: ApiActor = {context: null, auth: {user: Object.assign(new User(), {id: 7})},
            profile: Object.assign(new Profile(), {id: entityId, userId: 7})};
        const result: components['schemas']['DriversAssignmentResult'] = {
            listId: entityId, itemId, selfAssigned: true, assignedCount: 1, maxAssignees: 2};
        const observedActors: ApiActor[] = [];
        let validReply = false;
        let completed = 0;
        const fixture = await routingFixture(app => {
            const router = express.Router();
            attachAssignRoutes(router, {
                path: '/:listId/items/:itemId/self-assignment', entityParameter: 'listId', itemParameter: 'itemId',
                requireProfile: true,
                assign: {operation: 'assignDriversItem', delivery: 'transaction',
                    async execute(input, prepare) {
                        observedActors.push(input.actor);
                        // A controller transaction can still reject preparation.
                        // Completion here models that callback boundary, not a DB commit.
                        prepare(validReply ? result : {...result, listId: 'invalid-uuid'});
                        completed++;
                    }},
                unassign: {operation: 'unassignDriversItem', delivery: 'transaction',
                    async execute(_input, prepare) { prepare({...result, selfAssigned: false}); }},
            });
            app.use('/api/v1/drivers-lists', router);
        }, actor);
        const url = `${fixture.origin}/api/v1/drivers-lists/${entityId}/items/${itemId}/self-assignment`;
        const rejected = await fetch(url, {method: 'PUT', headers: fixture.headers()});
        expect(rejected.status).toBe(500);
        expect((await rejected.json()).code).toBe('INTERNAL_ERROR');
        expect(completed).toBe(0);
        expect(observedActors).toEqual([actor]);

        validReply = true;
        const accepted = await fetch(url, {method: 'PUT', headers: fixture.headers()});
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual(result);
        expect(completed).toBe(1);
        expect(observedActors[1]).toBe(actor);
    });

    it('keeps upload preflight, rejected-byte cleanup and successful image retention in the shared header routes', async () => {
        let stage: 'preflight' | 'reject-operation' | 'completed-operation' = 'preflight';
        let calls = 0;
        let acceptedPath: string | undefined;
        const fixture = await routingFixture(app => {
            const router = express.Router();
            createEntityHeaderUpdateRouter(router, {
                parameter: 'listId', uploadOperation: 'uploadPackingHeader', deleteOperation: 'deletePackingHeader',
                requireProfile: false,
                async admitUpload() { if (stage === 'preflight') throw new ApiProblem('FORBIDDEN'); },
                command: {receipt: 'after-write', async execute({file}) {
                    calls++;
                    acceptedPath = file?.path;
                    if (stage === 'reject-operation') throw new ApiProblem('FORBIDDEN');
                    // Deliberately invalid feature evidence exercises real response
                    // validation after the unchanged operation success boundary.
                    return {changed: 'invalid'} as unknown as components['schemas']['MutationResult'];
                }},
            });
            app.use('/api/v1/packing-lists', router);
        });
        const url = `${fixture.origin}/api/v1/packing-lists/${entityId}/header`;
        const denied = await fetch(url, {method: 'PUT', headers: fixture.headers(), body: imageUpload()});
        expect(denied.status).toBe(403);
        await denied.arrayBuffer();
        expect(calls).toBe(0);
        expect(await fs.readdir(fixture.directory)).toEqual([]);

        stage = 'reject-operation';
        const rejected = await fetch(url, {method: 'PUT', headers: fixture.headers(), body: imageUpload()});
        expect(rejected.status).toBe(403);
        await rejected.arrayBuffer();
        expect(calls).toBe(1);
        await expect.poll(() => fs.readdir(fixture.directory)).toEqual([]);

        stage = 'completed-operation';
        const invalidReply = await fetch(url, {method: 'PUT', headers: fixture.headers(), body: imageUpload()});
        expect(invalidReply.status).toBe(500);
        expect((await invalidReply.json()).code).toBe('INTERNAL_ERROR');
        expect(calls).toBe(2);
        expect(acceptedPath).toBeDefined();
        expect(await fs.readFile(acceptedPath!, 'utf8')).toBe('shared routing upload fixture');
        expect(await fs.readdir(fixture.directory)).toHaveLength(1);
    });
});
