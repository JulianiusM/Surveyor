import {describe, expect, it} from 'vitest';
import {distributeInvoiceAmount, validateInvoiceFactor} from '../../src/modules/lib/invoiceDistribution';

describe('invoice distribution', () => {
    it('multiplies the distribution weight by each participant factor before normalizing', () => {
        expect(distributeInvoiceAmount(100, [
            {registrationId: 1, weight: 2, factor: 1.5},
            {registrationId: 2, weight: 4, factor: 0.5},
        ])).toEqual(new Map([[1, 60], [2, 40]]));
    });

    it.each([
        [100, true, 33.34],
        [100, false, 33.33],
        [-100, true, -33.33],
        [-100, false, -33.34],
    ] as const)('rounds every share of %s consistently with roundUpShares=%s', (total, roundUpShares, expected) => {
        const participants = [3, 1, 2].map((registrationId) => ({registrationId, weight: 1, factor: 1}));
        const allocation = distributeInvoiceAmount(total, participants, roundUpShares);
        expect([...allocation.values()]).toEqual([expected, expected, expected]);
        expect(distributeInvoiceAmount(total, participants.reverse(), roundUpShares)).toEqual(allocation);
    });

    it('defaults to rounding every participant upward without assigning spare cents by registration ID', () => {
        expect(distributeInvoiceAmount(0.01, [
            {registrationId: 10, weight: 1, factor: 1},
            {registrationId: 20, weight: 1, factor: 1},
        ])).toEqual(new Map([[10, 0.01], [20, 0.01]]));
    });

    it.each([true, false])('preserves exact cents despite decimal factor arithmetic when roundUpShares=%s', (roundUpShares) => {
        expect(distributeInvoiceAmount(0.07, [
            {registrationId: 1, weight: 1, factor: 0.1},
            {registrationId: 2, weight: 2, factor: 0.3},
        ], roundUpShares)).toEqual(new Map([[1, 0.01], [2, 0.06]]));
    });

    it.each([true, false])('keeps real fractions of a cent at the smallest allowed factor when roundUpShares=%s', (roundUpShares) => {
        expect(distributeInvoiceAmount(0.01, [
            {registrationId: 1, weight: 1, factor: 0.0001},
            {registrationId: 2, weight: 1, factor: 1000},
        ], roundUpShares)).toEqual(new Map([[1, roundUpShares ? 0.01 : 0], [2, roundUpShares ? 0.01 : 0]]));
    });

    it('allows zero factors without losing a cent to an excluded participant', () => {
        expect(distributeInvoiceAmount(0.01, [
            {registrationId: 1, weight: 1, factor: 0},
            {registrationId: 2, weight: 1, factor: 1},
        ])).toEqual(new Map([[2, 0.01], [1, 0]]));
    });

    it('rejects a nonzero total with no billable weight instead of silently dropping it', () => {
        expect(() => distributeInvoiceAmount(10, [])).toThrow('positive factor');
        expect(() => distributeInvoiceAmount(-10, [{registrationId: 1, weight: 0, factor: 1}])).toThrow('positive factor');
        expect(distributeInvoiceAmount(0, [])).toEqual(new Map());
    });

    it.each([-1, NaN, Infinity, 1000000, 1.00001])('rejects invalid factor %s', (factor) => {
        expect(() => validateInvoiceFactor(factor)).toThrow('Factors must');
    });
});
