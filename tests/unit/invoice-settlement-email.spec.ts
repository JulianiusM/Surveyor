import {describe, expect, it} from 'vitest';
import {buildInvoiceSettlementEmail, type InvoiceSettlementNotice} from '../../src/modules/lib/invoiceSettlementEmail';

function notice(share: Partial<InvoiceSettlementNotice['share']> = {}): InvoiceSettlementNotice {
    return {
        eventTitle: 'Shared trip', poolName: 'Travel', eventUrl: 'https://example.test/event/trip',
        actor: 'Organizer', reason: 'requested', needsRecalculation: false,
        share: {baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: 25, isPaid: false, ...share},
    };
}

describe('invoice settlement emails', () => {
    it.each([25, -25])('does not request money again for a settled payment or payout of %s', (shareAmount) => {
        const result = buildInvoiceSettlementEmail(notice({paymentCreditAmount: 75 - shareAmount, shareAmount, isPaid: true}));
        expect(result.heading).toBe('Your pool share is settled');
        expect(result.details).toContainEqual({label: 'Remaining to settle', value: '0.00'});
        expect(result.details).toContainEqual({label: 'Settled in this calculation', value: shareAmount.toFixed(2)});
        expect(result.details?.some(detail => ['Amount due', 'Amount owed to you'].includes(detail.label))).toBe(false);
    });

    it.each([
        [50, 25, 'You owe 25.00', 'Amount due'],
        [100, -25, 'You are owed 25.00', 'Amount owed to you'],
    ] as const)('reports the remaining balance after %s has already been settled', (paymentCreditAmount, shareAmount, heading, label) => {
        const result = buildInvoiceSettlementEmail(notice({paymentCreditAmount, shareAmount}));
        expect(result.heading).toBe(heading);
        expect(result.details).toContainEqual({label, value: '25.00'});
        expect(result.details).toContainEqual({label: 'Previously settled', value: paymentCreditAmount.toFixed(2)});
    });

    it('describes zero remaining balance as settled and identifies a saved calculation awaiting an update', () => {
        const result = buildInvoiceSettlementEmail({...notice({paymentCreditAmount: 75, shareAmount: 0}), needsRecalculation: true});
        expect(result.heading).toBe('Your pool share is settled');
        expect(result.details).toContainEqual({label: 'Remaining to settle', value: '0.00'});
        expect(result.notice).toContain('saved settlement');
        expect(result.notice).toContain('a new calculation may change the balance');
    });
});
