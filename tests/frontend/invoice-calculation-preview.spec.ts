import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import {renderPoolCalculationPreview} from '../../src/public/js/events';
import {invoiceLabels} from '../../src/modules/invoice/wording';
import {invoicePresentation} from '../../src/modules/invoice/presentation';

type Preview = Parameters<typeof renderPoolCalculationPreview>[1];

class NodeStub {
    hidden = true;
    dataset: Record<string, string> = {};
    children: NodeStub[] = [];
    className = '';
    attributes = new Map([['hidden', '']]);
    private content = '';
    get textContent(): string { return this.content + this.children.map(child => child.textContent).join(''); }
    set textContent(value: string) { this.content = value; this.children = []; }
    appendChild(child: NodeStub) { this.children.push(child); return child; }
    append(...children: NodeStub[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; this.content = ''; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
}

function previewModal() {
    const elements = Object.fromEntries([
        'rows', 'columns', 'outstanding', 'refunds', 'table', 'summary', 'reconciliation', 'basis', 'basis-lines', 'distribution', 'example', 'settlement-hint',
        'total:roundingDifference', 'total:invoiceCreditAmount', 'total:paymentCreditAmount',
        'row:roundingDifference', 'row:invoiceCreditAmount', 'row:paymentCreditAmount',
    ].map(name => [name, new NodeStub()]));
    const modal = Object.assign(new NodeStub(), {
        querySelector(selector: string) {
            const total = /^\[data-preview-total="(.+)"\]$/.exec(selector)?.[1];
            if (total) return elements[`total:${total}`];
            const row = /^\[data-preview-total-row="(.+)"\]$/.exec(selector)?.[1];
            if (row) return elements[`row:${row}`];
            const name = /^\[data-pool-preview-(.+)]$/.exec(selector)?.[1];
            return name ? elements[name] : null;
        },
    });
    vi.stubGlobal('document', {
        createElement: () => new NodeStub(),
        getElementById: () => ({textContent: JSON.stringify(invoiceLabels)}),
    });
    return {modal: modal as unknown as HTMLElement, elements};
}

function share(overrides: Partial<Preview['shares'][number]> = {}): Preview['shares'][number] {
    return {
        registrationId: 1, payerName: 'Participant', baseShareAmount: 75, extraAmount: 0,
        invoiceCreditAmount: 0, paymentCreditAmount: 50, shareAmount: 25, isPaid: false, ...overrides,
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('invoice calculation preview', () => {
    it.each([
        [0.01, 100.01],
        [-0.01, 99.99],
    ] as const)('shows the signed rounding difference %s separately from recorded settlements', (roundingDifference, calculatedAmount) => {
        const {modal, elements} = previewModal();
        const remaining = Math.round((calculatedAmount - 50) * 100) / 100;
        renderPoolCalculationPreview(modal, {revision: 7, shares: [share({shareAmount: remaining})], totals: {
            invoiceAmount: 100, redistributedAmount: -20, distributableAmount: 120,
            allocatedBaseAmount: calculatedAmount + 20, roundingDifference, adjustmentAmount: -20,
            grossAmount: calculatedAmount, invoiceCreditAmount: 0, expectedNetAmount: 100,
            calculatedAmount, paymentCreditAmount: 50, outstandingAmount: remaining, creditAmount: 0,
        }});
        expect(elements['total:paymentCreditAmount'].textContent).toBe('50.00');
        expect(elements['total:roundingDifference'].textContent).toBe(roundingDifference.toFixed(2));
        expect(elements['row:invoiceCreditAmount'].hidden).toBe(true);
        expect(elements['row:roundingDifference'].hidden).toBe(false);
        expect(elements.reconciliation.hidden).toBe(false);
    });

    it('keeps the calculation breakdown while clearing exceptional totals when a later preview no longer needs them', () => {
        const {modal, elements} = previewModal();
        const totals = {
            invoiceAmount: 100, redistributedAmount: 0, distributableAmount: 100,
            allocatedBaseAmount: 100, roundingDifference: 0, adjustmentAmount: 0,
            grossAmount: 100, invoiceCreditAmount: 0, expectedNetAmount: 100,
            calculatedAmount: 100, paymentCreditAmount: 50, outstandingAmount: 50, creditAmount: 0,
        };
        renderPoolCalculationPreview(modal, {revision: 7, shares: [share({baseShareAmount: 100, shareAmount: 50})], totals});
        expect(elements.reconciliation.hidden).toBe(false);
        expect(elements['row:paymentCreditAmount'].hidden).toBe(false);
        expect(elements['row:roundingDifference'].hidden).toBe(true);
        expect(elements['settlement-hint'].hidden).toBe(false);

        renderPoolCalculationPreview(modal, {revision: 8, shares: [share({baseShareAmount: 100, paymentCreditAmount: 0, shareAmount: 100})],
            totals: {...totals, paymentCreditAmount: 0, outstandingAmount: 100}});
        expect(elements.reconciliation.hidden).toBe(false);
        expect(elements['row:paymentCreditAmount'].hidden).toBe(true);
        expect(elements['row:roundingDifference'].hidden).toBe(true);
        expect(elements['settlement-hint'].hidden).toBe(true);
        expect(elements.outstanding.textContent).toBe('100.00');
        expect(elements.refunds.textContent).toBe('0.00');
        expect(modal.dataset.previewRevision).toBe('8');
    });

    it('rejects incomplete reconciliation totals before allowing the preview revision to be applied', () => {
        const {modal} = previewModal();
        expect(() => renderPoolCalculationPreview(modal, {
            revision: 1, shares: [share()], totals: {invoiceAmount: 100} as Preview['totals'],
        })).toThrow('totals could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
    });

    it('shows settlement credits, remaining payments and refunds with participant details rendered as text', () => {
        const {modal, elements} = previewModal();
        const payerName = '<img src=x onerror=alert(1)> & Participant';
        const note = '<script>alert(1)</script> • Paid train tickets';
        renderPoolCalculationPreview(modal, {revision: 4, shares: [
            share({payerName, note}),
            share({registrationId: 2, baseShareAmount: 30, paymentCreditAmount: 40, shareAmount: -10}),
            share({registrationId: 3, baseShareAmount: 20, paymentCreditAmount: 20, shareAmount: 0, isPaid: true}),
        ]});
        const rows = elements.rows.children;
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain(payerName);
        expect(rows[0].textContent).toContain('<script>alert(1)</script>');
        expect(rows[0].children.find(cell => cell.dataset.label === 'Previously settled')!.textContent).toBe('50.00');
        expect(rows[0].children.find(cell => cell.dataset.label === 'Calculated balance')!.textContent).toBe('25.00Payment due');
        expect(rows[1].children.find(cell => cell.dataset.label === 'Calculated balance')!.textContent).toBe('-10.00Refund due');
        expect(rows[2].children.find(cell => cell.dataset.label === 'Calculated balance')!.textContent).toBe('0.00No payment');
        expect(elements.outstanding.textContent).toBe('25.00');
        expect(elements.refunds.textContent).toBe('-10.00');
        expect(elements.table.attributes.has('hidden')).toBe(false);
        expect(modal.dataset.previewRevision).toBe('4');
    });

    it('renders the labeled pool example while keeping each preview row limited to its calculation notes', () => {
        const {modal, elements} = previewModal();
        const explanation: Preview['explanation'] = {version: 1, distributionMethod: 'NIGHTS', roundUpShares: true,
            invoiceAmount: 120, redistributedAmount: 0, distributableAmount: 120,
            assignedParticipants: 2, exemptParticipants: 0, attendanceUnits: 8, eligibleAttendanceUnits: 8,
            effectiveWeight: 10, weightDenominator: '10', contributions: [
                {registrationId: 1, payerRegistrationId: 1, name: '<Payer>', attendanceWeight: 4, factor: 1.5,
                    isExempt: false, effectiveWeight: 6, weightNumerator: '6', baseShareAmount: 72},
                {registrationId: 2, payerRegistrationId: 2, name: 'Other payer', attendanceWeight: 4, factor: 1,
                    isExempt: false, effectiveWeight: 4, weightNumerator: '4', baseShareAmount: 48},
            ]};
        const saved = share({payerName: '<Payer>', baseShareAmount: 72, shareAmount: 22, note: 'Saved train receipt'});
        renderPoolCalculationPreview(modal, {revision: 4, explanation,
            calculation: invoicePresentation.calculation(explanation, [saved]),
            shares: [{...saved, calculation: invoicePresentation.payerCalculation(explanation, saved)}]});
        expect(elements['basis-lines'].children[0].className).toBe('invoice-calculation');
        expect(elements['basis-lines'].textContent).toContain('Participant A');
        expect(elements['basis-lines'].textContent).not.toContain('<Payer>');
        for (const label of ['Nights stayed', 'Share factor', 'Total weight']) expect(elements['basis-lines'].textContent).toContain(label);
        // Pool-wide counts are facts in the global breakdown, while the example uses the same divisor in its formula.
        expect(elements.distribution.textContent).toContain('Total nights8');
        expect(elements.distribution.textContent).toContain('Total weight10');
        expect(elements.distribution.textContent).not.toContain('×');
        expect(elements.distribution.textContent).not.toContain('sum of');
        expect(elements['basis-lines'].textContent).not.toContain('Total nights');
        expect(elements['basis-lines'].children[0].children.some(node => node.dataset.calculationSection === 'attendance')).toBe(false);
        expect(elements.basis.hidden).toBe(false);
        expect(elements.example.hidden).toBe(false);
        expect(elements.rows.textContent).not.toContain('Base share for <Payer>');
        expect(elements.rows.textContent).not.toContain('Calculation explanation');
        expect(elements.rows.textContent).toContain('Saved train receipt');
    });

    it.each([null, '', ' • ', '  '])('omits the preview notes disclosure when no actual notes exist (%s)', (note) => {
        const {modal, elements} = previewModal();
        const saved = share({note});
        renderPoolCalculationPreview(modal, {revision: 1,
            shares: [{...saved, calculation: invoicePresentation.payerCalculation(undefined, saved)}]});
        // A detailed presentation may still be available elsewhere, but it must not create an empty preview disclosure.
        expect(elements.rows.children[0].children[0].children).toHaveLength(1);
        expect(elements.rows.textContent).not.toContain('Calculation details');
        expect(elements.rows.textContent).not.toContain('Calculation explanation');
    });

    it('preserves escaped coverage item order in both structured calculation renderers', () => {
        const names = ['<img src=x onerror=alert(1)> First participant', 'Second & participant'];
        const calculation: NonNullable<Preview['calculation']> = {title: 'Calculation explanation', sections: [
            {key: 'coverage', title: 'Covered participants', items: names, metrics: [{label: 'Count', value: '2'}]},
        ]};
        const {modal, elements} = previewModal();
        renderPoolCalculationPreview(modal, {revision: 1, shares: [share()], calculation});
        const section = elements['basis-lines'].children[0].children.find(node => node.dataset.calculationSection === 'coverage')!;
        const list = section.children.find(node => node.className === 'small text-secondary ps-3 mb-2')!;
        expect(list.children.map(node => node.textContent)).toEqual(names);
        expect(section.children.indexOf(list)).toBeLessThan(section.children.findIndex(node => node.className.includes('invoice-share-breakdown')));

        // The server mixin escapes the same names instead of introducing submitted HTML into its compact roster.
        const output = renderInvoiceFragment('+invoiceCalculationDisplay(pool.calculation)', {calculation});
        expect(output).toContain('<li>&lt;img src=x onerror=alert(1)&gt; First participant</li><li>Second &amp; participant</li>');
        expect(output).not.toContain('<img src=x');
    });

    it('drops unused optional columns when a later preview contains an ordinary allocation', () => {
        const {modal, elements} = previewModal();
        renderPoolCalculationPreview(modal, {revision: 4, shares: [share({extraAmount: 10, invoiceCreditAmount: 5, shareAmount: 30})]});
        expect(elements.columns.children.map(cell => cell.textContent)).toEqual([
            'Payer', 'Base share', 'Adjustments', 'Invoice credit', 'Previously settled', 'Calculated balance',
        ]);
        renderPoolCalculationPreview(modal, {revision: 5, shares: [share({paymentCreditAmount: 0, shareAmount: 75})]});
        expect(elements.columns.children.map(cell => cell.textContent)).toEqual(['Payer', 'Base share', 'Calculated balance']);
        expect(elements.rows.children[0].children.map(cell => cell.dataset.label)).toEqual(['Payer', 'Base share', 'Calculated balance']);
        expect(elements['settlement-hint'].hidden).toBe(true);
    });

    it('keeps used component columns when opposite payer amounts cancel in the aggregate', () => {
        const {modal, elements} = previewModal();
        renderPoolCalculationPreview(modal, {revision: 4, shares: [
            share({extraAmount: 5, paymentCreditAmount: 20, shareAmount: 60}),
            share({registrationId: 2, extraAmount: -5, paymentCreditAmount: -20, shareAmount: 90}),
        ]});
        expect(elements.columns.children.map(cell => cell.textContent)).toEqual([
            'Payer', 'Base share', 'Adjustments', 'Previously settled', 'Calculated balance',
        ]);
        expect(elements.rows.children[1].children.find(cell => cell.dataset.label === 'Adjustments')!.textContent).toBe('-5.00');
        expect(elements.rows.children[1].children.find(cell => cell.dataset.label === 'Previously settled')!.textContent).toBe('-20.00');
        expect(elements['settlement-hint'].hidden).toBe(false);
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid revision of %s', (revision) => {
        const {modal, elements} = previewModal();
        expect(() => renderPoolCalculationPreview(modal, {revision, shares: [share()]})).toThrow('could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
        expect(elements.rows.children).toHaveLength(0);
    });

    it.each([NaN, Infinity, '', null])('rejects an invalid settlement amount %s', (amount) => {
        const {modal} = previewModal();
        const invalidShare = share({paymentCreditAmount: amount as number});
        expect(() => renderPoolCalculationPreview(modal, {revision: 1, shares: [invalidShare]})).toThrow('could not be verified');
        expect(modal.dataset.previewRevision).toBeUndefined();
    });
});

/** Render the production mixin with explicit feature data, without an application, session, or database. */
function renderInvoiceFragment(fragment: string, pool: Record<string, unknown>, savedShare?: Preview['shares'][number]): string {
    const filename = resolve('src/views/modules/module_invoice_pool.pug');
    // Append only a fixed test-owned mixin invocation. The filename preserves production relative includes.
    const source = readFileSync(filename, 'utf8') + '\n' + fragment;
    // The same presentation owner supplies optional columns and wording to real renderer calls.
    return pug.render(source, {filename, pool, share: savedShare, ui: invoicePresentation});
}

describe('rendered invoice overviews', () => {
    it('keeps preview figures and example arithmetic in separate collapsed disclosures', () => {
        const pool = {id: 'preview-sections', name: 'Shared costs', status: 'CLOSED', distributionMethod: 'EQUAL',
            assignAll: true, assignments: [], takeovers: [], surcharges: [], invoices: [], shares: []};
        const output = renderInvoiceFragment("+poolManagementModals({id: 'event'}, pool, [], ui)", pool);
        const breakdown = /<details[^>]*data-pool-preview-reconciliation[^>]*>([\s\S]*?)<\/details>/.exec(output)!;
        const example = /<details([^>]*)data-pool-preview-example([^>]*)>([\s\S]*?)<\/details>/.exec(output)!;
        // Real production markup places the numerical hooks together without nesting the example inside them.
        expect(breakdown[1]).toContain('data-pool-preview-distribution');
        expect(breakdown[1]).not.toContain('data-pool-preview-basis-lines');
        expect(breakdown[1]).not.toContain('invoice-calculation-formula');
        expect(example[3]).toContain('data-pool-preview-basis-lines');
        expect(example[3]).toContain('Example calculation');
        expect(example[1] + example[2]).not.toMatch(/\bopen(?:=|\s|$)/);
        expect(output.indexOf(example[0])).toBeGreaterThan(output.indexOf(breakdown[0]) + breakdown[0].length - 1);
    });

    it('restores organizer and personal balance descriptions without adding a financial component', () => {
        const saved = share({paymentCreditAmount: 0, shareAmount: 75});
        const pool = {id: 'captions', name: 'Shared costs', status: 'CLOSED', shares: [saved],
            calculationSnapshot: {takeovers: []}, takeovers: []};
        const organizer = renderInvoiceFragment("+invoiceShareTable(pool, [], true, 'test-event', ui)", pool);
        const personal = renderInvoiceFragment('+participantShareSummary(1, [pool], ui)', pool);
        expect(organizer).toContain('data-share-balance-note');
        expect(organizer).toContain(invoicePresentation.balanceCaption(saved, 'organizer'));
        expect(personal).toContain('data-share-balance-note');
        expect(personal).toContain(invoicePresentation.balanceCaption(saved, 'participant'));
        expect(organizer).not.toContain(invoicePresentation.labels.remaining);
        expect(personal).not.toContain(invoicePresentation.labels.remaining);
    });

    it.each(['exempt', 'covered'] as const)('keeps a %s payer’s pending refund and ownership caption visible in both share ledgers', (reason) => {
        const saved = share({registrationId: 1, baseShareAmount: 0, paymentCreditAmount: 50,
            shareAmount: -50, isPaid: false, note: null});
        const pool = {id: 'history', name: 'Saved history', status: 'CLOSED', shares: [saved],
            calculationSnapshot: {settledRegistrationIds: [1], takeovers: reason === 'covered'
                ? [{payerRegistrationId: 2, beneficiaryRegistrationId: 1}] : [], explanation: {
                version: 1 as const, distributionMethod: 'EQUAL' as const, roundUpShares: true, invoiceAmount: 100,
                redistributedAmount: 0, distributableAmount: 100, assignedParticipants: 2,
                exemptParticipants: reason === 'exempt' ? 1 : 0, attendanceUnits: 2,
                eligibleAttendanceUnits: reason === 'exempt' ? 1 : 2, effectiveWeight: 1,
                weightDenominator: '1', contributions: [
                    {registrationId: 1, payerRegistrationId: reason === 'covered' ? 2 : 1, name: 'History payer',
                        attendanceWeight: 1, factor: 1, isExempt: reason === 'exempt', effectiveWeight: 0,
                        weightNumerator: '0', baseShareAmount: 0},
                    {registrationId: 2, payerRegistrationId: 2, name: 'Saved covering payer', attendanceWeight: 1,
                        factor: 1, isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 100},
                ],
            }},
            // Current edits deliberately disagree. The indicator must describe the applied calculation only.
            assignments: [{registrationId: 1, isExempt: reason !== 'exempt'}],
            takeovers: [{payerRegistrationId: 3, beneficiaryRegistrationId: 1}]};
        const notice = invoicePresentation.settledShareNotice(pool, saved, []);
        expect(notice).not.toBeNull();
        const organizer = renderInvoiceFragment("+invoiceShareTable(pool, [], true, 'test-event', ui)", pool);
        const personal = renderInvoiceFragment('+participantShareSummary(1, [pool], ui)', pool);
        for (const output of [organizer, personal]) {
            expect(output).toContain('data-share-settlement-history');
            expect(output).toContain(notice!.label);
            expect(output).toContain(notice!.description);
            expect(output).toContain(invoicePresentation.labels.refund);
        }
        if (reason === 'covered') expect(notice!.label).toContain('Saved covering payer');
        expect(organizer).toContain(invoicePresentation.text('ownShare'));
    });

    it('keeps closed applied coverage separate from editable pending responsibility', () => {
        const pool = {id: 'coverage', status: 'CLOSED', needsRecalculation: true,
            calculationSnapshot: {takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}]},
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 3}]};
        const output = renderInvoiceFragment("+poolTakeoverSummary(pool, [{id: 1, name: 'Payer'}, {id: 2, name: 'Applied beneficiary'}, {id: 3, name: 'Pending beneficiary'}], ui)", pool);
        const sections = output.split(invoicePresentation.text('pendingTakeoverChanges'));
        expect(sections).toHaveLength(2);
        expect(sections[0]).toContain('Applied beneficiary');
        expect(sections[0]).not.toContain('Pending beneficiary');
        expect(sections[0]).not.toContain('data-mode="admin"');
        expect(sections[1]).toContain('Pending beneficiary');
        expect(sections[1]).toContain('data-mode="admin"');
        expect(sections[1]).toContain('data-pool-takeover-pending');
        expect(sections[1]).toContain(invoicePresentation.text('takeoverChangesPendingDescription'));
        const header = renderInvoiceFragment('+poolHeaderSummary(pool, ui)', pool);
        expect(header).toContain(invoicePresentation.text('takeoverChangesPendingIndicator'));
        expect(header).toContain('data-pool-takeover-pending');
    });

    it('uses frozen contribution coverage when an older snapshot has no explicit takeover list', () => {
        const pool = {id: 'legacy-coverage', status: 'CLOSED', shares: [share()],
            calculationSnapshot: {explanation: {version: 1, distributionMethod: 'EQUAL', roundUpShares: true,
                invoiceAmount: 75, redistributedAmount: 0, distributableAmount: 75, assignedParticipants: 2,
                exemptParticipants: 0, attendanceUnits: 2, eligibleAttendanceUnits: 2, effectiveWeight: 2,
                weightDenominator: '2', contributions: [
                    {registrationId: 1, payerRegistrationId: 1, name: 'Payer', attendanceWeight: 1, factor: 1,
                        isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 37.5},
                    {registrationId: 2, payerRegistrationId: 1, name: 'Applied beneficiary', attendanceWeight: 1, factor: 1,
                        isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 37.5},
                ]}},
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 3}]};
        const output = renderInvoiceFragment("+invoiceShareTable(pool, [{id: 1, name: 'Payer'}, {id: 2, name: 'Applied beneficiary'}, {id: 3, name: 'Pending beneficiary'}], false, null, ui)", pool);
        expect(output).toContain(invoicePresentation.text('otherParticipantsCovered', {count: 1}));
        expect(output).toContain('Applied beneficiary');
        expect(output).not.toContain('Pending beneficiary');
        expect(output).not.toContain(invoicePresentation.text('coverageInSavedNotes'));
    });

    it('labels unknown legacy coverage without inventing an applied or pending baseline', () => {
        const pool = {id: 'unknown-coverage', status: 'CLOSED', shares: [share()], calculationSnapshot: {},
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}]};
        const summary = renderInvoiceFragment("+poolTakeoverSummary(pool, [{id: 1, name: 'Payer'}, {id: 2, name: 'Future beneficiary'}], ui)", pool);
        expect(summary).toContain(invoicePresentation.text('appliedTakeoversUnavailable'));
        expect(summary).toContain(invoicePresentation.text('takeoversForNextCalculation'));
        expect(summary).toContain('Future beneficiary');
        expect(summary).not.toContain(invoicePresentation.text('pendingTakeoverChanges'));
        const ledger = renderInvoiceFragment('+invoiceShareTable(pool, [], false, null, ui)', pool);
        expect(ledger).toContain(invoicePresentation.text('coverageInSavedNotes'));
        expect(ledger).not.toContain(invoicePresentation.text('ownShare'));
    });

    it('keeps the participant coverage chooser unavailable in the organizer-only state', () => {
        const pool = {id: 'organizer-only-coverage', name: 'Organizer-only pool', status: 'ORGANIZER_ONLY', assignAll: true,
            takeovers: [{payerRegistrationId: 1, beneficiaryRegistrationId: 2}]};
        const output = renderInvoiceFragment("+participantTakeoverList([pool], [{id: 1, name: 'Payer'}, {id: 2, name: 'Covered'}], ui, 1)", pool);
        expect(output).toContain('data-pool-status="ORGANIZER_ONLY"');
        expect(output).toContain('Covered');
        expect(output).toMatch(/manage-takeovers[^>]*disabled/);
    });

    it('offers both initial pool states in the creation form without requiring a state change afterward', () => {
        const output = renderInvoiceFragment("+invoicePoolCreateModal({id: 'creation-event'}, [], ui)", {});
        expect(output).toContain(invoicePresentation.text('poolSubmissionState'));
        expect(output).toContain('<option value="OPEN" selected="selected">Open for invoices</option>');
        expect(output).toContain('<option value="ORGANIZER_ONLY">Organizer invoices only</option>');
        expect(output).toContain(invoicePresentation.text('poolSubmissionStateHelp'));
        expect(output).not.toContain('value="CLOSED"');
    });

    it('keeps key transfer totals and an independently collapsed example while omitting unused source figures', () => {
        const pool = {status: 'CLOSED', totalAmount: 75, invoiceAmount: 75, payableAmount: 75,
            outstandingAmount: 75, creditAmount: 0, additionalAmount: 0, surchargeOffsetAmount: 0,
            surcharges: [], shares: [share({baseShareAmount: 50, paymentCreditAmount: 0, shareAmount: 50}),
                share({registrationId: 2, baseShareAmount: 25, paymentCreditAmount: 0, shareAmount: 25})],
            calculationSnapshot: {surcharges: [], explanation: {version: 1, distributionMethod: 'EQUAL', roundUpShares: true,
                invoiceAmount: 75, redistributedAmount: 0, distributableAmount: 75,
                assignedParticipants: 2, exemptParticipants: 0, attendanceUnits: 2, eligibleAttendanceUnits: 2,
                effectiveWeight: 3, weightDenominator: '3', contributions: [
                    {registrationId: 1, payerRegistrationId: 1, name: 'Payer', attendanceWeight: 1, factor: 2,
                        isExempt: false, effectiveWeight: 2, weightNumerator: '2', baseShareAmount: 50},
                    {registrationId: 2, payerRegistrationId: 2, name: 'Other payer', attendanceWeight: 1, factor: 1,
                        isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 25},
                ]}}};
        const output = renderInvoiceFragment('+poolStats(pool, ui)', pool);
        expect(output).toContain('Full pool total');
        expect(output).toContain('data-pool-outstanding');
        expect(output).toContain('data-pool-refunds');
        expect(output).toContain('Calculation breakdown');
        // The production markup makes the example a sibling, never a child of the factual breakdown.
        const breakdown = /<details[^>]*data-pool-calculation-breakdown[^>]*>([\s\S]*?)<\/details>/.exec(output)!;
        const example = /<details([^>]*)data-pool-example-calculation([^>]*)>([\s\S]*?)<\/details>/.exec(output)!;
        expect(breakdown).not.toBeNull();
        expect(example).not.toBeNull();
        expect(breakdown[1]).not.toContain('data-pool-example-calculation');
        expect(breakdown[1]).toContain('data-calculation-display');
        expect(breakdown[1]).toContain('data-calculation-section="attendance"');
        expect(breakdown[1]).toContain('Participants');
        expect(breakdown[1]).toContain('Total weight');
        expect(breakdown[1]).not.toContain('invoice-calculation-formula');
        expect(breakdown[1]).not.toContain('sum of');
        expect(breakdown[1]).not.toContain('Recorded payments and refunds apply');
        expect(example[1] + example[2]).not.toMatch(/\bopen(?:=|\s|$)/);
        expect(example[3]).toContain('Example calculation');
        expect(example[3]).toContain('data-calculation-display');
        expect(example[3]).not.toContain('data-calculation-section="attendance"');
        expect(example[3]).toContain('data-calculation-section="costs"');
        expect(example[3]).toContain('invoice-calculation-formula');
        expect(example[3].match(/Example calculation/g)).toHaveLength(1);
        expect(output.indexOf(example[0])).toBeGreaterThan(output.indexOf(breakdown[0]) + breakdown[0].length - 1);
        expect(output).not.toContain('<summary class="text-info">Base calculation</summary>');
        expect(output).toContain('Base to distribute');
        expect(output).not.toContain('Redistributed surcharges');
        expect(output).not.toContain('On-top surcharges');
    });

    it('preserves opposite source adjustments instead of hiding their categories when the net is zero', () => {
        const surcharges = [
            {registrationId: 1, amount: 20, subtractFromPool: true},
            {registrationId: 2, amount: -20, subtractFromPool: true},
            {registrationId: 1, amount: 30, subtractFromPool: false},
            {registrationId: 2, amount: -30, subtractFromPool: false},
        ];
        const pool = {status: 'OPEN', totalAmount: 75, invoiceAmount: 75, payableAmount: 75,
            additionalAmount: 0, surchargeOffsetAmount: 0, surcharges, shares: []};
        const output = renderInvoiceFragment('+poolStats(pool, ui)', pool);
        expect(output).toContain('Calculation breakdown');
        for (const adjustment of invoicePresentation.adjustmentRows(surcharges)) {
            expect(output).toContain(adjustment.label);
            expect(output).toContain(invoicePresentation.money(adjustment.amount));
        }
        expect(output).not.toContain('data-pool-outstanding');
        expect(output).not.toContain('data-pool-refunds');
    });

    it('retains distinct invoice costs and distributable base when used adjustments change them', () => {
        const pool = {status: 'OPEN', totalAmount: 105, invoiceAmount: 100, payableAmount: 80,
            additionalAmount: 5, surchargeOffsetAmount: 20, shares: [], surcharges: [
                {registrationId: 1, amount: 20, subtractFromPool: true},
                {registrationId: 1, amount: 5, subtractFromPool: false},
            ]};
        const output = renderInvoiceFragment('+poolStats(pool, ui)', pool);
        expect(output).toContain('Full pool total');
        expect(output).toContain('105.00');
        expect(output).toContain('Invoice costs');
        expect(output).toContain('100.00');
        expect(output).toContain('Base to distribute');
        expect(output).toContain('80.00');
    });

    it('omits unused share components while keeping the dialog balance and settlement status', () => {
        const saved = share({paymentCreditAmount: 0, shareAmount: 75, note: null});
        const output = renderInvoiceFragment('+invoiceShareBreakdown(pool, share, ui)', {}, saved);
        expect(output).toContain('Base share');
        expect(output).toContain('Calculated balance');
        expect(output).toContain('Payment due');
        for (const label of ['Adjustments', 'Invoice credit', 'Previously settled', 'Calculated share', 'Unsettled balance']) {
            expect(output).not.toContain(label);
        }
    });

    it('stores only the personal concrete calculation and excludes another payer from its lazy breakdown', () => {
        const personal = share({registrationId: 2, payerName: 'Personal payer name', paymentCreditAmount: 0, baseShareAmount: 25, shareAmount: 25});
        const other = share({registrationId: 1, payerName: 'Private payer name', extraAmount: 4444.44,
            paymentCreditAmount: 0, baseShareAmount: 25, shareAmount: 4469.44});
        const explanation = {version: 1, distributionMethod: 'EQUAL', roundUpShares: true,
            invoiceAmount: 50, redistributedAmount: 0, distributableAmount: 50,
            assignedParticipants: 2, exemptParticipants: 0, attendanceUnits: 2, eligibleAttendanceUnits: 2,
            effectiveWeight: 2, weightDenominator: '2', contributions: [
                {registrationId: 1, payerRegistrationId: 1, name: 'Private payer name', attendanceWeight: 1, factor: 1,
                    isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 25},
                {registrationId: 2, payerRegistrationId: 2, name: 'Personal payer name', attendanceWeight: 1, factor: 1,
                    isExempt: false, effectiveWeight: 1, weightNumerator: '1', baseShareAmount: 25},
            ]};
        const pool = {name: 'Travel costs', shares: [other, personal], calculationSnapshot: {explanation, surcharges: []}};
        const output = renderInvoiceFragment('+participantShareSummary(2, [pool], ui)', pool);
        expect(output).toContain('Base share for Personal payer name');
        expect(output).not.toContain('Private payer name');
        expect(output).not.toContain('Participant A');
        expect(output).not.toContain('data-calculation-display');
        expect(output).toContain('data-share-breakdown');
        expect(output).not.toContain('4469.44');
        expect(output).not.toContain('4444.44');
    });

    it('keeps a legacy prior refund signed in preview and grouped in the concrete personal formula', () => {
        const {modal, elements} = previewModal();
        const saved = share({baseShareAmount: 0, paymentCreditAmount: -10, shareAmount: 10});
        renderPoolCalculationPreview(modal, {revision: 1, shares: [saved],
            calculation: invoicePresentation.calculation(undefined, [saved])});
        const row = elements.rows.children[0];
        // Legacy input evidence cannot select an honest pool example; the actual personal balance remains explainable.
        expect(elements.distribution.textContent).toContain('Saved calculation inputsNot saved');
        expect(elements['basis-lines'].hidden).toBe(true);
        expect(elements.example.hidden).toBe(true);
        expect(elements['basis-lines'].textContent).not.toContain('(-10.00)');
        expect(row.children.find(cell => cell.dataset.label === 'Previously settled')!.textContent).toBe('-10.00');
        expect(row.children.find(cell => cell.dataset.label === 'Calculated balance')!.textContent).toBe('10.00Payment due');

        // The server-rendered dialog follows the same operand convention as the shared browser renderer.
        const output = renderInvoiceFragment('+invoiceShareBreakdown(pool, share, ui)', {}, saved);
        expect(output).toContain('<strong>(-10.00)</strong>');
    });

    it('renders hundreds of personal pool rows with one reusable modal and the established display controls', () => {
        const pools = Array.from({length: 180}, (_, index) => ({id: `pool-${index}`, name: `Pool ${index}`,
            shares: [share({paymentCreditAmount: 0, shareAmount: 75})]}));
        const filename = resolve('src/views/modules/module_invoice_pool.pug');
        const output = pug.render(readFileSync(filename, 'utf8') + '\n+participantShareSummary(1, pools, ui)',
            {filename, pools, ui: invoicePresentation});
        expect(output.match(/data-personal-share-ledger=/g)).toHaveLength(1);
        expect(output.match(/data-share-row=/g)).toHaveLength(180);
        expect(output.match(/class="modal fade pool-edit-modal"/g)).toHaveLength(1);
        expect(output).not.toContain('participant-share-card');
        expect(output).not.toContain('data-calculation-display');
        expect(output).not.toContain('<template');
        for (const hook of ['data-share-search', 'data-share-filter', 'data-share-sort', 'data-share-page-size', 'data-share-next']) {
            expect(output).toContain(hook);
        }
    });

    it('uses the explicitly supplied participant name for a legacy credit-only personal payer', () => {
        const filename = resolve('src/views/modules/module_invoice_pool.pug');
        const pool = {id: 'legacy', name: 'Earlier travel costs',
            shares: [share({payerName: undefined, baseShareAmount: 0, paymentCreditAmount: 50, shareAmount: -50})]};
        const participants = [{id: 1, name: 'Known former payer'}, {id: 2, name: 'Private participant'}];
        const output = pug.render(readFileSync(filename, 'utf8') + '\n+participantShareSummary(1, [pool], ui, participants)',
            {filename, pool, participants, ui: invoicePresentation});
        expect(output).toContain('Calculated balance for Known former payer');
        expect(output).not.toContain('Private participant');
        expect(output).not.toContain('Participant A');
        expect(output).toContain('-50.00');
    });

    it('restores labeled collapsed totals for closed pools, including completed transfers with no money still due', () => {
        const pool = {name: 'Travel costs', status: 'CLOSED', totalAmount: 75, outstandingAmount: 0, creditAmount: 0,
            shares: [share({paymentCreditAmount: 0, shareAmount: 75, isPaid: true})]};
        const output = renderInvoiceFragment('+poolHeaderSummary(pool, ui)', pool);
        expect(output).toContain('Full pool total');
        expect(output).toContain('75.00');
        expect(output).toContain('Payments due');
        expect(output).toContain('Refunds due');
        expect(output).toContain('data-pool-header-outstanding');
        expect(output).toContain('data-pool-header-refunds');
        expect(output).not.toContain('data-pool-outstanding=');
    });

    it('offers outlined saved-share PDF exports with and without the calculation example', () => {
        const pool = {id: 'export-pool', name: 'Travel costs', shares: [share()], takeovers: []};
        const output = renderInvoiceFragment("+invoiceShareTable(pool, [], true, 'test-event', ui)", pool);
        expect(output).toContain('href="/event/test-event/export/invoice-pools/export-pool/shares"');
        expect(output).toContain('href="/event/test-event/export/invoice-pools/export-pool/shares?example=false"');
        for (const key of ['exportPdfWithExample', 'exportPdfWithoutExample',
            'exportNamedSharesPdfWithExample', 'exportNamedSharesPdfWithoutExample'] as const) {
            expect(output).toContain(invoicePresentation.text(key, {poolName: pool.name}));
        }
        expect(output.match(/class="btn btn-outline-light btn-sm" href=/g)).toHaveLength(2);
    });
});
