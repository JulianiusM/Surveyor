import {describe, expect, it} from 'vitest';
import {formatInvoiceMoney, invoiceAdjustmentRows, invoiceCalculationLines, invoicePayerCalculation, invoiceBalanceCaption,
    invoicePoolCalculation, invoicePoolCalculationBreakdown, invoicePoolSummary, invoiceSettlementRows, invoiceShareColumns,
    invoiceShareComponents, presentInvoiceShare, sumInvoiceAdjustments, invoiceSettledShareNotice} from '../../src/modules/invoice/presentation';
import {getInvoiceCatalog, invoiceText} from '../../src/modules/invoice/wording';
import {invoiceAppliedTakeovers, invoiceHasPendingTakeovers, invoiceHasAppliedTakeoverEvidence} from '../../src/modules/invoice/coverage';
import type {InvoiceAdjustmentInput, InvoiceCalculationExplanation, InvoiceCalculationShare,
    InvoicePoolSummaryInput, InvoiceAppliedTakeoversInput, InvoiceCalculationOverview} from '../../src/types/InvoicePoolTypes';

/** Protect the global figures-only contract independently of which saved features supply its metrics. */
function expectFiguresOnly(overview: InvoiceCalculationOverview): void {
    expect(Object.keys(overview).sort()).toEqual(['sections', 'title']);
    // Reject explanatory fields even if a renderer currently ignores them; every consumer shares this boundary.
    for (const section of overview.sections) {
        expect(Object.keys(section).sort()).toEqual(['key', 'metrics', 'title']);
        expect(section.metrics.length).toBeGreaterThan(0);
        for (const metric of section.metrics) {
            expect(Object.keys(metric).sort()).toEqual(['label', 'value']);
            expect(typeof metric.label).toBe('string');
            expect(typeof metric.value).toBe('string');
        }
    }
}

/** Supply saved contribution evidence independently from the presenter being exercised. */
function calculationExplanation(): InvoiceCalculationExplanation {
    return {
        version: 1, distributionMethod: 'NIGHTS', roundUpShares: true,
        invoiceAmount: 100, redistributedAmount: 0, distributableAmount: 100,
        assignedParticipants: 2, exemptParticipants: 0, attendanceUnits: 5, eligibleAttendanceUnits: 5,
        effectiveWeight: 8, weightDenominator: '80000',
        contributions: [
            {registrationId: 1, payerRegistrationId: 1, name: 'Private payer name', attendanceWeight: 3,
                factor: 2, isExempt: false, effectiveWeight: 6, weightNumerator: '60000', baseShareAmount: 75},
            {registrationId: 2, payerRegistrationId: 2, name: 'Another private name', attendanceWeight: 2,
                factor: 1, isExempt: false, effectiveWeight: 2, weightNumerator: '20000', baseShareAmount: 25},
        ],
    };
}

/** Keep the saved balance explicit instead of recomputing it in the fixture. */
function calculationShare(overrides: Partial<InvoiceCalculationShare> = {}): InvoiceCalculationShare {
    return {registrationId: 1, baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0,
        paymentCreditAmount: 0, shareAmount: 75, ...overrides};
}

/** Supply two ordinary payers so selection tests can isolate the feature they intentionally introduce. */
function ordinaryCalculationExplanation(): InvoiceCalculationExplanation {
    const explanation = calculationExplanation();
    explanation.effectiveWeight = 5;
    explanation.weightDenominator = '50000';
    Object.assign(explanation.contributions[0], {factor: 1, effectiveWeight: 3,
        weightNumerator: '30000', baseShareAmount: 60});
    explanation.contributions[1].baseShareAmount = 40;
    return explanation;
}

describe('invoice presentation', () => {
    it.each([
        {shareAmount: 25, isPaid: false, organizer: 'Amount to collect', participant: 'Amount to pay'},
        {shareAmount: -25, isPaid: false, organizer: 'Amount to pay out', participant: 'Refund to receive'},
        {shareAmount: '25.00', isPaid: 1, organizer: 'Already settled', participant: 'Already settled'},
        {shareAmount: '-25.00', isPaid: true, organizer: 'Already settled', participant: 'Already settled'},
        {shareAmount: 0, isPaid: false, organizer: 'No payment due', participant: 'No payment due'},
        {shareAmount: 0, isPaid: true, organizer: 'Already settled', participant: 'Already settled'},
    ])('describes saved balance $shareAmount with settlement=$isPaid from each viewer role', (scenario) => {
        const share = {shareAmount: scenario.shareAmount, isPaid: scenario.isPaid};
        const before = structuredClone(share);
        // Only these two saved fields are required; no gross or remaining total is reconstructed for a caption.
        expect(invoiceBalanceCaption(share, 'organizer')).toBe(scenario.organizer);
        expect(invoiceBalanceCaption(share, 'participant')).toBe(scenario.participant);
        expect(share).toEqual(before);
    });

    it.each([
        [25, false, 'Payment due', 'Record payment'],
        [-25, false, 'Refund due', 'Record refund'],
        [25, true, 'Paid', 'Undo payment'],
        [-25, true, 'Refunded', 'Undo refund'],
        [0, false, 'No payment', 'Record payment'],
    ] as const)('keeps calculated balance %s visible with paid=%s', (balance, isPaid, status, action) => {
        const share = {baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: 75 - balance, shareAmount: balance, isPaid};
        const before = structuredClone(share);
        const result = presentInvoiceShare(share);
        expect(result.originalBalance).toBe(balance);
        expect(result.calculatedAmount).toBe(75);
        expect(result.settledAmount).toBe(isPaid ? balance : 0);
        expect(result.remainingAmount).toBe(isPaid ? 0 : balance);
        expect(result.statusLabel).toBe(status);
        expect(result.actionLabel).toBe(action);
        expect(share).toEqual(before);
    });

    it('preserves signed refunds and normalizes negative zero', () => {
        expect(formatInvoiceMoney(-99999999.99)).toBe('-99999999.99');
        expect(formatInvoiceMoney(-0)).toBe('0.00');
        expect(formatInvoiceMoney(-0.001)).toBe('0.00');
    });
});

describe('adaptive invoice amounts', () => {
    it('keeps redistributed and on-top surcharges and rebates distinct when their net totals cancel', () => {
        const adjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 1, amount: '10.00', subtractFromPool: true},
            {registrationId: 2, amount: -10, subtractFromPool: true},
            {registrationId: 1, amount: 5, subtractFromPool: false},
            {registrationId: 2, amount: '-5.00', subtractFromPool: false},
        ];
        const before = structuredClone(adjustments);
        const totals = sumInvoiceAdjustments(adjustments);
        expect(totals).toEqual({redistributedSurcharges: 10, redistributedRebates: -10,
            additionalSurcharges: 5, additionalRebates: -5});
        expect(invoiceAdjustmentRows(totals)).toEqual(invoiceAdjustmentRows(adjustments));
        expect(invoiceAdjustmentRows(totals).map(row => [row.key, row.amount])).toEqual([
            ['redistributedSurcharges', 10], ['redistributedRebates', -10],
            ['additionalSurcharges', 5], ['additionalRebates', -5],
        ]);
        expect(adjustments).toEqual(before);
    });

    it('omits unused adjustment categories while retaining signed rebate totals', () => {
        const rows = invoiceAdjustmentRows([{registrationId: 1, amount: '-2.50', subtractFromPool: false}]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({key: 'additionalRebates', amount: -2.5});
        expect(invoiceAdjustmentRows([])).toEqual([]);
    });

    it('selects financial columns from the actual shares and keeps the calculated balance for credit-only payers', () => {
        const simple = invoiceShareColumns([calculationShare()]);
        expect(simple.map(column => column.key)).toEqual(['baseShareAmount', 'shareAmount']);
        const refund = invoiceShareColumns([calculationShare({baseShareAmount: 0, paymentCreditAmount: 25, shareAmount: -25})]);
        expect(refund.map(column => column.key)).toEqual(['paymentCreditAmount', 'shareAmount']);
        expect(invoiceShareColumns([]).map(column => column.key)).toEqual(['shareAmount']);
    });

    it('retains a component column whenever any saved payer uses it, including decimal-string amounts', () => {
        const columns = invoiceShareColumns([
            calculationShare(),
            calculationShare({registrationId: 2, baseShareAmount: '25.00', extraAmount: '-5.00',
                invoiceCreditAmount: '10.00', paymentCreditAmount: '-15.00', shareAmount: '25.00'}),
        ]);
        expect(columns.map(column => column.key)).toEqual([
            'baseShareAmount', 'extraAmount', 'invoiceCreditAmount', 'paymentCreditAmount', 'shareAmount',
        ]);
    });

    it('shows only the personal components used by a plain share', () => {
        const components = invoiceShareComponents(calculationShare());
        expect(components.map(component => component.key)).toEqual(['baseShareAmount', 'shareAmount']);
        expect(components[0].amount).toBe(75);
    });

    it('attributes covered adjustments to their payer and keeps cancelling categories visible in the breakdown', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        const adjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 1, amount: 10, subtractFromPool: true},
            {registrationId: 2, amount: -10, subtractFromPool: false},
            {registrationId: 99, amount: 50, subtractFromPool: false},
        ];
        const components = invoiceShareComponents(calculationShare({baseShareAmount: 100, shareAmount: 100}), explanation, adjustments);
        expect(components.map(component => [component.key, component.amount])).toEqual([
            ['baseShareAmount', 100], ['redistributedSurcharges', 10], ['additionalRebates', -10], ['shareAmount', 100],
        ]);
    });

    it('uses the saved net adjustment when its historical category provenance is unavailable', () => {
        const components = invoiceShareComponents(calculationShare({extraAmount: -5, shareAmount: 70}), calculationExplanation());
        expect(components.map(component => [component.key, component.amount])).toEqual([
            ['baseShareAmount', 75], ['extraAmount', -5], ['shareAmount', 70],
        ]);
    });

    it('does not replace a saved adjustment with source categories whose amounts fail to reconcile', () => {
        const components = invoiceShareComponents(calculationShare({extraAmount: -5, shareAmount: 70}),
            calculationExplanation(), [{registrationId: 1, amount: 20, subtractFromPool: true}]);
        expect(components.map(component => [component.key, component.amount])).toEqual([
            ['baseShareAmount', 75], ['extraAmount', -5], ['shareAmount', 70],
        ]);
    });
});

