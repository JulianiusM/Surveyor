import * as invoiceOperations from '../../src/modules/invoice/invoiceOperations';
import * as poolOperations from '../../src/modules/invoice/poolOperations';
import type {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import {AddOrganizerInvoices1789603200000} from '../../src/migrations/1789603200000-AddOrganizerInvoices';
import {AddInvoicePoolOrganizerOnlyState1790985600000} from '../../src/migrations/1790985600000-AddInvoicePoolOrganizerOnlyState';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {EventInvoice} from '../../src/modules/database/entities/event/EventInvoice';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/modules/database/services/EventService';
import mailer from '../../src/modules/email';
import settings from '../../src/modules/settings';
import type {PermBundle} from '../../src/types/PermissionTypes';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let organizer: Profile;
let first: Profile;
let second: Profile;
const proofs = new Set<string>();
const sendEmail = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
const managePerms = {entity: {has: (permission: string) => permission === 'MANAGE_ASSIGNMENTS'}} as PermBundle;
const sessionFor = (profile: Profile) => ({profile} as Request['session']);

beforeAll(async () => {
    await initializeIntegrationDatabase();
    organizer = await persistIntegrationProfile({name: 'Nonattending organizer'});
    first = await persistIntegrationProfile({name: 'First participant'});
    second = await persistIntegrationProfile({name: 'Second participant'});
}, 120_000);
beforeEach(() => sendEmail.mockClear());
afterAll(async () => {
    sendEmail.mockRestore();
    await Promise.all([...proofs].map((proof) => fs.promises.unlink(proof).catch(() => undefined)));
    await closeIntegrationDatabase();
});

/** Build real event membership independently of whether participant invoice submission is ever enabled. */
async function eventContext() {
    const eventId = await createIntegrationEvent(organizer.id, 'Organizer pool costs');
    // The organizer remains outside attendance; the two participant registrations only supply allocation recipients.
    for (const profile of [first, second]) {
        await registerEventAttendance(eventId, profile, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    }
    const event = (await eventService.getEventById(eventId))!;
    const firstId = (await eventService.getRegistrationFor(first.id, eventId))!.id;
    const secondId = (await eventService.getRegistrationFor(second.id, eventId))!.id;
    return {event, firstId, secondId};
}

/** Retain default OPEN fixtures for established invoice workflows while sharing their event setup. */
async function context() {
    const value = await eventContext();
    const poolId = await invoiceService.createPool(value.event.id, 'Shared costs', '', 'EQUAL', false, true, true, [], false);
    return {...value, poolId};
}

async function proofFile(): Promise<Express.Multer.File> {
    const proofPath = path.resolve(process.cwd(), settings.value.invoiceDir, `organizer-test-${randomUUID()}.pdf`);
    await fs.promises.mkdir(path.dirname(proofPath), {recursive: true});
    await fs.promises.writeFile(proofPath, '%PDF-1.4 organizer proof');
    proofs.add(proofPath);
    return {path: proofPath, originalname: 'organizer-receipt.pdf', mimetype: 'application/pdf'} as Express.Multer.File;
}

describe('organizer invoice entries without event attendance', () => {
    it('migrates existing participant invoices without changing proofs, shares, payments, or calculation revisions', async () => {
        // Run the reversible legacy-schema check before this suite creates any organizer entries.
        const {event, poolId, firstId} = await context();
        const invoiceId = await invoiceOperations.persistSubmittedInvoice(poolId, firstId, 100, 'Participant receipt', {
            path: 'uploads/invoices/legacy-proof.pdf', originalName: 'legacy-proof.pdf', mimeType: 'application/pdf',
        });
        await invoiceOperations.acceptSavedInvoice(poolId, invoiceId);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, initial.shares[0].id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const migration = new AddOrganizerInvoices1789603200000();
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            await migration.down(runner);
            await migration.up(runner);
            await migration.up(runner);
            const after = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(after.invoices).toEqual(before.invoices);
            expect(after.shares).toEqual(before.shares);
            expect(after.calculationRevision).toBe(before.calculationRevision);
            expect(after.calculationSnapshot).toEqual(before.calculationSnapshot);
            expect(after.needsRecalculation).toBe(before.needsRecalculation);
            expect((await runner.getTable('event_invoices'))!.findColumnByName('registration_id')!.isNullable).toBe(true);
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('extends a legacy pool enum without changing costs, settlements, snapshots, or existing lifecycle states', async () => {
        const {event, poolId} = await context();
        await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 100, description: 'Migration baseline'}, sessionFor(organizer));
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const closed = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, closed.shares[0].id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const migration = new AddInvoicePoolOrganizerOnlyState1790985600000();
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            // Rehearse existing-schema upgrade, including an idempotent second run, on the guarded disposable schema.
            await migration.down(runner);
            await migration.up(runner);
            await migration.up(runner);
            const after = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(after.status).toBe('CLOSED');
            expect(after.invoices).toEqual(before.invoices);
            expect(after.shares).toEqual(before.shares);
            expect(after.calculationSnapshot).toEqual(before.calculationSnapshot);
            expect(after.calculationRevision).toBe(before.calculationRevision);
            expect((await runner.getTable('event_invoice_pools'))!.findColumnByName('status')!.enum).toContain('ORGANIZER_ONLY');
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('creates directly with organizer invoices only, records costs, and closes without ever opening participant invoices', async () => {
        const {event, firstId} = await eventContext();
        const poolId = await eventPoolController.createInvoicePool(event, {
            name: 'Organizer invoices from creation', status: 'ORGANIZER_ONLY', distribution: 'EQUAL',
            assignAll: true, sendCalculationEmails: false,
        });
        const created = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(created.status).toBe('ORGANIZER_ONLY');
        expect(created.calculationRevision).toBe(0);
        expect(created.closedAt).toBeNull();
        expect(created.calculationSnapshot).toBeNull();
        expect(created.shares).toEqual([]);
        expect(await invoiceService.getParticipantPools(event.id, firstId)).toEqual([]);
        // Submission stays disabled from the first persisted state; no OPEN transition is part of this workflow.
        await expect(eventPoolController.submitInvoice(event, poolId, {amount: 10}, sessionFor(first)))
            .rejects.toMatchObject({status: 400});
        await expect(invoiceOperations.persistSubmittedInvoice(poolId, firstId, 10, 'Disabled from creation'))
            .rejects.toMatchObject({status: 409});

        await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 120, description: 'Direct organizer cost'}, sessionFor(organizer));
        expect((await invoiceService.getPoolWithInvoices(poolId))!.status).toBe('ORGANIZER_ONLY');
        expect(await eventService.getRegistrationFor(organizer.id, event.id)).toBeNull();
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(calculated.status).toBe('CLOSED');
        expect(calculated.invoiceAmount).toBe(120);
        expect(calculated.invoices).toHaveLength(1);
        expect(calculated.shares).toHaveLength(2);
        expect(calculated.shares.every(share => share.baseShareAmount === 60 && share.invoiceCreditAmount === 0 && share.shareAmount === 60)).toBe(true);
        expect(calculated.calculationSnapshot).not.toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();
        // A calculated pool remains closed regardless of which uncalculated state is requested next.
        for (const status of ['OPEN', 'ORGANIZER_ONLY']) {
            await expect(eventPoolController.changePoolSubmissionState(event, poolId, {status, expectedRevision: calculated.calculationRevision}))
                .rejects.toMatchObject({status: 409});
        }
    });

    it('closes and reopens participant submissions independently of organizer costs and then calculates directly from either state', async () => {
        const {event, poolId, firstId} = await context();
        const originalId = await invoiceOperations.persistSubmittedInvoice(poolId, firstId, 20, 'Existing participant cost');
        const original = (await invoiceService.getPoolWithInvoices(poolId))!;
        await eventPoolController.changePoolSubmissionState(event, poolId, {status: 'ORGANIZER_ONLY', expectedRevision: original.calculationRevision});
        const organizerOnly = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(organizerOnly.status).toBe('ORGANIZER_ONLY');
        expect(organizerOnly.invoices).toEqual(original.invoices);
        expect(organizerOnly.assignments).toEqual(original.assignments);
        expect(organizerOnly.shares).toEqual([]);
        expect(organizerOnly.closedAt).toBeNull();
        expect(organizerOnly.needsRecalculation).toBeFalsy();
        expect(await invoiceService.getParticipantPools(event.id, firstId)).not.toContainEqual(expect.objectContaining({id: poolId}));
        // Both orchestration and the locked operation reject new participant invoices; organizers keep recording costs.
        await expect(eventPoolController.submitInvoice(event, poolId, {amount: 10}, sessionFor(first)))
            .rejects.toMatchObject({status: 400});
        await expect(invoiceOperations.persistSubmittedInvoice(poolId, firstId, 10, 'Blocked participant cost'))
            .rejects.toMatchObject({status: 409});
        await eventPoolController.approveInvoice(event, poolId, String(originalId), {}, sessionFor(organizer));
        await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 100, description: 'Organizer pool cost'}, sessionFor(organizer));
        const withCost = (await invoiceService.getPoolWithInvoices(poolId))!;
        await expect(eventPoolController.changePoolSubmissionState(event, poolId, {status: 'OPEN', expectedRevision: organizerOnly.calculationRevision}))
            .rejects.toMatchObject({status: 409});
        await eventPoolController.changePoolSubmissionState(event, poolId, {status: 'OPEN', expectedRevision: withCost.calculationRevision});
        const reopened = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(await invoiceService.getParticipantPools(event.id, firstId)).toContainEqual(expect.objectContaining({id: poolId}));
        await invoiceOperations.persistSubmittedInvoice(poolId, firstId, 15, 'Reopened participant cost');
        const afterSubmission = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterSubmission.invoices).toHaveLength(reopened.invoices.length + 1);
        await eventPoolController.changePoolSubmissionState(event, poolId, {status: 'ORGANIZER_ONLY', expectedRevision: afterSubmission.calculationRevision});
        // Downgrading must never silently reopen submission access or discard this independent lifecycle state.
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            await expect(new AddInvoicePoolOrganizerOnlyState1790985600000().down(runner)).rejects.toThrow('pools still use it');
        } finally {
            await runner.release();
        }
        const preview = await eventPoolController.previewPool(event, poolId);
        await eventPoolController.closePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(calculated.status).toBe('CLOSED');
        expect(calculated.shares).toHaveLength(2);
        expect(calculated.calculationSnapshot).not.toBeNull();
        expect(calculated.invoices).toHaveLength(3);
        await expect(eventPoolController.changePoolSubmissionState(event, poolId, {status: 'OPEN', expectedRevision: calculated.calculationRevision}))
            .rejects.toMatchObject({status: 409});
    });

    it('records an approved shared cost for a nonparticipant without creating a registration or reimbursement', async () => {
        const {event, poolId} = await context();
        const invoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {amount: '100.00', description: '  Venue hire  '}, sessionFor(organizer));
        const invoice = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
        expect(invoice).toMatchObject({
            status: 'APPROVED', registration: null, registrationId: null, amount: '100.00', description: 'Venue hire',
            recordedByProfileId: organizer.id, recordedByName: organizer.name, proofPath: null,
        });
        expect(invoice.recordedByProfile!.id).toBe(organizer.id);
        expect(await eventService.getRegistrationFor(organizer.id, event.id)).toBeNull();
        expect(await eventService.getRegistrationsForEvent(event.id)).toHaveLength(2);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.invoiceAmount).toBe(100);
        expect(pool.shares).toHaveLength(2);
        expect(pool.shares.every((share) => share.baseShareAmount === 50 && share.invoiceCreditAmount === 0 && share.shareAmount === 50)).toBe(true);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('keeps unattributed organizer costs separate from an attending recorder’s own invoices', async () => {
        const {event, poolId, firstId, secondId} = await context();
        const participantInvoiceId = await invoiceOperations.persistSubmittedInvoice(poolId, firstId, 100, 'Personal purchase', null);
        await invoiceOperations.acceptSavedInvoice(poolId, participantInvoiceId);
        const organizerInvoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {
            amount: 50, description: 'Shared booking', recordedByProfileId: organizer.id,
        }, sessionFor(first));
        expect((await invoiceService.getInvoiceWithRegistration(poolId, organizerInvoiceId))!).toMatchObject({
            registrationId: null, recordedByProfileId: first.id,
        });
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.invoiceAmount).toBe(150);
        expect(pool.shares.find((share) => share.registrationId === firstId)).toMatchObject({baseShareAmount: 75, invoiceCreditAmount: 100, shareAmount: -25});
        expect(pool.shares.find((share) => share.registrationId === secondId)).toMatchObject({baseShareAmount: 75, invoiceCreditAmount: 0, shareAmount: 75});
    });

    it.each([
        {state: 'OPEN', credits: true}, {state: 'OPEN', credits: false},
        {state: 'ORGANIZER_ONLY', credits: true}, {state: 'ORGANIZER_ONLY', credits: false},
        {state: 'CLOSED', credits: true}, {state: 'CLOSED', credits: false},
    ] as const)('attributes an organizer invoice in $state with participant credits=$credits', async ({state, credits}) => {
        const {event, poolId, firstId, secondId} = await context();
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, credits, [], []);
        if (state === 'ORGANIZER_ONLY') {
            const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
            await eventPoolController.changePoolSubmissionState(event, poolId, {status: state, expectedRevision: initial.calculationRevision});
        } else if (state === 'CLOSED') {
            // A late attributed expense must preserve the existing calculated balances and recorded transfers.
            await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 100, description: 'Existing shared cost'}, sessionFor(organizer));
            await eventPoolController.closePool(event, poolId, {sendEmails: false});
            const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
            await poolOperations.recordShareSettlement(poolId, calculated.shares.find(share => share.registrationId === firstId)!.id, true);
        }
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const invoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {
            amount: 100, description: 'Participant paid this organizer entry', registrationId: firstId,
            // Request data must never replace the authenticated recorder, even when its paid-by selection is valid.
            recordedByProfileId: second.id,
        }, sessionFor(organizer));
        const invoice = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
        expect(invoice).toMatchObject({registrationId: firstId, registration: {profile: {id: first.id}},
            recordedByProfileId: organizer.id, recordedByName: organizer.name, status: 'APPROVED', proofPath: null});
        expect(await eventService.getRegistrationFor(organizer.id, event.id)).toBeNull();
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.calculationRevision).toBe(before.calculationRevision + 1);
        expect(pool.shares).toEqual(before.shares);
        expect(pool.status).toBe(state);
        expect(Boolean(pool.needsRecalculation)).toBe(state === 'CLOSED');
        expect(sendEmail).not.toHaveBeenCalled();
        // Both preview and application use the existing registration-attributed credit and payment carry-forward rules.
        const preview = await eventPoolController.previewPool(event, poolId);
        const base = state === 'CLOSED' ? 100 : 50;
        const paidCredit = state === 'CLOSED' ? 50 : 0;
        const expectedFirst = {baseShareAmount: base, invoiceCreditAmount: credits ? 100 : 0,
            paymentCreditAmount: paidCredit, shareAmount: base - (credits ? 100 : 0) - paidCredit};
        expect(preview.shares.find(share => share.registrationId === firstId)).toMatchObject(expectedFirst);
        if (state === 'CLOSED') {
            await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        } else {
            await eventPoolController.closePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        }
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === firstId)).toMatchObject(expectedFirst);
        expect(pool.shares.find(share => share.registrationId === secondId)).toMatchObject({baseShareAmount: base,
            invoiceCreditAmount: 0, paymentCreditAmount: 0, shareAmount: base});
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('keeps optional proof visible to the attributed participant and retains ordinary own-invoice actions', async () => {
        const {event, poolId, firstId} = await context();
        const proof = await proofFile();
        const invoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {
            amount: 20, description: 'Organizer-entered participant receipt', registrationId: firstId,
        }, sessionFor(organizer), proof);
        const invoice = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
        expect(invoice.recordedByProfileId).toBe(organizer.id);
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(first))).resolves.toBe(proof.path);
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(second))).rejects.toMatchObject({status: 403});
        await expect(eventPoolController.closeInvoice(event, poolId, String(invoiceId), sessionFor(second))).rejects.toMatchObject({status: 403});
        // Attribution grants the same accepted-invoice close capability as a participant's own submitted invoice.
        await eventPoolController.closeInvoice(event, poolId, String(invoiceId), sessionFor(first), undefined, false);
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.status).toBe('CLOSED');
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.recordedByProfileId).toBe(organizer.id);
    });

    it('rejects foreign, unassigned and deleted paid-by registrations before writing costs or keeping rejected proofs', async () => {
        const {event, poolId, firstId, secondId} = await context();
        await poolOperations.saveInvoicePoolAssignments(poolId, false, false, true, [firstId], []);
        const otherEventId = await createIntegrationEvent(organizer.id, 'Foreign attributed invoice');
        await registerEventAttendance(otherEventId, second, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const foreignId = (await eventService.getRegistrationFor(second.id, otherEventId))!.id;
        const proof = await proofFile();
        // The organizer controller cleans uploads when the locked membership check rejects an unassigned selection.
        await expect(eventPoolController.addOrganizerInvoice(event, poolId, {
            amount: 20, description: 'Unassigned participant', registrationId: secondId,
        }, sessionFor(organizer), proof)).rejects.toMatchObject({status: 400});
        await expect(fs.promises.access(proof.path)).rejects.toThrow();
        // A registration removed after a form was rendered cannot be resurrected by invoice creation.
        await eventService.deleteRegistration(event.id, secondId);
        for (const registrationId of [foreignId, secondId, Number.MAX_SAFE_INTEGER]) {
            await expect(invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, 20, 'Invalid participant', null, registrationId))
                .rejects.toMatchObject({status: 400});
        }
        for (const registrationId of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            await expect(invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, 20, 'Invalid ID', null, registrationId))
                .rejects.toMatchObject({status: 400});
        }
        const unchanged = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(unchanged.invoices).toEqual([]);
        expect(unchanged.assignments.map(assignment => assignment.registrationId)).toEqual([firstId]);
    });

    it('preserves closed shares and previous payments until recalculation and retains new costs through input rollback', async () => {
        const {event, poolId, firstId} = await context();
        await invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, 100, 'Original venue cost');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, initial.shares.find((share) => share.registrationId === firstId)!.id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const extraId = await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 20, description: 'Late venue cost'}, sessionFor(organizer));
        const pending = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pending.status).toBe('CLOSED');
        expect(pending.needsRecalculation).toBeTruthy();
        expect(pending.calculationRevision).toBe(before.calculationRevision + 1);
        expect(pending.shares).toEqual(before.shares);
        expect((await eventPoolController.rollbackPoolChanges(event, poolId)).needsRecalculation).toBe(true);
        expect(await invoiceService.getInvoiceWithRegistration(poolId, extraId)).toBeTruthy();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        const recalculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(recalculated.needsRecalculation).toBeFalsy();
        expect(recalculated.shares.find((share) => share.registrationId === firstId)).toMatchObject({
            baseShareAmount: 60, invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: 10,
        });
        expect(recalculated.shares.every((share) => !share.isPaid)).toBe(true);
    });

    it('authorizes optional organizer proof and close operations without treating a null registration as ownership', async () => {
        const {event, poolId} = await context();
        const proof = await proofFile();
        const invoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {amount: 20, description: 'External receipt'}, sessionFor(organizer), proof);
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(organizer), managePerms)).resolves.toBe(proof.path);
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(first))).rejects.toMatchObject({status: 403});
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(organizer))).rejects.toMatchObject({status: 403});
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), {} as Request['session'])).rejects.toMatchObject({status: 401});
        await expect(eventPoolController.closeInvoice(event, poolId, String(invoiceId), sessionFor(organizer), managePerms, false)).rejects.toMatchObject({status: 403});
        await eventPoolController.closeInvoice(event, poolId, String(invoiceId), sessionFor(organizer), managePerms);
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.status).toBe('CLOSED');
    });

    it('rejects invalid cost amounts, descriptions, actor profiles, and event ownership before adding costs', async () => {
        const {event, poolId} = await context();
        for (const amount of [0, -1, 0.001, 1.005, Number.NaN, Number.POSITIVE_INFINITY, 100000000]) {
            await expect(invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, amount, 'Invalid amount')).rejects.toThrow();
        }
        await expect(invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, 1, '   ')).rejects.toThrow();
        await expect(invoiceOperations.persistOrganizerInvoice(poolId, '', 1, 'No actor')).rejects.toMatchObject({status: 401});
        await expect(eventPoolController.addOrganizerInvoice(event, poolId, {amount: 10, description: 'No actor'}, {} as Request['session'])).rejects.toMatchObject({status: 401});
        const otherEventId = await createIntegrationEvent(organizer.id, 'Other event');
        const otherEvent = (await eventService.getEventById(otherEventId))!;
        const proof = await proofFile();
        await expect(eventPoolController.addOrganizerInvoice(otherEvent, poolId, {amount: 10, description: 'Wrong pool'}, sessionFor(organizer), proof)).rejects.toMatchObject({status: 404});
        await expect(fs.promises.access(proof.path)).rejects.toThrow();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.invoices).toHaveLength(0);
    });

    it('keeps a usable recorder snapshot when a legacy display name is blank and when the profile is renamed or removed', async () => {
        const {poolId} = await context();
        const recorder = await persistIntegrationProfile({name: 'Recorder account'});
        await AppDataSource.getRepository(Profile).update(recorder.id, {name: '   '});
        const invoiceId = await invoiceOperations.persistOrganizerInvoice(poolId, recorder.id, 25, 'Recorded by another manager');
        await AppDataSource.getRepository(Profile).update(recorder.id, {name: 'Changed name'});
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!).toMatchObject({
            recordedByName: 'Recorder account', recordedByProfile: {name: 'Changed name'},
        });
        await AppDataSource.getRepository(Profile).delete(recorder.id);
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!).toMatchObject({
            recordedByName: 'Recorder account', recordedByProfile: null, recordedByProfileId: null, amount: '25.00',
        });
        expect((await invoiceService.getPoolWithInvoices(poolId))!.invoiceAmount).toBe(25);
    });

    it('refuses a migration rollback before touching organizer entries or their attribution', async () => {
        const {poolId} = await context();
        const invoiceId = await invoiceOperations.persistOrganizerInvoice(poolId, organizer.id, 30, 'Retained organizer cost');
        const before = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId);
        const migration = new AddOrganizerInvoices1789603200000();
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        try {
            await expect(migration.down(runner)).rejects.toThrow(/Cannot revert organizer invoices/);
            await migration.up(runner);
            expect(await invoiceService.getInvoiceWithRegistration(poolId, invoiceId)).toEqual(before);
            expect(await AppDataSource.getRepository(EventInvoice).countBy({id: invoiceId})).toBe(1);
        } finally { await runner.release(); }
    });
});
