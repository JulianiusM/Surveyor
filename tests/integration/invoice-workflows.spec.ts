import {purgeExpiredInvoices} from '../../src/modules/invoice/retention';
import {savePoolTakeovers} from '../../src/modules/invoice/takeovers';
import {invoiceSettledShareImpact} from '../../src/modules/invoice/coverage';
import * as invoiceOperations from '../../src/modules/invoice/invoiceOperations';
import * as poolOperations from '../../src/modules/invoice/poolOperations';
import {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import {AddInvoicePoolFactors1789344000000} from '../../src/migrations/1789344000000-AddInvoicePoolFactors';
import {AddInvoiceSettlementSnapshots1789430400000} from '../../src/migrations/1789430400000-AddInvoiceSettlementSnapshots';
import {AddInvoiceShareRounding1789516800000} from '../../src/migrations/1789516800000-AddInvoiceShareRounding';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Event} from '../../src/modules/database/entities/event/Event';
import {EventInvoicePool} from '../../src/modules/database/entities/event/EventInvoicePool';
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
    // Teardown owns only newly created fixtures, never an existing upload at an overridden path.
    await fs.promises.writeFile(submission.proofPath, '%PDF-1.4 integration proof', {flag: 'wx'});
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
    it('completes submission while the confirmation email is still pending', async () => {
        const context = await createInvoiceContext('Slow confirmation');
        sendEmail.mockReturnValueOnce(new Promise(() => undefined));
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const invoiceId = await Promise.race([
                submitInvoice(context),
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Submission waited for the confirmation email')), 3000);
                }),
            ]);
            expect(await invoiceService.getInvoiceWithRegistration(context.poolId, invoiceId)).toMatchObject({status: 'NEW'});
        } finally {
            clearTimeout(timeout);
        }
    });

    it('confirms a participant invoice submission by email', async () => {
        const context = await createInvoiceContext('Submission confirmation');
        const submission = createInvoiceSubmissionCase();

        const invoiceId = await submitInvoice(context, submission);
        const invoice = await invoiceService.getInvoiceWithRegistration(context.poolId, invoiceId);

        // Canary: a participant must receive confirmation and see the pending invoice in history immediately.
        expect(invoice).toMatchObject({status: 'NEW', amount: '48.75', description: submission.description});
        expect(sendEmail).toHaveBeenCalledWith(
            {name: participant.name, address: participant.user!.email},
            'Your invoice submitted',
            expect.objectContaining({
                heading: 'Your invoice was submitted',
                details: expect.arrayContaining([
                    {label: 'Your invoice', value: `#${invoiceId}`},
                    {label: 'Your submitted invoice amount', value: '48.75'},
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
            {name: participant.name, address: participant.user!.email},
            'Your invoice accepted',
            expect.objectContaining({
                heading: 'Your invoice was accepted',
                details: expect.arrayContaining([
                    {label: 'Your accepted invoice amount', value: '44.25'},
                    {label: 'Organizer correction to your invoice', value: 'Personal item removed'},
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
            {name: participant.name, address: participant.user!.email},
            'Your invoice rejected',
            expect.objectContaining({
                heading: 'Your invoice needs attention',
                details: expect.arrayContaining([
                    {label: 'Why your invoice was rejected', value: 'The proof does not show a payment total.'},
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

        const deleted = await purgeExpiredInvoices(6, new Date('2026-08-27T12:00:00Z'));

        // Canary: retention is global and removes the database record and proof, but not newer invoices.
        expect(deleted).toBe(1);
        await expect(invoiceService.getInvoiceWithRegistration(expiredContext.poolId, expiredInvoiceId)).resolves.toBeNull();
        await expect(invoiceService.getInvoiceWithRegistration(retainedContext.poolId, retainedInvoiceId)).resolves.toBeTruthy();
        await expect(fs.promises.access(expiredSubmission.proofPath)).rejects.toThrow();
        await expect(fs.promises.access(retainedSubmission.proofPath)).resolves.toBeUndefined();
    });
});

async function createCalculationContext(title: string) {
    const context = await createInvoiceContext(title);
    await eventService.updateEventDates(context.event.id, '2027-06-01', '2027-06-05');
    context.event = (await eventService.getEventById(context.event.id))!;
    const second = await persistIntegrationProfile({name: `${title} second participant`});
    await registerEventAttendance(context.event.id, second, {
        arrivalDate: '2027-06-01', departureDate: '2027-06-05',
    });
    const firstId = (await eventService.getRegistrationFor(participant.id, context.event.id))!.id;
    const secondId = (await eventService.getRegistrationFor(second.id, context.event.id))!.id;
    const invoiceId = await submitInvoice(context, createInvoiceSubmissionCase({amount: 100}));
    await invoiceOperations.acceptSavedInvoice(context.poolId, invoiceId);
    return {...context, firstId, secondId, invoiceId};
}

/** Add a third real event member so reassignment can be tested without bypassing pool membership. */
async function createTakeoverContext(title: string) {
    const context = await createCalculationContext(title);
    // Registration uses the public attendance workflow and receives assign-all pool membership.
    const third = await persistIntegrationProfile({name: `${title} third participant`});
    await registerEventAttendance(context.event.id, third, {
        arrivalDate: '2027-06-01', departureDate: '2027-06-03',
    });
    const thirdId = (await eventService.getRegistrationFor(third.id, context.event.id))!.id;
    return {...context, third, thirdId};
}

describe('staged takeover notifications', () => {
    it('blocks participant coverage changes while participant invoices are disabled but immediately applies organizer planning edits', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Organizer invoice coverage');
        const open = (await invoiceService.getPoolWithInvoices(poolId))!;
        await eventPoolController.changePoolSubmissionState(event, poolId, {
            status: 'ORGANIZER_ONLY', expectedRevision: open.calculationRevision,
        });
        sendEmail.mockClear();
        // Both the controller flow and the locked operation enforce participant access independently of UI visibility.
        await expect(eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: participant} as Request['session'], false)).rejects.toMatchObject({status: 409});
        await expect(savePoolTakeovers(poolId, firstId, [secondId], false)).rejects.toMatchObject({status: 409});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.takeovers).toHaveLength(0);
        expect(sendEmail).not.toHaveBeenCalled();

        // An uncalculated pool has no applied calculation yet, so planning notices retain their immediate behavior.
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        expect(sendEmail).toHaveBeenCalledTimes(2);
        sendEmail.mockClear();
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        expect(sendEmail).not.toHaveBeenCalled();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.status).toBe('CLOSED');
    });

    it('notifies open-pool edits immediately once and does not replay them at first calculation', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Immediate coverage');
        sendEmail.mockClear();
        await eventPoolController.updateTakeovers(event, poolId, {
            payerId: firstId, beneficiaries: [secondId, secondId],
        }, {profile: participant} as Request['session'], false);
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect(sendEmail.mock.calls.every(call => call[1] === 'Your payment coverage changed')).toBe(true);
        const applied = (await invoiceService.getPoolWithInvoices(poolId))!;

        // Identical input is a no-op, including duplicate beneficiary values in a request.
        sendEmail.mockClear();
        await eventPoolController.updateTakeovers(event, poolId, {
            payerId: firstId, beneficiaries: [secondId],
        }, {profile: participant} as Request['session'], false);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBe(applied.calculationRevision);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        expect(sendEmail).not.toHaveBeenCalled();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.takeovers)
            .toEqual([{payerRegistrationId: firstId, beneficiaryRegistrationId: secondId}]);
    });

    it('keeps closed edits pending and sends only the final applied delta after the calculation commits', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Deferred coverage');
        await eventPoolController.updatePoolSettings(event, poolId, {distribution: 'EQUAL', sendCalculationEmails: false});
        await eventPoolController.closePool(event, poolId);
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        sendEmail.mockClear();

        // Several edits stay as pending inputs; none may replace the applied shares or snapshot.
        for (const beneficiaries of [[secondId], [], [secondId]]) {
            await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries},
                {profile: organizer} as Request['session'], true);
        }
        const pending = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pending.needsRecalculation).toBeTruthy();
        expect(pending.shares).toEqual(saved.shares);
        expect(pending.calculationSnapshot).toEqual(saved.calculationSnapshot);
        expect(pending.takeovers).toHaveLength(1);
        expect(sendEmail).not.toHaveBeenCalled();

        // Observe the public DBAL at the mail boundary: each recipient sees the committed snapshot.
        const observations: Promise<EventInvoicePool | null>[] = [];
        function observeCommittedNotice(): Promise<void> {
            observations.push(invoiceService.getPoolWithInvoices(poolId));
            return Promise.resolve();
        }
        sendEmail.mockImplementation(observeCommittedNotice);
        try {
            await eventPoolController.recalculatePool(event, poolId, {}, {profile: organizer} as Request['session']);
            expect(sendEmail).toHaveBeenCalledTimes(2);
            expect(sendEmail.mock.calls.every(call => call[1] === 'Your payment coverage changed')).toBe(true);
            const deliveredSnapshots = await Promise.all(observations);
            for (const committed of deliveredSnapshots) {
                expect(committed!.needsRecalculation).toBeFalsy();
                expect(committed!.calculationSnapshot!.takeovers)
                    .toEqual([{payerRegistrationId: firstId, beneficiaryRegistrationId: secondId}]);
                expect(committed!.shares).toHaveLength(1);
                expect(committed!.shares[0]).toMatchObject({registrationId: firstId, baseShareAmount: 100});
            }
        } finally {
            sendEmail.mockResolvedValue(undefined);
        }
        // Recalculation without a new applied change must never send the same notices again.
        sendEmail.mockClear();
        await eventPoolController.recalculatePool(event, poolId);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('does not notify remove-and-readd changes or rollback, and preserves current settlement records', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Coverage rollback');
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        sendEmail.mockClear();
        for (const beneficiaries of [[], [secondId], [secondId]]) {
            await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries},
                {profile: organizer} as Request['session'], true);
        }
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect(sendEmail).not.toHaveBeenCalled();

        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, calculated.shares[0].id, true);
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: []},
            {profile: organizer} as Request['session'], true);
        const pending = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pending.takeovers).toHaveLength(0);
        await eventPoolController.rollbackPoolChanges(event, poolId, {expectedRevision: pending.calculationRevision});
        const restored = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(restored.takeovers).toHaveLength(1);
        expect(restored.takeovers[0]).toMatchObject({payerRegistrationId: firstId, beneficiaryRegistrationId: secondId});
        expect(restored.shares).toEqual(pending.shares);
        expect(restored.shares[0].isPaid).toBeTruthy();
        expect(restored.calculationSnapshot).toEqual(calculated.calculationSnapshot);
        expect(restored.needsRecalculation).toBeFalsy();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('notifies final reassignment once per recipient without reporting intermediate staged responsibilities', async () => {
        const {event, poolId, firstId, secondId, thirdId, third} = await createTakeoverContext('Reassigned coverage');
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        sendEmail.mockClear();
        // Remove, restore, and finally reassign the same beneficiary before applying any calculation.
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: []},
            {profile: organizer} as Request['session'], true);
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        await eventPoolController.updateTakeovers(event, poolId, {payerId: thirdId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false}, {profile: organizer} as Request['session']);

        // Old payer, new payer, and beneficiary each receive one coherent message, even for reassignment.
        expect(sendEmail).toHaveBeenCalledTimes(3);
        const recipients = await eventService.getEventParticipants(event.id);
        const beneficiary = recipients.find(row => Number(row.id) === secondId)!;
        expect(sendEmail.mock.calls.map(call => call[0].address).sort())
            .toEqual([participant.user!.email, third.user!.email, beneficiary.email].sort());
        const beneficiaryMessage = sendEmail.mock.calls.find(call => call[0].address === beneficiary.email)![2];
        expect(beneficiaryMessage).toMatchObject({
            details: expect.arrayContaining([{label: 'Your records updated by', value: organizer.name}]),
            sections: [{title: 'What changed for you', items: [
                expect.stringContaining(third.name), expect.stringContaining(participant.name),
            ]}],
        });
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.takeovers)
            .toEqual([{payerRegistrationId: thirdId, beneficiaryRegistrationId: secondId}]);
    });

    it('does not apply or notify staged coverage from an outdated preview', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Stale coverage preview');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const preview = await eventPoolController.previewPool(event, poolId);
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        sendEmail.mockClear();
        await expect(eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false}))
            .rejects.toThrow(/preview|changed/i);
        const rejected = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(rejected.shares).toEqual(saved.shares);
        expect(rejected.calculationSnapshot).toEqual(saved.calculationSnapshot);
        expect(rejected.needsRecalculation).toBeTruthy();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('establishes a legacy snapshot without guessing historic applied coverage or sending speculative notices', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Legacy coverage');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        // Simulate an installation predating snapshot provenance without changing its saved shares.
        await AppDataSource.getRepository(EventInvoicePool).update(poolId, {calculationSnapshot: null});
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        sendEmail.mockClear();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.takeovers)
            .toEqual([{payerRegistrationId: firstId, beneficiaryRegistrationId: secondId}]);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('uses frozen contribution attribution when a legacy snapshot lacks its explicit takeover list', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Legacy attributed coverage');
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        // Older numeric provenance still records which beneficiary's base belonged to this payer.
        const legacySnapshot = structuredClone(saved.calculationSnapshot)!;
        Reflect.deleteProperty(legacySnapshot, 'takeovers');
        await AppDataSource.getRepository(EventInvoicePool).update(poolId, {calculationSnapshot: legacySnapshot});
        sendEmail.mockClear();
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: []},
            {profile: organizer} as Request['session'], true);
        expect(sendEmail).not.toHaveBeenCalled();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.explanation)
            .toEqual(saved.calculationSnapshot!.explanation);

        // Rollback uses the same proved applied pairs, restores coverage silently, and retains saved shares.
        await eventPoolController.rollbackPoolChanges(event, poolId);
        const restored = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(restored.takeovers).toHaveLength(1);
        expect(restored.takeovers[0]).toMatchObject({payerRegistrationId: firstId, beneficiaryRegistrationId: secondId});
        expect(restored.shares).toEqual(saved.shares);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: []},
            {profile: organizer} as Request['session'], true);

        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect(sendEmail).toHaveBeenCalledTimes(2);
        const payerMessage = sendEmail.mock.calls.find(call => call[0].address === participant.user!.email)![2];
        expect(payerMessage).toMatchObject({sections: [{title: 'What changed for you', items: [
            expect.stringContaining('no longer covering'),
        ]}]});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.takeovers).toEqual([]);
    });

    it('does not guess applied coverage from a legacy snapshot that has neither saved coverage source', async () => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Legacy coverage without evidence');
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const saved = (await invoiceService.getPoolWithInvoices(poolId))!;
        const legacySnapshot = structuredClone(saved.calculationSnapshot)!;
        Reflect.deleteProperty(legacySnapshot, 'takeovers');
        Reflect.deleteProperty(legacySnapshot, 'explanation');
        await AppDataSource.getRepository(EventInvoicePool).update(poolId, {calculationSnapshot: legacySnapshot});
        sendEmail.mockClear();
        await eventPoolController.updateTakeovers(event, poolId, {payerId: firstId, beneficiaries: [secondId]},
            {profile: organizer} as Request['session'], true);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares).toEqual(saved.shares);
        // Unknown historic coverage cannot be safely restored. Reject before any rollback write or notification.
        await expect(eventPoolController.rollbackPoolChanges(event, poolId)).rejects.toMatchObject({status: 409});
        const rejected = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(rejected.takeovers).toHaveLength(1);
        expect(rejected.shares).toEqual(saved.shares);
        expect(rejected.calculationSnapshot).toEqual(legacySnapshot);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationSnapshot!.takeovers)
            .toEqual([{payerRegistrationId: firstId, beneficiaryRegistrationId: secondId}]);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});