describe('shared invoice calculation explanation', () => {
    it('structures an anonymous example with saved attendance, factors, divisor and rounded base', () => {
        const explanation = calculationExplanation();
        const share = calculationShare();
        const before = structuredClone({explanation, share});
        const display = invoicePoolCalculation(explanation, [share]);
        expect(display.title).toBe('Example calculation');
        expect(display.description).toContain('example name');
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule', 'base-1']);
        expect(display.sections.find(section => section.key === 'base-1')).toMatchObject({title: 'Base share for Participant A', formula: {
            terms: [
                {label: 'Base to distribute', value: '100.00'},
                {label: 'Nights stayed', value: '3', operator: '×'},
                {label: 'Share factor', value: '2', operator: '×'},
                {label: 'Total weight', value: '8', operator: '÷'},
            ],
            result: {label: 'Base share', value: '75.00'}, note: 'Rounded up to cents.',
        }});
        const text = JSON.stringify(display);
        expect(text).not.toContain('Private payer name');
        expect(text).not.toContain('Another private name');
        expect(text).not.toMatch(/surcharges|rebates|invoice credit|previously settled|covered|exempt/iu);
        expect({explanation, share}).toEqual(before);
    });

    it('chooses an example only from the supplied saved payer set', () => {
        const display = invoicePoolCalculation(calculationExplanation(), [calculationShare({registrationId: 2,
            baseShareAmount: 25, shareAmount: 25})]);
        expect(display.sections.find(section => section.key === 'base-2')!.formula!.result.value).toBe('25.00');
        expect(display.sections.some(section => section.key === 'base-1')).toBe(false);
        expect(JSON.stringify(display)).not.toMatch(/75\.00|Private payer name|Another private name/u);
    });

    it('does not substitute another payer contribution for a former payer with only a settlement credit', () => {
        const display = invoicePoolCalculation(calculationExplanation(), [calculationShare({registrationId: 99,
            baseShareAmount: 0, paymentCreditAmount: 15, shareAmount: -15})]);
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule']);
        expect(display.description).toBe(invoiceText('poolCalculationCostExampleCaption'));
        const text = JSON.stringify(display);
        expect(text).not.toContain('-15.00');
        expect(text).not.toContain('75.00');
        expect(text).not.toContain('25.00');
        expect(text).not.toContain('Private payer name');
        expect(text).not.toContain('Another private name');
    });

    it('does not demonstrate a contributor when the supplied saved-share list is empty', () => {
        const display = invoicePoolCalculation(calculationExplanation(), []);
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule']);
        expect(JSON.stringify(display)).not.toMatch(/75\.00|25\.00|Nights stayed|Private payer name|Another private name/u);
    });

    it('uses one example name for a participant who also pays their own balance', () => {
        const display = invoicePoolCalculation(calculationExplanation(), [calculationShare({extraAmount: 5, shareAmount: 80})]);
        expect(display.sections.find(section => section.key === 'base-1')!.title).toBe('Base share for Participant A');
        expect(display.sections.find(section => section.key === 'balance')!.title).toContain('Participant A');
        expect(JSON.stringify(display)).not.toContain('Payer A');
    });

    it('keeps takeover names fictional in the one worked pool example', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 100,
            paymentCreditAmount: 25, shareAmount: 75})]);
        expect(display.sections.filter(section => section.key.startsWith('base-'))).toHaveLength(1);
        expect(display.sections.find(section => section.key === 'coverage')!.formula!.terms.map(term => term.value)).toEqual(['75.00', '25.00']);
        expect(display.sections.find(section => section.key === 'balance')!.title).toContain('Payer A');
        expect(display.description).toContain('Payer A is an example payer who covers 1 other participant.');
        expect(JSON.stringify(display)).not.toMatch(/Private payer name|Another private name/u);
    });

    it('uses frozen adjustment sources to explain a legacy base changed by redistributed surcharges and rebates', () => {
        const explanation = calculationExplanation();
        explanation.redistributedAmount = 10;
        explanation.distributableAmount = 90;
        explanation.contributions[0].baseShareAmount = 67.5;
        explanation.contributions[1].baseShareAmount = 22.5;
        const savedAdjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 1, amount: 20, subtractFromPool: true},
            {registrationId: 2, amount: -10, subtractFromPool: true},
            {registrationId: 1, amount: 5, subtractFromPool: false},
        ];
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 67.5,
            extraAmount: 25, shareAmount: 92.5})], savedAdjustments);
        expect(display.sections.find(section => section.key === 'costs')!.formula).toEqual({
            terms: [{label: 'Invoice costs', value: '100.00'},
                {label: 'Redistributed surcharges', value: '20.00', operator: '−'},
                {label: 'Redistributed rebates', value: '-10.00', operator: '−'}],
            result: {label: 'Base to distribute', value: '90.00'},
        });
        expect(display.sections.find(section => section.key === 'on-top')!.formula).toEqual({
            terms: [{label: 'Invoice costs', value: '100.00'},
                {label: 'On-top surcharges', value: '5.00', operator: '+'}],
            result: {label: 'Full pool total', value: '105.00'},
        });
        expect(JSON.stringify(display)).not.toMatch(/on-top rebates/iu);
    });

    it('explains redistributed categories even when they cancel and the base equals the invoice total', () => {
        const explanation = calculationExplanation();
        explanation.adjustmentTotals = {redistributedSurcharges: 10, redistributedRebates: -10,
            additionalSurcharges: 0, additionalRebates: 0};
        const display = invoicePoolCalculation(explanation, [calculationShare()]);
        const costs = display.sections.find(section => section.key === 'costs')!;
        expect(costs.formula!.terms.map(term => [term.label, term.value])).toEqual([
            ['Invoice costs', '100.00'], ['Redistributed surcharges', '10.00'], ['Redistributed rebates', '-10.00'],
        ]);
        expect(costs.formula!.result.value).toBe('100.00');
        expect(display.sections.some(section => section.key === 'on-top')).toBe(false);
    });

    it('omits attendance and factor steps unused by a plain equal-share pool', () => {
        const explanation = calculationExplanation();
        explanation.distributionMethod = 'EQUAL';
        explanation.attendanceUnits = 2;
        explanation.eligibleAttendanceUnits = 2;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        for (const contribution of explanation.contributions) {
            contribution.attendanceWeight = 1;
            contribution.factor = 1;
            contribution.effectiveWeight = 1;
            contribution.weightNumerator = '10000';
            contribution.baseShareAmount = 50;
        }
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 50, shareAmount: 50})]);
        expect(display.sections.find(section => section.key === 'base-1')!.formula!.terms).toEqual([
            {label: 'Base to distribute', value: '100.00'}, {label: 'Eligible participants', value: '2', operator: '÷'},
        ]);
        const context = invoicePoolCalculationBreakdown(explanation, []);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'attendance')!.metrics)
            .toEqual([{label: 'Participants', value: '2'}]);
        expect(JSON.stringify(display)).not.toMatch(/nights|days|share factor|surcharges|rebates|invoice credit|previously settled|exempt/iu);
    });

    it('explains an actual exemption while keeping exempt attendance outside the base divisor', () => {
        const explanation = calculationExplanation();
        explanation.exemptParticipants = 1;
        explanation.eligibleAttendanceUnits = 2;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        explanation.contributions[0].isExempt = true;
        explanation.contributions[0].effectiveWeight = 0;
        explanation.contributions[0].weightNumerator = '0';
        explanation.contributions[0].baseShareAmount = 0;
        explanation.contributions[1].baseShareAmount = 100;
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 0, shareAmount: 0}),
            calculationShare({registrationId: 2, baseShareAmount: 100, shareAmount: 100})]);
        const context = invoicePoolCalculationBreakdown(explanation, []);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'attendance')!.metrics).toEqual([
            {label: 'Participants', value: '2'}, {label: 'Total nights', value: '5'},
            {label: 'Eligible nights', value: '2'}, {label: 'Exempt participants', value: '1'},
        ]);
        expect(display.sections.find(section => section.key === 'base-2')!.formula!.terms.at(-1))
            .toEqual({label: 'Eligible nights', value: '2', operator: '÷'});
        expect(JSON.stringify(display)).not.toMatch(/Share factor|Private payer name/u);
    });

    it('does not divide by zero or invent a personal base example when no distribution weight remains', () => {
        const explanation = calculationExplanation();
        explanation.invoiceAmount = 0;
        explanation.distributableAmount = 0;
        explanation.effectiveWeight = 0;
        explanation.weightDenominator = '0';
        for (const contribution of explanation.contributions) {
            contribution.factor = 0;
            contribution.effectiveWeight = 0;
            contribution.weightNumerator = '0';
            contribution.baseShareAmount = 0;
        }
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 0, shareAmount: 0})], []);
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule', 'zero-weight']);
        const context = invoicePoolCalculationBreakdown(explanation, []);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'attendance')!.metrics).toEqual([
            {label: 'Participants', value: '2'}, {label: 'Total nights', value: '5'}, {label: 'Total weight', value: '0'},
        ]);
        expect(display.sections.find(section => section.key === 'zero-weight')!.description)
            .toBe('The total weight is zero, so no automatic base share is allocated.');
        const text = JSON.stringify({context, display});
        expect(text).not.toMatch(/NaN|Infinity|\/\s*0|÷\s*0/u);
        expect(text).toContain('The total weight is zero, so no automatic base share is allocated.');
        expect(text).not.toContain('Private payer name');
    });

    it('keeps legacy missing attendance evidence explicit instead of inventing an example', () => {
        const display = invoicePoolCalculation(undefined, [calculationShare()]);
        expect(display.sections).toEqual([]);
        const context = invoicePoolCalculationBreakdown();
        expectFiguresOnly(context);
        const text = JSON.stringify(context);
        expect(text).toContain('Not saved');
        expect(text).not.toMatch(/Nights stayed|Share factor|Total weight/iu);
        expect(invoicePoolCalculationBreakdown().sections.map(section => section.key)).toEqual(['legacy']);
        expect(display.description).toBe(invoiceText('poolCalculationCostExampleCaption'));
    });

    it('retains global facts before the optional anonymous example in the compatibility text adapter', () => {
        const lines = invoiceCalculationLines(calculationExplanation(), [calculationShare()]);
        expect(lines[0]).toBe('Calculation breakdown');
        expect(lines).toContain('Participants: 2');
        expect(lines).toContain('Total nights: 5');
        expect(lines).toContain('Total weight: 8');
        expect(lines.indexOf('Total weight: 8')).toBeLessThan(lines.indexOf('Example calculation'));
        expect(lines).toContain('100.00 (Base to distribute) × 3 (Nights stayed) × 2 (Share factor) ÷ 8 (Total weight) = 75.00 (Base share)');
        expect(lines).toContain('Rounded up to cents.');
        expect(lines).not.toContain('Private payer name');
        expect(lines).not.toContain('Another private name');
    });

    it('prefers an ordinary payer over a covering payer with more calculation features', () => {
        const explanation = calculationExplanation();
        explanation.contributions.push({...explanation.contributions[1], registrationId: 3, payerRegistrationId: 1,
            name: 'Private covered name', attendanceWeight: 1, effectiveWeight: 1, weightNumerator: '10000', baseShareAmount: 12.5});
        const display = invoicePoolCalculation(explanation, [
            calculationShare({baseShareAmount: 87.5, extraAmount: 5, invoiceCreditAmount: 10, paymentCreditAmount: 20, shareAmount: 62.5}),
            calculationShare({registrationId: 2, baseShareAmount: 25, shareAmount: 25}),
        ]);
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
        expect(display.sections.some(section => section.key === 'coverage')).toBe(false);
        expect(display.description).toBe(invoiceText('poolCalculationExampleCaption'));
        expect(JSON.stringify(display)).not.toMatch(/Private covered name|Private payer name|Payer A/u);
    });

    it.each([
        {feature: 'nondefault factor', factor: 2, extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 0},
        {feature: 'fixed adjustment', factor: 1, extraAmount: 5, invoiceCreditAmount: 0, paymentCreditAmount: 0},
        {feature: 'invoice credit', factor: 1, extraAmount: 0, invoiceCreditAmount: 5, paymentCreditAmount: 0},
        {feature: 'previous settlement credit', factor: 1, extraAmount: 0, invoiceCreditAmount: 0, paymentCreditAmount: 5},
    ])('selects the richer actual $feature among standalone positive payers', (scenario) => {
        const explanation = ordinaryCalculationExplanation();
        if (scenario.factor !== 1) {
            explanation.effectiveWeight = 7;
            explanation.weightDenominator = '70000';
            explanation.contributions[0].baseShareAmount = 42.86;
            Object.assign(explanation.contributions[1], {factor: 2, effectiveWeight: 4,
                weightNumerator: '40000', baseShareAmount: 57.15});
        }
        const base = explanation.contributions[1].baseShareAmount;
        const shares = [calculationShare({baseShareAmount: explanation.contributions[0].baseShareAmount,
            shareAmount: explanation.contributions[0].baseShareAmount}), calculationShare({registrationId: 2,
            baseShareAmount: base, extraAmount: scenario.extraAmount, invoiceCreditAmount: scenario.invoiceCreditAmount,
            paymentCreditAmount: scenario.paymentCreditAmount,
            shareAmount: base + scenario.extraAmount - scenario.invoiceCreditAmount - scenario.paymentCreditAmount})];
        const display = invoicePoolCalculation(explanation, shares);
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
        expect(JSON.stringify(display)).not.toMatch(/Private payer name|Another private name/u);
    });

    it('counts cancelling signed adjustment categories as actual features instead of just their zero net', () => {
        const explanation = ordinaryCalculationExplanation();
        const adjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 2, amount: 10, subtractFromPool: true},
            {registrationId: 2, amount: -10, subtractFromPool: true},
            {registrationId: 2, amount: 5, subtractFromPool: false},
            {registrationId: 2, amount: -5, subtractFromPool: false},
        ];
        const shares = [calculationShare({baseShareAmount: 60, shareAmount: 60}),
            calculationShare({registrationId: 2, baseShareAmount: 40, shareAmount: 40})];
        const before = structuredClone({explanation, shares, adjustments});
        const display = invoicePoolCalculation(explanation, shares, adjustments);
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
        expect(display.sections.find(section => section.key === 'balance')!.formula!.terms.map(term => term.label)).toEqual([
            'Base share', 'Redistributed surcharges', 'Redistributed rebates', 'On-top surcharges', 'On-top rebates',
        ]);
        expect({explanation, shares, adjustments}).toEqual(before);
    });

    it('prefers an own redistributed surcharge over a richer on-top example with the same eligibility', () => {
        const explanation = ordinaryCalculationExplanation();
        explanation.redistributedAmount = 10;
        explanation.distributableAmount = 90;
        explanation.contributions[0].baseShareAmount = 54;
        explanation.contributions[1].baseShareAmount = 36;
        const adjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 1, amount: 10, subtractFromPool: true},
            {registrationId: 2, amount: 5, subtractFromPool: false},
        ];
        const shares = [calculationShare({baseShareAmount: 54, extraAmount: 10, shareAmount: 64}),
            calculationShare({registrationId: 2, baseShareAmount: 36, extraAmount: 5,
                invoiceCreditAmount: 5, paymentCreditAmount: 5, shareAmount: 31})];
        const display = invoicePoolCalculation(explanation, shares, adjustments);
        // The own surcharge explains the shared-base deduction and its later addition to this participant.
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-1');
        expect(display.sections.find(section => section.key === 'base-1')!.formula!.terms[0])
            .toEqual({label: 'Base to distribute', value: '90.00'});
        expect(display.sections.find(section => section.key === 'balance')!.formula!.terms).toEqual([
            {label: 'Base share', value: '54.00'}, {label: 'Redistributed surcharges', value: '10.00', operator: '+'},
        ]);
        expect(display.sections.find(section => section.key === 'on-top')!.formula!.result).toEqual({
            label: 'Full pool total', value: '105.00',
        });
        expect(JSON.stringify(display)).not.toMatch(/Private payer name|Another private name|rebates/iu);
        expect(invoicePoolCalculation(explanation, [...shares].reverse(), [...adjustments].reverse())).toEqual(display);
    });

    it('keeps positive distribution weight ahead of the own redistributed-surcharge preference', () => {
        const explanation = ordinaryCalculationExplanation();
        explanation.redistributedAmount = 10;
        explanation.distributableAmount = 90;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        Object.assign(explanation.contributions[0], {factor: 0, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        explanation.contributions[1].baseShareAmount = 90;
        const adjustments: InvoiceAdjustmentInput[] = [
            {registrationId: 1, amount: 10, subtractFromPool: true},
            {registrationId: 2, amount: 5, subtractFromPool: false},
        ];
        const display = invoicePoolCalculation(explanation, [
            calculationShare({baseShareAmount: 0, extraAmount: 10, shareAmount: 10}),
            calculationShare({registrationId: 2, baseShareAmount: 90, extraAmount: 5, shareAmount: 95}),
        ], adjustments);
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
    });

    it('breaks feature ties by saved registration independently of array order and profile names', () => {
        const explanation = ordinaryCalculationExplanation();
        const shares = [calculationShare({baseShareAmount: 60, shareAmount: 60}),
            calculationShare({registrationId: 2, baseShareAmount: 40, shareAmount: 40})];
        const expected = invoicePoolCalculation(explanation, shares);
        const reordered = structuredClone(explanation);
        reordered.contributions.reverse();
        reordered.contributions[0].name = 'Changed current profile';
        reordered.contributions[1].name = 'Another current profile';
        expect(invoicePoolCalculation(reordered, [...shares].reverse())).toEqual(expected);
        expect(expected.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-1');
    });

    it('excludes exempt, covered and nonpositive payers even when they have richer features', () => {
        const explanation = calculationExplanation();
        explanation.contributions.push({...explanation.contributions[0], registrationId: 3, payerRegistrationId: 3,
            name: 'Exempt name', isExempt: true, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0},
        {...explanation.contributions[0], registrationId: 4, payerRegistrationId: 1, name: 'Covered name'});
        const display = invoicePoolCalculation(explanation, [
            calculationShare({extraAmount: 50, invoiceCreditAmount: 75, paymentCreditAmount: 55, shareAmount: -5}),
            calculationShare({registrationId: 3, baseShareAmount: 0, extraAmount: 5, shareAmount: 5}),
            calculationShare({registrationId: 4, extraAmount: 10, shareAmount: 85}),
            calculationShare({registrationId: 2, baseShareAmount: 25, shareAmount: 25}),
        ]);
        expect(display.sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
        expect(display.sections.some(section => section.key === 'coverage')).toBe(false);
        expect(JSON.stringify(display)).not.toMatch(/Exempt name|Covered name|Private payer name/u);
    });

    it('prefers a positive-weight standalone payer before a richer zero-weight standalone payer', () => {
        const explanation = calculationExplanation();
        Object.assign(explanation.contributions[0], {factor: 0, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        const shares = [calculationShare({baseShareAmount: 0, extraAmount: 20, invoiceCreditAmount: 5, shareAmount: 15}),
            calculationShare({registrationId: 2, baseShareAmount: 25, shareAmount: 25})];
        expect(invoicePoolCalculation(explanation, shares).sections.find(section => section.key.startsWith('base-'))!.key).toBe('base-2');
    });

    it('uses a nonexempt zero-weight positive fixed balance as a factual fallback without dividing', () => {
        const explanation = calculationExplanation();
        Object.assign(explanation.contributions[0], {factor: 0, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        const display = invoicePoolCalculation(explanation, [calculationShare({baseShareAmount: 0, extraAmount: 5, shareAmount: 5})]);
        const base = display.sections.find(section => section.key === 'base-1')!;
        expect(base.formula).toBeUndefined();
        expect(base.description).toContain('no positive distribution weight');
        expect(display.sections.find(section => section.key === 'balance')!.formula!.result.value).toBe('5.00');
        expect(JSON.stringify(display)).not.toMatch(/Private payer name|Another private name|"operator":"÷"/u);
    });

    it('counts only other beneficiaries in the covering example introduction and keeps their order stable', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        explanation.contributions.push({...explanation.contributions[1], registrationId: 3, name: 'Private third name',
            isExempt: true, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        const shares = [calculationShare({baseShareAmount: 100, paymentCreditAmount: 25, shareAmount: 75})];
        const expected = invoicePoolCalculation(explanation, shares);
        expect(expected.description).toContain('covers 2 other participants.');
        const reordered = structuredClone(explanation);
        reordered.contributions.reverse();
        expect(invoicePoolCalculation(reordered, shares)).toEqual(expected);
        expect(JSON.stringify(expected)).not.toMatch(/Private payer name|Another private name|Private third name/u);
    });

    it.each([0, -10])('does not manufacture a payment example for a saved balance of %s', (balance) => {
        const display = invoicePoolCalculation(calculationExplanation(), [calculationShare({shareAmount: balance})]);
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule']);
        expect(display.description).toBe(invoiceText('poolCalculationCostExampleCaption'));
        expect(JSON.stringify(display)).not.toMatch(/Participant A|Payer A|75\.00|"key":"balance"/u);
    });
});

describe('concrete payer calculation explanation', () => {
    it('omits unrelated global on-top totals while keeping actual personal base and payer components', () => {
        const explanation = ordinaryCalculationExplanation();
        const adjustments: InvoiceAdjustmentInput[] = [{registrationId: 2, amount: 5, subtractFromPool: false}];
        const first = calculationShare({baseShareAmount: 60, shareAmount: 60});
        const personal = invoicePayerCalculation(explanation, first, adjustments);
        expect(personal.sections.map(section => section.key)).toEqual(['costs', 'attendance', 'base-1', 'balance']);
        expect(JSON.stringify(personal)).not.toMatch(/Full pool total|On-top|5\.00|Another private name/u);
        expect(personal.sections.find(section => section.key === 'costs')).toMatchObject({
            metrics: [{label: 'Base to distribute', value: '100.00'}],
        });
        expect(personal.sections.find(section => section.key === 'costs')!.formula).toBeUndefined();
        expect(personal.sections.find(section => section.key === 'balance')!.formula!.result.value).toBe('60.00');

        const second = invoicePayerCalculation(explanation, calculationShare({registrationId: 2,
            baseShareAmount: 40, extraAmount: 5, shareAmount: 45}), adjustments);
        const balance = second.sections.find(section => section.key === 'balance')!;
        expect(second.sections.some(section => section.key === 'on-top')).toBe(false);
        expect(balance.description).toBe(invoiceText('payerOnTopSurchargeExplanation'));
        expect(balance.formula!.terms).toEqual([
            {label: 'Base share', value: '40.00'}, {label: 'On-top surcharges', value: '5.00', operator: '+'},
        ]);
        expect(balance.formula!.result.value).toBe('45.00');
    });

    it('shows every actual own and covered contribution, then combines rounded bases before credits', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        explanation.contributions.push({registrationId: 3, payerRegistrationId: 3, name: 'Unrelated payer',
            attendanceWeight: 0, factor: 1, isExempt: false, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        const share = calculationShare({name: 'Private payer name', baseShareAmount: 100, extraAmount: -5,
            invoiceCreditAmount: 20, paymentCreditAmount: 30, shareAmount: 45});
        const adjustments: InvoiceAdjustmentInput[] = [{registrationId: 2, amount: -5, subtractFromPool: false}];
        const before = structuredClone({explanation, share, adjustments});
        const display = invoicePayerCalculation(explanation, share, adjustments);
        expect(display.title).toBe('Calculation explanation');
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'attendance', 'coverage-summary', 'base-1', 'base-2', 'coverage', 'balance']);
        expect(display.sections.find(section => section.key === 'coverage-summary')).toEqual({
            key: 'coverage-summary', title: 'Participants covered by Private payer name',
            description: 'Covers 1 other participant', items: ['Another private name'],
        });
        expect(display.sections.find(section => section.key === 'base-1')!).toMatchObject({
            title: 'Base share for Private payer name', formula: {result: {value: '75.00'}},
        });
        expect(display.sections.find(section => section.key === 'base-2')!).toMatchObject({
            title: 'Base share for Another private name', formula: {result: {value: '25.00'}},
        });
        expect(display.sections.find(section => section.key === 'coverage')!.formula).toEqual({
            terms: [{label: 'Base share for Private payer name', value: '75.00'},
                {label: 'Base share for Another private name', value: '25.00', operator: '+'}],
            result: {label: 'Base share', value: '100.00'},
        });
        expect(display.sections.find(section => section.key === 'balance')!).toMatchObject({
            title: 'Calculated balance for Private payer name', formula: {
                terms: [{label: 'Base share', value: '100.00'},
                    {label: 'On-top rebates', value: '-5.00', operator: '+'},
                    {label: 'Invoice credit', value: '20.00', operator: '−'},
                    {label: 'Previously settled', value: '30.00', operator: '−'}],
                result: {label: 'Calculated balance', value: '45.00'},
            },
        });
        expect(JSON.stringify(display)).not.toMatch(/Unrelated payer|Participant A|Payer A|example/iu);
        expect({explanation, share, adjustments}).toEqual(before);
    });

    it('introduces every beneficiary by name and count, including zero bases, before their individual calculations', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        explanation.contributions.push({registrationId: 3, payerRegistrationId: 1, name: 'Covered exempt person',
            attendanceWeight: 0, factor: 1, isExempt: true, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        const display = invoicePayerCalculation(explanation, calculationShare({name: 'Private payer name', baseShareAmount: 100, shareAmount: 100}));
        const summary = display.sections.find(section => section.key === 'coverage-summary')!;
        expect(summary).toMatchObject({title: 'Participants covered by Private payer name',
            description: 'Covers 2 other participants', items: ['Another private name', 'Covered exempt person']});
        expect(summary.items).not.toContain('Private payer name');
        expect(display.sections.indexOf(summary)).toBeLessThan(display.sections.findIndex(section => section.key.startsWith('base-')));
        expect(display.sections.find(section => section.key === 'base-3')).toMatchObject({
            title: 'Base share for Covered exempt person', metrics: [{label: 'Base share', value: '0.00'}],
        });
    });

    it('introduces coverage even when the payer has only a beneficiary contribution', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 99;
        const display = invoicePayerCalculation(explanation, calculationShare({registrationId: 99, name: 'Covering payer',
            baseShareAmount: 25, shareAmount: 25}));
        expect(display.sections.map(section => section.key)).toEqual(['costs', 'attendance', 'coverage-summary', 'base-2', 'balance']);
        expect(display.sections[2]).toMatchObject({title: 'Participants covered by Covering payer',
            description: 'Covers 1 other participant', items: ['Another private name']});
        expect(JSON.stringify(display)).not.toContain('Private payer name');
    });

    it('omits coverage introductions when only the payer’s own contribution is present', () => {
        const display = invoicePayerCalculation(calculationExplanation(), calculationShare());
        expect(display.sections.some(section => section.key === 'coverage-summary')).toBe(false);
        expect(JSON.stringify(display)).not.toContain('Another private name');
    });

    it('retains a covered exemption and zero base without dividing by zero or removing its balance', () => {
        const explanation = calculationExplanation();
        explanation.contributions[0].isExempt = true;
        explanation.contributions[0].effectiveWeight = 0;
        explanation.contributions[0].baseShareAmount = 0;
        const display = invoicePayerCalculation(explanation, calculationShare({baseShareAmount: 0, extraAmount: 5, shareAmount: 5}));
        const base = display.sections.find(section => section.key === 'base-1')!;
        expect(base.formula).toBeUndefined();
        expect(base.description).toMatch(/exempt/iu);
        expect(base.metrics).toEqual([{label: 'Base share', value: '0.00'}]);
        expect(display.sections.map(section => section.key)).toEqual(['base-1', 'balance']);
        expect(display.sections.find(section => section.key === 'balance')!.formula!.result.value).toBe('5.00');
    });

    it('abbreviates an exempt personal explanation while retaining fixed categories, credits and the signed balance', () => {
        const explanation = calculationExplanation();
        Object.assign(explanation.contributions[0], {isExempt: true, effectiveWeight: 0,
            weightNumerator: '0', baseShareAmount: 0});
        const share = calculationShare({name: 'Exempt payer', baseShareAmount: 0, extraAmount: 5,
            invoiceCreditAmount: 10, paymentCreditAmount: 20, shareAmount: -25});
        const adjustments: InvoiceAdjustmentInput[] = [{registrationId: 1, amount: 5, subtractFromPool: false}];
        const before = structuredClone({explanation, share, adjustments});
        const display = invoicePayerCalculation(explanation, share, adjustments);
        expect(display.sections.map(section => section.key)).toEqual(['base-1', 'balance']);
        expect(display.sections[0].description).toContain('exempt');
        expect(display.sections[1].formula).toEqual({terms: [
            {label: 'On-top surcharges', value: '5.00'},
            {label: 'Invoice credit', value: '10.00', operator: '−'},
            {label: 'Previously settled', value: '20.00', operator: '−'},
        ], result: {label: 'Calculated balance', value: '-25.00'}});
        expect(JSON.stringify(display)).not.toMatch(/Base to distribute|Nights stayed|Total nights|Total weight|Another private name/u);
        expect({explanation, share, adjustments}).toEqual(before);
    });

    it('retains the actual shared calculation when an exempt payer covers an eligible participant', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        Object.assign(explanation.contributions[0], {isExempt: true, effectiveWeight: 0,
            weightNumerator: '0', baseShareAmount: 0});
        explanation.exemptParticipants = 1;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        explanation.eligibleAttendanceUnits = 2;
        explanation.contributions[1].baseShareAmount = 100;
        const display = invoicePayerCalculation(explanation, calculationShare({baseShareAmount: 100, shareAmount: 100}));
        expect(display.sections.map(section => section.key)).toEqual([
            'costs', 'attendance', 'coverage-summary', 'base-1', 'base-2', 'coverage', 'balance',
        ]);
        expect(display.sections.find(section => section.key === 'coverage-summary')!.items).toEqual(['Another private name']);
        expect(display.sections.find(section => section.key === 'base-1')!.description).toContain('exempt');
        expect(display.sections.find(section => section.key === 'base-2')!.formula!.terms).toEqual([
            {label: 'Base to distribute', value: '100.00'}, {label: 'Nights stayed', value: '2', operator: '×'},
            {label: 'Eligible nights', value: '2', operator: '÷'},
        ]);
        expect(display.sections.find(section => section.key === 'balance')!.formula!.result.value).toBe('100.00');
    });

    it.each([
        {reason: 'zero share factor', attendance: 3, factor: 0, totalAttendance: 5, metrics: [
            {label: 'Nights stayed', value: '3'}, {label: 'Share factor', value: '0'},
            {label: 'Distribution weight', value: '0'}, {label: 'Base share', value: '0.00'},
        ]},
        {reason: 'zero attendance', attendance: 0, factor: 1, totalAttendance: 2, metrics: [
            {label: 'Nights stayed', value: '0'}, {label: 'Distribution weight', value: '0'},
            {label: 'Base share', value: '0.00'},
        ]},
    ])('names the actual saved inputs behind $reason without inventing a base formula', (scenario) => {
        const explanation = calculationExplanation();
        explanation.attendanceUnits = scenario.totalAttendance;
        explanation.eligibleAttendanceUnits = scenario.totalAttendance;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        Object.assign(explanation.contributions[0], {attendanceWeight: scenario.attendance, factor: scenario.factor,
            effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        explanation.contributions[1].baseShareAmount = 100;
        const display = invoicePayerCalculation(explanation, calculationShare({baseShareAmount: 0, extraAmount: 5, shareAmount: 5}));
        const base = display.sections.find(section => section.key === 'base-1')!;
        expect(base.title).toBe('Base share for Private payer name');
        expect(base.metrics).toEqual(scenario.metrics);
        expect(base.description).toContain('no positive distribution weight');
        expect(base.formula).toBeUndefined();
        expect(display.sections.map(section => section.key)).toEqual(['base-1', 'balance']);
        expect(display.sections.find(section => section.key === 'balance')!.formula!.result.value).toBe('5.00');
        expect(JSON.stringify(display)).not.toMatch(/Another private name|NaN|Infinity|Participant A/u);
    });

    it('keeps zero-weight personal inputs traceable when the saved global divisor is zero', () => {
        const explanation = calculationExplanation();
        explanation.invoiceAmount = 0;
        explanation.distributableAmount = 0;
        explanation.effectiveWeight = 0;
        explanation.weightDenominator = '0';
        for (const contribution of explanation.contributions) {
            contribution.factor = 0;
            contribution.effectiveWeight = 0;
            contribution.weightNumerator = '0';
            contribution.baseShareAmount = 0;
        }
        const display = invoicePayerCalculation(explanation, calculationShare({baseShareAmount: 0, shareAmount: 0}));
        const base = display.sections.find(section => section.key === 'base-1')!;
        expect(base.metrics).toEqual([{label: 'Nights stayed', value: '3'}, {label: 'Share factor', value: '0'},
            {label: 'Distribution weight', value: '0'}, {label: 'Base share', value: '0.00'}]);
        expect(base.formula).toBeUndefined();
        expect(display.sections.find(section => section.key === 'balance')!.metrics)
            .toEqual([{label: 'Calculated balance', value: '0.00'}]);
        expect(JSON.stringify(display)).not.toMatch(/Another private name|NaN|Infinity|"operator":"÷"/u);
    });

    it('explains a former payer credit without borrowing another payer’s attendance or identity', () => {
        const display = invoicePayerCalculation(calculationExplanation(), calculationShare({registrationId: 99,
            name: 'Former payer', baseShareAmount: 0, paymentCreditAmount: 15, shareAmount: -15}));
        expect(display.sections.map(section => section.key)).toEqual(['balance']);
        expect(display.sections.at(-1)).toEqual({key: 'balance', title: 'Calculated balance for Former payer',
            formula: {terms: [{label: 'Previously settled', value: '15.00', operator: '−'}],
                result: {label: 'Calculated balance', value: '-15.00'}}});
        expect(JSON.stringify(display)).not.toMatch(/Private payer name|Another private name|Nights stayed|75\.00|25\.00/u);
    });

    it('keeps a retained covered payer explanation to their actual credit and balance without a shared divisor', () => {
        const explanation = calculationExplanation();
        explanation.contributions[0].payerRegistrationId = 2;
        const share = calculationShare({baseShareAmount: 0, paymentCreditAmount: 25, shareAmount: -25});
        const display = invoicePayerCalculation(explanation, share);
        expect(display.sections.map(section => section.key)).toEqual(['balance']);
        expect(display.sections[0].formula).toEqual({terms: [
            {label: 'Previously settled', value: '25.00', operator: '−'},
        ], result: {label: 'Calculated balance', value: '-25.00'}});
        expect(JSON.stringify(display)).not.toMatch(/Base to distribute|Total weight|Nights stayed|Distribution weight|Invoice costs/u);
    });

    it('uses saved payer identity for legacy shares and discloses missing numeric evidence', () => {
        const display = invoicePayerCalculation(undefined, calculationShare({payerName: 'Legacy payer',
            baseShareAmount: 0, paymentCreditAmount: -10, shareAmount: 10}));
        expect(display.sections[0].description).toContain('inputs were not saved');
        expect(display.sections.at(-1)).toMatchObject({title: 'Calculated balance for Legacy payer',
            formula: {terms: [{label: 'Previously settled', value: '-10.00', operator: '−'}],
                result: {label: 'Calculated balance', value: '10.00'}}});
        expect(JSON.stringify(display)).not.toMatch(/Nights stayed|Days attended|Share factor|Total weight/u);
    });
});

describe('saved global calculation breakdown', () => {
    it('keeps weighted pool counts in the global breakdown when no anonymous payment example applies', () => {
        const explanation = calculationExplanation();
        const before = structuredClone(explanation);
        const context = invoicePoolCalculationBreakdown(explanation, []);
        expectFiguresOnly(context);
        expect(context.sections.map(section => section.key)).toEqual(['costs', 'attendance']);
        expect(context.sections.find(section => section.key === 'costs')).toMatchObject({
            metrics: [{label: 'Invoice costs', value: '100.00'}],
        });
        expect(context.sections.find(section => section.key === 'attendance')).toMatchObject({
            metrics: [{label: 'Participants', value: '2'}, {label: 'Total nights', value: '5'},
                {label: 'Total weight', value: '8'}],
        });
        const example = invoicePoolCalculation(explanation, [], []);
        expect(example.sections.map(section => section.key)).toEqual(['costs', 'distribution-rule']);
        expect(example.sections.find(section => section.key === 'distribution-rule')!.description)
            .toBe(invoiceText('nightsWeightExplanation'));
        expect(example.description).toBe(invoiceText('poolCalculationCostExampleCaption'));
        expect(JSON.stringify(example)).not.toMatch(/Participant A|Payer A|Private payer name|Another private name|Base share for|Calculated balance/u);
        expect(JSON.stringify(context)).not.toMatch(/Participant A|Payer A|Private payer name|Another private name|Base share for/u);
        expect(explanation).toEqual(before);
    });

    it.each([
        {method: 'NIGHTS' as const, totalLabel: 'Total nights', attendanceLabel: 'Nights stayed', divisorLabel: 'Eligible nights'},
        {method: 'DAYS' as const, totalLabel: 'Total days', attendanceLabel: 'Days attended', divisorLabel: 'Eligible days'},
    ])('separates $method pool context from the example while retaining a complete personal explanation', (scenario) => {
        const explanation = ordinaryCalculationExplanation();
        explanation.distributionMethod = scenario.method;
        const share = calculationShare({baseShareAmount: 60, shareAmount: 60});
        const before = structuredClone({explanation, share});
        const context = invoicePoolCalculationBreakdown(explanation, []);
        const example = invoicePoolCalculation(explanation, [share], []);
        const personal = invoicePayerCalculation(explanation, share, []);
        expectFiguresOnly(context);

        // The global display supplies the overall participant and attendance counts without personal identities.
        expect(context.sections.find(section => section.key === 'attendance')!.metrics).toEqual([
            {label: 'Participants', value: '2'}, {label: scenario.totalLabel, value: '5'},
        ]);
        expect(context.sections.find(section => section.key === 'costs')!.metrics)
            .toEqual([{label: 'Invoice costs', value: '100.00'}]);
        expect(JSON.stringify(context)).not.toMatch(/Share factor|Total weight|Exempt participants|Private payer name|Another private name/u);

        // The optional example explains the cost relationship and payer arithmetic, without another count overview.
        expect(example.sections.map(section => section.key)).toEqual(['costs', 'base-1']);
        expect(example.sections.find(section => section.key === 'costs')!.description)
            .toContain('both the full pool total and the base to distribute');
        expect(example.sections.find(section => section.key === 'base-1')).toMatchObject({title: 'Base share for Participant A', formula: {
            terms: [{label: 'Base to distribute', value: '100.00'},
                {label: scenario.attendanceLabel, value: '3', operator: '×'},
                {label: scenario.divisorLabel, value: '5', operator: '÷'}],
            result: {label: 'Base share', value: '60.00'},
        }});

        // A participant's own disclosure remains self-contained and uses only their actual saved identity.
        expect(personal.sections.map(section => section.key)).toEqual(['costs', 'attendance', 'base-1', 'balance']);
        expect(personal.sections.find(section => section.key === 'costs')!.metrics)
            .toEqual([{label: 'Base to distribute', value: '100.00'}]);
        expect(personal.sections.find(section => section.key === 'attendance')!.metrics).toEqual([
            {label: 'Participants', value: '2'}, {label: scenario.totalLabel, value: '5'},
        ]);
        expect(personal.sections.find(section => section.key === 'base-1')!.title).toBe('Base share for Private payer name');
        expect(personal.sections.find(section => section.key === 'balance')!.formula!.result)
            .toEqual({label: 'Calculated balance', value: '60.00'});
        expect(JSON.stringify(personal)).not.toMatch(/Another private name|Participant A|Payer A|Full pool total/u);
        expect({explanation, share}).toEqual(before);
    });

    it.each([
        {mode: 'plain', adjustments: [], base: '100.00', full: '100.00',
            redistributed: [], onTop: [], unused: /surcharge|rebate/iu},
        {mode: 'redistributed surcharge', adjustments: [{registrationId: 1, amount: 10, subtractFromPool: true}],
            base: '90.00', full: '100.00', redistributed: [{label: 'Redistributed surcharges', value: '10.00'}],
            onTop: [], unused: /rebate|on-top/iu},
        {mode: 'redistributed rebate', adjustments: [{registrationId: 1, amount: -10, subtractFromPool: true}],
            base: '110.00', full: '100.00', redistributed: [{label: 'Redistributed rebates', value: '-10.00'}],
            onTop: [], unused: /surcharge|on-top/iu},
        {mode: 'cancelling redistributed categories', adjustments: [
            {registrationId: 1, amount: 10, subtractFromPool: true}, {registrationId: 2, amount: -10, subtractFromPool: true},
        ], base: '100.00', full: '100.00', redistributed: [{label: 'Redistributed surcharges', value: '10.00'},
            {label: 'Redistributed rebates', value: '-10.00'}], onTop: [], unused: /on-top/iu},
        {mode: 'on-top surcharge', adjustments: [{registrationId: 1, amount: 5, subtractFromPool: false}],
            base: '100.00', full: '105.00', redistributed: [],
            onTop: [{label: 'On-top surcharges', value: '5.00'}], unused: /rebate|redistribut/iu},
        {mode: 'on-top rebate', adjustments: [{registrationId: 1, amount: -5, subtractFromPool: false}],
            base: '100.00', full: '95.00', redistributed: [],
            onTop: [{label: 'On-top rebates', value: '-5.00'}], unused: /surcharge|redistribut/iu},
        {mode: 'both cancelling on-top categories', adjustments: [
            {registrationId: 1, amount: 5, subtractFromPool: false}, {registrationId: 2, amount: -5, subtractFromPool: false},
        ], base: '100.00', full: '100.00', redistributed: [], onTop: [{label: 'On-top surcharges', value: '5.00'},
            {label: 'On-top rebates', value: '-5.00'}], unused: /redistribut/iu},
        {mode: 'both adjustment modes', adjustments: [
            {registrationId: 1, amount: 10, subtractFromPool: true}, {registrationId: 2, amount: 5, subtractFromPool: false},
        ], base: '90.00', full: '105.00', redistributed: [{label: 'Redistributed surcharges', value: '10.00'}],
            onTop: [{label: 'On-top surcharges', value: '5.00'}], unused: /rebate/iu},
        {mode: 'both modes with cancelling gross categories', adjustments: [
            {registrationId: 1, amount: 10, subtractFromPool: true}, {registrationId: 2, amount: -10, subtractFromPool: true},
            {registrationId: 1, amount: 5, subtractFromPool: false}, {registrationId: 2, amount: -5, subtractFromPool: false},
        ], base: '100.00', full: '100.00', redistributed: [{label: 'Redistributed surcharges', value: '10.00'},
            {label: 'Redistributed rebates', value: '-10.00'}], onTop: [{label: 'On-top surcharges', value: '5.00'},
            {label: 'On-top rebates', value: '-5.00'}], unused: /Unavailable/iu},
    ])('lists signed figures globally and explains the cost equations in the example for $mode', (scenario) => {
        const explanation = calculationExplanation();
        explanation.redistributedAmount = 100 - Number(scenario.base);
        explanation.distributableAmount = Number(scenario.base);
        // Keep the saved payer fixture coherent with its known 6/8 weight and actual fixed adjustments.
        explanation.contributions[0].baseShareAmount = Number(scenario.base) * 0.75;
        explanation.contributions[1].baseShareAmount = Number(scenario.base) * 0.25;
        let ownAdjustment = 0;
        for (const adjustment of scenario.adjustments) {
            if (adjustment.registrationId === 1) ownAdjustment += adjustment.amount;
        }
        const share = calculationShare({baseShareAmount: explanation.contributions[0].baseShareAmount,
            extraAmount: ownAdjustment, shareAmount: explanation.contributions[0].baseShareAmount + ownAdjustment});
        const before = structuredClone({explanation, share, adjustments: scenario.adjustments});
        const context = invoicePoolCalculationBreakdown(explanation, scenario.adjustments);
        const example = invoicePoolCalculation(explanation, [share], scenario.adjustments);
        const costs = example.sections.find(section => section.key === 'costs')!;
        const onTop = example.sections.find(section => section.key === 'on-top');
        expect(context.title).toBe('Calculation breakdown');
        expectFiguresOnly(context);
        expect(context.sections.map(section => section.key)).toEqual(['costs', 'attendance']);
        // Used categories retain their gross signed values, even when the base and full total equal invoice costs.
        const expectedCosts = [{label: 'Invoice costs', value: '100.00'}, ...scenario.redistributed, ...scenario.onTop];
        if (scenario.redistributed.length || scenario.onTop.length) expectedCosts.push({label: 'Base to distribute', value: scenario.base});
        if (scenario.onTop.length) expectedCosts.push({label: 'Full pool total', value: scenario.full});
        expect(context.sections.find(section => section.key === 'costs')!.metrics).toEqual(expectedCosts);

        // The example owns signed arithmetic and prose. Redistribution changes the base, while direct costs change the total.
        if (scenario.redistributed.length) {
            expect(costs.formula).toEqual({terms: [{label: 'Invoice costs', value: '100.00'},
                ...scenario.redistributed.map(row => ({...row, operator: '−'}))],
            result: {label: 'Base to distribute', value: scenario.base}});
            expect(costs.metrics).toBeUndefined();
        } else {
            expect(costs.metrics).toEqual([{label: scenario.onTop.length ? 'Base to distribute' : 'Invoice costs', value: scenario.base}]);
            expect(costs.formula).toBeUndefined();
        }
        if (scenario.onTop.length) {
            expect(onTop!.formula).toEqual({terms: [{label: 'Invoice costs', value: '100.00'},
                ...scenario.onTop.map(row => ({...row, operator: '+'}))],
            result: {label: 'Full pool total', value: scenario.full}});
            expect(onTop!.description).toContain('do not enter the base to distribute');
            expect(example.sections.map(section => section.key).indexOf('on-top'))
                .toBeLessThan(example.sections.map(section => section.key).indexOf('costs'));
        } else {
            expect(onTop).toBeUndefined();
            expect(costs.description).toContain('full pool total');
            expect(costs.description).toContain(!scenario.redistributed.length ? 'both the full pool total and the base to distribute'
                : 'The base to distribute is the part split between participants.');
        }
        expect(example.sections.some(section => section.key === 'attendance')).toBe(false);
        expect(example.sections.find(section => section.key === 'distribution-rule')!.description)
            .toBe(invoiceText('nightsWeightExplanation'));
        expect(JSON.stringify(context)).not.toMatch(scenario.unused);
        expect(JSON.stringify(example)).not.toMatch(scenario.unused);
        expect(JSON.stringify(context)).not.toMatch(/Private payer name|Another private name|Participant A/u);
        expect(JSON.stringify(example)).not.toMatch(/Private payer name|Another private name/u);
        expect({explanation, share, adjustments: scenario.adjustments}).toEqual(before);
    });

    it('does not infer a legacy full pool total without any saved adjustment provenance', () => {
        const context = invoicePoolCalculationBreakdown(calculationExplanation());
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'costs')!.metrics).toEqual([
            {label: 'Invoice costs', value: '100.00'}, {label: 'Base to distribute', value: '100.00'},
            {label: 'Full pool total', value: 'Unavailable'},
        ]);
        const example = invoicePoolCalculation(calculationExplanation(), [calculationShare()]);
        expect(example.sections.find(section => section.key === 'costs')!.description)
            .toContain('full pool total cannot be reconstructed');
        expect(example.sections.some(section => section.formula?.result.label === 'Full pool total')).toBe(false);
        const missing = invoicePoolCalculationBreakdown();
        expectFiguresOnly(missing);
        expect(missing.sections.find(section => section.key === 'legacy')!.metrics)
            .toEqual([{label: 'Saved calculation inputs', value: 'Not saved'}]);
        expect(invoicePoolCalculation(undefined, [calculationShare()]).sections).toEqual([]);
    });

    it.each([
        {net: 10, base: '90.00'}, {net: -10, base: '110.00'},
    ])('keeps a legacy signed redistribution of $net factual without inventing gross adjustment categories', (scenario) => {
        const explanation = calculationExplanation();
        explanation.redistributedAmount = scenario.net;
        explanation.distributableAmount = Number(scenario.base);
        const before = structuredClone(explanation);
        const context = invoicePoolCalculationBreakdown(explanation);
        const example = invoicePoolCalculation(explanation, []);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'costs')!.metrics).toEqual([
            {label: 'Invoice costs', value: '100.00'},
            {label: 'Redistributed adjustments', value: `${scenario.net}.00`},
            {label: 'Base to distribute', value: scenario.base},
            {label: 'Full pool total', value: 'Unavailable'},
        ]);
        expect(example.sections.find(section => section.key === 'costs')!.formula).toEqual({
            terms: [{label: 'Invoice costs', value: '100.00'},
                {label: 'Redistributed adjustments', value: `${scenario.net}.00`, operator: '−'}],
            result: {label: 'Base to distribute', value: scenario.base},
        });
        expect(example.sections.some(section => section.key === 'on-top')).toBe(false);
        expect(JSON.stringify({context, example})).not.toMatch(/Redistributed surcharges|Redistributed rebates|On-top|Participant A|Payer A/u);
        expect(explanation).toEqual(before);
    });

    it('uses captured numeric adjustment provenance ahead of a contradictory legacy source fallback in both projections', () => {
        const explanation = calculationExplanation();
        explanation.redistributedAmount = 10;
        explanation.distributableAmount = 90;
        explanation.adjustmentTotals = {redistributedSurcharges: 10, redistributedRebates: 0,
            additionalSurcharges: 0, additionalRebates: -5};
        const fallback = [{registrationId: 1, amount: 5, subtractFromPool: true},
            {registrationId: 2, amount: 20, subtractFromPool: false}];
        const before = structuredClone({explanation, fallback});
        const context = invoicePoolCalculationBreakdown(explanation, fallback);
        const example = invoicePoolCalculation(explanation, [], fallback);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'costs')!.metrics).toEqual([
            {label: 'Invoice costs', value: '100.00'}, {label: 'Redistributed surcharges', value: '10.00'},
            {label: 'On-top rebates', value: '-5.00'}, {label: 'Base to distribute', value: '90.00'},
            {label: 'Full pool total', value: '95.00'},
        ]);
        expect(example.sections.find(section => section.key === 'costs')!.formula).toEqual({
            terms: [{label: 'Invoice costs', value: '100.00'},
                {label: 'Redistributed surcharges', value: '10.00', operator: '−'}],
            result: {label: 'Base to distribute', value: '90.00'},
        });
        expect(example.sections.find(section => section.key === 'on-top')!.formula).toEqual({
            terms: [{label: 'Invoice costs', value: '100.00'},
                {label: 'On-top rebates', value: '-5.00', operator: '+'}],
            result: {label: 'Full pool total', value: '95.00'},
        });
        expect(JSON.stringify({context, example})).not.toMatch(/On-top surcharges|20\.00/u);
        expect({explanation, fallback}).toEqual(before);
    });

    it.each([
        {method: 'DAYS' as const, units: 5, weight: 8, rule: 'daysWeightExplanation' as const,
            counts: [{label: 'Participants', value: '2'}, {label: 'Total days', value: '5'}, {label: 'Total weight', value: '8'}]},
        {method: 'EQUAL' as const, units: 2, weight: 3, rule: 'equalWeightExplanation' as const,
            counts: [{label: 'Participants', value: '2'}, {label: 'Total weight', value: '3'}]},
    ])('keeps the $method weighting rule in the example while its overview contains only saved figures', (scenario) => {
        const explanation = calculationExplanation();
        explanation.distributionMethod = scenario.method;
        explanation.attendanceUnits = scenario.units;
        explanation.eligibleAttendanceUnits = scenario.units;
        explanation.effectiveWeight = scenario.weight;
        if (scenario.method === 'EQUAL') {
            // Equal mode counts participants before applying each saved factor, not their attendance days.
            explanation.weightDenominator = '30000';
            Object.assign(explanation.contributions[0], {attendanceWeight: 1, effectiveWeight: 2,
                weightNumerator: '20000', baseShareAmount: 66.67});
            Object.assign(explanation.contributions[1], {attendanceWeight: 1, effectiveWeight: 1,
                weightNumerator: '10000', baseShareAmount: 33.34});
        }
        const context = invoicePoolCalculationBreakdown(explanation, []);
        const example = invoicePoolCalculation(explanation, [], []);
        expectFiguresOnly(context);
        expect(context.sections.find(section => section.key === 'attendance')!.metrics).toEqual(scenario.counts);
        expect(example.sections.find(section => section.key === 'distribution-rule')!.description).toBe(invoiceText(scenario.rule));
        expect(example.sections.some(section => section.key === 'attendance')).toBe(false);
        expect(JSON.stringify(example)).not.toMatch(/Participant A|Payer A|Private payer name|Another private name/u);
    });
});

describe('retained settlement responsibility notices', () => {
    it.each([-25, 0, 25])('preserves the saved exemption notice for a balance of %s', (shareAmount) => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}],
            calculationSnapshot: {settledRegistrationIds: [1], takeovers: [],
                assignments: [{registrationId: 1, isExempt: true}]}};
        const share = calculationShare({baseShareAmount: 0, shareAmount});
        const before = structuredClone({pool, share});
        // The current balance sign cannot rewrite frozen transfer evidence or replace the saved exemption with pending coverage.
        expect(invoiceSettledShareNotice(pool, share)).toEqual({
            label: invoiceText('settledShareExemptLabel'), description: invoiceText('settledShareExemptDescription'),
        });
        expect({pool, share}).toEqual(before);
    });

    it('names the applied covering payer from frozen evidence instead of pending or renamed participants', () => {
        const explanation = calculationExplanation();
        explanation.contributions[0].payerRegistrationId = 2;
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 3, beneficiaryRegistrationId: 1}],
            calculationSnapshot: {settledRegistrationIds: [1],
                takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}], explanation}};
        const notice = invoiceSettledShareNotice(pool, calculationShare({baseShareAmount: 0, shareAmount: 0}), [
            {id: 2, name: 'Changed current name'}, {id: 3, name: 'Pending payer'},
        ]);
        expect(notice!.label).toBe('Covered by Another private name · settlement retained');
        expect(notice!.description).toContain("Another private name now covers this participant's share");
        expect(notice!.description).toContain('Previously recorded payments or refunds');
        // The notice explains retention without inventing an original gross transfer or a chronological ledger.
        expect(JSON.stringify(notice)).not.toMatch(/Changed current name|Pending payer|\d+\.\d{2}|base share/u);
    });

    it('uses explicit participant data or a localized identity when a saved covering payer has no name', () => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED', calculationSnapshot: {
            settledRegistrationIds: [1], takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}],
        }};
        expect(invoiceSettledShareNotice(pool, calculationShare(), [{id: 2, name: 'Known payer'}])!.label)
            .toBe('Covered by Known payer · settlement retained');
        expect(invoiceSettledShareNotice(pool, calculationShare())!.label)
            .toBe('Covered by Participant #2 · settlement retained');
    });

    it('requires saved transfer evidence and never treats current planning or automatic zero balances as history', () => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}],
            calculationSnapshot: {takeovers: [], assignments: [{registrationId: 1, isExempt: true}]}};
        expect(invoiceSettledShareNotice(pool, calculationShare({shareAmount: 0, isPaid: true}))).toBeNull();
        expect(invoiceSettledShareNotice({...pool, status: 'OPEN'}, calculationShare())).toBeNull();
        expect(invoiceSettledShareNotice({...pool, calculationSnapshot: null}, calculationShare())).toBeNull();
        expect(invoiceSettledShareNotice(pool, calculationShare({registrationId: undefined}))).toBeNull();
    });

    it.each(['exempt', 'covered'] as const)('addresses the %s participant directly while leaving organizer wording unchanged', (reason) => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED', calculationSnapshot: {
            settledRegistrationIds: [1], assignments: [{registrationId: 1, isExempt: true}],
            takeovers: reason === 'covered' ? [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}] : [],
        }};
        const participant = invoiceSettledShareNotice(pool, calculationShare(), [{id: 2, name: 'Known payer'}], 'participant')!;
        expect(participant.description).toContain(reason === 'covered' ? 'Known payer now covers your share' : 'You are now exempt');
        expect(participant.description).toContain('Your previously recorded payments or refunds stay with you');
        expect(participant.description).not.toContain('this participant');
        const organizer = invoiceSettledShareNotice(pool, calculationShare(), [{id: 2, name: 'Known payer'}])!;
        expect(organizer.description).toContain('this participant');
    });
});

