import {describe, expect, it} from 'vitest';
import {buildInvoiceSettlementEmail} from '../../src/modules/invoice/settlementEmail';
import {renderEmail} from '../../src/modules/email';
import type {InvoiceSettlementNotice} from '../../src/types/InvoicePoolTypes';

function notice(share: Partial<InvoiceSettlementNotice['share']> = {}): InvoiceSettlementNotice {
    return {
        eventTitle: 'Shared trip', poolName: 'Travel', eventUrl: 'https://example.test/event/trip',
        actor: 'Organizer', reason: 'requested', needsRecalculation: false, payerName: 'Taylor Morgan',
        share: {registrationId: 1, baseShareAmount: 75, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: 50, shareAmount: 25, isPaid: false, ...share},
    };
}

/** Saved own and covered contributions belong to this payer; the unrelated payer stays outside their explanation. */
function calculation(): NonNullable<InvoiceSettlementNotice['explanation']> {
    return {
        version: 1, distributionMethod: 'NIGHTS', roundUpShares: true,
        invoiceAmount: 100, redistributedAmount: 0, distributableAmount: 100,
        assignedParticipants: 3, exemptParticipants: 0, attendanceUnits: 3, eligibleAttendanceUnits: 3,
        effectiveWeight: 4, weightDenominator: '40000',
        adjustmentTotals: {redistributedSurcharges: 0, redistributedRebates: 0, additionalSurcharges: 0, additionalRebates: 0},
        contributions: [
            {registrationId: 1, payerRegistrationId: 1, name: 'Taylor Morgan', attendanceWeight: 1, factor: 2,
                isExempt: false, effectiveWeight: 2, weightNumerator: '20000', baseShareAmount: 50},
            {registrationId: 2, payerRegistrationId: 1, name: 'Casey Rivera', attendanceWeight: 1, factor: 1,
                isExempt: false, effectiveWeight: 1, weightNumerator: '10000', baseShareAmount: 25},
            {registrationId: 3, payerRegistrationId: 3, name: 'Alex Jordan', attendanceWeight: 1, factor: 1,
                isExempt: false, effectiveWeight: 1, weightNumerator: '10000', baseShareAmount: 25},
        ],
    };
}

