import {describe, expect, it} from 'vitest';
import {distributeInvoiceAmount, validateInvoiceFactor} from '../../src/modules/invoice/distribution';
import {buildPoolCalculationPreview, preparePoolCalculation} from '../../src/modules/invoice/calculation';
import type {EventInvoicePool} from '../../src/modules/database/entities/event/EventInvoicePool';
import type {EventRegistration} from '../../src/modules/database/entities/event/EventRegistration';
import type {ParticipantRow} from '../../src/types/EventTypes';

/** Supply real calculation inputs without repeatedly persisting an unchanged 28-person roster. */
function createRosterCalculation(mixedStays: boolean, roundUpShares: boolean) {
    // A..Z, AA, AB. The first scenario assumes four nights except E; the second
    // includes short stays, a fractional factor and an exempt four-night member.
    const nights = mixedStays
        ? [4,4,4,4,4,4,1,4,4,4,2,4,4,4,4,4,2,4,4,4,4,4,3,4,2,3,4,1]
        : Array.from({length: 28}, (_, index) => index === 4 ? 3 : 4);
    const registrations = nights.map((stay, index) => ({id: index + 1,
        arrivalDate: '2027-06-01', departureDate: `2027-06-0${1 + stay}`})) as EventRegistration[];
    const participants = registrations.map(registration => ({id: registration.id,
        name: `Roster participant ${registration.id}`})) as ParticipantRow[];
    const ids = registrations.map(registration => registration.id);
    const adjustments = mixedStays
        ? [[0, -5, true], [25, -5, true], [1, -5, true], [1, 10, true], [16, 20, false]] as const
        : [[0, -5, true], [4, -5, true], [4, 20, false], [9, -5, true], [9, 10, true]] as const;
    const coverage = mixedStays ? [[0, 25], [3, 5], [3, 11]] : [[0, 4], [1, 11], [1, 7]];
    const pool = {status: 'OPEN', distributionMethod: 'NIGHTS', assignAll: true,
        subtractPersonalInvoices: true, roundUpShares, shares: [],
        assignments: registrations.map((registration, index) => ({registration, registrationId: registration.id,
            factor: index === 0 ? 2 : mixedStays && index === 5 ? 0.75 : 1,
            isExempt: mixedStays && index === 12})),
        invoices: [{id: 1, status: 'APPROVED', amount: 1000, registrationId: ids[0]}],
        surcharges: adjustments.map(([index, amount, subtractFromPool]) => ({registrationId: ids[index], amount,
            subtractFromPool, note: 'Roster adjustment'})),
        takeovers: coverage.map(([payer, beneficiary]) => ({payerRegistrationId: ids[payer], beneficiaryRegistrationId: ids[beneficiary]})),
    } as unknown as EventInvoicePool;
    return {pool, registrations, participants, ids, nights};
}

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

    it.each([true, false])('reconciles the complete 28-person four-night scenario with roundUpShares=%s', (roundUpShares) => {
        const {pool, registrations, participants, ids} = createRosterCalculation(false, roundUpShares);
        // Independent arithmetic: 115 weighted nights, shared 1000 - (-5) = 1005, adjustments +15.
        const expected = roundUpShares
            ? {base: 1005.10, gross: 1020.10, net: 20.10, difference: 0.10, aBase: 96.14, aNet: -893.86, b: 104.88, j: 39.96, other: 34.96}
            : {base: 1004.82, gross: 1019.82, net: 19.82, difference: -0.18, aBase: 96.12, aNet: -893.88, b: 104.85, j: 39.95, other: 34.95};
        const preview = buildPoolCalculationPreview(pool, participants, registrations);
        expect(preview.roundUpShares).toBe(roundUpShares);
        expect(preview.totals).toMatchObject({invoiceAmount: 1000, redistributedAmount: -5, distributableAmount: 1005,
            allocatedBaseAmount: expected.base, roundingDifference: expected.difference,
            adjustmentAmount: 15, grossAmount: expected.gross, invoiceCreditAmount: 1000,
            expectedNetAmount: 20, calculatedAmount: expected.net});
        expect(preview.explanation).toMatchObject({assignedParticipants: 28, exemptParticipants: 0,
            attendanceUnits: 111, eligibleAttendanceUnits: 111, effectiveWeight: 115,
            distributableAmount: 1005, distributionMethod: 'NIGHTS', roundUpShares});
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[0]))
            .toMatchObject({attendanceWeight: 4, factor: 2, effectiveWeight: 8, payerRegistrationId: ids[0]});
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[4]))
            .toMatchObject({attendanceWeight: 3, factor: 1, effectiveWeight: 3, payerRegistrationId: ids[0]});

        // Test the actual payload builder used by commit, including complete covered shares.
        const shares = preparePoolCalculation(pool, participants, registrations).sharePayloads;
        expect(shares).toHaveLength(25);
        expect(shares.find(share => share.registrationId === ids[0])).toMatchObject({baseShareAmount: expected.aBase,
            extraAmount: 10, invoiceCreditAmount: 1000, shareAmount: expected.aNet});
        expect(shares.find(share => share.registrationId === ids[1])!.shareAmount).toBe(expected.b);
        expect(shares.find(share => share.registrationId === ids[9])!.shareAmount).toBe(expected.j);
        const ordinary = shares.filter(share => ![ids[0], ids[1], ids[9]].includes(share.registrationId));
        expect(ordinary).toHaveLength(22);
        expect(ordinary.every(share => share.shareAmount === expected.other)).toBe(true);
        expect(shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.net * 100));

        // The credit switch must leave the already combined base and adjustments unchanged.
        pool.subtractPersonalInvoices = false;
        const withoutCredit = preparePoolCalculation(pool, participants, registrations).sharePayloads;
        expect(withoutCredit.find(share => share.registrationId === ids[0])).toMatchObject({baseShareAmount: expected.aBase,
            extraAmount: 10, invoiceCreditAmount: 0});
        expect(withoutCredit.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.gross * 100));
    });

    it.each([true, false])('reconciles the complete mixed-stay roster with an exemption and roundUpShares=%s', (roundUpShares) => {
        const {pool, registrations, participants, ids, nights} = createRosterCalculation(true, roundUpShares);
        const expected = roundUpShares
            ? {base: 1005.19, net: 20.19, difference: 0.19, aBase: 113.98, a: -896.02, b: 113.99, j: 46.45, additional: 40.73, ordinary: 41.45}
            : {base: 1004.92, net: 19.92, difference: -0.08, aBase: 113.96, a: -896.04, b: 113.96, j: 46.44, additional: 40.72, ordinary: 41.44};
        // 97 weighted nights; A's 8+3 and B's 4+3+4 round per beneficiary before combining.
        const preview = buildPoolCalculationPreview(pool, participants, registrations);
        expect(preview.totals).toMatchObject({distributableAmount: 1005, allocatedBaseAmount: expected.base,
            adjustmentAmount: 15, invoiceCreditAmount: 1000, expectedNetAmount: 20,
            roundingDifference: expected.difference, calculatedAmount: expected.net});
        expect(preview.explanation).toMatchObject({assignedParticipants: 28, exemptParticipants: 1,
            attendanceUnits: 98, eligibleAttendanceUnits: 94, effectiveWeight: 97});
        expect(preview.explanation.contributions.find(row => row.registrationId === ids[12]))
            .toMatchObject({isExempt: true, attendanceWeight: 4, effectiveWeight: 0, baseShareAmount: 0});
        const shares = preparePoolCalculation(pool, participants, registrations).sharePayloads;
        expect(shares.find(share => share.registrationId === ids[0])).toMatchObject({baseShareAmount: expected.aBase,
            extraAmount: -10, invoiceCreditAmount: 1000, shareAmount: expected.a});
        expect(shares.find(share => share.registrationId === ids[3])!.shareAmount).toBe(expected.b);
        expect(shares.find(share => share.registrationId === ids[1])!.shareAmount).toBe(expected.j);
        expect(shares.find(share => share.registrationId === ids[16])!.shareAmount).toBe(expected.additional);
        expect(shares.find(share => share.registrationId === ids[12])).toMatchObject({baseShareAmount: 0, shareAmount: 0});
        const ordinaryIds = ids.filter((_, index) => nights[index] === 4 && ![0, 1, 3, 5, 11, 12].includes(index));
        expect(shares.filter(share => ordinaryIds.includes(share.registrationId)).every(share => share.baseShareAmount === expected.ordinary)).toBe(true);
        expect(shares.reduce((sum, share) => sum + Math.round(share.shareAmount * 100), 0)).toBe(Math.round(expected.net * 100));
    });
});
