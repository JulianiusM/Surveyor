import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import type {Request} from 'express';
import invoices, {
    admitEventInvoiceSubmission, closeEventInvoice, readEventFinance, readEventFinanceBreakdown,
    readEventInvoiceProof, retractEventInvoice,
} from '../../src/controller/eventPoolController';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import {contractValidator} from '../../src/modules/api/contracts';
import {decodeApiMultipartData} from '../../src/modules/api/transport';
import {PERM} from '../../src/modules/lib/permissions';
import {AppDataSource} from '../../src/modules/database/dataSource';
import eventRouter from '../../src/routes/api/v1/events';
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
            form.append('data', JSON.stringify({amount: 12, description: 'Concurrent closed-pool upload'}));
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
        expect(personal.invoices.find(row => row.id === String(accepted.id))).toMatchObject({status: 'CLOSED', amount: 40,
            description: 'Corrected original', correctedAmount: 35, correctedDescription: 'Corrected saved', canClose: false});
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
        expect(personal.shares[0]).toMatchObject({amount: -20, status: 'refund', isPaid: false});
        const breakdown = await readEventFinanceBreakdown(id, poolId, personal.shares[0].id, actor(participant), 'participant');
        const validate = contractValidator('FinanceBreakdown');
        expect(validate(breakdown), JSON.stringify(validate.errors)).toBe(true);
        expect(JSON.stringify(breakdown)).not.toContain(other.name);
        expect(breakdown.components.find(row => row.key === 'shareAmount')?.amount).toBe(-20);
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
        expect(validate(decodeApiMultipartData({data: JSON.stringify({amount: 10, description: 'Proof input'})}, file, 'proof'))).toBe(true);
        expect(validate(decodeApiMultipartData({data: JSON.stringify({amount: 10, extra: 'forged'})}, file, 'proof'))).toBe(false);
        expect(() => decodeApiMultipartData({data: '{}', proof: 'not uploaded'}, undefined, 'proof')).toThrow();
    });
});
