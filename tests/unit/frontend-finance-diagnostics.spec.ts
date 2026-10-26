import {describe, expect, it} from 'vitest';
import type {EventInvoicePool} from '../../src/backend/modules/database/entities/event/EventInvoicePool';
import type {EventRegistration} from '../../src/backend/modules/database/entities/event/EventRegistration';
import {preparePoolCalculation} from '../../src/backend/modules/invoice/calculation';
import {prepareTakeoverRequest, prepareSurchargeRequest, prepareOrganizerInvoice, prepareSubmittedInvoice,
    prepareInvoiceAcceptance, preparePoolAssignments} from '../../src/backend/modules/invoice/requests';
import {assertConfirmedInvoiceChange, assertPositiveInvoiceAmount} from '../../src/backend/modules/invoice/validation';
import {invoiceText} from '../../src/backend/modules/invoice/wording';
import {APIError} from '../../src/backend/modules/lib/errors';
import {classifyApiError, validatedProblemBody} from '../../src/backend/modules/api/problem';

/** Exercise actual domain rejections and their transport projection together.
 * Pure calculation/request inputs need no persistence or replacement services. */
function rejection(operation: () => unknown): APIError {
    try { operation(); } catch (error) {
        expect(error).toBeInstanceOf(APIError);
        return error as APIError;
    }
    throw new Error('Expected the Finance operation to reject');
}

describe('Finance user-facing rejection identities', () => {
    it('explains an empty pool without changing its native message, status or calculation state', () => {
        const pool = {status: 'OPEN', assignAll: true, invoices: []} as unknown as EventInvoicePool;
        const error = rejection(() => preparePoolCalculation(pool, [], []));
        expect(error.message).toBe(invoiceText('noParticipantsAssignedToThisPool'));
        expect(error.status).toBe(400);
        expect(error.data).toEqual({});
        expect(pool.status).toBe('OPEN');

        const problem = classifyApiError(error);
        expect(problem.code).toBe('FINANCE_NO_PARTICIPANTS_ASSIGNED_TO_THIS_POOL_400');
        for (const locale of ['en', 'de']) {
            const body = validatedProblemBody(problem, locale, 'empty-pool');
            expect(body.messageKey).toBe('finance.noParticipantsAssignedToThisPool');
            expect(body.params).toEqual({});
            expect(body.detail).not.toContain('submitted values');
            expect(body.detail).not.toContain('finance.');
            expect(body.detail.length).toBeGreaterThan(15);
        }
    });

    it('keeps stale financial review a definite conflict with an actionable reason', () => {
        const pool = {calculationRevision: 7} as EventInvoicePool;
        const error = rejection(() => assertConfirmedInvoiceChange(pool, {confirmed: true, expectedRevision: 6}));
        expect(error.status).toBe(409);
        expect(error.message).toBe(invoiceText('thePoolChangedReloadAndReviewTheInvoiceAgain'));
        expect(classifyApiError(error).code).toBe('FINANCE_THE_POOL_CHANGED_RELOAD_AND_REVIEW_THE_INVOICE_AGAIN_409');
    });

    it('names the positive amount rule instead of a generic submitted-values error', () => {
        const error = rejection(() => assertPositiveInvoiceAmount(0));
        expect(error.status).toBe(400);
        expect(classifyApiError(error).code).toBe('FINANCE_ENTER_APOSITIVE_AMOUNT_WITH_AT_MOST_TWO_DECIMAL_400');
    });

    it('explains an unavailable payer from the existing pool membership check', () => {
        const pool = {assignAll: true, takeovers: []} as unknown as EventInvoicePool;
        const registrations = [{id: 1}] as EventRegistration[];
        const error = rejection(() => prepareTakeoverRequest(pool, {payerId: 2, beneficiaries: []}, registrations, 1, true));
        expect(error.message).toBe(invoiceText('payerIsNotPartOfThisPool'));
        expect(classifyApiError(error).code).toBe('FINANCE_PAYER_IS_NOT_PART_OF_THIS_POOL_400');
    });

    it('preserves a specific allocator reason when a nonzero cost has no positive share weight', () => {
        const registrations = [{id: 1, arrivalDate: '2027-06-01', departureDate: '2027-06-03'}] as EventRegistration[];
        const pool = {status: 'OPEN', assignAll: true, distributionMethod: 'EQUAL', invoices: [{status: 'APPROVED', amount: 10}],
            assignments: [{registrationId: 1, factor: 0}], surcharges: [], takeovers: [], roundUpShares: true} as unknown as EventInvoicePool;
        const error = rejection(() => preparePoolCalculation(pool, [], registrations));
        expect(error.message).toBe(invoiceText('noPositiveDistributionWeight'));
        expect(classifyApiError(error).code).toBe('FINANCE_NO_POSITIVE_DISTRIBUTION_WEIGHT_400');
    });

    it('explains existing signed-adjustment precision and range constraints without tightening other invoice inputs', () => {
        const error = rejection(() => prepareSurchargeRequest({registrationId: 1, amount: 1.001, note: 'Saved rebate', subtractFromPool: true}));
        expect(error.status).toBe(400);
        expect(classifyApiError(error).code).toBe('FINANCE_ADJUSTMENT_AMOUNT_INVALID_400');
        // Initial participant submission and acceptance retain their existing
        // normalization contract; the new diagnostic adds no precision rule.
        expect(prepareSubmittedInvoice({amount: 1.001}).amount).toBe(1.001);
        expect(prepareInvoiceAcceptance({correctedAmount: 1.001}).correctedAmount).toBe(1.001);
    });

    it('distinguishes an oversized organizer amount from a nonpositive participant amount', () => {
        const oversized = rejection(() => prepareOrganizerInvoice({amount: 100_000_000, description: 'Organizer expense'}));
        expect(classifyApiError(oversized).code).toBe('FINANCE_INVOICE_AMOUNT_TOO_LARGE_400');
        const nonpositive = rejection(() => prepareSubmittedInvoice({amount: -1}));
        expect(classifyApiError(nonpositive).code).toBe('FINANCE_INVOICE_AMOUNT_MUST_BE_POSITIVE_400');
    });

    it('identifies an out-of-range share factor from Joi rule metadata without disclosing a participant identifier', () => {
        const pool = {assignAll: true, subtractPersonalInvoices: true} as EventInvoicePool;
        const error = rejection(() => preparePoolAssignments(pool, {participantFactors: {'1': 1001}}, []));
        const problem = validatedProblemBody(classifyApiError(error), 'de', 'invalid-factor');
        expect(problem).toMatchObject({code: 'FINANCE_FACTORS_MUST_BE_BETWEEN_AND_WITH_AT_MOST_FOUR_400',
            messageKey: 'finance.factorsMustBeBetweenAndWithAtMostFour', params: {}, status: 400});
        expect(problem).not.toHaveProperty('fieldErrors');
        expect(problem.detail).toContain('1000');
    });
});
