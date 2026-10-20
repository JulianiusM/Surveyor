import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import type {Request} from 'express';
import invoices, {
    admitEventInvoiceSubmission, closeEventInvoice, readEventFinance, readEventFinanceBreakdown,
    readEventInvoiceProof, retractEventInvoice, createEventFinancePool, updateEventFinanceSettings,
    changeEventFinanceSubmissionState, admitEventFinanceOrganizer, recordEventOrganizerInvoice,
    reviewEventFinanceInvoice, updateEventFinanceAssignments, addEventFinanceAdjustment,
    removeEventFinanceAdjustment, updateEventFinanceTakeovers,
} from '../../src/controller/eventPoolController';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import {contractValidator} from '../../src/modules/api/contracts';
import {decodeApiMultipartData} from '../../src/modules/api/transport';
import {PERM} from '../../src/modules/lib/permissions';
import {AppDataSource} from '../../src/modules/database/dataSource';
import settings from '../../src/modules/settings';
import eventRouter from '../../src/routes/api/v1/events';
import nativeEventRouter from '../../src/routes/api/event';
import {wrapErrorApi} from '../../src/middleware/validationErrorHandler';
import {handleApiProblem} from '../../src/modules/api/problem';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import mailer from '../../src/modules/email';
import type {Event} from '../../src/modules/database/entities/event/Event';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createInvoiceSubmissionCase} from '../factories/invoiceFactory';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let other: Profile;
let editor: Profile;
const proofPaths = new Set<string>();
const sendEmail = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);

function actor(profile: Profile): SessionLike { return {profile, auth: {user: profile.user!}}; }
function nativeActor(profile: Profile): Request['session'] { return actor(profile) as Request['session']; }

async function fixture() {
    const id = await createIntegrationEvent(owner.id, 'Saved finance projection');
    await eventService.register(id, '2027-06-01', '2027-06-03', participant.id);
    await eventService.register(id, '2027-06-01', '2027-06-03', other.id);
    const event = (await eventService.getEventById(id))!;
    const poolId = await invoices.createInvoicePool(event, {name: 'Shared groceries', distribution: 'EQUAL', assignAll: true});
    return {id, event, poolId};
}

/** Persist real evidence through the shared submission operation and retain only this fixture's proof for teardown. */
async function submit(event: Event, poolId: string, profile: Profile, description: string, amount = 40) {
    const proof = createInvoiceSubmissionCase({description, amount});
    await fs.mkdir(path.dirname(proof.proofPath), {recursive: true});
    await fs.writeFile(proof.proofPath, '%PDF-1.4 saved finance proof', {flag: 'wx'});
    proofPaths.add(proof.proofPath);
    await invoices.submitInvoice(event, poolId, {amount, description}, actor(profile),
        {path: proof.proofPath, originalname: proof.proofOriginalName, mimetype: proof.proofMimeType} as Express.Multer.File);
    // The saved audit row, rather than an invented adapter receipt, supplies the fixture identifier.
    return (await invoiceService.getPoolWithInvoices(poolId))!.invoices.find(row => row.description === description)!;
}

beforeAll(async function prepareFinanceDatabase() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile({name: 'Finance organizer'});
    participant = await persistIntegrationProfile({name: 'Own payer'});
    other = await persistIntegrationProfile({name: 'Private other payer'});
    editor = await persistIntegrationProfile({name: 'Limited finance editor'});
}, 120_000);

afterAll(async function closeFinanceDatabase() {
    await Promise.all([...proofPaths].map(file => fs.unlink(file).catch(() => undefined)));
    await closeIntegrationDatabase();
    sendEmail.mockRestore();
});