describe('applied invoice coverage', () => {
    it('uses closed-pool saved coverage instead of pending changes and never exposes persistence objects', () => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 3}],
            calculationSnapshot: {takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 3}]}};
        const before = structuredClone(pool);
        const applied = invoiceAppliedTakeovers(pool);
        expect(applied).toEqual([{payerRegistrationId: 1, beneficiaryRegistrationId: 3}]);
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(true);
        expect(invoiceHasPendingTakeovers(pool)).toBe(true);
        applied[0].payerRegistrationId = 99;
        expect(pool).toEqual(before);
    });

    it('treats an explicitly saved empty list as authoritative even when other evidence contains coverage', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}],
            calculationSnapshot: {takeovers: [], explanation}};
        expect(invoiceAppliedTakeovers(pool)).toEqual([]);
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(true);
        expect(invoiceHasPendingTakeovers(pool)).toBe(true);
    });

    it('recovers older applied pairs only from saved contribution attribution', () => {
        const explanation = calculationExplanation();
        explanation.contributions[1].payerRegistrationId = 1;
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 3, beneficiaryRegistrationId: 2}],
            calculationSnapshot: {explanation}};
        expect(invoiceAppliedTakeovers(pool)).toEqual([{payerRegistrationId: 1, beneficiaryRegistrationId: 2}]);
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(true);
        expect(invoiceHasPendingTakeovers(pool)).toBe(true);
    });

    it('does not invent baseline legacy applied coverage from current pending maps or notes', () => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}], calculationSnapshot: null};
        expect(invoiceAppliedTakeovers(pool)).toEqual([]);
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(false);
        expect(invoiceHasPendingTakeovers(pool)).toBe(false);
        expect(invoiceAppliedTakeovers({status: 'CLOSED'})).toEqual([]);
        // A non-null legacy snapshot still cannot establish a baseline without either numeric source.
        pool.calculationSnapshot = {};
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(false);
        expect(invoiceHasPendingTakeovers(pool)).toBe(false);
        expect(invoiceAppliedTakeovers(pool)).toEqual([]);
    });

    it('uses a saved empty contribution list as evidence and safely ignores malformed takeover lists', () => {
        const explanation = calculationExplanation();
        explanation.contributions = [];
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED',
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}],
            calculationSnapshot: {explanation}};
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(true);
        expect(invoiceAppliedTakeovers(pool)).toEqual([]);
        expect(invoiceHasPendingTakeovers(pool)).toBe(true);

        // Persisted legacy JSON can predate today's type contract. Its saved contribution attribution,
        // rather than a null takeover list or current pending pairs, remains the usable evidence.
        explanation.contributions = calculationExplanation().contributions;
        explanation.contributions[1].payerRegistrationId = 1;
        const malformed: InvoiceAppliedTakeoversInput = JSON.parse(JSON.stringify(pool));
        Object.assign(malformed.calculationSnapshot!, {takeovers: null});
        expect(invoiceHasAppliedTakeoverEvidence(malformed)).toBe(true);
        expect(invoiceAppliedTakeovers(malformed)).toEqual([{payerRegistrationId: 1, beneficiaryRegistrationId: 2}]);
        expect(invoiceHasPendingTakeovers(malformed)).toBe(false);
    });

    it.each(['OPEN', 'ORGANIZER_ONLY'])('uses current uncalculated coverage for %s without claiming pending saved changes', (status) => {
        const pool: InvoiceAppliedTakeoversInput = {status,
            takeovers: [{payerRegistrationId: 2, beneficiaryRegistrationId: 3}],
            calculationSnapshot: {takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 3}]}};
        expect(invoiceAppliedTakeovers(pool)).toEqual([{payerRegistrationId: 2, beneficiaryRegistrationId: 3}]);
        expect(invoiceHasAppliedTakeoverEvidence(pool)).toBe(true);
        expect(invoiceHasPendingTakeovers(pool)).toBe(false);
    });

    it('compares pair identity instead of order, duplicate entries or unrelated current participant names', () => {
        const pool: InvoiceAppliedTakeoversInput = {status: 'CLOSED', takeovers: [
            {payerRegistrationId: 5, beneficiaryRegistrationId: 3},
            {payerRegistrationId: 1, beneficiaryRegistrationId: 4},
            {payerRegistrationId: 1, beneficiaryRegistrationId: 4},
        ], calculationSnapshot: {takeovers: [
            {payerRegistrationId: 1, beneficiaryRegistrationId: 4},
            {payerRegistrationId: 5, beneficiaryRegistrationId: 3},
        ]}};
        const before = structuredClone(pool);
        expect(invoiceHasPendingTakeovers(pool)).toBe(false);
        expect(invoiceAppliedTakeovers(pool)).toEqual(before.calculationSnapshot!.takeovers);
        expect(pool).toEqual(before);
    });
});