async function createRosterCalculationContext(title: string, nights: number[]) {
    const eventId = await createIntegrationEvent(organizer.id, title, nights.length);
    await eventService.updateEventDates(eventId, '2027-06-01', '2027-06-05');
    const registrationIds: number[] = [];
    for (let index = 0; index < nights.length; index++) {
        const profile = index === 0 ? participant : await persistIntegrationProfile({name: `Roster participant ${index}`});
        await registerEventAttendance(eventId, profile, {
            arrivalDate: '2027-06-01', departureDate: `2027-06-0${1 + nights[index]}`,
        });
        registrationIds.push((await eventService.getRegistrationFor(profile.id, eventId))!.id);
    }
    const event = (await eventService.getEventById(eventId))!;
    const poolId = await eventPoolController.createInvoicePool(event, {
        name: title, distribution: 'NIGHTS', assignAll: true, subtractPersonalInvoices: true,
    });
    const context = {event, poolId, registrationIds};
    const invoiceId = await submitInvoice(context, createInvoiceSubmissionCase({amount: 1000}));
    await invoiceOperations.acceptSavedInvoice(poolId, invoiceId);
    return context;
}

describe('retained settled share responsibility', () => {
    it.each([
        {change: 'exempt', refunded: false, sendEmails: false},
        {change: 'exempt', refunded: false, sendEmails: true},
        {change: 'covered', refunded: false, sendEmails: false},
        {change: 'covered', refunded: false, sendEmails: true},
        {change: 'covered', refunded: true, sendEmails: false},
        {change: 'covered', refunded: true, sendEmails: true},
    ])('keeps correcting credit after $change and clears it once settled (original refund=$refunded, bulk emails=$sendEmails)', async (scenario) => {
        const {event, poolId, firstId, secondId} = await createCalculationContext('Retained settled responsibility');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, scenario.refunded, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const first = pool.shares.find(share => share.registrationId === firstId)!;
        expect(first.shareAmount).toBe(scenario.refunded ? -50 : 50);
        await poolOperations.recordShareSettlement(poolId, first.id, true);
        sendEmail.mockClear();

        /** Stage an allocation change through existing commands while the previous transfer stays applied. */
        async function stageChange(): Promise<void> {
            if (scenario.change === 'exempt') {
                await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [firstId]);
            } else {
                await eventPoolController.updateTakeovers(event, poolId, {payerId: secondId, beneficiaries: [firstId]},
                    {profile: organizer} as Request['session'], true);
            }
        }
        // Pending edits and rollback cannot publish a changed financial responsibility or send its notice.
        await stageChange();
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.rollbackPoolChanges(event, poolId);
        expect(sendEmail).not.toHaveBeenCalled();
        const restored = (await invoiceService.getPoolWithInvoices(poolId))!.shares.find(share => share.registrationId === firstId)!;
        expect(restored.shareAmount).toBe(first.shareAmount);
        expect(Boolean(restored.isPaid)).toBe(true);
        await stageChange();

        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.settledRegistrationIds).toContain(firstId);
        expect(preview.shares.find(share => share.registrationId === firstId)).toMatchObject({
            paymentCreditAmount: first.shareAmount, shareAmount: -first.shareAmount, isPaid: false,
        });
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: scenario.sendEmails});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.calculationSnapshot!.settledRegistrationIds).toContain(firstId);
        expect(invoiceSettledShareImpact(pool, firstId)).toEqual(scenario.change === 'exempt'
            ? {registrationId: firstId, reason: 'exempt'} : {registrationId: firstId, reason: 'covered', payerRegistrationId: secondId});
        const retained = pool.shares.find(share => share.registrationId === firstId)!;
        expect(retained).toMatchObject({baseShareAmount: 0, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: first.shareAmount, shareAmount: -first.shareAmount});
        expect(Boolean(retained.isPaid)).toBe(false);
        // One explicit financial notice is mandatory even when bulk calculation mail is disabled.
        // Enabled bulk mail skips this recipient; coverage notices still reach all affected relationships.
        const explicit = sendEmail.mock.calls.filter(call => call[0].address === participant.user!.email
            && call[1] === 'Your payment responsibility changed');
        expect(explicit).toHaveLength(1);
        expect(explicit[0][2]).toMatchObject({heading: expect.stringContaining((-first.shareAmount).toFixed(2)),
            paragraphs: expect.arrayContaining([expect.stringContaining('Your payment responsibility changed')])});
        expect(JSON.stringify(explicit[0][2])).toContain(scenario.change === 'exempt' ? 'now exempt' : 'now covers');
        expect(sendEmail.mock.calls.filter(call => call[0].address === participant.user!.email
            && call[1] === 'Your invoice pool recalculated')).toHaveLength(0);

        // Recording the correcting transfer leaves its saved calculation intact until a recalculation applies it.
        await poolOperations.recordShareSettlement(poolId, retained.id, true);
        sendEmail.mockClear();
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.calculationSnapshot!.settledRegistrationIds).toContain(firstId);
        const clearedPreview = await eventPoolController.previewPool(event, poolId);
        expect(clearedPreview.settledRegistrationIds).not.toContain(firstId);
        const previewShare = clearedPreview.shares.find(share => share.registrationId === firstId);
        if (scenario.change === 'exempt') {
            expect(previewShare).toMatchObject({paymentCreditAmount: 0, shareAmount: 0, isPaid: true, paidAt: null});
        } else {
            expect(previewShare).toBeUndefined();
        }
        // Apply the same projection: a covered orphan is removed; an actual exempt allocation stays ordinary.
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: clearedPreview.revision, sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const zeroBalance = pool.shares.find(share => share.registrationId === firstId)!;
        if (scenario.change === 'exempt') {
            expect(zeroBalance).toMatchObject({paymentCreditAmount: 0, shareAmount: 0, paidAt: null});
            expect(Boolean(zeroBalance.isPaid)).toBe(true);
        } else {
            expect(zeroBalance).toBeUndefined();
        }
        expect(pool.calculationSnapshot!.settledRegistrationIds).not.toContain(firstId);
        expect(invoiceSettledShareImpact(pool, firstId)).toBeNull();
        // Repeated previews and no-op calculations must not resurrect old IDs, rows, or financial notices.
        const nextPreview = await eventPoolController.previewPool(event, poolId);
        expect(nextPreview.settledRegistrationIds).not.toContain(firstId);
        if (scenario.change === 'exempt') {
            expect(nextPreview.shares.find(share => share.registrationId === firstId)).toMatchObject({shareAmount: 0, isPaid: true});
        } else {
            expect(nextPreview.shares.find(share => share.registrationId === firstId)).toBeUndefined();
        }
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: nextPreview.revision, sendEmails: false});
        const finalPool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(finalPool.calculationSnapshot!.settledRegistrationIds).not.toContain(firstId);
        if (scenario.change === 'exempt') {
            const ordinaryZero = finalPool.shares.find(share => share.registrationId === firstId)!;
            expect(ordinaryZero).toMatchObject({paymentCreditAmount: 0, shareAmount: 0, paidAt: null});
            expect(Boolean(ordinaryZero.isPaid)).toBe(true);
        } else {
            expect(finalPool.shares.find(share => share.registrationId === firstId)).toBeUndefined();
        }
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('notifies a refunded payer during active-credit reassignment and clears the marker after repayment', async () => {
        const {event, poolId, firstId, secondId, thirdId} = await createTakeoverContext('Retained refund reassignment');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const original = pool.shares.find(share => share.registrationId === firstId)!;
        expect(original.shareAmount).toBeLessThan(0);
        await poolOperations.recordShareSettlement(poolId, original.id, true);
        await savePoolTakeovers(poolId, secondId, [firstId], true);
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const correctingShare = pool.shares.find(share => share.registrationId === firstId)!;
        expect(correctingShare.paymentCreditAmount).toBe(original.shareAmount);
        expect(correctingShare.shareAmount).toBe(-original.shareAmount);
        sendEmail.mockClear();
        await eventPoolController.updateTakeovers(event, poolId, {payerId: thirdId, beneficiaries: [firstId]},
            {profile: organizer} as Request['session'], true);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === firstId)).toMatchObject({
            shareAmount: -original.shareAmount, paymentCreditAmount: original.shareAmount});
        expect(invoiceSettledShareImpact(pool, firstId)).toEqual({registrationId: firstId, reason: 'covered', payerRegistrationId: thirdId});
        expect(sendEmail.mock.calls.filter(call => call[0].address === participant.user!.email
            && call[1] === 'Your payment responsibility changed')).toHaveLength(1);

        // Complete the positive repayment of the earlier negative refund, then preview the exact cleanup.
        await poolOperations.recordShareSettlement(poolId, pool.shares.find(share => share.registrationId === firstId)!.id, true);
        sendEmail.mockClear();
        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.settledRegistrationIds).not.toContain(firstId);
        expect(preview.shares.find(share => share.registrationId === firstId)).toBeUndefined();
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === firstId)).toBeUndefined();
        expect(pool.calculationSnapshot!.settledRegistrationIds).not.toContain(firstId);
        expect(invoiceSettledShareImpact(pool, firstId)).toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();

        // Future coverage changes still send their normal relationship notices, without expired financial-history mail.
        await eventPoolController.updateTakeovers(event, poolId, {payerId: secondId, beneficiaries: [firstId]},
            {profile: organizer} as Request['session'], true);
        expect(sendEmail).not.toHaveBeenCalled();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect(sendEmail.mock.calls.filter(call => call[0].address === participant.user!.email
            && call[1] === 'Your payment responsibility changed')).toHaveLength(0);
        sendEmail.mockClear();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === firstId)).toBeUndefined();
        expect(pool.calculationSnapshot!.settledRegistrationIds).not.toContain(firstId);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});