describe('versioned finance shared ownership and private saved projections', () => {
    it('preserves the existing native public management methods independently of profile-required invoice actions', async () => {
        const {id, event, poolId} = await fixture();
        const invoice = await submit(event, poolId, participant, 'Native public review baseline');
        await adminService.updatePerms('event', id, {public: PERM.MANAGE_ASSIGNMENTS});
        const app = express();
        app.use(express.json());
        app.use(session({secret: 'native-public-finance-baseline', resave: false, saveUninitialized: false}));
        // Mount the unchanged real native API, including its actual parameter
        // loader and permission middleware. No fixture grants a request actor.
        app.use('/api/event', nativeEventRouter);
        app.use(wrapErrorApi);
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing native public-finance listener');
        const endpoint = `http://127.0.0.1:${address.port}/api/event/${id}/invoice-pools`;
        try {
            const created = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: 'Native anonymous management baseline', distribution: 'EQUAL', assignAll: true})});
            expect(created.status).toBe(200);
            const settings = await fetch(`${endpoint}/${poolId}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({description: 'Native anonymous saved setting', distribution: 'NIGHTS'})});
            expect(settings.status).toBe(200);
            const approved = await fetch(`${endpoint}/${poolId}/invoices/${invoice.id}/approve`, {method: 'POST',
                headers: {'Content-Type': 'application/json'}, body: JSON.stringify({correctedAmount: 30})});
            expect(approved.status).toBe(200);
            expect((await fetch(`${endpoint}/${poolId}/invoices/${invoice.id}/close`, {method: 'POST'})).status).toBe(200);
            const stored = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(stored).toMatchObject({description: 'Native anonymous saved setting', distributionMethod: 'NIGHTS'});
            expect(stored.invoices.find(row => row.id === invoice.id)).toMatchObject({amount: '40.00', correctedAmount: '30.00', status: 'CLOSED'});
            expect((await invoiceService.listPools(id)).map(row => row.name)).toContain('Native anonymous management baseline');
            // Native entry and retroactive review explicitly require a profile;
            // public management cannot fabricate an audit recorder.
            expect((await fetch(`${endpoint}/${poolId}/invoices/organizer`, {method: 'POST'})).status).toBe(401);
            expect((await fetch(`${endpoint}/${poolId}/invoices/${invoice.id}/revise`, {method: 'POST'})).status).toBe(401);
            expect(await eventService.getRegistrationFor(owner.id, id)).toBeNull();
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        }
    });

    it('uses generated closed command shapes, CSRF admission and optional proof bytes through the actual organizer HTTP adapter', async () => {
        const {id, event} = await fixture();
        const context = 'finance-organizer-context-123456789012345';
        const csrf = 'finance-organizer-csrf-123456789012345678';
        const app = express();
        app.use(express.json());
        app.use(session({secret: 'finance-organizer-http-fixture', resave: false, saveUninitialized: false}));
        app.post('/seed', function seedOrganizerSession(req, res) {
            req.session.profile = owner;
            req.session.auth = {user: owner.user!};
            req.session.frontendContext = context;
            req.session.frontendCsrfToken = csrf;
            res.sendStatus(204);
        });
        app.use(function retainOrganizerProof(req, res, next) {
            // This fixture tracks only files received by its own HTTP request.
            res.once('finish', function captureOrganizerProof() { if (req.file) proofPaths.add(req.file.path); });
            next();
        });
        app.use('/api/v1/events', eventRouter);
        app.use(handleApiProblem);
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing organizer HTTP listener address');
        const origin = `http://127.0.0.1:${address.port}`;
        try {
            const seed = await fetch(`${origin}/seed`, {method: 'POST'});
            const cookie = seed.headers.get('set-cookie')?.split(';', 1)[0];
            expect(cookie).toBeTruthy();
            const headers = {Cookie: cookie!, 'X-Surveyor-Context': context, 'X-CSRF-Token': csrf,
                'X-Surveyor-Api-Compatibility': apiCompatibility, 'X-Surveyor-Locale': 'de'};
            const input = {name: 'HTTP organizer input', distribution: 'EQUAL', status: 'OPEN', isDefault: false,
                assignAll: true, subtractPersonalInvoices: true, sendCalculationEmails: false, roundUpShares: false, registrations: []};
            const endpoint = `${origin}/api/v1/events/${id}/finance/pools`;
            // Transport rejection precedes persistence, including unknown fields and absent CSRF proof.
            const noCsrf = await fetch(endpoint, {method: 'POST', headers: {...headers, 'X-CSRF-Token': '', 'Content-Type': 'application/json'},
                body: JSON.stringify(input)});
            expect(noCsrf.status).toBe(403);
            const forged = await fetch(endpoint, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
                body: JSON.stringify({...input, recordedByProfileId: other.id})});
            expect(forged.status).toBe(400);
            expect((await invoiceService.listPools(id)).map(pool => pool.name)).not.toContain(input.name);
            const created = await fetch(endpoint, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify(input)});
            expect(created.status).toBe(200);
            expect(await created.json()).toEqual({changed: true});
            expect(created.headers.get('cache-control')).toBe('private, no-store');
            expect(created.headers.get('content-language')).toBe('de');
            const poolId = (await invoiceService.listPools(id)).find(pool => pool.name === input.name)!.id;

            // A browser-supplied proof filename cannot impersonate uploaded evidence.
            const forgedProof = new FormData();
            forgedProof.append('data', JSON.stringify({amount: '8', description: 'Untrusted filename'}));
            forgedProof.append('proof', 'forged.pdf');
            const rejected = await fetch(`${endpoint}/${poolId}/invoices/organizer`, {method: 'POST', headers, body: forgedProof});
            expect(rejected.status).toBe(400);
            const cost = new FormData();
            cost.append('data', JSON.stringify({amount: '8', description: 'Optional organizer proof saved'}));
            cost.append('proof', new Blob(['%PDF-1.4 HTTP organizer proof'], {type: 'application/pdf'}), 'organizer.pdf');
            const recorded = await fetch(`${endpoint}/${poolId}/invoices/organizer`, {method: 'POST', headers, body: cost});
            expect(recorded.status).toBe(200);
            expect(await recorded.json()).toEqual({changed: true});
            const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(pool.invoices).toHaveLength(1);
            expect(pool.invoices[0]).toMatchObject({description: 'Optional organizer proof saved', proofOriginalName: 'organizer.pdf',
                recordedByProfileId: owner.id, recordedByName: owner.name, registrationId: null});
            expect(await eventService.getRegistrationFor(owner.id, id)).toBeNull();

            // Public method grants remain independent from private page/profile
            // admission. Anonymous writes still require origin and compatibility.
            const publicHeaders = {'X-Surveyor-Api-Compatibility': apiCompatibility, 'X-Surveyor-Locale': 'en',
                Origin: new URL(settings.value.rootUrl).origin};
            const publicInput = {...input, name: 'Anonymous public-grant pool'};
            async function publicPost(path: string, body?: object): Promise<globalThis.Response> {
                return fetch(`${endpoint}${path}`, {method: 'POST', headers: body
                    ? {...publicHeaders, 'Content-Type': 'application/json'} : publicHeaders,
                    ...(body ? {body: JSON.stringify(body)} : {})});
            }
            expect((await publicPost('', publicInput)).status).toBe(403);
            await adminService.updatePerms('event', id, {public: PERM.MANAGE_ASSIGNMENTS});
            const noContext = await fetch(endpoint, {method: 'POST', headers: {...headers,
                'X-Surveyor-Context': '', 'Content-Type': 'application/json'}, body: JSON.stringify(publicInput)});
            expect(await noContext.json()).toMatchObject({code: 'CONTEXT_REQUIRED'});
            const wrongContext = await fetch(endpoint, {method: 'POST', headers: {...headers,
                'X-Surveyor-Context': 'another-context-12345678901234567890', 'Content-Type': 'application/json'}, body: JSON.stringify(publicInput)});
            expect(await wrongContext.json()).toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
            const noOrigin = await fetch(endpoint, {method: 'POST', headers: {
                'X-Surveyor-Api-Compatibility': apiCompatibility, 'Content-Type': 'application/json'}, body: JSON.stringify(publicInput)});
            expect(await noOrigin.json()).toMatchObject({code: 'CSRF_INVALID'});
            expect((await publicPost('', publicInput)).status).toBe(200);
            const publicPoolId = (await invoiceService.listPools(id)).find(row => row.name === publicInput.name)!.id;
            expect((await publicPost(`/${publicPoolId}/settings`, {distribution: 'NIGHTS', description: 'Public method settings',
                sendCalculationEmails: false, roundUpShares: false})).status).toBe(200);
            const own = (await eventService.getRegistrationFor(participant.id, id))!;
            const second = (await eventService.getRegistrationFor(other.id, id))!;
            expect((await publicPost(`/${publicPoolId}/assignments`, {assignAll: false, isDefault: true, subtractPersonalInvoices: false,
                registrations: [String(own.id), String(second.id)], exemptions: [String(second.id)], participantFactors: {[own.id]: '0.0000', [second.id]: '1.2500'}})).status).toBe(200);
            expect((await publicPost(`/${publicPoolId}/adjustments`, {registrationId: String(own.id), amount: '-2.5',
                note: 'Public method rebate', subtractFromPool: false})).status).toBe(200);
            const adjusted = (await invoiceService.getPoolWithInvoices(publicPoolId))!;
            expect(adjusted).toMatchObject({description: 'Public method settings', distributionMethod: 'NIGHTS'});
            expect(adjusted.assignments.find(row => row.registrationId === own.id)?.factor).toBe(0);
            expect(adjusted.surcharges[0]).toMatchObject({amount: '-2.50', note: 'Public method rebate'});
            expect((await publicPost(`/${publicPoolId}/adjustments/${adjusted.surcharges[0].id}/remove`)).status).toBe(200);
            expect((await publicPost(`/${publicPoolId}/takeovers/manage`, {payerId: String(own.id), beneficiaries: [String(second.id)]})).status).toBe(200);
            const coverage = (await invoiceService.getPoolWithInvoices(publicPoolId))!;
            expect(coverage.takeovers).toEqual([expect.objectContaining({payerRegistrationId: own.id, beneficiaryRegistrationId: second.id})]);

            // Native acceptance, decline and manager closure require the method
            // grant alone; recorder entry and retroactive review require a profile.
            const accepted = await submit(event, publicPoolId, participant, 'Anonymous public-grant acceptance');
            const declined = await submit(event, publicPoolId, other, 'Anonymous public-grant decline');
            expect((await publicPost(`/${publicPoolId}/invoices/${accepted.id}/approve`, {correctedAmount: '30'})).status).toBe(200);
            expect((await publicPost(`/${publicPoolId}/invoices/${accepted.id}/organizer-close`)).status).toBe(200);
            expect((await publicPost(`/${publicPoolId}/invoices/${declined.id}/decline`, {rejectionReason: 'Anonymous method review'})).status).toBe(200);
            const reviewed = (await invoiceService.getPoolWithInvoices(publicPoolId))!;
            expect(reviewed.invoices.find(row => row.id === accepted.id)).toMatchObject({status: 'CLOSED', amount: '40.00', correctedAmount: '30.00'});
            expect(reviewed.invoices.find(row => row.id === declined.id)).toMatchObject({status: 'REJECTED', rejectionReason: 'Anonymous method review'});
            expect((await publicPost(`/${publicPoolId}/invoices/${accepted.id}/revise`, {confirmed: true,
                expectedRevision: reviewed.calculationRevision, correctedAmount: '29', correctedDescription: null})).status).toBe(401);
            expect((await publicPost(`/${publicPoolId}/invoices/${accepted.id}/reject-accepted`, {confirmed: true,
                expectedRevision: reviewed.calculationRevision, rejectionReason: 'A profile is required'})).status).toBe(401);
            expect((await publicPost(`/${publicPoolId}/takeovers`, {beneficiaries: []})).status).toBe(401);
            const anonymousExpense = new FormData();
            anonymousExpense.append('data', JSON.stringify({amount: '8', description: 'Profile required expense'}));
            expect((await fetch(`${endpoint}/${publicPoolId}/invoices/organizer`, {method: 'POST', headers: publicHeaders,
                body: anonymousExpense})).status).toBe(401);
            for (const path of ['/finance', '/finance/organizer', `/finance/pools/${publicPoolId}/invoices/${accepted.id}/proof`]) {
                const privateRead = await fetch(`${origin}/api/v1/events/${id}${path}`, {headers: publicHeaders});
                expect(privateRead.status).toBe(401);
                expect(await privateRead.json()).toMatchObject({code: 'AUTH_REQUIRED'});
            }
            expect((await publicPost(`/${publicPoolId}/submission-state`, {status: 'ORGANIZER_ONLY',
                expectedRevision: reviewed.calculationRevision})).status).toBe(200);
            expect((await invoiceService.getPoolWithInvoices(publicPoolId))!.status).toBe('ORGANIZER_ONLY');
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        }
    }, 30_000);

    it('keeps organizer command grants independent from page reads and bounds every pool to its Event', async () => {
        const {id, event, poolId} = await fixture();
        const foreign = await fixture();
        const input = {name: 'Versioned organizer pool', distribution: 'NIGHTS', description: 'Separate saved settings',
            status: 'ORGANIZER_ONLY', assignAll: true, isDefault: false, subtractPersonalInvoices: true,
            roundUpShares: false, sendCalculationEmails: false};
        // A method grant cannot be inferred from registration, page access or a visible control.
        await expect(createEventFinancePool(id, input, actor(participant))).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('event', id, editor.id, PERM.ACCESS_ADMIN);
        await expect(createEventFinancePool(id, input, actor(editor))).rejects.toMatchObject({status: 403});
        await adminService.updateAdminPerms('event', id, editor.id, PERM.MANAGE_ASSIGNMENTS);
        const createdId = await createEventFinancePool(id, input, actor(editor));
        const created = (await invoiceService.getPoolWithInvoices(createdId))!;
        expect(created).toMatchObject({name: input.name, description: input.description, status: 'ORGANIZER_ONLY', distributionMethod: 'NIGHTS'});
        expect([created.assignAll, created.isDefault, created.subtractPersonalInvoices, created.roundUpShares, created.sendCalculationEmails]
            .map(Boolean)).toEqual([true, false, true, false, false]);
        // Assign-all membership is derived from current Event registrations;
        // creation need not persist redundant explicit assignment rows.
        expect((await readEventFinance(id, actor(owner), 'organizer')).pools.find(pool => pool.id === createdId)?.assignedCount).toBe(2);
        await expect(readEventFinance(id, actor(editor), 'organizer')).rejects.toMatchObject({status: 403});
        expect((await admitEventFinanceOrganizer(id, actor(editor))).id).toBe(event.id);
        await expect(admitEventFinanceOrganizer(id, {})).rejects.toMatchObject({status: 403});

        // The admitted Event remains the owner even when a valid pool ID belongs to another root.
        const foreignBefore = (await invoiceService.getPoolWithInvoices(foreign.poolId))!;
        await expect(updateEventFinanceSettings(id, foreign.poolId,
            {distribution: 'EQUAL', description: 'Forged cross-Event edit'}, actor(owner))).rejects.toMatchObject({status: 404});
        await expect(updateEventFinanceAssignments(id, foreign.poolId,
            {assignAll: true, registrations: []}, actor(owner))).rejects.toMatchObject({status: 404});
        expect((await invoiceService.getPoolWithInvoices(foreign.poolId))!.calculationRevision).toBe(foreignBefore.calculationRevision);

        // Submission access has its existing reviewed revision and never becomes financial reopening.
        const revision = (await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision;
        await changeEventFinanceSubmissionState(id, poolId, {status: 'ORGANIZER_ONLY', expectedRevision: revision}, actor(owner));
        await expect(changeEventFinanceSubmissionState(id, poolId,
            {status: 'OPEN', expectedRevision: revision}, actor(owner))).rejects.toMatchObject({status: 409});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.status).toBe('ORGANIZER_ONLY');
        await changeEventFinanceSubmissionState(id, poolId,
            {status: 'OPEN', expectedRevision: revision + 1}, actor(owner));
        expect((await invoiceService.getPoolWithInvoices(poolId))!.status).toBe('OPEN');
    });

    it('reviews original evidence through shared operations and rejects a stale retroactive correction without replacing saved shares', async () => {
        const {id, event, poolId} = await fixture();
        const invoice = await submit(event, poolId, participant, 'Immutable submitted receipt', 40);
        const rejected = await submit(event, poolId, other, 'Rejected original receipt', 9);
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        // Acceptance writes effective overrides while preserving proof and original submitted fields.
        await reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'approve',
            {correctedAmount: 35, correctedDescription: 'Accepted effective receipt'}, actor(owner));
        await reviewEventFinanceInvoice(id, poolId, String(rejected.id), 'decline',
            {rejectionReason: 'Paid outside this pool'}, actor(owner));
        await expect(reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'approve', {}, actor(owner)))
            .rejects.toMatchObject({status: 409});
        await reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'close', {}, actor(owner));
        const closedInvoice = (await invoiceService.getPoolWithInvoices(poolId))!.invoices.find(row => row.id === invoice.id)!;
        expect(closedInvoice).toMatchObject({status: 'CLOSED', amount: '40.00', description: 'Immutable submitted receipt',
            correctedAmount: '35.00', correctedDescription: 'Accepted effective receipt', proofPath: invoice.proofPath});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.invoices.find(row => row.id === rejected.id))
            .toMatchObject({status: 'REJECTED', amount: '9.00', description: 'Rejected original receipt', rejectionReason: 'Paid outside this pool'});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBeGreaterThan(initial.calculationRevision);

        // Calculation is fixture setup for P8's closed-pool input boundary, not a new P9 adapter.
        await invoices.closePool(event, poolId, {sendEmails: false}, nativeActor(owner));
        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        await invoices.markSharePaid(event, poolId, String(calculated.shares[0].id), true, nativeActor(owner));
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        const reviewed = {confirmed: true, expectedRevision: saved.calculationRevision,
            correctedAmount: 31, correctedDescription: 'Retroactive reviewed receipt'};
        await updateEventFinanceSettings(id, poolId, {distribution: 'EQUAL', description: 'Concurrent saved setting'}, actor(owner));
        await expect(reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'revise', reviewed, actor(owner)))
            .rejects.toMatchObject({status: 409});
        const afterConflict = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterConflict.invoices.find(row => row.id === invoice.id)?.correctedAmount).toBe('35.00');
        await reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'revise',
            {...reviewed, expectedRevision: afterConflict.calculationRevision}, actor(owner));
        const revised = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(revised.invoices.find(row => row.id === invoice.id)).toMatchObject({amount: '40.00',
            description: 'Immutable submitted receipt', correctedAmount: '31.00', correctedDescription: 'Retroactive reviewed receipt',
            proofPath: invoice.proofPath, status: 'CLOSED'});
        await reviewEventFinanceInvoice(id, poolId, String(invoice.id), 'reject',
            {confirmed: true, expectedRevision: revised.calculationRevision, rejectionReason: 'Counted cost removed after review'}, actor(owner));
        const final = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(Boolean(final.needsRecalculation)).toBe(true);
        expect(final.shares).toEqual(saved.shares);
        expect(final.calculationSnapshot).toEqual(saved.calculationSnapshot);
        expect(final.invoices.find(row => row.id === invoice.id)).toMatchObject({status: 'REJECTED', amount: '40.00',
            description: 'Immutable submitted receipt', proofPath: invoice.proofPath, rejectionReason: 'Counted cost removed after review'});
        expect(await readEventInvoiceProof(id, poolId, String(invoice.id), actor(participant))).toBeTruthy();
    });

    it('keeps organizer recorder, attributed participant, pool cost and proof ownership distinct without creating attendance', async () => {
        const {id, event, poolId} = await fixture();
        const registration = (await eventService.getRegistrationFor(participant.id, id))!;
        const foreign = await fixture();
        const foreignRegistration = (await eventService.getRegistrationFor(participant.id, foreign.id))!;
        const admitted = await admitEventFinanceOrganizer(id, actor(owner));
        await recordEventOrganizerInvoice(admitted, poolId,
            {amount: 18, description: 'Versioned shared pool-only expense'}, actor(owner));
        await recordEventOrganizerInvoice(admitted, poolId,
            {amount: 6, description: 'Versioned participant-paid expense', registrationId: registration.id}, actor(owner));
        await expect(recordEventOrganizerInvoice(admitted, poolId,
            {amount: 6, description: 'Foreign paid-by attribution', registrationId: foreignRegistration.id}, actor(owner)))
            .rejects.toMatchObject({status: 400});
        expect(await eventService.getRegistrationFor(owner.id, id)).toBeNull();
        const stored = (await invoiceService.getPoolWithInvoices(poolId))!;
        const sharedId = stored.invoices.find(row => row.description === 'Versioned shared pool-only expense')!.id;
        const attributedId = stored.invoices.find(row => row.description === 'Versioned participant-paid expense')!.id;
        expect(stored.invoices.find(row => row.id === sharedId)).toMatchObject({status: 'APPROVED', registrationId: null,
            recordedByProfileId: owner.id, recordedByName: owner.name});
        expect(stored.invoices.find(row => row.id === attributedId)).toMatchObject({status: 'APPROVED', registrationId: registration.id,
            recordedByProfileId: owner.id, recordedByName: owner.name});
        const personal = await readEventFinance(id, actor(participant));
        expect(personal.invoices.map(row => row.id)).toContain(String(attributedId));
        expect(personal.invoices.map(row => row.id)).not.toContain(String(sharedId));
        expect(personal.invoices.find(row => row.id === String(attributedId))).toMatchObject({recordedByName: owner.name,
            participantName: participant.name, participantEmail: null, canClose: true, canRetract: false});
        expect(stored.invoices).toHaveLength(2);
        expect(event.id).toBe(admitted.id);
    });

    it('saves factors, exemptions, signed adjustments and pending organizer coverage independently of applied closed shares', async () => {
        const {id, event, poolId} = await fixture();
        const registration = (await eventService.getRegistrationFor(participant.id, id))!;
        const otherRegistration = (await eventService.getRegistrationFor(other.id, id))!;
        await invoices.addOrganizerInvoice(event, poolId, {amount: 40, description: 'Saved cost before P8 edits'}, nativeActor(owner));
        await invoices.closePool(event, poolId, {sendEmails: false}, nativeActor(owner));
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        await recordEventOrganizerInvoice(await admitEventFinanceOrganizer(id, actor(owner)), poolId,
            {amount: 4, description: 'Additional cost after financial closure'}, actor(owner));
        // Per-form updates affect current allocation inputs only; a zero factor and exemption are separate choices.
        await updateEventFinanceAssignments(id, poolId, {assignAll: false, isDefault: true, subtractPersonalInvoices: false,
            registrations: [registration.id, otherRegistration.id], exemptions: [otherRegistration.id],
            participantFactors: {[registration.id]: 0, [otherRegistration.id]: 1.0001}}, actor(owner));
        await addEventFinanceAdjustment(id, poolId, {registrationId: registration.id, amount: -3.25,
            note: 'Reviewed redistribution rebate', subtractFromPool: true}, actor(owner));
        await addEventFinanceAdjustment(id, poolId, {registrationId: otherRegistration.id, amount: 2.5,
            note: 'Additional fixed charge', subtractFromPool: false}, actor(owner));
        await updateEventFinanceTakeovers(id, poolId,
            {payerId: registration.id, beneficiaries: [otherRegistration.id]}, actor(owner), true);
        const changed = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect([changed.assignAll, changed.isDefault, changed.subtractPersonalInvoices, changed.needsRecalculation].map(Boolean))
            .toEqual([false, true, false, true]);
        expect(changed.assignments.map(row => ({id: row.registrationId, factor: row.factor, isExempt: Boolean(row.isExempt)})))
            .toEqual(expect.arrayContaining([{id: registration.id, factor: 0, isExempt: false}, {id: otherRegistration.id, factor: 1.0001, isExempt: true}]));
        expect(changed.surcharges.map(row => ({...row, subtractFromPool: Boolean(row.subtractFromPool)}))).toEqual(expect.arrayContaining([
            expect.objectContaining({registrationId: registration.id, amount: '-3.25', subtractFromPool: true}),
            expect.objectContaining({registrationId: otherRegistration.id, amount: '2.50', subtractFromPool: false}),
        ]));
        expect(changed.shares).toEqual(saved.shares);
        expect(changed.calculationSnapshot).toEqual(saved.calculationSnapshot);
        const organizer = await readEventFinance(id, actor(owner), 'organizer');
        expect(organizer.pools.find(row => row.id === poolId)).toMatchObject({coverageGroups: [], hasPendingTakeovers: true,
            pendingCoverageGroups: [{payerId: String(registration.id), beneficiaries: [{id: String(otherRegistration.id), name: other.name}]}]});

        // Invalid values cannot partially change current inputs; deletion retains the saved share boundary too.
        await expect(updateEventFinanceAssignments(id, poolId, {assignAll: false, registrations: [registration.id],
            participantFactors: {[registration.id]: 0.00001}}, actor(owner))).rejects.toMatchObject({status: 400});
        await expect(addEventFinanceAdjustment(id, poolId, {registrationId: registration.id, amount: 0,
            note: 'Zero is invalid', subtractFromPool: true}, actor(owner))).rejects.toMatchObject({status: 400});
        await removeEventFinanceAdjustment(id, poolId, String(changed.surcharges[0].id), actor(owner));
        const afterDelete = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterDelete.surcharges).toHaveLength(1);
        expect(afterDelete.shares).toEqual(saved.shares);
        await expect(changeEventFinanceSubmissionState(id, poolId,
            {status: 'OPEN', expectedRevision: afterDelete.calculationRevision}, actor(owner))).rejects.toMatchObject({status: 409});
    });

    it('enforces participant payer ownership, one-level coverage and OPEN state while retaining organizer reassignment authority', async () => {
        const {id, event, poolId} = await fixture();
        const registration = (await eventService.getRegistrationFor(participant.id, id))!;
        const otherRegistration = (await eventService.getRegistrationFor(other.id, id))!;
        // The participant adapter never gains the organizer's payer selection through its body.
        await expect(updateEventFinanceTakeovers(id, poolId, {payerId: otherRegistration.id, beneficiaries: [registration.id]},
            actor(participant), false)).rejects.toMatchObject({status: 403});
        await updateEventFinanceTakeovers(id, poolId, {beneficiaries: [otherRegistration.id]}, actor(participant), false);
        await expect(updateEventFinanceTakeovers(id, poolId, {beneficiaries: [registration.id]}, actor(other), false))
            .rejects.toMatchObject({status: 400});
        await expect(updateEventFinanceTakeovers(id, poolId, {payerId: registration.id, beneficiaries: []}, actor(other), true))
            .rejects.toMatchObject({status: 403});
        // Managers may clear another payer's inputs and then establish the opposite valid relationship.
        await updateEventFinanceTakeovers(id, poolId, {payerId: registration.id, beneficiaries: []}, actor(owner), true);
        await updateEventFinanceTakeovers(id, poolId, {payerId: otherRegistration.id, beneficiaries: [registration.id]}, actor(owner), true);
        const planning = (await invoiceService.getPoolWithInvoices(poolId))!;
        await changeEventFinanceSubmissionState(id, poolId,
            {status: 'ORGANIZER_ONLY', expectedRevision: planning.calculationRevision}, actor(owner));
        await expect(updateEventFinanceTakeovers(id, poolId, {beneficiaries: []}, actor(other), false))
            .rejects.toMatchObject({status: 409});
        await updateEventFinanceTakeovers(id, poolId, {payerId: otherRegistration.id, beneficiaries: []}, actor(owner), true);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.takeovers).toEqual([]);
        expect(event.id).toBe(id);
    });

    it('delivers a definite conflict when a pool closes after upload admission but before its locked submission', async () => {
        const {event, poolId} = await fixture();
        const context = 'finance-http-context-12345678901234567890';
        const csrf = 'finance-http-csrf-12345678901234567890123';
        const app = express();
        app.use(express.json());
        app.use(session({secret: 'finance-http-race-fixture', resave: false, saveUninitialized: false}));
        app.post('/seed', function seedFinanceSession(req, res) {
            // Only the server fixture supplies identity. Production admission
            // reloads this persisted account/profile through the real DBAL.
            req.session.profile = participant;
            req.session.auth = {user: participant.user!};
            req.session.frontendContext = context;
            req.session.frontendCsrfToken = csrf;
            res.sendStatus(204);
        });
        app.use(function retainOwnUpload(req, res, next) {
            // Track only bytes attached to this fixture's real request. The
            // inherited rejected-upload lifecycle remains unchanged (IMP-013).
            res.once('finish', function captureOwnProof() { if (req.file) proofPaths.add(req.file.path); });
            next();
        });
        app.use('/api/v1/events', eventRouter);
        app.use(handleApiProblem);
        const server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing finance HTTP listener address');
        const origin = `http://127.0.0.1:${address.port}`;
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let acquired!: () => void;
        const locked = new Promise<void>(resolve => { acquired = resolve; });
        let closing: Promise<void> | undefined;
        let submission: Promise<globalThis.Response> | undefined;
        try {
            const seed = await fetch(`${origin}/seed`, {method: 'POST'});
            const cookie = seed.headers.get('set-cookie')?.split(';', 1)[0];
            expect(cookie).toBeTruthy();
            // A real concurrent transaction stages closure under the same pool
            // lock. The upload's initial snapshot still sees its committed OPEN
            // state, then waits for this transaction before its final decision.
            closing = invoiceService.withLockedPool(poolId, async function stagePoolClosure(manager, pool) {
                pool!.status = 'ORGANIZER_ONLY';
                await invoiceService.savePool(pool!, manager);
                acquired();
                await held;
            });
            await Promise.race([locked, closing]);
            const form = new FormData();
            form.append('data', JSON.stringify({amount: '12', description: 'Concurrent closed-pool upload'}));
            form.append('proof', new Blob(['%PDF-1.4 raced proof'], {type: 'application/pdf'}), 'race.pdf');
            submission = fetch(`${origin}/api/v1/events/${event.id}/finance/pools/${poolId}/invoices`, {
                method: 'POST', headers: {Cookie: cookie!, 'X-Surveyor-Context': context, 'X-CSRF-Token': csrf,
                    'X-Surveyor-Api-Compatibility': apiCompatibility, 'X-Surveyor-Locale': 'en'}, body: form,
            });
            // Observe this account's actual waiting SQL before committing the
            // closure. No mocked repository, timing sleep or test-only backend
            // hook can substitute for reaching the production root lock.
            await expect.poll(async function submissionReachedRootLock() {
                const rows = await AppDataSource.query('SELECT COUNT(*) AS waiting FROM information_schema.PROCESSLIST '
                    + 'WHERE DB = DATABASE() AND ID <> CONNECTION_ID() AND INFO LIKE ?', [`%${poolId}%FOR UPDATE%`]);
                return Number(rows[0].waiting);
            }, {timeout: 10_000, interval: 50}).toBeGreaterThan(0);
            release();
            await closing;
            const response = await submission;
            expect(response.status).toBe(409);
            expect(await response.json()).toMatchObject({code: 'RESOURCE_CONFLICT', status: 409});
            expect((await invoiceService.getPoolWithInvoices(poolId))!.invoices).toEqual([]);
        } finally {
            release();
            await closing?.catch(() => undefined);
            await submission?.catch(() => undefined);
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        }
    }, 30_000);

    it('separates own history from organizer costs, attributed invoices and contact disclosure', async () => {
        const {id, event, poolId} = await fixture();
        const own = await submit(event, poolId, participant, 'Own submitted evidence');
        await submit(event, poolId, other, 'PRIVATE other receipt description');
        await invoices.addOrganizerInvoice(event, poolId, {amount: 12, description: 'PRIVATE shared organizer cost'}, nativeActor(owner));
        const registration = (await eventService.getRegistrationFor(participant.id, id))!;
        const attributedId = await invoices.addOrganizerInvoice(event, poolId,
            {amount: 8, description: 'Attributed organizer evidence', registrationId: registration.id}, nativeActor(owner));

        const personal = await readEventFinance(id, actor(participant));
        expect(contractValidator('FinanceView')(personal)).toBe(true);
        expect(personal.invoices.map(row => row.id)).toEqual(expect.arrayContaining([String(own.id), String(attributedId)]));
        expect(personal.invoices).toHaveLength(2);
        expect(personal.invoices.find(row => row.id === String(attributedId))).toMatchObject({organizerRecorded: true,
            recordedByName: owner.name, participantName: participant.name, participantEmail: null, proofUrl: null,
            canClose: true, canRetract: false});
        expect(personal.pools[0]).toMatchObject({canSubmit: true, summary: null, calculation: null, exampleCalculation: null});
        for (const secret of ['PRIVATE', other.id, 'password', 'proofPath', 'recordedByProfileId']) {
            expect(JSON.stringify(personal)).not.toContain(secret);
        }
        const organizer = await readEventFinance(id, actor(owner), 'organizer');
        expect(contractValidator('FinanceView')(organizer)).toBe(true);
        expect(organizer.invoices).toHaveLength(4);
        expect(organizer.pools[0].summary?.primary.length).toBeGreaterThan(0);
        expect(organizer.invoices.find(row => row.id === String(own.id))?.participantEmail).toBe(participant.user!.email);
        await expect(readEventFinance(id, actor(editor))).rejects.toMatchObject({status: 403});
        await expect(readEventFinance(id, {})).rejects.toMatchObject({status: 401});
        await adminService.addAdmin('event', id, editor.id, PERM.ACCESS_ADMIN);
        await expect(readEventFinance(id, actor(editor), 'organizer')).rejects.toMatchObject({status: 403});
        await adminService.updateAdminPerms('event', id, editor.id, PERM.MANAGE_ASSIGNMENTS);
        await expect(readEventFinance(id, actor(editor), 'organizer')).rejects.toMatchObject({status: 403});
        // The independently granted proof method remains usable without organizer-page admission.
        expect(await readEventInvoiceProof(id, poolId, String(own.id), actor(editor))).toBeTruthy();
    });

    it('retains all review states, original evidence and proof after retraction or participant close', async () => {
        const {id, event, poolId} = await fixture();
        const retracted = await submit(event, poolId, participant, 'Withdrawn evidence');
        const accepted = await submit(event, poolId, participant, 'Corrected original', 40);
        const rejected = await submit(event, poolId, participant, 'Rejected evidence');
        const pending = await submit(event, poolId, participant, 'Pending evidence');
        await invoices.approveInvoice(event, poolId, String(accepted.id), {correctedAmount: 35, correctedDescription: 'Corrected saved'}, nativeActor(owner));
        await invoices.declineInvoice(event, poolId, String(rejected.id), {rejectionReason: 'Saved rejection reason'}, nativeActor(owner));
        const revision = (await readEventFinance(id, actor(participant))).pools[0].revision;
        await expect(retractEventInvoice(id, poolId, String(retracted.id), {confirmed: true, expectedRevision: revision - 1}, actor(participant)))
            .rejects.toMatchObject({status: 409, code: 'RESOURCE_CONFLICT'});
        await retractEventInvoice(id, poolId, String(retracted.id), {confirmed: true, expectedRevision: revision}, actor(participant));
        await expect(closeEventInvoice(id, poolId, String(accepted.id), actor(other))).rejects.toMatchObject({status: 403});
        await closeEventInvoice(id, poolId, String(accepted.id), actor(participant));
        await closeEventInvoice(id, poolId, String(accepted.id), actor(participant));
        await expect(closeEventInvoice(id, poolId, String(accepted.id), actor(other))).rejects.toMatchObject({status: 403});

        const personal = await readEventFinance(id, actor(participant));
        expect(personal.invoices.find(row => row.id === String(retracted.id))).toMatchObject({status: 'RETRACTED', canRetract: false});
        expect(personal.invoices.find(row => row.id === String(accepted.id))).toMatchObject({status: 'CLOSED', amount: '40.00',
            description: 'Corrected original', correctedAmount: '35.00', correctedDescription: 'Corrected saved', canClose: false});
        expect(personal.invoices.find(row => row.id === String(rejected.id))).toMatchObject({status: 'REJECTED', rejectionReason: 'Saved rejection reason'});
        expect(personal.invoices.find(row => row.id === String(pending.id))).toMatchObject({status: 'NEW', canRetract: true});
        expect(await readEventInvoiceProof(id, poolId, String(retracted.id), actor(participant))).toBeTruthy();
        await expect(readEventInvoiceProof(id, poolId, String(retracted.id), actor(other))).rejects.toMatchObject({status: 403});
        await expect(retractEventInvoice(id, poolId, String(pending.id), {confirmed: true, expectedRevision: personal.pools[0].revision}, actor(other)))
            .rejects.toMatchObject({status: 403});
    });

    it('reads frozen signed balances and lazy personal calculations without disclosing other payer contributions or recalculating', async () => {
        const {id, event, poolId} = await fixture();
        const own = await submit(event, poolId, participant, 'Saved calculation evidence', 40);
        await invoices.approveInvoice(event, poolId, String(own.id), {}, nativeActor(owner));
        await invoices.closePool(event, poolId, {sendEmails: false}, nativeActor(owner));
        const otherRegistration = (await eventService.getRegistrationFor(other.id, id))!;
        const ownRegistration = (await eventService.getRegistrationFor(participant.id, id))!;
        // Pending future coverage must not rewrite the frozen payer rows or widen a personal history-only pool's roster.
        await invoices.updateTakeovers(event, poolId, {payerId: otherRegistration.id, beneficiaries: [ownRegistration.id]}, nativeActor(owner), true);
        const stored = (await invoiceService.getPoolWithInvoices(poolId))!;
        const personal = await readEventFinance(id, actor(participant));
        expect(personal.shares).toHaveLength(1);
        expect(personal.shares[0]).toMatchObject({amount: '-20.00', status: 'refund', isPaid: false});
        const breakdown = await readEventFinanceBreakdown(id, poolId, personal.shares[0].id, actor(participant), 'participant');
        const validate = contractValidator('FinanceBreakdown');
        expect(validate(breakdown), JSON.stringify(validate.errors)).toBe(true);
        expect(JSON.stringify(breakdown)).not.toContain(other.name);
        expect(breakdown.components.find(row => row.key === 'shareAmount')?.amount).toBe('-20.00');
        const german = await readEventFinance(id, actor(participant), 'participant', 'de');
        expect(german.shares[0].caption).toBe('Zu erhaltende Erstattung');
        const germanBreakdown = await readEventFinanceBreakdown(id, poolId, personal.shares[0].id, actor(participant), 'participant', 'de');
        expect(germanBreakdown.calculation.title).toBe('Berechnungserklärung');
        expect((await readEventFinance(id, actor(participant))).shares[0].caption).toBe('Refund to receive');
        const organizer = await readEventFinance(id, actor(owner), 'organizer');
        expect(organizer.shares).toHaveLength(2);
        expect(organizer.pools[0].calculation).toBeTruthy();
        expect(organizer.pools[0].exampleCalculation).toBeTruthy();
        expect(organizer.pools[0]).toMatchObject({hasPendingTakeovers: true, coverageKnown: true, coverageGroups: [],
            pendingCoverageGroups: [{payerId: String(otherRegistration.id), payerName: other.name,
                beneficiaries: [{id: String(ownRegistration.id), name: participant.name}]}]});
        expect(personal.pools[0]).toMatchObject({coverageKnown: false, coverageGroups: [], pendingCoverageGroups: [], assignedCount: 0, assignAll: false});
        const otherShare = organizer.shares.find(row => row.id !== personal.shares[0].id)!;
        await expect(readEventFinanceBreakdown(id, poolId, otherShare.id, actor(participant), 'participant')).rejects.toMatchObject({status: 403});
        const afterRead = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterRead.calculationRevision).toBe(stored.calculationRevision);
        expect(afterRead.calculationSnapshot).toEqual(stored.calculationSnapshot);
        expect(afterRead.shares).toEqual(stored.shares);
        expect((await readEventFinance(id, actor(participant))).pools[0].canSubmit).toBe(false);
    });

    it('keeps assignment/open-state submission eligibility and validates proof bytes with the generated multipart shape', async () => {
        const {id, event, poolId: defaultPoolId} = await fixture();
        const registration = (await eventService.getRegistrationFor(participant.id, id))!;
        const otherRegistration = (await eventService.getRegistrationFor(other.id, id))!;
        await invoices.updateTakeovers(event, defaultPoolId, {beneficiaries: [otherRegistration.id]}, nativeActor(participant), false);
        expect((await readEventFinance(id, actor(participant))).pools.find(row => row.id === defaultPoolId)).toMatchObject({assignedCount: 2, assignAll: true,
            coverageGroups: [{payerId: String(registration.id), payerName: participant.name,
                beneficiaries: [{id: String(otherRegistration.id), name: other.name}]}], pendingCoverageGroups: []});
        const poolId = await invoices.createInvoicePool(event, {name: 'Assigned only', distribution: 'EQUAL', registrations: [registration.id]});
        expect((await readEventFinance(id, actor(participant))).pools.find(row => row.id === poolId)?.canSubmit).toBe(true);
        expect((await readEventFinance(id, actor(other))).pools.find(row => row.id === poolId)).toBeUndefined();
        const revision = (await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision;
        await invoices.changePoolSubmissionState(event, poolId, {status: 'ORGANIZER_ONLY', expectedRevision: revision});
        expect((await readEventFinance(id, actor(participant))).pools.find(row => row.id === poolId)).toBeUndefined();
        await expect(admitEventInvoiceSubmission(id, actor(editor))).rejects.toMatchObject({status: 403});
        const validate = contractValidator('FinanceInvoiceForm');
        const file = {originalname: 'receipt.pdf'} as Express.Multer.File;
        expect(validate(decodeApiMultipartData({data: JSON.stringify({amount: '10', description: 'Proof input'})}, file, 'proof'))).toBe(true);
        expect(validate(decodeApiMultipartData({data: JSON.stringify({amount: '10', extra: 'forged'})}, file, 'proof'))).toBe(false);
        expect(() => decodeApiMultipartData({data: '{}', proof: 'not uploaded'}, undefined, 'proof')).toThrow();
    });
});
