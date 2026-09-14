import type {Request} from 'express';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import eventPoolController from '../../src/controller/eventPoolController';
import type {Profile} from '../../src/modules/database/entities/user/Profile';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as userService from '../../src/modules/database/services/UserService';
import mailer from '../../src/modules/email';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let participant: Profile;
const sendEmail = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);

beforeAll(async () => {
    await initializeIntegrationDatabase();
    participant = await persistIntegrationProfile({name: 'Invoice feedback participant'});
}, 120_000);

beforeEach(() => sendEmail.mockReset().mockResolvedValue(undefined));
afterAll(async () => {
    sendEmail.mockRestore();
    await closeIntegrationDatabase();
});

async function context() {
    const eventId = await createIntegrationEvent(participant.id, 'Invoice feedback');
    await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    const event = (await eventService.getEventById(eventId))!;
    const registration = (await eventService.getRegistrationFor(participant.id, eventId))!;
    const poolId = await invoiceService.createPool(eventId, 'Feedback pool', '', 'EQUAL', false, true, false, [], false);
    const invoiceId = await invoiceService.submitInvoice(poolId, registration.id, 100, 'Shared travel');
    return {event, poolId, invoiceId, session: {profile: participant} as Request['session']};
}

describe('invoice administration feedback and committed decisions', () => {
    it.each(['accept', 'reject', 'close'] as const)('acknowledges a committed %s without waiting for SMTP delivery', async (action) => {
        const {event, poolId, invoiceId, session} = await context();
        if (action === 'close') await invoiceService.approveInvoice(poolId, invoiceId);
        let releaseDelivery!: () => void;
        const delivery = new Promise<void>(resolve => { releaseDelivery = resolve; });
        sendEmail.mockReturnValueOnce(delivery);
        const operation = action === 'accept'
            ? eventPoolController.approveInvoice(event, poolId, String(invoiceId), {correctedAmount: 75}, session)
            : action === 'reject'
                ? eventPoolController.declineInvoice(event, poolId, String(invoiceId), {rejectionReason: 'Duplicate receipt'}, session)
                : eventPoolController.closeInvoice(event, poolId, String(invoiceId), session);
        let settled = false;
        let failure: unknown;
        const observed = operation.then(() => { settled = true; }, error => { failure = error; settled = true; });
        try {
            await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce(), {timeout: 5000});
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(settled).toBe(true);
            expect(failure).toBeUndefined();
            const saved = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
            expect(saved.status).toBe(action === 'accept' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'CLOSED');
            if (action === 'accept') expect(Number(saved.correctedAmount)).toBe(75);
            if (action === 'reject') expect(saved.rejectionReason).toBe('Duplicate receipt');
            expect(sendEmail.mock.calls[0][0]).toEqual({name: participant.name, address: participant.user!.email});
        } finally {
            releaseDelivery();
            await observed;
        }
    }, 15_000);

    it('keeps a saved approval successful when email delivery fails', async () => {
        const {event, poolId, invoiceId, session} = await context();
        const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));
        try {
            await expect(eventPoolController.approveInvoice(event, poolId, String(invoiceId), {correctedAmount: 65}, session)).resolves.toBeUndefined();
            const saved = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
            expect(saved.status).toBe('APPROVED');
            expect(Number(saved.correctedAmount)).toBe(65);
            expect(report).toHaveBeenCalled();
        } finally { report.mockRestore(); }
    });

    it('rejects invalid financial changes before saving or requesting an email', async () => {
        const {event, poolId, invoiceId, session} = await context();
        await expect(eventPoolController.approveInvoice(event, poolId, String(invoiceId), {correctedAmount: -1}, session)).rejects.toThrow();
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.status).toBe('NEW');
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends only the committed correction when two organizers review the same invoice', async () => {
        const {event, poolId, invoiceId, session} = await context();
        const results = await Promise.allSettled([80, 90].map(correctedAmount =>
            eventPoolController.approveInvoice(event, poolId, String(invoiceId), {correctedAmount}, session)));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(sendEmail).toHaveBeenCalledOnce();
        const saved = (await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!;
        expect(sendEmail.mock.calls[0][2]).toMatchObject({details: expect.arrayContaining([
            {label: 'Accepted amount', value: Number(saved.correctedAmount).toFixed(2)},
        ])});
    });

    it('confirms repeated concurrent closure without duplicate notifications', async () => {
        const {event, poolId, invoiceId, session} = await context();
        await invoiceService.approveInvoice(poolId, invoiceId);
        await Promise.all([1, 2].map(() => eventPoolController.closeInvoice(event, poolId, String(invoiceId), session)));
        expect((await invoiceService.getInvoiceWithRegistration(poolId, invoiceId))!.status).toBe('CLOSED');
        expect(sendEmail).toHaveBeenCalledOnce();
    });

    it('uses the account name for invoice recipients and participant lists when a legacy profile name is blank', async () => {
        const {event, poolId, invoiceId, session} = await context();
        await userService.updateProfileName(participant.id, ' \n ');
        try {
            await eventPoolController.approveInvoice(event, poolId, String(invoiceId), {}, session);
            expect(sendEmail.mock.calls[0][0]).toEqual({name: participant.user!.name, address: participant.user!.email});
            expect((await eventService.getEventParticipants(event.id))[0].name).toBe(participant.user!.name);
        } finally {
            await userService.updateProfileName(participant.id, participant.name);
        }
    });
});
