import {describe, expect, it} from 'vitest';
import {collectSettledRegistrationIds, projectInvoiceShares} from '../../src/modules/invoice/settlements';
import {preparePoolCalculation} from '../../src/modules/invoice/calculation';
import {invoiceSettledShareImpact} from '../../src/modules/invoice/coverage';
import type {PreviousInvoiceShare} from '../../src/types/InvoicePoolTypes';
import type {EventInvoicePool} from '../../src/modules/database/entities/event/EventInvoicePool';
import type {EventRegistration} from '../../src/modules/database/entities/event/EventRegistration';
import type {ParticipantRow} from '../../src/types/EventTypes';

describe('active carried invoice settlements', () => {
    it('removes a former payer after their completed refund consumes their original payment', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 50, shareAmount: -50, isPaid: true,
            paidAt: new Date('2026-10-03T12:00:00Z')}];
        const before = structuredClone(previous);
        const projected = projectInvoiceShares(previous, [], [1]);
        expect(projected).toEqual([]);
        expect(collectSettledRegistrationIds(previous, [1])).toEqual([]);
        expect(projectInvoiceShares(projected, [], [1])).toEqual([]);
        expect(previous).toEqual(before);
    });

    it('removes a refund payer after a completed repayment nets their negative credit to zero', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: -25, shareAmount: 25, isPaid: true}];
        expect(collectSettledRegistrationIds(previous)).toEqual([]);
        expect(projectInvoiceShares(previous, [], [1])).toEqual([]);
    });

    it.each([50, -25])('keeps the signed %s credit and correcting balance until its transfer is recorded', (credit) => {
        const previous = [{registrationId: 1, paymentCreditAmount: credit, shareAmount: -credit, isPaid: false}];
        expect(collectSettledRegistrationIds(previous)).toEqual([1]);
        expect(projectInvoiceShares(previous, [], [1])).toMatchObject([
            {registrationId: 1, paymentCreditAmount: credit, shareAmount: -credit, isPaid: false},
        ]);
        expect(previous[0].isPaid).toBe(false);
    });

    it('preserves only the remaining credit after a correcting transfer consumes part of it', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 50, shareAmount: -20, isPaid: true}];
        expect(collectSettledRegistrationIds(previous)).toEqual([1]);
        expect(projectInvoiceShares(previous, [], [1])).toMatchObject([
            {registrationId: 1, paymentCreditAmount: 30, shareAmount: -30, isPaid: false},
        ]);
    });

    it('does not invent a recorded transfer from an automatic settled zero balance', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 0, shareAmount: 0, isPaid: true}];
        expect(collectSettledRegistrationIds(previous)).toEqual([]);
        expect(projectInvoiceShares(previous, [], [1])).toEqual([]);
    });

    it('does not keep a consumed legacy zero row alive from its recorded date', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 0, shareAmount: 0, isPaid: true,
            paidAt: new Date('2026-10-03T12:00:00Z')}];
        expect(collectSettledRegistrationIds(previous)).toEqual([]);
        expect(projectInvoiceShares(previous, [], [1])).toEqual([]);
    });

    it('uses integer cents before deciding whether opposing transfers have consumed the carried credit', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 0.3, shareAmount: -0.3, isPaid: true}];
        expect(collectSettledRegistrationIds(previous)).toEqual([]);
        expect(projectInvoiceShares(previous, [], [1])).toEqual([]);
    });

    it('orders active IDs deterministically and groups each payer’s cumulative signed evidence', () => {
        const previous = [{registrationId: 2, paymentCreditAmount: -5, shareAmount: 0, isPaid: false},
            {registrationId: 1, paymentCreditAmount: 30, shareAmount: -10, isPaid: true},
            {registrationId: 1, paymentCreditAmount: -20, shareAmount: 0, isPaid: false}];
        expect(collectSettledRegistrationIds(previous)).toEqual([2]);
        expect(collectSettledRegistrationIds([...previous].reverse())).toEqual([2]);
    });

    it('keeps a currently allocated exempt zero share normally after its correcting refund is complete', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 50, shareAmount: -50, isPaid: true,
            paidAt: new Date('2026-10-03T12:00:00Z')}];
        const allocation = [{registrationId: 1, baseShareAmount: 0, extraAmount: 0,
            invoiceCreditAmount: 0, shareAmount: 0, note: 'Saved exempt allocation'}];
        const projected = projectInvoiceShares(previous, allocation, [1]);
        expect(collectSettledRegistrationIds(previous)).toEqual([]);
        expect(projected).toMatchObject([{registrationId: 1, paymentCreditAmount: 0, shareAmount: 0,
            isPaid: true, paidAt: null, note: allocation[0].note}]);
        expect(projectInvoiceShares(projected, allocation, [1])).toEqual(projected);
    });

    it('preserves signed credit ownership when another payer assumes the current costs', () => {
        const previous: PreviousInvoiceShare[] = [{registrationId: 1, paymentCreditAmount: 0, shareAmount: 50, isPaid: true}];
        const projected = projectInvoiceShares(previous, [{registrationId: 2, baseShareAmount: 100,
            extraAmount: 0, invoiceCreditAmount: 0, shareAmount: 100}], [1, 2]);
        expect(projected).toMatchObject([
            {registrationId: 2, paymentCreditAmount: 0, shareAmount: 100, isPaid: false},
            {registrationId: 1, paymentCreditAmount: 50, shareAmount: -50, isPaid: false},
        ]);
    });

    it('keeps the existing hard-deleted registration boundary for both history and projected rows', () => {
        const previous = [{registrationId: 1, paymentCreditAmount: 50, shareAmount: -50, isPaid: false}];
        expect(collectSettledRegistrationIds(previous, [2])).toEqual([]);
        expect(projectInvoiceShares(previous, [], [2])).toEqual([]);
    });
});