describe('contextual invoice pool summaries', () => {
    it('separates current costs from saved credits, transfers and rounding against the frozen base', () => {
        const pool: InvoicePoolSummaryInput = {status: 'CLOSED', totalAmount: 125, invoiceAmount: 120,
            payableAmount: 110, openAmount: 12, surcharges: [
                {registrationId: 1, amount: 10, subtractFromPool: true},
                {registrationId: 1, amount: 5, subtractFromPool: false},
            ], calculationSnapshot: {explanation: calculationExplanation()}, shares: [
                calculationShare({baseShareAmount: 75.01, invoiceCreditAmount: 10, paymentCreditAmount: 20,
                    shareAmount: 45.01, isPaid: true}),
                calculationShare({registrationId: 2, baseShareAmount: 25, paymentCreditAmount: -20, shareAmount: 45}),
            ]};
        const before = structuredClone(pool);
        const summary = invoicePoolSummary(pool);
        expect(summary.primary.map(row => [row.key, row.amount])).toEqual([
            ['totalAmount', 125], ['payableAmount', 110], ['outstandingAmount', 45], ['creditAmount', 0],
        ]);
        expect(summary.details.map(row => [row.key, row.amount])).toEqual([
            ['invoiceAmount', 120], ['redistributedSurcharges', 10], ['additionalSurcharges', 5], ['openAmount', 12],
        ]);
        expect(summary.details.at(-1)!.label).toBe('Accepted invoice costs');
        expect(summary.saved.map(row => [row.key, row.amount])).toEqual([
            ['invoiceCreditAmount', 10], ['paymentCreditAmount', 0], ['paymentsReceived', 45.01], ['roundingDifference', 0.01],
        ]);
        // Current source costs cannot retroactively alter the saved calculation's rounding or recorded transfers.
        expect(pool).toEqual(before);
    });

    it('retains all gross adjustment categories and a distinct base when each mode nets to zero', () => {
        const summary = invoicePoolSummary({status: 'OPEN', totalAmount: 100, invoiceAmount: 100, payableAmount: 100,
            surcharges: [{registrationId: 1, amount: 10, subtractFromPool: true},
                {registrationId: 2, amount: -10, subtractFromPool: true},
                {registrationId: 1, amount: 5, subtractFromPool: false},
                {registrationId: 2, amount: -5, subtractFromPool: false}]});
        expect(summary.primary.map(row => [row.key, row.amount])).toEqual([['totalAmount', 100], ['payableAmount', 100]]);
        expect(summary.details.map(row => [row.key, row.amount])).toEqual([
            ['invoiceAmount', 100], ['redistributedSurcharges', 10], ['redistributedRebates', -10],
            ['additionalSurcharges', 5], ['additionalRebates', -5],
        ]);
        expect(summary.saved).toEqual([]);
    });

    it('omits redundant and unused source totals but keeps applicable accepted invoice costs', () => {
        const summary = invoicePoolSummary({status: 'OPEN', totalAmount: 100, invoiceAmount: 100, payableAmount: 100, openAmount: 15});
        expect(summary.primary).toEqual([{key: 'totalAmount', label: 'Full pool total', amount: 100}]);
        expect(summary.details).toEqual([{key: 'openAmount', label: 'Accepted invoice costs', amount: 15}]);
        expect(invoicePoolSummary({totalAmount: 100, invoiceAmount: 100, openAmount: 0}).details).toEqual([]);
    });

    it('uses authoritative live due totals with a signed refund projection', () => {
        const summary = invoicePoolSummary({status: 'CLOSED', totalAmount: 75, outstandingAmount: 5, creditAmount: 8,
            shares: [calculationShare()]});
        expect(summary.primary.map(row => [row.key, row.amount])).toEqual([
            ['totalAmount', 75], ['outstandingAmount', 5], ['creditAmount', -8],
        ]);
    });

    it('preserves zero due totals and recorded payments or refunds after every share is settled', () => {
        const summary = invoicePoolSummary({status: 'CLOSED', totalAmount: 10, shares: [
            calculationShare({shareAmount: 10, isPaid: true}),
            calculationShare({registrationId: 2, shareAmount: -5, isPaid: true}),
        ]});
        expect(summary.primary.map(row => [row.key, row.amount])).toEqual([
            ['totalAmount', 10], ['outstandingAmount', 0], ['creditAmount', 0],
        ]);
        expect(summary.saved.map(row => [row.key, row.amount])).toEqual([['paymentsReceived', 10], ['refundsPaid', -5]]);
    });

    it('counts only transfers recorded in this calculation and retains opposing prior credits separately', () => {
        const shares = [calculationShare({shareAmount: '15.00', paymentCreditAmount: 20, invoiceCreditAmount: 2, isPaid: 1}),
            calculationShare({registrationId: 2, shareAmount: '-5.00', paymentCreditAmount: -20, isPaid: true}),
            calculationShare({registrationId: 3, shareAmount: 7, isPaid: false}),
            calculationShare({registrationId: 4, shareAmount: -3, isPaid: 0})];
        const before = structuredClone(shares);
        expect(invoiceSettlementRows(shares)).toEqual([
            {key: 'outstandingAmount', label: 'Payments due', amount: 7},
            {key: 'creditAmount', label: 'Refunds due', amount: -3},
            {key: 'invoiceCreditAmount', label: 'Invoice credit', amount: 2},
            {key: 'paymentCreditAmount', label: 'Previously settled', amount: 0},
            {key: 'paymentsReceived', label: 'Payments received', amount: 15},
            {key: 'refundsPaid', label: 'Refunds paid', amount: -5},
        ]);
        expect(shares).toEqual(before);
    });

    it('aggregates decimal strings in cents and omits inapplicable settlement detail rows', () => {
        expect(invoiceSettlementRows([calculationShare({shareAmount: '0.10'}), calculationShare({shareAmount: '0.20'})]))
            .toEqual([{key: 'outstandingAmount', label: 'Payments due', amount: 0.3},
                {key: 'creditAmount', label: 'Refunds due', amount: 0}]);
        expect(invoiceSettlementRows([])).toEqual([]);
    });
});

