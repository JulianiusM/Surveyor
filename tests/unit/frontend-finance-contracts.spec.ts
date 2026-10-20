import {describe, expect, it} from 'vitest';
import {financeDecimal} from '../../src/frontend/features/finance/numbers';
import {contractValidator} from '../../src/modules/api/contracts';

describe('finance decimal transport preserves existing business inputs', () => {
    it('retains amount precision while normalizing only transport spelling', () => {
        const validate = contractValidator('FinanceInvoiceInput');
        for (const [draft, expected] of [
            ['0013.5000', '13.5'], ['0.00123', '0.00123'], ['1.234567890123456789', '1.234567890123456789'],
            ['1.2345e-3', '0.0012345'], ['1e3', '1000'],
        ]) {
            const amount = financeDecimal(draft!);
            expect(amount).toBe(expected);
            expect(validate({amount})).toBe(true);
        }
        // JSON numbers are the superseded wire representation, not a second
        // accepted API shape. Semantic invoice validation still belongs server-side.
        expect(validate({amount: 13.5})).toBe(false);
    });

    it('uses four-place factor strings without rounding an invalid factor into acceptance', () => {
        const validate = contractValidator('FinanceAssignmentsInput');
        const input = {isDefault: false, assignAll: false, subtractPersonalInvoices: true,
            registrations: ['7'], exemptions: [], participantFactors: {'7': financeDecimal('002.5000', 4)}};
        expect(input.participantFactors['7']).toBe('2.5000');
        expect(financeDecimal('0', 4)).toBe('0.0000');
        expect(financeDecimal('0e999', 4)).toBe('0.0000');
        expect(financeDecimal('1' + '0'.repeat(400) + 'e-400', 4)).toBe('1.0000');
        expect(financeDecimal('1e-999', 4)).toBe('0.0000');
        expect(validate(input)).toBe(true);
        expect(validate({...input, participantFactors: {'7': financeDecimal('1.00001', 4)}})).toBe(false);
        expect(validate({...input, registrations: [7]})).toBe(false);
        expect(validate({...input, participantFactors: {'7': 2.5}})).toBe(false);
    });
});
