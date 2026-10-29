import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import type {Request, Router} from 'express';
import invoices, {
    admitEventInvoiceSubmission, closeEventInvoice, readEventFinance, readEventFinanceBreakdown,
    readEventInvoiceProof, retractEventInvoice, createEventFinancePool, updateEventFinanceSettings,
    changeEventFinanceSubmissionState, admitEventFinanceOrganizer, recordEventOrganizerInvoice,
    reviewEventFinanceInvoice, updateEventFinanceAssignments, addEventFinanceAdjustment,
    removeEventFinanceAdjustment, updateEventFinanceTakeovers,
    previewEventFinancePool, calculateEventFinancePool, rollbackEventFinancePool, notifyEventFinancePool, settleEventFinanceShare,
} from '../../src/backend/controller/eventPoolController';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {decodeApiMultipartData} from '../../src/backend/modules/api/transport';
import {PERM} from '../../src/backend/modules/lib/permissions';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import settings from '../../src/backend/modules/settings';
import {handleApiProblem} from '../../src/backend/modules/api/problem';
import {createTranslator} from '../../src/common/localization/translator';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import mailer from '../../src/backend/modules/email';
import type {Event} from '../../src/backend/modules/database/entities/event/Event';
import type {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import type {SessionLike} from '../../src/types/PermissionTypes';
import {createInvoiceSubmissionCase} from '../factories/invoiceFactory';
import {createIntegrationEvent, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let other: Profile;
let editor: Profile;
let eventRouter: Router;
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
    // Production selects settings before constructing routers and their upload
    // storage. Preserve that ordering so this HTTP fixture uses its isolated root.
    const routes = await vi.importActual<typeof import('../../src/backend/routes/api/v1/events.js')>(
        '../../src/backend/routes/api/v1/events.js');
    eventRouter = routes.default;
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
    it('loads one pool graph per read and refreshes participant eligibility between requests', async () => {
        const {id, event, poolId} = await fixture();
        await submit(event, poolId, participant, 'Retained own invoice across reads');

        // Observe actual database dispatch without replacing repositories, rows
        // or transactions. A counter retains no pool payload or query parameters.
        const logger = AppDataSource.logger;
        const originalLogQuery = logger.logQuery;
        let poolLoads = 0;
        const observe = vi.spyOn(logger, 'logQuery').mockImplementation(function countPoolLoads(query, parameters, runner) {
            if (/\bFROM\s+(?:`[^`]+`\.)?`event_invoice_pools`\s/iu.test(query)) poolLoads++;
            originalLogQuery.call(logger, query, parameters, runner);
        });

        /** Each controller request must hydrate exactly one fresh pool graph. */
        async function readParticipant(profile: Profile) {
            const before = poolLoads;
            const result = await readEventFinance(id, actor(profile));
            expect(poolLoads - before).toBe(1);
            return result;
        }

        try {
            const open = await readParticipant(participant);
            expect(open.pools.find(pool => pool.id === poolId)).toMatchObject({status: 'OPEN', canSubmit: true});

            // A later request must observe the committed lifecycle change. Own
            // history retains its pool name without borrowing submission access.
            await invoices.changePoolSubmissionState(event, poolId,
                {status: 'ORGANIZER_ONLY', expectedRevision: open.pools[0].revision});
            const closed = await readParticipant(participant);
            expect(closed.invoices).toHaveLength(1);
            expect(closed.pools.find(pool => pool.id === poolId)).toMatchObject({status: 'ORGANIZER_ONLY', canSubmit: false,
                coverageChoices: [], coverageGroups: [], assignedCount: 0});
            expect((await readParticipant(other)).pools).toEqual([]);

            // Reopening is independently visible; no earlier request's graph or
            // actor-specific eligibility is cached or mutated by a later read.
            await invoices.changePoolSubmissionState(event, poolId,
                {status: 'OPEN', expectedRevision: closed.pools[0].revision});
            expect((await readParticipant(other)).pools.find(pool => pool.id === poolId))
                .toMatchObject({status: 'OPEN', canSubmit: true});
            expect(open.pools[0]).toMatchObject({status: 'OPEN', canSubmit: true});
            expect(closed.pools[0]).toMatchObject({status: 'ORGANIZER_ONLY', canSubmit: false});
        } finally {
            observe.mockRestore();
        }
    });

    it('projects one localized reviewed calculation without writes and preserves the independent preview method grant', async () => {
        const {id, event, poolId} = await fixture();
        await invoices.addOrganizerInvoice(event, poolId, {amount: 27.51, description: 'Preview source'}, nativeActor(owner));
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        sendEmail.mockClear();
        await expect(previewEventFinancePool(id, poolId, actor(participant))).rejects.toMatchObject({status: 403});
        await adminService.addAdmin('event', id, editor.id, PERM.MANAGE_ASSIGNMENTS);
        const preview = await previewEventFinancePool(id, poolId, actor(editor), 'de');
        const validate = contractValidator('FinancePreview');
        expect(validate(preview), JSON.stringify(validate.errors)).toBe(true);
        expect(preview.revision).toBe(before.calculationRevision);
        expect(preview.shares).toHaveLength(2);
        expect(preview.shares.map(row => row.baseShareAmount)).toEqual(['13.76', '13.76']);
        expect(preview.totals).toMatchObject({invoiceAmount: '27.51', allocatedBaseAmount: '27.52', roundingDifference: '0.01'});
        expect(preview.columns[0]).toMatchObject({key: 'baseShareAmount', label: 'Grundanteil'});
        expect(preview.calculation.title).toBe('Berechnungsübersicht');
        expect(JSON.stringify(preview)).not.toContain(participant.user!.email);
        expect(sendEmail).not.toHaveBeenCalled();
        // Method admission grants preview without silently admitting the private organizer page.
        await expect(readEventFinance(id, actor(editor), 'organizer')).rejects.toMatchObject({status: 403});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares).toEqual(before.shares);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBe(before.calculationRevision);
        const foreign = await fixture();
        await expect(previewEventFinancePool(foreign.id, poolId, actor(owner))).rejects.toMatchObject({status: 404});
        await adminService.updatePerms('event', id, {public: PERM.MANAGE_ASSIGNMENTS});
        expect((await previewEventFinancePool(id, poolId, {})).revision).toBe(before.calculationRevision);
    });

    it('rejects stale previews, carries signed recorded transfers and restores only pool-local calculation inputs', async () => {
        const {id, event, poolId} = await fixture();
        const cost = await submit(event, poolId, participant, 'Calculation source', 40);
        await invoices.approveInvoice(event, poolId, String(cost.id), {}, nativeActor(owner));
        const first = await previewEventFinancePool(id, poolId, actor(owner));
        await updateEventFinanceSettings(id, poolId, {distribution: 'EQUAL', description: 'New input', sendCalculationEmails: false, roundUpShares: true}, actor(owner));
        await expect(calculateEventFinancePool(id, poolId, {expectedRevision: first.revision, sendEmails: false}, actor(owner), false))
            .rejects.toMatchObject({code: 'FINANCE_THE_PREVIEW_IS_OUT_OF_DATE_PREVIEW_THE_CALCULATION_409', status: 409});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares).toEqual([]);
        const reviewed = await previewEventFinancePool(id, poolId, actor(owner));
        sendEmail.mockClear();
        await calculateEventFinancePool(id, poolId, {expectedRevision: reviewed.revision, sendEmails: false}, actor(owner), false);
        expect(sendEmail).not.toHaveBeenCalled();
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        const refund = saved.shares.find(row => Number(row.shareAmount) < 0)!;
        const payment = saved.shares.find(row => Number(row.shareAmount) > 0)!;
        await settleEventFinanceShare(id, poolId, String(refund.id), true, actor(owner));
        await settleEventFinanceShare(id, poolId, String(payment.id), true, actor(owner));
        await updateEventFinanceSettings(id, poolId, {distribution: 'EQUAL', description: 'Pending local edit', sendCalculationEmails: false, roundUpShares: false}, actor(owner));
        const pending = (await invoiceService.getPoolWithInvoices(poolId))!;
        // A stale source calculation remains payable; recording/reversing uses its saved signed balance.
        await settleEventFinanceShare(id, poolId, String(payment.id), false, actor(owner));
        await settleEventFinanceShare(id, poolId, String(payment.id), true, actor(owner));
        expect((await invoiceService.getPoolWithInvoices(poolId))!.needsRecalculation).toBeTruthy();
        const restored = await rollbackEventFinancePool(id, poolId, {}, actor(owner));
        expect(restored).toEqual({needsRecalculation: false, externalChanges: false});
        const afterRollback = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterRollback.description).toBe('New input');
        expect(afterRollback.shares.map(row => [row.id, row.shareAmount, row.isPaid])).toEqual(pending.shares.map(row => [row.id, row.shareAmount, row.isPaid]));
        const again = await previewEventFinancePool(id, poolId, actor(owner));
        expect(again.shares.map(row => row.paymentCreditAmount).sort()).toEqual(['-20.00', '20.00']);
        await calculateEventFinancePool(id, poolId, {expectedRevision: again.revision, sendEmails: false}, actor(owner), true);
        const recalculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(recalculated.shares.map(row => Number(row.shareAmount))).toEqual([0, 0]);
        expect(recalculated.shares.map(row => Number(row.paymentCreditAmount)).sort((a, b) => a - b)).toEqual([-20, 20]);
        expect(recalculated.status).toBe('CLOSED');
    });

    it('queues optional settlement notices from the complete saved ledger and preserves PDF snapshot privacy', async () => {
        const {id, event, poolId} = await fixture();
        await invoices.addOrganizerInvoice(event, poolId, {amount: 28, description: 'Mail and output source'}, nativeActor(owner));
        const reviewed = await previewEventFinancePool(id, poolId, actor(owner));
        sendEmail.mockClear();
        await calculateEventFinancePool(id, poolId, {expectedRevision: reviewed.revision, sendEmails: true}, actor(owner), false);
        expect(sendEmail).toHaveBeenCalledTimes(2);
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        await expect(notifyEventFinancePool(id, poolId, {expectedRevision: reviewed.revision}, actor(owner)))
            .rejects.toMatchObject({code: 'FINANCE_THE_SETTLEMENT_CHANGED_RELOAD_BEFORE_SENDING_EMAILS_409', status: 409});
        sendEmail.mockClear();
        expect(await notifyEventFinancePool(id, poolId, {}, actor(owner))).toEqual({count: 2});
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares).toEqual(saved.shares);
        // Both PDF variants use the existing complete saved rows, independent of any browser filtering.
        const full = await invoices.getInvoiceSharesPdfData(event, poolId, {example: 'true'});
        const compact = await invoices.getInvoiceSharesPdfData(event, poolId, {example: 'false'});
        expect(full.shares).toHaveLength(2);
        expect(compact.shares).toEqual(full.shares);
        expect(full.pdfOptions?.includeExampleCalculation).toBe(true);
        expect(compact.pdfOptions?.includeExampleCalculation).toBe(false);
        const personal = await readEventFinance(id, actor(participant));
        expect(personal.pools[0].summary).toBeNull();
        expect(personal.pools[0].canRollback).toBeUndefined();
        expect(JSON.stringify(personal)).not.toContain(other.user!.email);
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

            // A valid empty allocation reaches the shared calculation rule,
            // rather than being mislabeled as malformed submitted form values.
            const emptyName = 'HTTP pool without assigned participants';
            const emptyCreated = await fetch(endpoint, {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
                body: JSON.stringify({...input, name: emptyName, assignAll: false})});
            expect(emptyCreated.status).toBe(200);
            const empty = (await invoiceService.listPools(id)).find(pool => pool.name === emptyName)!;
            for (const locale of ['en', 'de'] as const) {
                const localizedHeaders = {...headers, 'X-Surveyor-Locale': locale};
                const preview = await fetch(`${endpoint}/${empty.id}/preview`, {headers: localizedHeaders});
                const close = await fetch(`${endpoint}/${empty.id}/close`, {method: 'POST',
                    headers: {...localizedHeaders, 'Content-Type': 'application/json'},
                    body: JSON.stringify({expectedRevision: empty.calculationRevision, sendEmails: false})});
                for (const response of [preview, close]) {
                    expect(response.status).toBe(400);
                    expect(response.headers.get('content-language')).toBe(locale);
                    const problem = await response.json();
                    expect(contractValidator('Problem')(problem)).toBe(true);
                    expect(problem).toMatchObject({code: 'FINANCE_NO_PARTICIPANTS_ASSIGNED_TO_THIS_POOL_400',
                        messageKey: 'finance.noParticipantsAssignedToThisPool', params: {}, status: 400,
                        detail: createTranslator(locale).t('finance.noParticipantsAssignedToThisPool')});
                    expect(JSON.stringify(problem)).not.toContain(participant.user!.email);
                    expect(JSON.stringify(problem)).not.toContain(other.user!.email);
                }
            }
            const stillEmpty = (await invoiceService.getPoolWithInvoices(empty.id))!;
            expect(stillEmpty.status).toBe('OPEN');
            expect(stillEmpty.shares).toEqual([]);
            expect(stillEmpty.assignments).toEqual([]);

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

            // Exercise all reviewed calculation transports against real middleware and persistence.
            const calculationPath = `${endpoint}/${poolId}`;
            const previewReply = await fetch(`${calculationPath}/preview`, {headers});
            expect(previewReply.status).toBe(200);
            const calculation = await previewReply.json();
            const jsonHeaders = {...headers, 'Content-Type': 'application/json'};
            const missingRevision = await fetch(`${calculationPath}/close`, {method: 'POST', headers: jsonHeaders,
                body: JSON.stringify({sendEmails: false})});
            expect(missingRevision.status).toBe(400);
            const closed = await fetch(`${calculationPath}/close`, {method: 'POST', headers: jsonHeaders,
                body: JSON.stringify({expectedRevision: calculation.revision, sendEmails: false})});
            expect(closed.status).toBe(200);
            expect(await closed.json()).toEqual({changed: true});
            const savedShares = (await invoiceService.getPoolWithInvoices(poolId))!.shares;
            const settled = await fetch(`${calculationPath}/shares/${savedShares[0].id}/settlement`, {method: 'POST', headers: jsonHeaders,
                body: JSON.stringify({isPaid: true})});
            expect(settled.status).toBe(200);
            expect(await settled.json()).toEqual({changed: true});
            // These existing actions have no mandatory revision or request body.
            const rolledBack = await fetch(`${calculationPath}/rollback`, {method: 'POST', headers});
            expect(rolledBack.status).toBe(200);
            expect(await rolledBack.json()).toEqual({needsRecalculation: false, externalChanges: false});
            const notified = await fetch(`${calculationPath}/notify`, {method: 'POST', headers});
            expect(notified.status).toBe(200);
            expect(await notified.json()).toEqual({count: 2});
            const freshPreview = await fetch(`${calculationPath}/preview`, {headers});
            const freshCalculation = await freshPreview.json();
            const recalculated = await fetch(`${calculationPath}/recalculate`, {method: 'POST', headers: jsonHeaders,
                body: JSON.stringify({expectedRevision: freshCalculation.revision, sendEmails: false})});
            expect(recalculated.status).toBe(200);

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
            expect(await response.json()).toMatchObject({code: 'FINANCE_POOL_IS_CLOSED_FOR_INVOICE_SUBMISSIONS_409',
                messageKey: 'finance.poolIsClosedForInvoiceSubmissions', params: {}, status: 409});
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
            .rejects.toMatchObject({status: 409, code: 'FINANCE_THE_POOL_CHANGED_RELOAD_AND_REVIEW_THE_INVOICE_AGAIN_409'});
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