describe('invoice pool factors, rebates, and recalculation', () => {
    it.each([true, false])('reconciles a 28-person scenario assuming four nights except E with roundUpShares=%s', async (roundUpShares) => {
        // A..Z, AA, AB; A and all other unspecified stays are explicitly four nights, E is three.
        const nights = Array.from({length: 28}, (_, index) => index === 4 ? 3 : 4);
        const {poolId, event, registrationIds: ids} = await createRosterCalculationContext('28-person stated scenario', nights);
        await poolOperations.saveInvoicePoolSettings(poolId, 'NIGHTS', undefined, false, roundUpShares);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], [], {[ids[0]]: 2});
        await poolOperations.savePoolSurcharge(poolId, ids[0], -5, 'A redistributed rebate', true);
        await poolOperations.savePoolSurcharge(poolId, ids[4], -5, 'E redistributed rebate', true);
        await poolOperations.savePoolSurcharge(poolId, ids[4], 20, 'E additional charge', false);
        await poolOperations.savePoolSurcharge(poolId, ids[9], -5, 'J redistributed rebate', true);
        await poolOperations.savePoolSurcharge(poolId, ids[9], 10, 'J redistributed charge', true);
        await savePoolTakeovers(poolId, ids[0], [ids[4]], true);
        await savePoolTakeovers(poolId, ids[1], [ids[11], ids[7]], true);

        // Independent arithmetic: 115 weighted nights, shared 1000 - (-5) = 1005, adjustments +15.
        const expected = roundUpShares
            ? {base: 1005.10, gross: 1020.10, net: 20.10, difference: 0.10, aBase: 96.14, aNet: -893.86, b: 104.88, j: 39.96, other: 34.96}
            : {base: 1004.82, gross: 1019.82, net: 19.82, difference: -0.18, aBase: 96.12, aNet: -893.88, b: 104.85, j: 39.95, other: 34.95};
        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.roundUpShares).toBe(roundUpShares);
        expect(preview.totals).toMatchObject({
            invoiceAmount: 1000, redistributedAmount: -5, distributableAmount: 1005,
            allocatedBaseAmount: expected.base, roundingDifference: expected.difference,
            adjustmentAmount: 15, grossAmount: expected.gross, invoiceCreditAmount: 1000,
            expectedNetAmount: 20, calculatedAmount: expected.net,
        });
        // Attendance, factor weights, and individual rounding remain distinct from takeover sums.
        expect(preview.explanation).toMatchObject({
            assignedParticipants: 28, exemptParticipants: 0, attendanceUnits: 111,
            eligibleAttendanceUnits: 111, effectiveWeight: 115, distributableAmount: 1005,
            distributionMethod: 'NIGHTS', roundUpShares,
        });
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[0]))
            .toMatchObject({attendanceWeight: 4, factor: 2, effectiveWeight: 8, payerRegistrationId: ids[0]});
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[4]))
            .toMatchObject({attendanceWeight: 3, factor: 1, effectiveWeight: 3, payerRegistrationId: ids[0]});
        await eventPoolController.closePool(event, poolId, {sendEmails: false, expectedRevision: preview.revision});
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.calculationSnapshot!.explanation).toEqual(preview.explanation);
        expect(pool.shares).toHaveLength(25);
        expect(pool.shares.find(share => share.registrationId === ids[0])).toMatchObject({
            baseShareAmount: expected.aBase, extraAmount: 10, invoiceCreditAmount: 1000, shareAmount: expected.aNet,
        });
        expect(pool.shares.find(share => share.registrationId === ids[1])!.shareAmount).toBe(expected.b);
        expect(pool.shares.find(share => share.registrationId === ids[9])!.shareAmount).toBe(expected.j);
        const ordinary = pool.shares.filter(share => ![ids[0], ids[1], ids[9]].includes(share.registrationId));
        expect(ordinary).toHaveLength(22);
        expect(ordinary.every(share => share.shareAmount === expected.other)).toBe(true);
        expect(pool.shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.net * 100));

        // Turning invoice credit off changes only that credit, including within the combined payer share.
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[ids[0]]: 2});
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === ids[0])).toMatchObject({
            baseShareAmount: expected.aBase, extraAmount: 10, invoiceCreditAmount: 0,
        });
        expect(pool.shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.gross * 100));
    }, 30_000);

    it.each([true, false])('reconciles an anonymous mixed-stay roster with an exemption and roundUpShares=%s', async (roundUpShares) => {
        const nights = [4,4,4,4,4,4,1,4,4,4,2,4,4,4,4,4,2,4,4,4,4,4,3,4,2,3,4,1];
        const {poolId, event, registrationIds: ids} = await createRosterCalculationContext('28-person mixed stays', nights);
        await poolOperations.saveInvoicePoolSettings(poolId, 'NIGHTS', undefined, false, roundUpShares);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], [ids[12]], {[ids[0]]: 2, [ids[5]]: 0.75});
        for (const [index, amount, redistributed] of [[0, -5, true], [25, -5, true], [1, -5, true], [1, 10, true], [16, 20, false]] as const) {
            await poolOperations.savePoolSurcharge(poolId, ids[index], amount, 'Roster adjustment', redistributed);
        }
        await savePoolTakeovers(poolId, ids[0], [ids[25]], true);
        await savePoolTakeovers(poolId, ids[3], [ids[5], ids[11]], true);
        const expected = roundUpShares
            ? {base: 1005.19, net: 20.19, difference: 0.19, aBase: 113.98, a: -896.02, b: 113.99, j: 46.45, additional: 40.73, ordinary: 41.45}
            : {base: 1004.92, net: 19.92, difference: -0.08, aBase: 113.96, a: -896.04, b: 113.96, j: 46.44, additional: 40.72, ordinary: 41.44};
        // 97 weighted nights; A's 8+3 and B's 4+3+4 are rounded per participant before combining.
        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.totals).toMatchObject({
            distributableAmount: 1005, allocatedBaseAmount: expected.base,
            adjustmentAmount: 15, invoiceCreditAmount: 1000, expectedNetAmount: 20,
            roundingDifference: expected.difference, calculatedAmount: expected.net,
        });
        expect(preview.explanation).toMatchObject({
            assignedParticipants: 28, exemptParticipants: 1, attendanceUnits: 98,
            eligibleAttendanceUnits: 94, effectiveWeight: 97,
        });
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[12]))
            .toMatchObject({isExempt: true, attendanceWeight: 4, effectiveWeight: 0, baseShareAmount: 0});
        await eventPoolController.closePool(event, poolId, {sendEmails: false, expectedRevision: preview.revision});
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find(share => share.registrationId === ids[0])).toMatchObject({
            baseShareAmount: expected.aBase, extraAmount: -10, invoiceCreditAmount: 1000, shareAmount: expected.a,
        });
        expect(pool.shares.find(share => share.registrationId === ids[3])!.shareAmount).toBe(expected.b);
        expect(pool.shares.find(share => share.registrationId === ids[1])!.shareAmount).toBe(expected.j);
        expect(pool.shares.find(share => share.registrationId === ids[16])!.shareAmount).toBe(expected.additional);
        expect(pool.shares.find(share => share.registrationId === ids[12])).toMatchObject({baseShareAmount: 0, shareAmount: 0});
        const ordinaryIds = ids.filter((_, index) => nights[index] === 4 && ![0, 1, 3, 5, 11, 12].includes(index));
        expect(pool.shares.filter(share => ordinaryIds.includes(share.registrationId)).every(share => share.baseShareAmount === expected.ordinary)).toBe(true);
        expect(pool.shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.net * 100));
    }, 30_000);

    it('validates factors and signed rebates and keeps participant changes closed after calculation', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Validated adjustments');
        for (const factor of [-1, NaN, Infinity, 1001, 1.00001]) {
            await expect(eventPoolController.updatePoolAssignments(event, poolId, {
                assignAll: true, participantFactors: {[firstId]: factor},
            })).rejects.toThrow();
        }
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        await expect(savePoolTakeovers(poolId, firstId, [secondId], false)).rejects.toThrow('only available while the pool is open');
        await expect(invoiceOperations.persistSubmittedInvoice(poolId, firstId, 10, 'Closed upload', null)).rejects.toThrow('closed');
        await eventPoolController.addPoolSurcharge(event, poolId, {
            registrationId: firstId, amount: -10, note: 'Organizer rebate', subtractFromPool: false,
        });
        const stale = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(stale.needsRecalculation).toBeTruthy();
        expect(stale.surcharges[0].amount).toBe('-10.00');
        // Reimbursing an approved invoice does not alter the saved calculation inputs.
        const revision = stale.calculationRevision;
        await invoiceOperations.closeSavedInvoice(poolId, stale.invoices[0].id);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.calculationRevision).toBe(revision);
        await eventPoolController.recalculatePool(event, poolId);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find((share) => share.registrationId === firstId)!.shareAmount).toBe(40);
        await poolOperations.deletePoolSurcharge(poolId, stale.surcharges[0].id);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.needsRecalculation).toBeTruthy();
    });

    it('gives default factors to new participants without resetting existing factors on attendance updates', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Default factors');
        await poolOperations.saveInvoicePoolAssignments(poolId, true, true, false, [], [], {[firstId]: 1.5});
        await eventPoolController.closePool(event, poolId);
        const extra = await persistIntegrationProfile({name: 'Late factor participant'});
        await registerEventAttendance(event.id, extra, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await eventService.register(event.id, '2027-06-01', '2027-06-02', participant.id);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.needsRecalculation).toBeTruthy();
        expect(pool.assignments.filter((assignment) => assignment.registrationId === firstId)).toHaveLength(1);
        expect(pool.assignments.find((assignment) => assignment.registrationId === firstId)!.factor).toBe(1.5);
        expect(pool.assignments.find((assignment) => assignment.registrationId === secondId)!.factor).toBe(1);
        expect(pool.assignments.find((assignment) => ![firstId, secondId].includes(assignment.registrationId))!.factor).toBe(1);
    });

    it('combines weighted base costs, redistributed adjustments, additional rebates, credits, and takeovers', async () => {
        const context = await createCalculationContext('Weighted adjustments');
        const {firstId, secondId, poolId, event} = context;
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await poolOperations.savePoolSurcharge(poolId, firstId, 20, 'Private expense', true);
        await poolOperations.savePoolSurcharge(poolId, secondId, -10, 'Shared rebate', true);
        await poolOperations.savePoolSurcharge(poolId, firstId, 10, 'Extra service', false);
        await poolOperations.savePoolSurcharge(poolId, secondId, -5, 'Organizer rebate', false);

        await eventPoolController.closePool(event, poolId);
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool).toMatchObject({invoiceAmount: 100, payableAmount: 90, additionalAmount: 5, totalAmount: 105});
        expect(pool.shares.find((share) => share.registrationId === firstId)).toMatchObject({
            baseShareAmount: 67.5, extraAmount: 30, invoiceCreditAmount: 100, shareAmount: -2.5,
        });
        expect(pool.shares.find((share) => share.registrationId === secondId)).toMatchObject({
            baseShareAmount: 22.5, extraAmount: -15, invoiceCreditAmount: 0, shareAmount: 7.5,
        });
        expect(pool.shares.find((share) => share.registrationId === secondId)!.note).toContain('Rebate');

        await savePoolTakeovers(poolId, firstId, [secondId], true);
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.needsRecalculation).toBeTruthy();
        expect(pool.shares).toHaveLength(2);
        await eventPoolController.recalculatePool(event, poolId);
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares).toHaveLength(1);
        expect(pool.shares[0]).toMatchObject({registrationId: firstId, baseShareAmount: 90, extraAmount: 15, invoiceCreditAmount: 100, shareAmount: 5});
        expect(pool.needsRecalculation).toBeFalsy();
    });

    it.each([
        ['TIME_BASED', 64.29, 35.72],
        ['NIGHTS', 60, 40],
    ] as const)('applies participant factors to %s weights with consistently rounded cents', async (distribution, firstAmount, secondAmount) => {
        const {poolId, event, firstId, secondId} = await createCalculationContext(`${distribution} factors`);
        await poolOperations.saveInvoicePoolSettings(poolId, distribution);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await eventPoolController.closePool(event, poolId);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find((share) => share.registrationId === firstId)!.shareAmount).toBe(firstAmount);
        expect(pool.shares.find((share) => share.registrationId === secondId)!.shareAmount).toBe(secondAmount);
        expect(pool.shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round((firstAmount + secondAmount) * 100));
    });

    it('preserves saved shares after edits, allows payments, and keeps the closed calculation on failure', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Closed editing');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const originalShares = pool.shares.map((share) => ({id: share.id, shareAmount: share.shareAmount}));
        const firstShareId = pool.shares.find((share) => share.registrationId === firstId)!.id;
        await poolOperations.recordShareSettlement(poolId, firstShareId, true);

        await eventPoolController.updatePoolAssignments(event, poolId, {
            assignAll: true, subtractPersonalInvoices: false, participantFactors: {[firstId]: 0, [secondId]: 0},
        });
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.status).toBe('CLOSED');
        expect(pool.needsRecalculation).toBeTruthy();
        expect(pool.shares.map((share) => ({id: share.id, shareAmount: share.shareAmount}))).toEqual(originalShares);
        await poolOperations.recordShareSettlement(poolId, firstShareId, false);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.id === firstShareId)!.isPaid).toBeFalsy();
        await poolOperations.recordShareSettlement(poolId, firstShareId, true);
        await expect(eventPoolController.recalculatePool(event, poolId)).rejects.toThrow('positive factor');
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares.some((share) => share.isPaid)).toBeTruthy();

        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await eventPoolController.recalculatePool(event, poolId);
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.status).toBe('CLOSED');
        expect(pool.needsRecalculation).toBeFalsy();
        expect(pool.shares.every((share) => !share.isPaid)).toBeTruthy();
        expect(pool.shares.find((share) => share.registrationId === firstId)).toMatchObject({
            baseShareAmount: 75, paymentCreditAmount: 50, shareAmount: 25,
        });
        await eventService.updateRegistrationDates(event.id, firstId, '2027-06-01', '2027-06-02');
        expect((await invoiceService.getPoolWithInvoices(poolId))!.needsRecalculation).toBeTruthy();
    });

    it('persists a rounding change, invalidates an earlier preview, and preserves its value when omitted from later settings', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Pool rounding setting');
        await poolOperations.saveInvoicePoolSettings(poolId, 'TIME_BASED');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(before.roundUpShares).toBeTruthy();
        const oldPreview = await eventPoolController.previewPool(event, poolId);
        await eventPoolController.updatePoolSettings(event, poolId, {distribution: 'TIME_BASED', roundUpShares: false});
        await eventPoolController.updatePoolSettings(event, poolId, {distribution: 'TIME_BASED', description: 'Rounding retained'});
        const stale = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(stale.roundUpShares).toBeFalsy();
        expect(stale.needsRecalculation).toBeTruthy();
        expect(stale.shares).toEqual(before.shares);
        await expect(eventPoolController.recalculatePool(event, poolId, {expectedRevision: oldPreview.revision, sendEmails: false})).rejects.toThrow(/changed|revision|out of date/i);
        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.roundUpShares).toBe(false);
        expect(preview.shares.find(share => share.registrationId === firstId)!.baseShareAmount).toBe(64.28);
        expect(preview.shares.find(share => share.registrationId === secondId)!.baseShareAmount).toBe(35.71);
        expect(preview.totals.roundingDifference).toBe(-0.01);
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        const recalculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(recalculated.roundUpShares).toBeFalsy();
        expect(recalculated.needsRecalculation).toBeFalsy();
        expect(recalculated.calculationSnapshot!.settings.roundUpShares).toBe(false);
    });

    it('carries settled payments once across repeated recalculations and only undoes the current payment', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Cumulative payments');
        const firstShare = async () => (await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.registrationId === firstId)!;
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});

        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({baseShareAmount: 75, paymentCreditAmount: 50, shareAmount: 25});
        expect((await firstShare()).isPaid).toBeFalsy();
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({paymentCreditAmount: 50, shareAmount: 25});

        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, true);
        await poolOperations.savePoolSurcharge(poolId, firstId, 25, 'Extra travel', false);
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({baseShareAmount: 75, extraAmount: 25, paymentCreditAmount: 75, shareAmount: 25});
        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, true);
        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, false);
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({paymentCreditAmount: 75, shareAmount: 25});
        expect((await firstShare()).isPaid).toBeFalsy();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.outstandingAmount).toBe(50);
    });

    it.each([false, true])('persists a nonzero recalculated remainder as unpaid after signed settlement (invoice credit=%s)', async (subtractPersonalInvoices) => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Persisted remainder state');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, subtractPersonalInvoices, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.registrationId === firstId)!;
        await poolOperations.recordShareSettlement(poolId, initial.id, true);
        expect((await invoiceService.getShareWithRegistration(poolId, initial.id))!.isPaid).toBeTruthy();
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, subtractPersonalInvoices, [], [], {
            [firstId]: subtractPersonalInvoices ? 0.5 : 1.5,
            [secondId]: subtractPersonalInvoices ? 1.5 : 0.5,
        });

        for (let calculation = 0; calculation < 2; calculation++) {
            await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
            const share = (await invoiceService.getPoolWithInvoices(poolId))!.shares.find((row) => row.registrationId === firstId)!;
            expect(share).toMatchObject({
                paymentCreditAmount: subtractPersonalInvoices ? -50 : 50,
                shareAmount: subtractPersonalInvoices ? -25 : 25,
                paidAt: null,
            });
            expect(Boolean(share.isPaid)).toBe(false);
            const [persisted] = await AppDataSource.query('SELECT is_paid AS isPaid, paid_at AS paidAt FROM event_invoice_shares WHERE id = ?', [share.id]);
            expect(Number(persisted.isPaid)).toBe(0);
            expect(persisted.paidAt).toBeNull();
            const listed = (await invoiceService.listPools(event.id)).find((pool) => pool.id === poolId)!;
            expect(Boolean(listed.shares.find((row) => row.id === share.id)!.isPaid)).toBe(false);
        }
    });

    it('loads complete calculation and payment relations consistently for individual pools and event lists', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Pool relation loading');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await poolOperations.savePoolSurcharge(poolId, firstId, 10, 'Supplement', false);
        await poolOperations.savePoolSurcharge(poolId, secondId, -5, 'Rebate', true);
        await savePoolTakeovers(poolId, firstId, [secondId], true);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const beforePayment = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, beforePayment.shares[0].id, true);
        await poolOperations.savePoolSurcharge(poolId, secondId, 1, 'Pending input', false);

        const loaded = (await invoiceService.getPoolWithInvoices(poolId))!;
        const listed = (await invoiceService.listPools(event.id)).find((pool) => pool.id === poolId)!;
        const joined = (await AppDataSource.getRepository(EventInvoicePool).findOne({
            where: {id: poolId}, relationLoadStrategy: 'join',
            relations: {
                event: true, assignments: {registration: true}, invoices: {registration: true, recordedByProfile: true}, shares: {registration: true},
                surcharges: {registration: true}, takeovers: {payerRegistration: true, beneficiaryRegistration: true},
            },
        }))!;
        const normalize = (pool: EventInvoicePool) => ({
            eventId: pool.eventId, calculationRevision: pool.calculationRevision,
            needsRecalculation: pool.needsRecalculation, calculationSnapshot: pool.calculationSnapshot,
            outstandingAmount: pool.outstandingAmount, creditAmount: pool.creditAmount,
            assignments: [...pool.assignments].sort((left, right) => left.id - right.id),
            invoices: [...pool.invoices].sort((left, right) => left.id - right.id),
            shares: [...pool.shares].sort((left, right) => left.id - right.id),
            surcharges: [...pool.surcharges].sort((left, right) => left.id - right.id),
            takeovers: [...pool.takeovers].sort((left, right) => left.id - right.id),
        });
        expect(normalize(loaded)).toEqual(normalize(joined));
        expect(normalize(listed)).toEqual(normalize(joined));
        expect(loaded.event.id).toBe(event.id);
        expect(loaded.needsRecalculation).toBeTruthy();
        expect(loaded.shares[0].isPaid).toBeTruthy();
        expect(loaded.assignments.map((row) => row.registration.id).sort()).toEqual([firstId, secondId].sort());
        expect(loaded.takeovers[0].payerRegistration.id).toBe(firstId);
        expect(loaded.takeovers[0].beneficiaryRegistration.id).toBe(secondId);
    });

    it('carries signed payouts and distinguishes a further refund from an amount to pay back', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Signed payout history');
        const firstShare = async () => (await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.registrationId === firstId)!;
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], []);
        await eventPoolController.closePool(event, poolId);
        expect(await firstShare()).toMatchObject({invoiceCreditAmount: 100, shareAmount: -50});
        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], [], {[firstId]: 0.5, [secondId]: 1.5});
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({baseShareAmount: 25, invoiceCreditAmount: 100, paymentCreditAmount: -50, shareAmount: -25});
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({paymentCreditAmount: -50, shareAmount: -25});

        await poolOperations.recordShareSettlement(poolId, (await firstShare()).id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, true, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await eventPoolController.recalculatePool(event, poolId);
        expect(await firstShare()).toMatchObject({baseShareAmount: 75, invoiceCreditAmount: 100, paymentCreditAmount: -75, shareAmount: 50});
    });

    it.each(['removed from allocation', 'covered by another payer'])('retains the actual payer\'s payment when %s', async (change) => {
        const {poolId, event, firstId, secondId} = await createCalculationContext(change === 'removed from allocation' ? 'Paid allocation removal' : 'Paid takeover change');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        let pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, pool.shares.find((share) => share.registrationId === firstId)!.id, true);
        if (change === 'removed from allocation') {
            await poolOperations.saveInvoicePoolAssignments(poolId, false, false, false, [secondId], []);
        } else {
            await savePoolTakeovers(poolId, secondId, [firstId], true);
        }
        await eventPoolController.recalculatePool(event, poolId);
        pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.shares.find((share) => share.registrationId === firstId)).toMatchObject({
            baseShareAmount: 0, extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: -50,
        });
        expect(pool.shares.find((share) => share.registrationId === secondId)).toMatchObject({
            paymentCreditAmount: 0, shareAmount: 100,
        });
        await eventPoolController.recalculatePool(event, poolId);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.registrationId === firstId))
            .toMatchObject({paymentCreditAmount: 50, shareAmount: -50});
    });

    it('keeps a credit-only refund when every participant is removed from a fully settled allocation', async () => {
        const {poolId, event} = await createInvoiceContext('Empty settled allocation');
        const registrationId = (await eventService.getRegistrationFor(participant.id, event.id))!.id;
        await poolOperations.savePoolSurcharge(poolId, registrationId, 10, 'Additional travel', false);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(calculated.shares[0].shareAmount).toBe(10);
        await poolOperations.recordShareSettlement(poolId, calculated.shares[0].id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, false, false, [], []);

        const preview = await eventPoolController.previewPool(event, poolId);
        expect(preview.shares).toHaveLength(1);
        expect(preview.shares[0]).toMatchObject({registrationId, baseShareAmount: 0, paymentCreditAmount: 10, shareAmount: -10});
        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        const refunded = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(refunded.assignments).toHaveLength(0);
        expect(refunded.shares).toHaveLength(1);
        expect(refunded.shares[0]).toMatchObject({registrationId, paymentCreditAmount: 10, shareAmount: -10});
        expect(refunded.creditAmount).toBe(10);
    });

    it('retains factors during assignment updates and recalculates signed shared totals without clamping', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Signed shared total');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.addPoolSurcharge(event, poolId, {registrationId: firstId, amount: 120, note: 'Expense assigned directly', subtractFromPool: true});
        await eventPoolController.closePool(event, poolId);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.payableAmount).toBe(-20);
        expect(pool.shares.find((share) => share.registrationId === firstId)!.shareAmount).toBe(105);
        expect(pool.shares.find((share) => share.registrationId === secondId)!.shareAmount).toBe(-5);
        expect(pool.assignments.find((assignment) => assignment.registrationId === firstId)!.factor).toBe(1.5);
    });

    it('requires recalculation when an invoice is approved after the pool has closed', async () => {
        const context = await createCalculationContext('Late invoice review');
        const {poolId, event, firstId} = context;
        const pendingId = await submitInvoice(context, createInvoiceSubmissionCase({amount: 20}));
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        await invoiceOperations.acceptSavedInvoice(poolId, pendingId);
        const stale = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(stale.needsRecalculation).toBeTruthy();
        expect(stale.shares.find((share) => share.registrationId === firstId)!.shareAmount).toBe(50);
        await eventPoolController.recalculatePool(event, poolId);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.shares.find((share) => share.registrationId === firstId)!.shareAmount).toBe(60);
    });

    it('rejects stale calculation revisions without replacing shares or losing invalidation', async () => {
        const {poolId, event} = await createCalculationContext('Concurrent edit');
        await eventPoolController.closePool(event, poolId);
        const snapshot = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.saveInvoicePoolSettings(poolId, 'NIGHTS');
        await expect(poolOperations.commitPoolCalculation(poolId, [], [], true, snapshot.calculationRevision)).rejects.toThrow('inputs changed');
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.needsRecalculation).toBeTruthy();
        expect(pool.shares.map((share) => share.id)).toEqual(snapshot.shares.map((share) => share.id));
    });

    it('previews without changing shares or payments and commits the same projected remaining amounts', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Read-only preview');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, initial.shares.find((share) => share.registrationId === firstId)!.id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await poolOperations.savePoolSurcharge(poolId, firstId, -20, 'Shared rebate', true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        sendEmail.mockClear();

        const preview = await eventPoolController.previewPool(event, poolId);
        const afterPreview = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(preview.revision).toBe(before.calculationRevision);
        expect(preview.shares.find((share) => share.registrationId === firstId)).toMatchObject({
            baseShareAmount: 90, extraAmount: -20, paymentCreditAmount: 50, shareAmount: 20,
        });
        expect(afterPreview.shares).toEqual(before.shares);
        expect(afterPreview.calculationRevision).toBe(before.calculationRevision);
        expect(afterPreview.closedAt).toEqual(before.closedAt);
        expect(afterPreview.outstandingAmount).toBe(before.outstandingAmount);
        expect(afterPreview.needsRecalculation).toBe(before.needsRecalculation);
        expect(sendEmail).not.toHaveBeenCalled();

        await eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision, sendEmails: false});
        const committed = (await invoiceService.getPoolWithInvoices(poolId))!;
        for (const projected of preview.shares) {
            expect(committed.shares.find((share) => share.registrationId === projected.registrationId)).toMatchObject({
                baseShareAmount: projected.baseShareAmount,
                extraAmount: projected.extraAmount,
                invoiceCreditAmount: projected.invoiceCreditAmount,
                paymentCreditAmount: projected.paymentCreditAmount,
                shareAmount: projected.shareAmount,
            });
        }
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('rejects a preview revision after a payment changes, preserving the newly recorded settlement', async () => {
        const {poolId, event, firstId} = await createCalculationContext('Payment after preview');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        const preview = await eventPoolController.previewPool(event, poolId);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        const first = pool.shares.find((share) => share.registrationId === firstId)!;
        await poolOperations.recordShareSettlement(poolId, first.id, true);
        await expect(eventPoolController.recalculatePool(event, poolId, {expectedRevision: preview.revision}))
            .rejects.toThrow(/changed|preview|revision/i);
        const after = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(after.shares.map((share) => share.id)).toEqual(pool.shares.map((share) => share.id));
        expect(after.shares.find((share) => share.id === first.id)!.isPaid).toBeTruthy();
        expect(after.needsRecalculation).toBeFalsy();
        sendEmail.mockClear();
        await expect(eventPoolController.notifyPoolShares(event, poolId, {expectedRevision: preview.revision}))
            .rejects.toThrow(/changed|revision/i);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('restores the last calculated pool settings and allocations without replacing shares or current payments', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Rollback local changes');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        await poolOperations.savePoolSurcharge(poolId, firstId, 10, 'Original surcharge', true);
        await savePoolTakeovers(poolId, firstId, [secondId], true);
        await eventPoolController.closePool(event, poolId);
        const calculated = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.saveInvoicePoolSettings(poolId, 'NIGHTS', 'Changed description', false, false);
        await poolOperations.saveInvoicePoolAssignments(poolId, true, false, true, [firstId], [firstId], {[firstId]: 2});
        await poolOperations.deletePoolSurcharge(poolId, calculated.surcharges[0].id);
        await poolOperations.savePoolSurcharge(poolId, firstId, -5, 'Uncalculated rebate', false);
        await poolOperations.recordShareSettlement(poolId, calculated.shares[0].id, true);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        sendEmail.mockClear();

        await eventPoolController.rollbackPoolChanges(event, poolId, {expectedRevision: before.calculationRevision});
        const restored = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(restored).toMatchObject({
            status: 'CLOSED', distributionMethod: 'EQUAL', description: 'Participant costs',
        });
        expect(restored.assignAll).toBeTruthy();
        expect(restored.isDefault).toBeFalsy();
        expect(restored.subtractPersonalInvoices).toBeFalsy();
        expect(restored.sendCalculationEmails).toBeTruthy();
        expect(restored.roundUpShares).toBeTruthy();
        expect(restored.needsRecalculation).toBeFalsy();
        expect(restored.assignments).toHaveLength(2);
        expect(restored.assignments.find((row) => row.registrationId === firstId)!.factor).toBe(1.5);
        expect(restored.assignments.find((row) => row.registrationId === secondId)!.factor).toBe(0.5);
        expect(restored.assignments.every((row) => !row.isExempt)).toBeTruthy();
        expect(restored.surcharges).toHaveLength(1);
        expect(restored.surcharges[0]).toMatchObject({registrationId: firstId, amount: '10.00', note: 'Original surcharge'});
        expect(restored.surcharges[0].subtractFromPool).toBeTruthy();
        expect(restored.takeovers).toHaveLength(1);
        expect(restored.takeovers[0]).toMatchObject({payerRegistrationId: firstId, beneficiaryRegistrationId: secondId});
        expect(restored.shares).toEqual(before.shares);
        expect(restored.calculationSnapshot!.explanation).toEqual(calculated.calculationSnapshot!.explanation);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('keeps external attendance and approved invoices when rolling back pool edits and remains stale', async () => {
        const context = await createCalculationContext('Rollback with external changes');
        const {poolId, event, firstId} = context;
        const pendingId = await submitInvoice(context, createInvoiceSubmissionCase({amount: 20}));
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        await poolOperations.saveInvoicePoolSettings(poolId, 'NIGHTS');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 2});
        await eventService.updateRegistrationDates(event.id, firstId, '2027-06-01', '2027-06-02');
        await invoiceOperations.acceptSavedInvoice(poolId, pendingId);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;

        await eventPoolController.rollbackPoolChanges(event, poolId);
        const restored = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(restored.distributionMethod).toBe('EQUAL');
        expect(restored.assignments.find((row) => row.registrationId === firstId)!.factor).toBe(1);
        expect(restored.assignments.find((row) => row.registrationId === firstId)!.registration.departureDate).toBe('2027-06-02');
        expect(restored.invoices.find((row) => row.id === pendingId)!.status).toBe('APPROVED');
        expect(restored.invoiceAmount).toBe(120);
        expect(restored.needsRecalculation).toBeTruthy();
        expect(restored.calculationSnapshot!.explanation).toEqual(before.calculationSnapshot!.explanation);
        expect(restored.shares).toEqual(before.shares);
    });

    it('honors the saved calculation-email preference and an explicit override for one calculation', async () => {
        const {poolId, event} = await createCalculationContext('Optional calculation emails');
        expect((await invoiceService.getPoolWithInvoices(poolId))!.sendCalculationEmails).toBeTruthy();
        await eventPoolController.updatePoolSettings(event, poolId, {distribution: 'EQUAL', sendCalculationEmails: false});
        sendEmail.mockClear();
        await eventPoolController.closePool(event, poolId);
        expect(sendEmail).not.toHaveBeenCalled();

        await eventPoolController.recalculatePool(event, poolId, {sendEmails: true});
        expect(sendEmail).toHaveBeenCalledTimes(2);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.sendCalculationEmails).toBeFalsy();

        await eventPoolController.updatePoolSettings(event, poolId, {distribution: 'EQUAL', sendCalculationEmails: true});
        sendEmail.mockClear();
        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        expect(sendEmail).not.toHaveBeenCalled();
        expect((await invoiceService.getPoolWithInvoices(poolId))!.sendCalculationEmails).toBeTruthy();
    });

    it('resends saved settled and remaining balances without recalculating or undoing payment records', async () => {
        const {poolId, event, firstId, secondId} = await createCalculationContext('Manual settlement emails');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, initial.shares.find((share) => share.registrationId === firstId)!.id, true);
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5, [secondId]: 0.5});
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        sendEmail.mockClear();

        expect(await eventPoolController.notifyPoolShares(event, poolId, {expectedRevision: before.calculationRevision}))
            .toEqual({count: 2});
        const settledEmail = sendEmail.mock.calls.find((call) => call[0].address === participant.user!.email)![2];
        expect(settledEmail).toMatchObject({
            heading: 'Your calculated balance: 50.00 · Paid',
            details: expect.arrayContaining([{label: 'Your payment status', value: 'Paid'}, {label: 'Your base share', value: '50.00'}]),
            paragraphs: expect.arrayContaining([expect.stringContaining('saved settlement')]),
        });
        expect(settledEmail).not.toMatchObject({details: expect.arrayContaining([expect.objectContaining({label: 'Unsettled balance'})])});
        const afterNotification = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(afterNotification.shares).toEqual(before.shares);
        expect(afterNotification.calculationRevision).toBe(before.calculationRevision);
        expect(afterNotification.needsRecalculation).toBeTruthy();

        await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
        sendEmail.mockClear();
        await eventPoolController.notifyPoolShares(event, poolId);
        const remainingEmail = sendEmail.mock.calls.find((call) => call[0].address === participant.user!.email)![2];
        expect(remainingEmail).toMatchObject({
            heading: 'Your calculated balance: 25.00 · Payment due',
            details: expect.arrayContaining([{label: 'Your base share', value: '75.00'}, {label: 'Your previous payments or refunds', value: '50.00'}]),
        });
    });

    it('serializes attendance and participant-factor edits without losing either change', async () => {
        const {poolId, event, firstId} = await createCalculationContext('Concurrent attendance');
        await eventPoolController.closePool(event, poolId);
        await Promise.all([
            poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], [], {[firstId]: 1.5}),
            eventService.updateRegistrationDates(event.id, firstId, '2027-06-01', '2027-06-02'),
        ]);
        const pool = (await invoiceService.getPoolWithInvoices(poolId))!;
        expect(pool.needsRecalculation).toBeTruthy();
        const assignment = pool.assignments.find((row) => row.registrationId === firstId)!;
        expect(assignment.factor).toBe(1.5);
        expect(assignment.registration.departureDate).toBe('2027-06-02');
        await eventPoolController.recalculatePool(event, poolId);
        expect((await invoiceService.getPoolWithInvoices(poolId))!.needsRecalculation).toBeFalsy();
    });

    it('migrates existing assignments to factor one while preserving closed shares and payments', async () => {
        const {poolId, event} = await createCalculationContext('Migration preservation');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId);
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, before.shares[0].id, true);
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoicePoolFactors1789344000000();
        await runner.connect();
        try {
            await migration.down(runner);
            await migration.up(runner);
            await migration.up(runner);
            const after = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(after.status).toBe('CLOSED');
            expect(after.needsRecalculation).toBeTruthy();
            expect(after.assignments.every((assignment) => assignment.factor === 1)).toBeTruthy();
            expect(after.shares.map((share) => share.id)).toEqual(before.shares.map((share) => share.id));
            expect(after.shares.find((share) => share.id === before.shares[0].id)!.isPaid).toBeTruthy();
            expect(await AppDataSource.getRepository(EventInvoicePool).count()).toBeGreaterThan(0);
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('upgrades existing paid shares without inventing historical credits or rollback snapshots', async () => {
        const {poolId, event, firstId} = await createCalculationContext('Settlement migration');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const firstShareId = before.shares.find((share) => share.registrationId === firstId)!.id;
        await poolOperations.recordShareSettlement(poolId, firstShareId, true);
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoiceSettlementSnapshots1789430400000();
        await runner.connect();
        try {
            await migration.down(runner);
            await migration.up(runner);
            await migration.up(runner);
            const upgraded = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(upgraded.shares.map((share) => share.id)).toEqual(before.shares.map((share) => share.id));
            expect(upgraded.shares.find((share) => share.id === firstShareId)!.isPaid).toBeTruthy();
            expect(upgraded.shares.every((share) => share.paymentCreditAmount === 0)).toBeTruthy();
            expect(upgraded.calculationSnapshot).toBeNull();
            expect(upgraded.sendCalculationEmails).toBeTruthy();
            await expect(eventPoolController.rollbackPoolChanges(event, poolId)).rejects.toThrow(/snapshot|previous/i);

            await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
            await migration.up(runner);
            const recalculated = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(recalculated.shares.find((share) => share.registrationId === firstId)).toMatchObject({
                paymentCreditAmount: 50, shareAmount: 0,
            });
            expect(recalculated.calculationSnapshot).toBeTruthy();
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('migrates rounding once without rewriting settlements or declaring a legacy snapshot current', async () => {
        const {poolId, event, firstId} = await createCalculationContext('Rounding migration');
        await poolOperations.saveInvoicePoolAssignments(poolId, false, true, false, [], []);
        await eventPoolController.closePool(event, poolId, {sendEmails: false});
        const initial = (await invoiceService.getPoolWithInvoices(poolId))!;
        await poolOperations.recordShareSettlement(poolId, initial.shares.find(share => share.registrationId === firstId)!.id, true);
        const legacySnapshot = initial.calculationSnapshot!;
        delete legacySnapshot.settings.roundUpShares;
        await AppDataSource.getRepository(EventInvoicePool).update(poolId, {calculationSnapshot: legacySnapshot});
        const before = (await invoiceService.getPoolWithInvoices(poolId))!;
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddInvoiceShareRounding1789516800000();
        await runner.connect();
        try {
            await migration.down(runner);
            await migration.up(runner);
            const firstUpgrade = (await invoiceService.getPoolWithInvoices(poolId))!;
            await migration.up(runner);
            const upgraded = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(upgraded.roundUpShares).toBeTruthy();
            expect(upgraded.needsRecalculation).toBeTruthy();
            expect(upgraded.calculationRevision).toBe(before.calculationRevision + 1);
            expect(upgraded.calculationRevision).toBe(firstUpgrade.calculationRevision);
            expect(upgraded.shares).toEqual(before.shares);
            expect(upgraded.calculationSnapshot).toEqual(legacySnapshot);

            const result = await eventPoolController.rollbackPoolChanges(event, poolId);
            expect(result.needsRecalculation).toBeTruthy();
            const rolledBack = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(rolledBack.roundUpShares).toBeTruthy();
            expect(rolledBack.shares).toEqual(before.shares);
            await eventPoolController.recalculatePool(event, poolId, {sendEmails: false});
            const recalculated = (await invoiceService.getPoolWithInvoices(poolId))!;
            expect(recalculated.needsRecalculation).toBeFalsy();
            expect(recalculated.calculationSnapshot!.settings.roundUpShares).toBe(true);
            expect(recalculated.shares.find(share => share.registrationId === firstId)).toMatchObject({paymentCreditAmount: 50, shareAmount: 0});
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });
});
