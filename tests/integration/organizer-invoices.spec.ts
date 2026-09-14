import type {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import {AddOrganizerInvoices1789603200000} from '../../src/migrations/1789603200000-AddOrganizerInvoices';
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

async function context() {
    const eventId = await createIntegrationEvent(organizer.id, 'Organizer pool costs');
    for (const profile of [first, second]) {
        await registerEventAttendance(eventId, profile, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    }
    const event = (await eventService.getEventById(eventId))!;
    const poolId = await invoiceService.createPool(eventId, 'Shared costs', '', 'EQUAL', false, true, true, [], false);
    const firstId = (await eventService.getRegistrationFor(first.id, eventId))!.id;
    const secondId = (await eventService.getRegistrationFor(second.id, eventId))!.id;
    return {event, poolId, firstId, secondId};
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
        const invoiceId = await invoiceService.submitInvoice(poolId, firstId, 100, 'Participant receipt', {
            path: 'uploads/invoices/legacy-proof.pdf', originalName: 'legacy-proof.pdf', mimeType: 'application/pdf',
        });
        await invoiceService.approveInvoice(poolId, invoiceId);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await invoiceService.setSharePaid(poolId, initial.shares[0].id, true);
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

    it('keeps organizer costs separate from an attending recorder and credits only participant submissions', async () => {
        const {event, poolId, firstId, secondId} = await context();
        const participantInvoiceId = await invoiceService.submitInvoice(poolId, firstId, 100, 'Personal purchase', null);
        await invoiceService.approveInvoice(poolId, participantInvoiceId);
        const organizerInvoiceId = await eventPoolController.addOrganizerInvoice(event, poolId, {
            amount: 50, description: 'Shared booking', registrationId: firstId, recordedByProfileId: organizer.id,
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

    it('preserves closed shares and previous payments until recalculation and retains new costs through input rollback', async () => {
        const {event, poolId, firstId} = await context();
        await invoiceService.addOrganizerInvoice(poolId, organizer.id, 100, 'Original venue cost');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await invoiceService.setSharePaid(poolId, initial.shares.find((share) => share.registrationId === firstId)!.id, true);
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
            await expect(invoiceService.addOrganizerInvoice(poolId, organizer.id, amount, 'Invalid amount')).rejects.toThrow();
        }
        await expect(invoiceService.addOrganizerInvoice(poolId, organizer.id, 1, '   ')).rejects.toThrow();
        await expect(invoiceService.addOrganizerInvoice(poolId, '', 1, 'No actor')).rejects.toMatchObject({status: 401});
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
        const invoiceId = await invoiceService.addOrganizerInvoice(poolId, recorder.id, 25, 'Recorded by another manager');
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
        const invoiceId = await invoiceService.addOrganizerInvoice(poolId, organizer.id, 30, 'Retained organizer cost');
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
