import {describe, expect, it, vi} from 'vitest';
import {FinanceApi} from '../../src/frontend/features/finance/api';
import {FrontendApi} from '../../src/frontend/app/api';
import {InvalidInputError} from '../../src/frontend/app/transport';
import {financeDecimal} from '../../src/frontend/features/finance/numbers';
import {contractValidator, operationContract} from '../../src/backend/modules/api/contracts';
import {formatInputDiagnostic} from '../../src/common/localization/inputValidation';
import {createTranslator} from '../../src/common/localization/translator';

describe('finance decimal transport preserves existing business inputs', () => {
    it.each(['calculation', 'settlement', 'retraction'] as const)('explains an invalid generated %s field before any request', async kind => {
        const request = vi.fn(async () => new Response('{}'));
        const api = new FinanceApi(new FrontendApi(() => true, vi.fn(), request));
        const scope = {context: null, csrfToken: null, epoch: 0, locale: 'en'};
        // These malformed internal drafts exercise the actual generated gates;
        // no request, validator or feature transport is replaced by the test.
        const result = kind === 'calculation'
            ? api.calculate('event', 'pool', {expectedRevision: -1, sendEmails: false}, false, scope)
            : kind === 'settlement'
                ? api.settlement('event', 'pool', 'share', {isPaid: 'yes' as unknown as boolean}, scope)
                : api.retract('event', 'pool', 'invoice', -1, scope);
        const error = await result.catch(failure => failure);
        expect(error).toBeInstanceOf(InvalidInputError);
        expect(request).not.toHaveBeenCalled();
        expect(error.diagnostic).toMatchObject({field: {label: kind === 'settlement'
            ? 'validation.fields.settlementStatus' : 'validation.fields.revision'}, rule: kind === 'settlement' ? 'type' : 'minimum'});
        for (const locale of ['en', 'de']) {
            const messages = createTranslator(locale);
            const explanation = formatInputDiagnostic(messages, error.diagnostic!);
            expect(explanation).toContain(messages.t(error.diagnostic!.field.label));
            expect(explanation).not.toContain('submitted values');
            expect(explanation).not.toContain('expectedRevision');
            expect(explanation).not.toContain('isPaid');
        }
    });

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

    it('preserves significant digits after long interior zero runs without rounding factors', () => {
        // A finite amount may have far more precision than JavaScript numbers.
        // Transport keeps that exact spelling, including the final nonzero digit.
        const draft = '1.' + '0'.repeat(30_000) + '1';
        expect(financeDecimal(draft + '000')).toBe(draft);
        expect(financeDecimal(draft + '000', 4)).toBe(draft);

        // Normalization must not turn excessive factor precision into acceptance.
        const validate = contractValidator('FinanceAssignmentsInput');
        expect(validate({isDefault: false, assignAll: false, subtractPersonalInvoices: true,
            registrations: ['7'], exemptions: [], participantFactors: {'7': financeDecimal(draft, 4)}})).toBe(false);
    });

    it('requires reviewed calculation evidence while retaining the existing settlement and optional-output contracts', () => {
        const calculation = contractValidator('FinanceCalculationInput');
        expect(calculation({expectedRevision: 7, sendEmails: false})).toBe(true);
        expect(calculation({sendEmails: false})).toBe(false);
        expect(calculation({expectedRevision: 7})).toBe(false);
        expect(calculation({expectedRevision: '7', sendEmails: true})).toBe(false);

        // Payment confirmation is a browser interaction, not a replacement financial revision protocol.
        const settlement = contractValidator('FinanceSettlementInput');
        expect(settlement({isPaid: true})).toBe(true);
        expect(settlement({isPaid: false})).toBe(true);
        expect(settlement({isPaid: 'true'})).toBe(false);
        expect(settlement({isPaid: true, expectedRevision: 7})).toBe(false);
        expect(operationContract('rollbackEventFinancePool').requestSchema).toBeNull();
        expect(operationContract('notifyEventFinancePool').requestSchema).toBeNull();
        for (const operation of ['closeEventFinancePool', 'recalculateEventFinancePool', 'settleEventFinanceShare',
            'rollbackEventFinancePool', 'notifyEventFinancePool'] as const) {
            expect(operationContract(operation).policy.retryPolicy).toBe('reconcile-only');
        }
    });
});