describe('invoice settlement emails', () => {
    it.each([25, -25])('preserves the original balance after a payment or refund of %s is settled', (shareAmount) => {
        const result = buildInvoiceSettlementEmail(notice({paymentCreditAmount: 75 - shareAmount, shareAmount, isPaid: true}));
        expect(result.heading).toBe(`Your calculated balance: ${shareAmount.toFixed(2)} · ${shareAmount < 0 ? 'Refunded' : 'Paid'}`);
        expect(result.details).toContainEqual({label: 'Your payment status', value: shareAmount < 0 ? 'Refunded' : 'Paid'});
        expect(result.details).toContainEqual({label: 'Your previous payments or refunds', value: (75 - shareAmount).toFixed(2)});
        // The signed heading preserves the original transfer without duplicate or zeroed derived amount rows.
        expect(result.details?.some(detail => ['Your calculated balance', 'Calculated share', 'Your recorded payment or refund',
            'Your unsettled balance', 'Amount due', 'Amount owed to you'].includes(detail.label))).toBe(false);
    });

    it.each([
        [50, 25, 'Your calculated balance: 25.00 · Payment due'],
        [100, -25, 'Your calculated balance: -25.00 · Refund due'],
    ] as const)('reports the signed calculated balance after %s was settled earlier', (paymentCreditAmount, shareAmount, heading) => {
        const result = buildInvoiceSettlementEmail(notice({paymentCreditAmount, shareAmount}));
        expect(result.heading).toBe(heading);
        expect(result.details).toContainEqual({label: 'Your base share', value: '75.00'});
        expect(result.details).toContainEqual({label: 'Your previous payments or refunds', value: paymentCreditAmount.toFixed(2)});
    });

    it('describes zero calculated balance as requiring no payment and identifies a saved calculation awaiting an update', () => {
        const result = buildInvoiceSettlementEmail({...notice({paymentCreditAmount: 75, shareAmount: 0}), needsRecalculation: true});
        expect(result.heading).toBe('Your calculated balance: 0.00 · No payment');
        expect(result.details).toContainEqual({label: 'Your payment status', value: 'No payment'});
        expect(result.paragraphs!.join(' ')).toContain('saved settlement');
        expect(result.paragraphs!.join(' ')).toContain('a new calculation may change your balance');
        expect(result.notice).toBeUndefined();
    });

    it('formats the complete actual payer calculation with every own and covered contribution', () => {
        const input = {...notice(), explanation: calculation()};
        const before = structuredClone(input);
        const result = buildInvoiceSettlementEmail(input);
        const group = result.sectionGroups![0];
        const sections = group.sections;
        expect(group).toMatchObject({title: 'Calculation explanation', disclosure: true});
        expect(sections.find(section => section.title === 'Base share for Taylor Morgan')!.formula).toEqual({
            terms: [{label: 'Base to distribute', value: '100.00'},
                {label: 'Nights stayed', value: '1', operator: '×'},
                {label: 'Share factor', value: '2', operator: '×'},
                {label: 'Total weight', value: '4', operator: '÷'}],
            result: {label: 'Base share', value: '50.00'}, note: 'Rounded up to cents.',
        });
        expect(sections.find(section => section.title === 'Base share for Casey Rivera')!.formula).toMatchObject({
            terms: [{value: '100.00'}, {label: 'Nights stayed', value: '1'}, {label: 'Share factor', value: '1'}, {value: '4'}],
            result: {label: 'Base share', value: '25.00'},
        });
        const coverage = sections.find(section => section.title === 'Participants covered by Taylor Morgan')!;
        expect(coverage.paragraphs).toEqual(['Covers 1 other participant']);
        expect(coverage.items).toEqual(['Casey Rivera']);
        expect(sections.indexOf(coverage)).toBeLessThan(sections.findIndex(section => section.title === 'Base share for Casey Rivera'));
        expect(sections.find(section => section.title === 'Combined base shares')!.formula).toEqual({
            terms: [{label: 'Base share for Taylor Morgan', value: '50.00'},
                {label: 'Base share for Casey Rivera', value: '25.00', operator: '+'}],
            result: {label: 'Base share', value: '75.00'},
        });
        expect(sections.find(section => section.title === 'Calculated balance for Taylor Morgan')!.formula).toEqual({
            terms: [{label: 'Base share', value: '75.00'}, {label: 'Previously settled', value: '50.00', operator: '−'}],
            result: {label: 'Calculated balance', value: '25.00'},
        });
        expect(JSON.stringify(sections)).not.toMatch(/Alex Jordan|Participant A|Payer A|example|surcharge|rebate|invoice credit/iu);
        expect(input).toEqual(before);
    });

    it('keeps the unused component rows out of an unadjusted first-calculation notice', () => {
        const result = buildInvoiceSettlementEmail(notice({paymentCreditAmount: 0, shareAmount: 75}));
        expect(result.details).toContainEqual({label: 'Your base share', value: '75.00'});
        expect(result.details?.some(detail => ['Your adjustments', 'Your invoice credit', 'Your previous payments or refunds'].includes(detail.label))).toBe(false);
    });

    it('uses frozen adjustment provenance to explain cancelling categories in older numeric snapshots', () => {
        const input = {...notice(), explanation: calculation(), savedAdjustments: [
            {registrationId: 1, amount: 20, subtractFromPool: true},
            {registrationId: 1, amount: -20, subtractFromPool: true},
            {registrationId: 2, amount: 5, subtractFromPool: false},
            {registrationId: 2, amount: -5, subtractFromPool: false},
        ]};
        delete input.explanation.adjustmentTotals;
        const result = buildInvoiceSettlementEmail(input);
        // Net zero cannot erase the distinction between redistribution and changes added after the split.
        const sections = result.sectionGroups![0].sections;
        expect(sections[0].formula!.terms).toEqual([{label: 'Invoice costs', value: '100.00'},
            {label: 'Redistributed surcharges', value: '20.00', operator: '−'},
            {label: 'Redistributed rebates', value: '-20.00', operator: '−'}]);
        expect(sections.some(section => section.title === 'Full pool total')).toBe(false);
        expect(sections.some(section => section.formula?.result.label === 'Full pool total')).toBe(false);
        const balance = sections.find(section => section.title === 'Calculated balance for Taylor Morgan')!.formula!;
        expect(balance.terms.map(term => [term.label, term.value])).toEqual([
            ['Base share', '75.00'], ['Redistributed surcharges', '20.00'], ['Redistributed rebates', '-20.00'],
            ['On-top surcharges', '5.00'], ['On-top rebates', '-5.00'], ['Previously settled', '50.00'],
        ]);
        expect(balance.result.value).toBe('25.00');
        expect(result.details?.filter(detail => /surcharge|rebate/i.test(detail.label))).toHaveLength(4);
    });

    it('preserves negative refunds carried from an earlier calculation', () => {
        const result = buildInvoiceSettlementEmail(notice({baseShareAmount: 50, invoiceCreditAmount: 100,
            paymentCreditAmount: -10, shareAmount: -40}));
        expect(result.heading).toBe('Your calculated balance: -40.00 · Refund due');
        expect(result.details).toContainEqual({label: 'Your invoice credit', value: '100.00'});
        expect(result.details).toContainEqual({label: 'Your previous payments or refunds', value: '-10.00'});
    });

    it('retains legacy saved notes without inventing missing attendance numbers and escapes them in the email', () => {
        const note = 'Saved receipt <img src=x onerror=alert(1)> & travel rebate';
        const result = buildInvoiceSettlementEmail(notice({note}));
        const sections = result.sectionGroups![0].sections;
        expect(sections.find(section => section.title === 'Base calculation')!.paragraphs!.join(' ')).toContain('inputs were not saved');
        expect(sections[0].formula).toBeUndefined();
        expect(JSON.stringify(sections)).not.toMatch(/Participant A|Nights stayed|Days attended|Share factor/u);
        expect(result.sections).toEqual([{title: 'Saved calculation notes', items: [note]}]);
        expect(sections.some(section => section.items?.includes(note))).toBe(false);
        const rendered = renderEmail('Saved invoice share', result, {name: 'Taylor', address: 'taylor@example.test'});
        // Structured notes remain readable text in both representations, never executable email markup.
        expect(rendered.text).toContain(note);
        expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; travel rebate');
        expect(rendered.html).not.toContain('<img src=x onerror=alert(1)>');
    });

    it('keeps factual saved notes separate from the complete structured arithmetic', () => {
        const note = 'Taylor Morgan: 1 night × factor 2 • Casey Rivera covered by Taylor Morgan';
        const result = buildInvoiceSettlementEmail({...notice({note}), explanation: calculation()});
        const notes = result.sections!.find(section => section.title === 'Saved calculation notes')!;
        expect(notes.items).toEqual(['Taylor Morgan: 1 night × factor 2', 'Casey Rivera covered by Taylor Morgan']);
        expect(notes.formula).toBeUndefined();
        expect(result.sections).toEqual([{title: 'Saved calculation notes', items: [
            'Taylor Morgan: 1 night × factor 2', 'Casey Rivera covered by Taylor Morgan',
        ]}]);
        expect(JSON.stringify(result.sectionGroups)).not.toContain('Casey Rivera covered by Taylor Morgan');
        expect(result.sectionGroups![0].sections.find(section => section.title === 'Base share for Casey Rivera')!.formula!.result.value).toBe('25.00');
    });

    it.each([
        {reason: 'zero factor', attendance: 3, factor: 0, totalAttendance: 5, metrics: [
            {label: 'Nights stayed', value: '3'}, {label: 'Share factor', value: '0'},
            {label: 'Distribution weight', value: '0'}, {label: 'Base share', value: '0.00'},
        ]},
        {reason: 'zero nights', attendance: 0, factor: 1, totalAttendance: 2, metrics: [
            {label: 'Nights stayed', value: '0'}, {label: 'Distribution weight', value: '0'},
            {label: 'Base share', value: '0.00'},
        ]},
    ])('includes named saved inputs for $reason while preserving covered calculations', (scenario) => {
        const explanation = calculation();
        explanation.attendanceUnits = scenario.totalAttendance;
        explanation.eligibleAttendanceUnits = scenario.totalAttendance;
        explanation.effectiveWeight = 2;
        explanation.weightDenominator = '20000';
        Object.assign(explanation.contributions[0], {attendanceWeight: scenario.attendance, factor: scenario.factor,
            effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0});
        explanation.contributions[1].baseShareAmount = 50;
        explanation.contributions[2].baseShareAmount = 50;
        const result = buildInvoiceSettlementEmail({...notice({baseShareAmount: 50, shareAmount: 0}), explanation});
        const sections = result.sectionGroups![0].sections;
        const own = sections.find(section => section.title === 'Base share for Taylor Morgan')!;
        expect(own.details).toEqual(scenario.metrics);
        expect(own.paragraphs!.join(' ')).toContain('no positive distribution weight');
        expect(own.formula).toBeUndefined();
        expect(sections.find(section => section.title === 'Base share for Casey Rivera')!.formula!.result.value).toBe('50.00');
        expect(JSON.stringify(sections)).not.toMatch(/Alex Jordan|Participant A|Payer A|NaN|Infinity/u);
        const rendered = renderEmail('Saved invoice share', result, {name: 'Taylor Morgan', address: 'taylor@example.test'});
        expect(rendered.text).toContain(`Nights stayed: ${scenario.attendance}`);
        expect(rendered.text).toContain('Distribution weight: 0');
        expect(rendered.text).toContain('Base share: 0.00');
    });

    it('retains named personal zero-weight inputs without dividing by a zero global denominator', () => {
        const explanation = calculation();
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
        const result = buildInvoiceSettlementEmail({...notice({baseShareAmount: 0, paymentCreditAmount: 0, shareAmount: 0}), explanation});
        const sections = result.sectionGroups![0].sections;
        const own = sections.find(section => section.title === 'Base share for Taylor Morgan')!;
        expect(own.details).toEqual([{label: 'Nights stayed', value: '1'}, {label: 'Share factor', value: '0'},
            {label: 'Distribution weight', value: '0'}, {label: 'Base share', value: '0.00'}]);
        expect(own.formula).toBeUndefined();
        expect(result.heading).toBe('Your calculated balance: 0.00 · No payment');
        expect(JSON.stringify(sections)).not.toMatch(/Alex Jordan|NaN|Infinity|"operator":"÷"/u);
    });

    it('explains a former payer refund using only their own credit and preserves leading subtraction in text', () => {
        const input = {...notice({registrationId: 99, baseShareAmount: 0, paymentCreditAmount: 15, shareAmount: -15}),
            payerName: 'Former payer', explanation: calculation()};
        const result = buildInvoiceSettlementEmail(input);
        const sections = result.sectionGroups![0].sections;
        const balance = sections.find(section => section.title === 'Calculated balance for Former payer')!.formula!;
        expect(balance).toEqual({terms: [{label: 'Previously settled', value: '15.00', operator: '−'}],
            result: {label: 'Calculated balance', value: '-15.00'}});
        expect(JSON.stringify(sections)).not.toMatch(/Taylor Morgan|Casey Rivera|Alex Jordan|Nights stayed|Base share for/u);
        const rendered = renderEmail('Saved invoice share', result, {name: 'Former payer', address: 'former@example.test'});
        expect(rendered.text).toContain('− Previously settled: 15.00 = Calculated balance: -15.00');
        expect(result.heading).toBe('Your calculated balance: -15.00 · Refund due');
    });

    it('places the main action before saved notes and one complete calculation disclosure in both representations', () => {
        const note = 'Taylor Morgan: saved attendance and factor';
        const result = buildInvoiceSettlementEmail({...notice({note}), explanation: calculation()});
        expect(result.actionPosition).toBe('beforeSections');
        expect(result.sections).toEqual([{title: 'Saved calculation notes', items: [note]}]);
        expect(result.sectionGroups).toHaveLength(1);
        const rendered = renderEmail('Saved invoice share', result, {name: 'Taylor Morgan', address: 'taylor@example.test'});
        // Balance/status/context and the action remain visible without opening the optional full explanation.
        const actionHtml = rendered.html.indexOf('>View your invoice pool</a>');
        const notesHtml = rendered.html.indexOf('>Saved calculation notes</h2>');
        const explanationHtml = rendered.html.indexOf('<details');
        expect(actionHtml).toBeGreaterThan(rendered.html.indexOf('Your calculated balance: 25.00'));
        expect(actionHtml).toBeLessThan(notesHtml);
        expect(notesHtml).toBeLessThan(explanationHtml);
        expect(rendered.html).toMatch(/<summary[^>]*>Calculation explanation<\/summary>/u);
        expect(rendered.text.indexOf('View your invoice pool:')).toBeLessThan(rendered.text.indexOf('Saved calculation notes'));
        expect(rendered.text.indexOf('Saved calculation notes')).toBeLessThan(rendered.text.indexOf('Calculation explanation'));
        expect(rendered.text.indexOf(note)).toBeLessThan(rendered.text.indexOf('Calculation explanation'));
        expect(rendered.text.indexOf(note)).toBeLessThan(rendered.text.indexOf('Base share for Taylor Morgan'));
        // The text alternative includes every real own/covered formula and the signed final result.
        expect(rendered.text).toContain('Base share for Taylor Morgan');
        expect(rendered.text).toContain('Base share for Casey Rivera');
        expect(rendered.text).toContain('Base to distribute: 100.00 × Nights stayed: 1 × Share factor: 2 ÷ Total weight: 4 = Base share: 50.00');
        expect(rendered.text).toContain('Base share: 75.00 − Previously settled: 50.00 = Calculated balance: 25.00');
        expect(rendered.text).toContain('Rounded up to cents.');
        expect(rendered.text.indexOf('Covers 1 other participant')).toBeLessThan(rendered.text.indexOf('Base share for Casey Rivera'));
        expect(rendered.text.indexOf('- Casey Rivera')).toBeLessThan(rendered.text.indexOf('Base share for Casey Rivera'));
        expect(rendered.html).toContain('Covers 1 other participant');
        const beneficiaryHtml = rendered.html.indexOf('>Casey Rivera</li>');
        expect(beneficiaryHtml).toBeGreaterThan(-1);
        expect(beneficiaryHtml).toBeLessThan(rendered.html.indexOf('>Base share for Casey Rivera</h2>'));
    });

    it.each([-50, 50, 0])('explains an applied responsibility change with its saved signed balance of %s', (balance) => {
        const input = {...notice({baseShareAmount: 0, paymentCreditAmount: -balance, shareAmount: balance,
            isPaid: balance === 0}), reason: 'responsibility-changed' as const,
            settledShareNotice: {label: 'You are exempt · settlement retained',
                description: 'You are now exempt. Your previously recorded payments or refunds stay with you.'}};
        const result = buildInvoiceSettlementEmail(input);
        expect(result.heading).toContain(balance.toFixed(2));
        expect(result.paragraphs).toContain(input.settledShareNotice.description);
        expect(result.paragraphs![0]).toContain('Your payment responsibility changed');
        expect(result.details).toContainEqual({label: 'Your payment status', value: balance < 0 ? 'Refund due' : balance > 0 ? 'Payment due' : 'No payment'});
    });

    it('shows material stale context before the action without repeating it after the calculation', () => {
        const result = buildInvoiceSettlementEmail({...notice(), explanation: calculation(), needsRecalculation: true});
        const rendered = renderEmail('Saved invoice share', result, {name: 'Taylor Morgan', address: 'taylor@example.test'});
        const warning = 'a new calculation may change your balance';
        expect(rendered.html.indexOf(warning)).toBeLessThan(rendered.html.indexOf('>View your invoice pool</a>'));
        expect(rendered.text.indexOf(warning)).toBeLessThan(rendered.text.indexOf('View your invoice pool:'));
        expect(rendered.text.match(/a new calculation may change your balance/gu)).toHaveLength(1);
    });

    it('does not manufacture saved notes from contribution metadata when no immutable note was recorded', () => {
        const result = buildInvoiceSettlementEmail({...notice(), explanation: calculation()});
        expect(result.sections).toEqual([]);
        expect(JSON.stringify(result.sectionGroups)).not.toMatch(/Saved source notes|Your saved calculation notes|You stayed/u);
        expect(result.heading).toBe('Your calculated balance: 25.00 · Payment due');
        expect(result.sectionGroups![0].sections.find(section => section.title === 'Base share for Taylor Morgan')!.formula)
            .toBeDefined();
    });
});
