import {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import {Event} from '../../src/modules/database/entities/event/Event';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/modules/database/services/EventService';
import mailer from '../../src/modules/email';
import {createInvoiceSubmissionCase, type InvoiceSubmissionCase} from '../factories/invoiceFactory';
import {
    createIntegrationEvent,
    persistIntegrationProfile,
    registerEventAttendance,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

interface InvoiceContext {
    event: Event;
    poolId: string;
}

let organizer: Profile;
let participant: Profile;
const proofPaths = new Set<string>();
const sendEmail = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);

async function createInvoiceContext(title: string): Promise<InvoiceContext> {
    const eventId = await createIntegrationEvent(organizer.id, title);
    await registerEventAttendance(eventId, participant, {
        arrivalDate: '2027-06-01',
        departureDate: '2027-06-03',
    });
    const event = (await eventService.getEventById(eventId))!;
    const poolId = await eventPoolController.createInvoicePool(event, {
        name: `${title} pool`,
        description: 'Participant costs',
        distribution: 'EQUAL',
        assignAll: 'on',
    });
    return {event, poolId};
}

async function submitInvoice(context: InvoiceContext, submission: InvoiceSubmissionCase = createInvoiceSubmissionCase()): Promise<number> {
    await fs.promises.mkdir(path.dirname(submission.proofPath), {recursive: true});
    await fs.promises.writeFile(submission.proofPath, '%PDF-1.4 integration proof');
    proofPaths.add(submission.proofPath);
    await eventPoolController.submitInvoice(
        context.event,
        context.poolId,
        {amount: submission.amount, description: submission.description},
        {profile: participant} as Request['session'],
        {
            path: submission.proofPath,
            originalname: submission.proofOriginalName,
            mimetype: submission.proofMimeType,
        } as Express.Multer.File,
    );
    const pool = await invoiceService.getPoolWithInvoices(context.poolId);
    return pool!.invoices[pool!.invoices.length - 1].id;
}

beforeAll(async () => {
    await initializeIntegrationDatabase();
    organizer = await persistIntegrationProfile({name: 'Invoice Organizer'});
    participant = await persistIntegrationProfile({name: 'Invoice Participant'});
}, 120_000);

beforeEach(() => {
    sendEmail.mockClear();
});

afterAll(async () => {
    await Promise.all(Array.from(proofPaths).map((proofPath) => fs.promises.unlink(proofPath).catch(() => undefined)));
    await closeIntegrationDatabase();
    sendEmail.mockRestore();
});

describe('invoice review and retention workflows', () => {
    it('confirms a participant invoice submission by email', async () => {
        const context = await createInvoiceContext('Submission confirmation');
        const submission = createInvoiceSubmissionCase();

        const invoiceId = await submitInvoice(context, submission);
        const invoice = await invoiceService.getInvoiceWithRegistration(context.poolId, invoiceId);

        // Canary: a participant must receive confirmation and see the pending invoice in history immediately.
        expect(invoice).toMatchObject({status: 'NEW', amount: '48.75', description: submission.description});
        expect(sendEmail).toHaveBeenCalledWith(
            participant.user!.email,
            'Invoice submitted',
            expect.objectContaining({
                heading: 'Your invoice was submitted',
                details: expect.arrayContaining([
                    {label: 'Invoice', value: `#${invoiceId}`},
                    {label: 'Amount', value: '48.75'},
                ]),
            }),
        );
    });

    it('accepts organizer corrections and emails the effective invoice amount', async () => {
        const context = await createInvoiceContext('Accepted correction');
        const invoiceId = await submitInvoice(context);
        sendEmail.mockClear();

        await eventPoolController.approveInvoice(
            context.event,
            context.poolId,
            String(invoiceId),
            {correctedAmount: '44.25', correctedDescription: 'Personal item removed'},
            {profile: organizer} as Request['session'],
        );
        const pool = await invoiceService.getPoolWithInvoices(context.poolId);
        const invoice = pool!.invoices.find((row) => row.id === invoiceId);

        // Canary: corrections remain separate from submitted values and drive accepted pool totals.
        expect(invoice).toMatchObject({
            status: 'APPROVED',
            amount: '48.75',
            correctedAmount: '44.25',
            correctedDescription: 'Personal item removed',
        });
        expect(Number(pool!.invoiceAmount)).toBe(44.25);
        expect(sendEmail).toHaveBeenCalledWith(
            participant.user!.email,
            'Invoice accepted',
            expect.objectContaining({
                heading: 'Your invoice was accepted',
                details: expect.arrayContaining([
                    {label: 'Accepted amount', value: '44.25'},
                    {label: 'Organizer correction', value: 'Personal item removed'},
                ]),
            }),
        );
    });

    it('retains a rejected invoice, its proof, and the organizer reason in history', async () => {
        const context = await createInvoiceContext('Rejected invoice');
        const submission = createInvoiceSubmissionCase();
        const invoiceId = await submitInvoice(context, submission);
        sendEmail.mockClear();

        await eventPoolController.declineInvoice(
            context.event,
            context.poolId,
            String(invoiceId),
            {rejectionReason: 'The proof does not show a payment total.'},
            {profile: organizer} as Request['session'],
        );
        const invoice = await invoiceService.getInvoiceWithRegistration(context.poolId, invoiceId);

        // Canary: rejecting must be auditable instead of silently deleting participant data.
        expect(invoice).toMatchObject({
            status: 'REJECTED',
            rejectionReason: 'The proof does not show a payment total.',
        });
        await expect(fs.promises.access(submission.proofPath)).resolves.toBeUndefined();
        expect(sendEmail).toHaveBeenCalledWith(
            participant.user!.email,
            'Invoice rejected',
            expect.objectContaining({
                heading: 'Your invoice needs attention',
                details: expect.arrayContaining([
                    {label: 'Rejection reason', value: 'The proof does not show a payment total.'},
                ]),
            }),
        );
    });

    it('deletes invoice records and proofs once the configured event retention window passes', async () => {
        const expiredContext = await createInvoiceContext('Expired invoice');
        const retainedContext = await createInvoiceContext('Retained invoice');
        await eventService.updateEventDates(expiredContext.event.id, '2026-02-19', '2026-02-20');
        await eventService.updateEventDates(retainedContext.event.id, '2026-02-28', '2026-03-01');
        const expiredSubmission = createInvoiceSubmissionCase();
        const retainedSubmission = createInvoiceSubmissionCase();
        const expiredInvoiceId = await submitInvoice(expiredContext, expiredSubmission);
        const retainedInvoiceId = await submitInvoice(retainedContext, retainedSubmission);

        const deleted = await invoiceService.purgeExpiredInvoices(6, new Date('2026-08-27T12:00:00Z'));

        // Canary: retention is global and removes the database record and proof, but not newer invoices.
        expect(deleted).toBe(1);
        await expect(invoiceService.getInvoiceWithRegistration(expiredContext.poolId, expiredInvoiceId)).resolves.toBeNull();
        await expect(invoiceService.getInvoiceWithRegistration(retainedContext.poolId, retainedInvoiceId)).resolves.toBeTruthy();
        await expect(fs.promises.access(expiredSubmission.proofPath)).rejects.toThrow();
        await expect(fs.promises.access(retainedSubmission.proofPath)).resolves.toBeUndefined();
    });
});