describe('factual invoice calculation notes', () => {
    it('keeps an exempt participant’s actual nights instead of borrowing missing billable cost metadata', () => {
        const registrations = [{id: 1, arrivalDate: '2027-06-01', departureDate: '2027-06-04'},
            {id: 2, arrivalDate: '2027-06-01', departureDate: '2027-06-04'}] as EventRegistration[];
        const pool = {status: 'CLOSED', distributionMethod: 'NIGHTS', assignAll: true, subtractPersonalInvoices: false,
            assignments: [{registrationId: 1, registration: registrations[0], isExempt: true, factor: 1},
                {registrationId: 2, registration: registrations[1], isExempt: false, factor: 1}],
            invoices: [{status: 'APPROVED', amount: 60, registrationId: 2}], surcharges: [], takeovers: [],
        } as unknown as EventInvoicePool;
        const participants = [{id: 1, name: 'Exempt participant'}, {id: 2, name: 'Ordinary participant'}] as ParticipantRow[];
        const result = preparePoolCalculation(pool, participants, registrations);
        const exempt = result.sharePayloads.find(share => share.registrationId === 1)!;
        expect(exempt.baseShareAmount).toBe(0);
        expect(exempt.note).toContain('(for 3 nights)');
        expect(exempt.note).not.toContain('(no nights stayed)');
        expect(result.explanation.contributions.find(row => row.registrationId === 1)).toMatchObject({attendanceWeight: 3, isExempt: true});
    });
});

describe('frozen active carried-share responsibility', () => {
    it('uses applied covered attribution instead of the current pending payer', () => {
        const pool = {status: 'CLOSED', takeovers: [{payerRegistrationId: 3, beneficiaryRegistrationId: 1}],
            calculationSnapshot: {settledRegistrationIds: [1],
                takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}],
                assignments: [{registrationId: 1, isExempt: false}]}};
        expect(invoiceSettledShareImpact(pool, 1)).toEqual({registrationId: 1, reason: 'covered', payerRegistrationId: 2});
        expect(invoiceSettledShareImpact(pool, 2)).toBeNull();
    });

    it('uses a saved exemption and ignores a pending exemption that has not been applied', () => {
        expect(invoiceSettledShareImpact({status: 'CLOSED', calculationSnapshot: {settledRegistrationIds: [1],
            takeovers: [], assignments: [{registrationId: 1, isExempt: true}]}}, 1)).toEqual({registrationId: 1, reason: 'exempt'});
        expect(invoiceSettledShareImpact({status: 'CLOSED', calculationSnapshot: {settledRegistrationIds: [1],
            takeovers: [], assignments: [{registrationId: 1, isExempt: false}]}}, 1)).toBeNull();
    });

    it('requires active carried-settlement identity and a financially closed snapshot before showing an indicator', () => {
        expect(invoiceSettledShareImpact({status: 'CLOSED', calculationSnapshot: {
            takeovers: [], assignments: [{registrationId: 1, isExempt: true}]}}, 1)).toBeNull();
        expect(invoiceSettledShareImpact({status: 'OPEN', calculationSnapshot: {settledRegistrationIds: [1],
            takeovers: [], assignments: [{registrationId: 1, isExempt: true}]}}, 1)).toBeNull();
        expect(invoiceSettledShareImpact({status: 'CLOSED', calculationSnapshot: {settledRegistrationIds: [],
            takeovers: [], assignments: [{registrationId: 1, isExempt: true}]}}, 1)).toBeNull();
    });
});