describe('invoice localization contract', () => {
    it('formats complete messages with named parameters and leaves supplied text uninterpreted', () => {
        expect(invoiceText('settlementHeading', {amount: '-25.00', status: 'Refunded'}))
            .toBe('Your calculated balance: -25.00 · Refunded');
        expect(invoiceText('participant', {id: '{name} <guest>'})).toBe('Participant #{name} <guest>');
        expect(() => invoiceText('participant')).toThrow('Missing invoice translation parameter: id');
    });

    it.each([1, 2, 21])('uses the selected catalog’s plural rules for %s covered participants', (count) => {
        const expected = count === 1 ? 'Covers 1 participant' : `Covers ${count} participants`;
        expect(invoiceText('participantsCovered', {count}, 'en-GB')).toBe(expected);
        // An unsupported language must fall back in both wording and grammar, rather than apply
        // that language's plural rules to English text (Russian treats 21 as a singular category).
        expect(invoiceText('participantsCovered', {count}, 'ru-RU')).toBe(expected);
    });

    it('selects regional catalogs predictably and preserves Joi’s own field placeholders', () => {
        expect(getInvoiceCatalog('EN-gb')).toBe(getInvoiceCatalog('en'));
        expect(getInvoiceCatalog('unsupported locale')).toBe(getInvoiceCatalog('en'));
        expect(invoiceText('validationRequired')).toBe('Enter a value for {{#label}}.');
    });
});
