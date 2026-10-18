import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {MockInstance} from 'vitest';
import mailer, {renderEmail} from '../../src/modules/email';
import {notifyAcceptedInvoice, notifyClosedInvoice, notifyPoolShareSettlements, notifyRejectedInvoice,
    notifySavedInvoiceChange, notifyShareSettlement, notifySubmittedInvoice, notifyTakeoverChanges} from '../../src/modules/invoice/notifications';
import type {StructuredEmailContent} from '../../src/types/EmailTypes';
import type {ParticipantRow} from '../../src/types/EventTypes';
import type {Event} from '../../src/modules/database/entities/event/Event';
import type {EventInvoicePool} from '../../src/modules/database/entities/event/EventInvoicePool';
import type {EventInvoice} from '../../src/modules/database/entities/event/EventInvoice';
import type {EventInvoiceShare} from '../../src/modules/database/entities/event/EventInvoiceShare';
import type {Request} from 'express';

const event = {id: 'notification-event', title: 'Shared trip'} as Event;
const pool = {name: 'Travel'} as EventInvoicePool;
const session = {profile: {name: 'Organizer'}} as Request['session'];

/** Supply only the hydrated attribution read by notification preparation, without a database or SMTP connection. */
function savedInvoice(): EventInvoice {
    return {id: 7, amount: 80, correctedAmount: null, description: 'Saved receipt', status: 'APPROVED',
        registration: {profile: {name: 'Taylor', user: {name: 'Taylor', username: 'taylor', email: 'taylor@example.test'}}},
    } as unknown as EventInvoice;
}

/** Select the actual public notification workflow so its recipient-facing catalog and renderer remain under test. */
function notifyInvoice(action: string): void {
    const invoice = savedInvoice();
    // Each branch exercises its existing production call; only the final external delivery is replaced below.
    if (action === 'submitted') notifySubmittedInvoice(event, pool, invoice, {amount: 80, description: 'Saved receipt'});
    else if (action === 'accepted') notifyAcceptedInvoice(event, pool, invoice, 70, 'Reviewed receipt', session);
    else if (action === 'closed') notifyClosedInvoice(event, pool, invoice, session);
    else if (action === 'rejected') notifyRejectedInvoice(event, pool, invoice, 'Missing evidence', session);
    else notifySavedInvoiceChange(event, pool, invoice, {...invoice, correctedAmount: '70.00'} as EventInvoice,
        action === 'saved-rejected' ? 'rejected' : action as 'corrected' | 'retracted', session);
}

/** Supply explicit recipient identities without importing persistence or current event membership services. */
function participant(id: number, name: string): ParticipantRow {
    return {id, profileId: null, name, email: `${id}@example.test`, arrivalDate: null, departureDate: null, dietaryChoices: []};
}

