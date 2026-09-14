import type {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import {AddInvoiceRetraction1789689600000} from '../../src/migrations/1789689600000-AddInvoiceRetraction';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/modules/database/services/EventService';
import mailer from '../../src/modules/email';
import settings from '../../src/modules/settings';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let organizer: Profile;
let participant: Profile;
let other: Profile;
const proofs = new Set<string>();
const sendEmail = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
const sessionFor = (profile: Profile) => ({profile} as Request['session']);

beforeAll(async () => {
    await initializeIntegrationDatabase();
    organizer = await persistIntegrationProfile({name: 'History organizer'});
    participant = await persistIntegrationProfile({name: 'Invoice submitter'});
    other = await persistIntegrationProfile({name: 'Other participant'});
}, 120_000);
beforeEach(() => sendEmail.mockClear());
afterAll(async () => {
    sendEmail.mockRestore();
    await Promise.all([...proofs].map((proof) => fs.promises.unlink(proof).catch(() => undefined)));
    await closeIntegrationDatabase();
});

async function context() {
    const eventId = await createIntegrationEvent(organizer.id, 'Invoice history changes');
    for (const profile of [participant, other]) {
        await registerEventAttendance(eventId, profile, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    }
    const event = (await eventService.getEventById(eventId))!;
    const poolId = await invoiceService.createPool(eventId, 'Shared costs', '', 'EQUAL', false, true, true, [], false);
    const firstId = (await eventService.getRegistrationFor(participant.id, eventId))!.id;
    const secondId = (await eventService.getRegistrationFor(other.id, eventId))!.id;
    const proofPath = path.resolve(process.cwd(), settings.value.invoiceDir, `history-test-${randomUUID()}.pdf`);
    await fs.promises.mkdir(path.dirname(proofPath), {recursive: true});
    await fs.promises.writeFile(proofPath, '%PDF-1.4 retained history proof');
    proofs.add(proofPath);
    const invoiceId = await invoiceService.submitInvoice(poolId, firstId, 100, 'Original participant purchase', {
        path: path.relative(process.cwd(), proofPath), originalName: 'original.pdf', mimeType: 'application/pdf',
    });
    return {event, poolId, invoiceId, firstId, secondId, proofPath};
}

async function confirmation(poolId: string) {
    return {confirmed: true, expectedRevision: (await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision};
}

describe('confirmed invoice revisions, rejection, and retraction', () => {
    it('upgrades the status enum and safely downgrades before any invoices have been retracted', async () => {
        const {event, poolId, invoiceId} = await context();
        await invoiceService.approveInvoice(poolId, invoiceId);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await invoiceService.setSharePaid(poolId, initial.shares[0].id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoiceRetraction1789689600000();
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
            expect((await runner.getTable('event_invoices'))!.findColumnByName('status')!.enum).toContain('RETRACTED');
        } finally { await migration.up(runner); await runner.release(); }
    });

    it.each(['APPROVED', 'CLOSED'] as const)('corrects and rejects %s organizer costs in an open pool while retaining originals', async (status) => {
        const {event, poolId} = await context();
        const invoiceId = await invoiceService.addOrganizerInvoice(poolId, organizer.id, 50, 'Original rental');
        if (status === 'CLOSED') await invoiceService.closeInvoice(poolId, invoiceId);
        await eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {
            ...await confirmation(poolId), correctedAmount: 30, correctedDescription: 'Corrected rental',
        }, sessionFor(organizer));
        const revised = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
        expect(revised).toMatchObject({status, amount: '50.00', description: 'Original rental', correctedAmount: '30.00', correctedDescription: 'Corrected rental', recordedByProfileId: organizer.id});
        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.totals.invoiceAmount).toBe(30);
        expect(preview.shares.every((share) => share.baseShareAmount === 15 && share.invoiceCreditAmount === 0)).toBe(true);
        await eventPoolController.rejectAcceptedInvoice(event, poolId, String(invoiceId), {
            ...await confirmation(poolId), rejectionReason: 'Duplicate booking',
        }, sessionFor(organizer));
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!).toMatchObject({
            status: 'REJECTED', amount: '50.00', correctedAmount: '30.00', correctedDescription: 'Corrected rental', rejectionReason: 'Duplicate booking',
        });
        expect((await invoiceService.getPoolWithInvoices(poolId))!.invoiceAmount).toBe(0);
    });

    it('keeps signed paid credits through closed-invoice correction, rollback, rejection, and recalculation', async () => {
        const {event, poolId, invoiceId, firstId, secondId, proofPath} = await context();
        await invoiceService.approveInvoice(poolId, invoiceId);
        await invoiceService.closeInvoice(poolId, invoiceId);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        for (const share of (await invoiceService.getPoolWithInvoices(poolId))!.shares) await invoiceService.setSharePaid(poolId, share.id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        await eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {
            ...await confirmation(poolId), correctedAmount: 60, correctedDescription: 'Corrected receipt',
        }, sessionFor(organizer));
        const pending = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pending.needsRecalculation).toBeTruthy();
        expect(pending.shares).toEqual(before.shares);
        expect(pending.invoices[0]).toMatchObject({status: 'CLOSED', amount: '100.00', correctedAmount: '60.00'});
        expect((await eventPoolController.rollbackPoolChanges(event, poolId)).needsRecalculation).toBe(true);
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.correctedAmount).toBe('60.00');
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        const corrected = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(corrected.shares.find((share) => share.registrationId === firstId)).toMatchObject({paymentCreditAmount: -50, shareAmount: 20, invoiceCreditAmount: 60});
        expect(corrected.shares.find((share) => share.registrationId === secondId)).toMatchObject({paymentCreditAmount: 50, shareAmount: -20});
        await invoiceService.setSharePaid(poolId, corrected.shares.find((share) => share.registrationId === firstId)!.id, true);
        const beforeRejection = (await invoiceService.getPoolWithInvoices(poolId))!;
        await eventPoolController.rejectAcceptedInvoice(event, poolId, String(invoiceId), {
            ...await confirmation(poolId), rejectionReason: 'Receipt was refunded by the supplier',
        }, sessionFor(organizer));
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares).toEqual(beforeRejection.shares);
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        const rejected = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(rejected.shares.find((share) => share.registrationId === firstId)).toMatchObject({paymentCreditAmount: -30, shareAmount: 30, invoiceCreditAmount: 0, baseShareAmount: 0});
        expect(rejected.shares.find((share) => share.registrationId === secondId)).toMatchObject({paymentCreditAmount: 50, shareAmount: -50});
        expect(rejected.shares.every((share) => !share.isPaid)).toBe(true);
        expect(rejected.invoices[0]).toMatchObject({status: 'REJECTED', amount: '100.00', correctedAmount: '60.00', description: 'Original participant purchase'});
        await expect(fs.promises.access(proofPath)).resolves.toBeUndefined();
    });

    it('requires explicit confirmation, current revision, valid fields, and counted status, and can restore original details', async () => {
        const {event, poolId, invoiceId} = await context();
        const correction = {correctedAmount: 80, correctedDescription: 'New accepted details'};
        await expect(eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {...await confirmation(poolId), ...correction}, sessionFor(organizer))).rejects.toMatchObject({status: 409});
        await invoiceService.approveInvoice(poolId, invoiceId);
        const confirm = await confirmation(poolId);
        for (const body of [correction, {...confirm, ...correction, confirmed: false}, {...confirm, ...correction, confirmed: 'true'}, {...confirm, correctedAmount: 80}]) {
            await expect(eventPoolController.reviseInvoice(event, poolId, String(invoiceId), body, sessionFor(organizer))).rejects.toMatchObject({status: 400});
        }
        await expect(eventPoolController.rejectAcceptedInvoice(event, poolId, String(invoiceId), {...confirm, rejectionReason: ' '}, sessionFor(organizer))).rejects.toMatchObject({status: 400});
        for (const correctedAmount of [0, -1, 1.005, Number.NaN, 100000000]) {
            await expect(invoiceService.reviseInvoice(poolId, invoiceId, {correctedAmount, correctedDescription: null}, confirm)).rejects.toMatchObject({status: 400});
        }
        await eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {...confirm, ...correction}, sessionFor(organizer));
        await expect(eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {...confirm, ...correction}, sessionFor(organizer))).rejects.toMatchObject({status: 409});
        await expect(eventPoolController.rejectAcceptedInvoice(event, poolId, String(invoiceId), {...confirm, rejectionReason: 'Stale decision'}, sessionFor(organizer))).rejects.toMatchObject({status: 409});
        await eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {...await confirmation(poolId), correctedAmount: null, correctedDescription: null}, sessionFor(organizer));
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!).toMatchObject({amount: '100.00', correctedAmount: null, correctedDescription: null});
    });

    it('commits only one concurrent correction or retroactive rejection and notifies only that saved decision', async () => {
        const {event, poolId, invoiceId} = await context();
        await invoiceService.approveInvoice(poolId, invoiceId);
        const confirm = await confirmation(poolId);
        const outcomes = await Promise.allSettled([
            eventPoolController.reviseInvoice(event, poolId, String(invoiceId), {...confirm, correctedAmount: 80, correctedDescription: null}, sessionFor(organizer)),
            eventPoolController.rejectAcceptedInvoice(event, poolId, String(invoiceId), {...confirm, rejectionReason: 'Concurrent rejection'}, sessionFor(organizer)),
        ]);
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBe(confirm.expectedRevision + 1);
        expect(sendEmail).toHaveBeenCalledOnce();
    });

    it.each(['OPEN', 'CLOSED'] as const)('retracts only the submitter\'s NEW invoice in a %s pool and preserves history and settlement', async (status) => {
        const {event, poolId, invoiceId, proofPath} = await context();
        if (status === 'CLOSED') {
            await invoiceService.addOrganizerInvoice(poolId, organizer.id, 40, 'Counted shared costs');
            await eventPoolController.closePool(event, poolId, {sendEmails: false});
            await invoiceService.setSharePaid(poolId, (await invoiceService.getPoolWithInvoices(poolId))!.shares[0].id, true);
        }
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const confirm = await confirmation(poolId);
        await expect(eventPoolController.retractInvoice(event, poolId, String(invoiceId), confirm, sessionFor(organizer))).rejects.toMatchObject({status: 403});
        await expect(eventPoolController.retractInvoice(event, poolId, String(invoiceId), confirm, sessionFor(other))).rejects.toMatchObject({status: 403});
        await eventPoolController.retractInvoice(event, poolId, String(invoiceId), confirm, sessionFor(participant));
        const after = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(after.shares).toEqual(before.shares);
        expect(after.needsRecalculation).toBe(before.needsRecalculation);
        expect(after.invoiceAmount).toBe(before.invoiceAmount);
        expect(after.calculationRevision).toBe(before.calculationRevision + 1);
        expect(after.invoices.find((invoice) => invoice.id === invoiceId)).toMatchObject({status: 'RETRACTED', amount: '100.00', description: 'Original participant purchase'});
        await expect(eventPoolController.serveInvoiceProof(event, poolId, String(invoiceId), sessionFor(participant))).resolves.toBe(proofPath);
        await expect(eventPoolController.retractInvoice(event, poolId, String(invoiceId), await confirmation(poolId), sessionFor(participant))).rejects.toMatchObject({status: 409});
        expect(await invoiceService.approveInvoice(poolId, invoiceId)).toBe(false);
        expect(await invoiceService.declineInvoice(poolId, invoiceId, 'Already retracted')).toBe(false);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBe(after.calculationRevision);
    });

    it('resolves an approval-versus-retraction race without an invoice becoming both accepted and withdrawn', async () => {
        const {event, poolId, invoiceId} = await context();
        await invoiceService.addOrganizerInvoice(poolId, organizer.id, 10, 'Counted shared costs');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const confirm = await confirmation(poolId);
        const outcomes = await Promise.allSettled([
            eventPoolController.approveInvoice(event, poolId, String(invoiceId), {}, sessionFor(organizer)),
            eventPoolController.retractInvoice(event, poolId, String(invoiceId), confirm, sessionFor(participant)),
        ]);
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        const invoice = saved.invoices.find((row) => row.id === invoiceId)!;
        expect(['APPROVED', 'RETRACTED']).toContain(invoice.status);
        expect(Boolean(saved.needsRecalculation)).toBe(invoice.status === 'APPROVED');
        expect(saved.invoiceAmount).toBe(invoice.status === 'APPROVED' ? 110 : 10);
        expect(saved.calculationRevision).toBe(confirm.expectedRevision + 1);
        expect(sendEmail).toHaveBeenCalledOnce();
    });

    it('rejects stale or unconfirmed retractions and blocks enum rollback while retracted history exists', async () => {
        const {event, poolId, invoiceId} = await context();
        const confirm = await confirmation(poolId);
        await expect(eventPoolController.retractInvoice(event, poolId, String(invoiceId), {...confirm, confirmed: false}, sessionFor(participant))).rejects.toMatchObject({status: 400});
        await expect(eventPoolController.retractInvoice(event, poolId, String(invoiceId), {...confirm, expectedRevision: confirm.expectedRevision + 1}, sessionFor(participant))).rejects.toMatchObject({status: 409});
        await eventPoolController.retractInvoice(event, poolId, String(invoiceId), confirm, sessionFor(participant));
        const before = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId);
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoiceRetraction1789689600000();
        await runner.connect();
        try {
            await expect(migration.down(runner)).rejects.toThrow(/Cannot revert invoice retraction/);
            await migration.up(runner);
            expect(await invoiceService.getInvoiceWithRegistration(poolId, invoiceId)).toEqual(before);
        } finally { await runner.release(); }
    });
});