describe('directly addressed invoice notifications', () => {
    let delivery: MockInstance<typeof mailer.sendEmail>;

    beforeEach(() => { delivery = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined); });
    afterEach(() => { vi.restoreAllMocks(); });

    it.each(['submitted', 'accepted', 'closed', 'rejected', 'corrected', 'saved-rejected', 'retracted'])
    ('addresses the %s invoice notice and its context labels directly to the recipient', (action) => {
        notifyInvoice(action);
        expect(delivery).toHaveBeenCalledTimes(1);
        const [recipient, subject, content] = delivery.mock.calls[0];
        const message = content as StructuredEmailContent;
        expect(recipient).toEqual({name: 'Taylor', address: 'taylor@example.test'});
        expect(subject).toMatch(/^Your /u);
        expect(message.heading).toMatch(/^Your /u);
        expect(message.paragraphs!.join(' ')).toMatch(/your /u);
        expect(message.details).toContainEqual({label: 'Your invoice', value: '#7'});
        expect(message.details).toContainEqual({label: 'Your event', value: 'Shared trip'});
        expect(message.details).toContainEqual({label: 'Your invoice pool', value: 'Travel'});
        expect(message.action!.label).toBe('View your invoice history');
        // Ordinary content never calls the recipient a participant or payer; authored source values remain intact.
        expect(JSON.stringify(message)).not.toMatch(/this participant|the payer|this invoice/u);
        const rendered = renderEmail(subject, message, recipient);
        expect(rendered.text).toContain('Your invoice: #7');
        expect(rendered.html).toContain('View your invoice history');
    });

    it('addresses an organizer about their recorded invoice without implying event registration', () => {
        const invoice = savedInvoice();
        invoice.recordedByProfile = invoice.registration!.profile;
        invoice.registration = null as unknown as EventInvoice['registration'];
        notifyAcceptedInvoice(event, pool, invoice, null, null, session);
        const [recipient, subject, content] = delivery.mock.calls[0];
        expect(recipient.address).toBe('taylor@example.test');
        expect(subject).toBe('Your invoice accepted');
        expect((content as StructuredEmailContent).paragraphs).toContain(
            'An organizer reviewed and accepted your invoice. It will now be included in the invoice pool.');
    });

    it.each([-25, 25])('preserves signed settlement %s while directly addressing the payer', (shareAmount) => {
        const share = {registration: savedInvoice().registration, baseShareAmount: 75, extraAmount: 0,
            invoiceCreditAmount: 0, paymentCreditAmount: 75 - shareAmount, shareAmount, isPaid: false} as EventInvoiceShare;
        notifyShareSettlement(event, pool, share, true, session);
        const [, subject, content] = delivery.mock.calls[0];
        const message = content as StructuredEmailContent;
        expect(subject).toBe('Your payment status changed');
        expect(message.heading).toBe(`Your calculated balance: ${shareAmount.toFixed(2)} · ${shareAmount < 0 ? 'Refunded' : 'Paid'}`);
        expect(message.details).toContainEqual({label: 'Your recorded payment or refund', value: shareAmount.toFixed(2)});
        expect(message.details).toContainEqual({label: 'Your payment status', value: shareAmount < 0 ? 'Refunded' : 'Paid'});
        expect(share.isPaid).toBe(false);
    });

    it('names coverage relationships directly for each recipient and aggregates a reassignment once', async () => {
        const participants = [participant(1, 'Taylor'), participant(2, 'Casey'), participant(3, 'Jordan')];
        await notifyTakeoverChanges(event, pool, {added: [{payerId: 1, beneficiaryId: 2}],
            removed: [{payerId: 3, beneficiaryId: 2}]}, 'Organizer', participants);
        expect(delivery).toHaveBeenCalledTimes(3);
        for (const [recipient, subject, content] of delivery.mock.calls) {
            const message = content as StructuredEmailContent;
            expect(subject).toBe('Your payment coverage changed');
            expect(message.heading).toBe('Your payment coverage was updated');
            expect(message.paragraphs).toEqual(['Your payment responsibilities in this invoice pool have changed.']);
            const expected = recipient.name === 'Taylor' ? ['You are now covering Casey.']
                : recipient.name === 'Jordan' ? ['You are no longer covering Casey.']
                    : ['Taylor will now pay your share.', 'Jordan will no longer pay your share.'];
            expect(message.sections).toEqual([{title: 'What changed for you', items: expected}]);
            expect(message.details).toContainEqual({label: 'Your records updated by', value: 'Organizer'});
        }
    });

    it('uses recipient-specific frozen responsibility wording instead of the shared ledger description', () => {
        const person = participant(1, 'Taylor');
        const savedPool = {name: 'Travel', status: 'CLOSED', shares: [{registrationId: 1, baseShareAmount: 0,
            extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 25, shareAmount: -25, isPaid: false}],
            calculationSnapshot: {settledRegistrationIds: [1], assignments: [{registrationId: 1, isExempt: true}], takeovers: []},
        } as unknown as EventInvoicePool;
        expect(notifyPoolShareSettlements(event, savedPool, new Map([[1, person]]), 'responsibility-changed', session)).toEqual({count: 1});
        const [, subject, content] = delivery.mock.calls[0];
        const message = content as StructuredEmailContent;
        expect(subject).toBe('Your payment responsibility changed');
        expect(message.paragraphs).toContain('You are now exempt from the automatic base share. Your previously recorded payments or refunds stay with you in your saved share.');
        expect(JSON.stringify(message)).not.toContain('this participant');
    });

    it('keeps the actual recorded payer notes visible before the explanation without rewriting authored text', () => {
        const person = participant(1, 'Taylor');
        const note = 'Taylor: previous payment recorded • Author note <credit> & original wording';
        const savedPool = {name: 'Travel', status: 'CLOSED', shares: [{registrationId: 1, baseShareAmount: 75,
            extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: 25, isPaid: false, note}],
        } as unknown as EventInvoicePool;
        notifyPoolShareSettlements(event, savedPool, new Map([[1, person]]), 'requested', session);
        const [recipient, subject, content] = delivery.mock.calls[0];
        const message = content as StructuredEmailContent;
        expect(message.heading).toBe('Your calculated balance: 25.00 · Payment due');
        expect(message.sections).toEqual([{title: 'Saved calculation notes', items: [
            'Taylor: previous payment recorded', 'Author note <credit> & original wording',
        ]}]);
        expect(JSON.stringify(message.sectionGroups)).not.toContain('Author note');
        const rendered = renderEmail(subject, message, recipient);
        expect(rendered.text.indexOf('Author note <credit> & original wording'))
            .toBeLessThan(rendered.text.indexOf('Calculation explanation'));
        expect(rendered.html).toContain('Author note &lt;credit&gt; &amp; original wording');
        expect(savedPool.shares[0].note).toBe(note);
    });
});
