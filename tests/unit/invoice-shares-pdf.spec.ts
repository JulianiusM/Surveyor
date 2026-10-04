import {describe, expect, it} from 'vitest';
import type {ContentTable, Node, NodeQueries, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {buildInvoiceSharesPdfDefinition} from '../../src/modules/invoice/exports';
import {invoiceText} from '../../src/modules/invoice/wording';
import type {InvoiceSharesPdfData} from '../../src/types/InvoicePoolTypes';

function fixture(): InvoiceSharesPdfData {
    return {
        event: {title: 'Summer gathering', timezone: 'Europe/Berlin'},
        pool: {id: 'saved-groceries', name: 'Shared groceries', closedAt: new Date('2026-09-14T10:00:00Z'), needsRecalculation: false},
        generatedAt: '2026-09-14T12:00:00Z',
        explanation: {
            version: 1, distributionMethod: 'NIGHTS', roundUpShares: true,
            invoiceAmount: 200, redistributedAmount: 0, distributableAmount: 200,
            assignedParticipants: 3, exemptParticipants: 0, attendanceUnits: 8, eligibleAttendanceUnits: 8,
            effectiveWeight: 8, weightDenominator: '80000',
            adjustmentTotals: {redistributedSurcharges: 0, redistributedRebates: 0, additionalSurcharges: 25, additionalRebates: -5},
            contributions: [
                {registrationId: 1, payerRegistrationId: 1, name: 'Alice', attendanceWeight: 3, factor: 1,
                    isExempt: false, effectiveWeight: 3, weightNumerator: '30000', baseShareAmount: 75},
                {registrationId: 3, payerRegistrationId: 3, name: 'Invoice submitter', attendanceWeight: 1, factor: 1,
                    isExempt: false, effectiveWeight: 1, weightNumerator: '10000', baseShareAmount: 25},
                {registrationId: 4, payerRegistrationId: 4, name: 'Settled payer', attendanceWeight: 4, factor: 1,
                    isExempt: false, effectiveWeight: 4, weightNumerator: '40000', baseShareAmount: 100},
            ],
        },
        savedAdjustments: [
            {registrationId: 1, amount: -5, subtractFromPool: false},
            {registrationId: 4, amount: 25, subtractFromPool: false},
        ],
        shares: [
            {registrationId: 1, name: 'Alice', baseShareAmount: 75, extraAmount: -5, invoiceCreditAmount: 0,
                paymentCreditAmount: 50, shareAmount: 20, isPaid: false, paidAt: null, note: 'Includes a rebate.'},
            {registrationId: 2, name: 'Former payer', baseShareAmount: 0, extraAmount: 0, invoiceCreditAmount: 0,
                paymentCreditAmount: 50, shareAmount: -50, isPaid: false, paidAt: null},
            {registrationId: 3, name: 'Invoice submitter', baseShareAmount: 25, extraAmount: 0, invoiceCreditAmount: 100,
                paymentCreditAmount: -50, shareAmount: -25, isPaid: false, paidAt: null},
            {registrationId: 4, name: 'Settled payer', baseShareAmount: 100, extraAmount: 25, invoiceCreditAmount: 0,
                paymentCreditAmount: 75, shareAmount: 50, isPaid: true, paidAt: new Date('2026-09-14T11:00:00Z')},
        ],
    };
}

/** Build a coherent one-payer snapshot whose invoice total is also its full pool total. */
function poolCostFixture(redistributed: boolean): InvoiceSharesPdfData {
    const data = fixture();
    const baseShareAmount = redistributed ? 195 : 200;
    // Keep the frozen aggregate, contribution, and saved balance in agreement for both cost modes.
    data.explanation = {...data.explanation!, invoiceAmount: 200, distributableAmount: baseShareAmount,
        redistributedAmount: redistributed ? 5 : 0, assignedParticipants: 1,
        attendanceUnits: 3, eligibleAttendanceUnits: 3, effectiveWeight: 3, weightDenominator: '30000',
        adjustmentTotals: {redistributedSurcharges: redistributed ? 10 : 0, redistributedRebates: redistributed ? -5 : 0,
            additionalSurcharges: 0, additionalRebates: 0},
        contributions: [{...data.explanation!.contributions[0], baseShareAmount}]};
    // An explicitly saved empty list certifies that this plain pool has no on-top adjustment features.
    data.savedAdjustments = redistributed ? [{registrationId: 1, amount: 10, subtractFromPool: true},
        {registrationId: 1, amount: -5, subtractFromPool: true}] : [];
    data.shares = [{...data.shares[0], baseShareAmount, extraAmount: redistributed ? 5 : 0,
        invoiceCreditAmount: 0, paymentCreditAmount: 0, shareAmount: 200, note: undefined}];
    return data;
}

function table(definition: TDocumentDefinitions): ContentTable {
    return (definition.content as object[]).find((content) => 'table' in content) as ContentTable;
}

function cellTexts(row: TableCell[]): unknown[] {
    return row.map((cell) => typeof cell === 'object' && cell !== null && 'text' in cell ? cell.text : cell);
}

/** Locate one visible display without confusing its facts with names in the saved share table. */
function displayContent(definition: TDocumentDefinitions, title: string): unknown {
    const content = definition.content as object[];
    return content.find(item => visiblePdfText(item).startsWith(title));
}

/** Read the visible wording of one PDF display, ignoring legal line-break opportunities. */
function displayText(definition: TDocumentDefinitions, title: string): string {
    return visiblePdfText(displayContent(definition, title)).replaceAll('\u200b', '').replace(/\s+/gu, ' ');
}

/** Inspect the optional explanation, including pool-cost formulas and the chosen payer's arithmetic. */
function exampleText(definition: TDocumentDefinitions): string {
    return displayText(definition, 'Example calculation');
}

/** Inspect the figures-only pool-wide breakdown retained in both export variants. */
function breakdownText(definition: TDocumentDefinitions): string {
    return displayText(definition, 'Calculation breakdown');
}

/** Read visible PDF text through normal stacks, columns, and labelled numeric terms. */
function visiblePdfText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(visiblePdfText).join(' ');
    if (!content || typeof content !== 'object') return '';
    const node = content as {text?: unknown; stack?: unknown; columns?: unknown; table?: {body?: unknown}};
    // Ignore styling and pagination metadata; the assertions protect what a reader actually sees.
    return [node.text, node.stack, node.columns, node.table?.body].map(visiblePdfText).filter(Boolean).join(' ');
}

/** Identify standalone prose without mistaking inline label/value facts for explanatory paragraphs. */
function standaloneTextBlocks(content: unknown): string[] {
    if (Array.isArray(content)) return content.flatMap(standaloneTextBlocks);
    if (!content || typeof content !== 'object') return [];
    const node = content as {text?: unknown; stack?: unknown; columns?: unknown; table?: {body?: unknown}};
    // Inline labels and values are composite text. Separate paragraph nodes would expose explanation
    // outside the optional example, so the factual displays may contain only their standalone heading.
    const ownText = typeof node.text === 'string' ? [node.text] : [];
    return [...ownText, ...standaloneTextBlocks(node.stack), ...standaloneTextBlocks(node.columns),
        ...standaloneTextBlocks(node.table?.body)];
}

/** Inspect column groups containing arithmetic, including any accidentally nested equations. */
function formulaRows(content: unknown): unknown[] {
    if (Array.isArray(content)) return content.flatMap(formulaRows);
    if (!content || typeof content !== 'object') return [];
    const node = content as {stack?: unknown; columns?: unknown[]; table?: {body?: unknown}};
    const rows = node.columns && visiblePdfText(node.columns).includes('=') ? [node.columns] : [];
    return [...rows, ...formulaRows(node.stack), ...formulaRows(node.columns), ...formulaRows(node.table?.body)];
}

/** Locate compact factual metric rows without treating labelled formula terms as pool facts. */
function metricRows(content: unknown): unknown[][] {
    if (Array.isArray(content)) return content.flatMap(metricRows);
    if (!content || typeof content !== 'object') return [];
    const node = content as {stack?: unknown; columns?: unknown[]; table?: {body?: unknown}};
    // Inline metrics have a colon-prefixed value; formula terms place their value and label in a stack.
    const metrics = node.columns?.every(isInlineMetric) ? [node.columns] : [];
    return [...metrics, ...metricRows(node.stack), ...metricRows(node.columns), ...metricRows(node.table?.body)];
}

/** Identify a displayed fact from its renderer-neutral label/value text instead of styling metadata. */
function isInlineMetric(content: unknown): boolean {
    if (!content || typeof content !== 'object') return false;
    const text = (content as {text?: unknown}).text;
    if (!Array.isArray(text) || text.length !== 2) return false;
    return typeof text[1] === 'object' && text[1] !== null && 'text' in text[1]
        && String(text[1].text).startsWith(': ');
}

function pdfNode(id: string, pages: number[]): Node {
    return {id, pageNumbers: pages, pages: 3, stack: false, startPosition: {
        pageNumber: pages[0], pageOrientation: 'portrait', pageInnerHeight: 777.89, pageInnerWidth: 539.28,
        left: 28, top: 750, verticalRatio: 0.9, horizontalRatio: 0,
    }};
}

describe('saved invoice shares PDF', () => {
    it('fits the widest table of applicable components within portrait A4 and repeats the header', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        expect(definition.pageSize).toBe('A4');
        expect(definition.pageOrientation).toBe('portrait');
        expect(definition.pageMargins).toEqual([28, 28, 28, 36]);
        const content = table(definition);
        expect(content.table.headerRows).toBe(1);
        expect(content.table.widths).toHaveLength(7);
        expect(content.table.widths![0]).toBe('*');
        const fixedWidths = (content.table.widths!.slice(1) as number[]).reduce((sum, width) => sum + width, 0);
        const layout = content.layout as {paddingLeft: () => number; paddingRight: () => number; vLineWidth: () => number};
        const columnCount = content.table.widths!.length;
        const nameWidth = 595.28 - 56 - fixedWidths - columnCount * (layout.paddingLeft() + layout.paddingRight())
            - (columnCount + 1) * layout.vLineWidth();
        expect(nameWidth).toBeGreaterThan(130);
        expect(nameWidth + fixedWidths).toBeLessThan(539.28);
        expect(JSON.stringify(content)).not.toContain('"noWrap":true');
    });

    it('omits unused component columns without removing the saved balance or payment status', () => {
        const data = fixture();
        data.shares = [{...data.shares[0], extraAmount: 0, paymentCreditAmount: 0, shareAmount: 75, note: undefined}];
        // Keep this first-calculation snapshot coherent: one participant, one invoice, no optional adjustments.
        data.savedAdjustments = [];
        data.explanation = {...data.explanation!, invoiceAmount: 75, distributableAmount: 75,
            assignedParticipants: 1, attendanceUnits: 3, eligibleAttendanceUnits: 3, effectiveWeight: 3,
            weightDenominator: '30000', contributions: [data.explanation!.contributions[0]],
            adjustmentTotals: {redistributedSurcharges: 0, redistributedRebates: 0, additionalSurcharges: 0, additionalRebates: 0}};
        const content = table(buildInvoiceSharesPdfDefinition(data));
        expect(cellTexts(content.table.body[0])).toEqual(['Payer', 'Base share', 'Calculated balance', 'Status']);
        expect(content.table.widths).toHaveLength(4);
        expect(cellTexts(content.table.body[1])).toEqual(['Alice', '75.00', '75.00', 'Payment due']);
    });

    it('preserves signed credits and rebates and keeps calculated balances visible after payment', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        const rows = table(definition).table.body.map(cellTexts);
        expect(rows).toContainEqual(['Alice', '75.00', '-5.00', '0.00', '50.00', '20.00', 'Payment due']);
        expect(rows).toContainEqual(['Former payer', '0.00', '0.00', '0.00', '50.00', '-50.00', 'Refund due']);
        expect(rows).toContainEqual(['Invoice submitter', '25.00', '0.00', '100.00', '-50.00', '-25.00', 'Refund due']);
        expect(rows).toContainEqual(['Settled payer', '100.00', '25.00', '0.00', '75.00', '50.00', 'Paid']);
        expect(rows.some((row) => String(row[0]).startsWith('Settled on '))).toBe(true);
        const content = definition.content as object[];
        const summary = visiblePdfText(content.find(item => visiblePdfText(item).startsWith('Saved settlement totals')));
        expect(summary).toMatch(/Payments due\s*:\s*20\.00/u);
        expect(summary).toMatch(/Refunds due\s*:\s*-75\.00/u);
        expect(summary).toMatch(/Payments received\s*:\s*50\.00/u);
        expect(summary).toMatch(/Invoice credit\s*:\s*100\.00/u);
        expect(summary).toMatch(/Previously settled\s*:\s*125\.00/u);
    });

    it('wraps long names and full-width details without truncating them or mutating saved data', () => {
        const data = fixture();
        data.shares[0].name = 'W'.repeat(180);
        data.shares[0].note = `Covers participants ${'LongParticipantName'.repeat(50)}. Rebate: -5.00.`;
        const before = structuredClone(data);
        const rows = table(buildInvoiceSharesPdfDefinition(data)).table.body;
        const name = String(cellTexts(rows[1])[0]);
        expect(name).toContain('\u200b');
        expect(name.split('\u200b').every((part) => part.length <= 18)).toBe(true);
        expect(name.replaceAll('\u200b', '')).toBe(data.shares[0].name);
        expect(rows[2][0]).toMatchObject({colSpan: rows[0].length});
        expect(String(cellTexts(rows[2])[0]).replaceAll('\u200b', '')).toBe(data.shares[0].note);
        expect(data).toEqual(before);
    });

    it('clearly identifies stale saved calculations and handles empty pools', () => {
        const data = fixture();
        data.pool.needsRecalculation = true;
        data.shares = [];
        const definition = buildInvoiceSharesPdfDefinition(data);
        expect(JSON.stringify(definition.content)).toContain('This PDF shows the saved calculation and recorded payments.');
        const content = table(definition);
        expect(cellTexts(content.table.body[0])).toEqual(['Payer', 'Calculated balance', 'Status']);
        expect(content.table.body[1][0]).toMatchObject({text: 'No calculated shares in this pool.', colSpan: 3});
    });

    it('keeps an already paid refund signed without repeating its balance in a note', () => {
        const data = fixture();
        data.shares = [{...data.shares[2], isPaid: true}];
        const rows = table(buildInvoiceSharesPdfDefinition(data)).table.body.map(cellTexts);
        expect(rows[1]).toEqual(['Invoice submitter', '25.00', '100.00', '-50.00', '-25.00', 'Refunded']);
        expect(rows).toHaveLength(2);
    });

    it.each([true, false])('keeps the provided compact retained-history label in saved notes when includeExampleCalculation=%s', (includeExampleCalculation) => {
        const data = fixture();
        const label = 'Covered by Alice · settlement retained';
        const description = 'Previously recorded payments or refunds stay with this participant in the saved shares.';
        // Responsibility is already classified by the presenter before export. The PDF adapter only renders its text.
        // A retained row has a real carried credit. Fully squared former-payer rows are removed before export.
        data.shares = [{...data.shares[1], note: 'Saved coverage note.',
            settledShareNotice: {label, description}}];
        const before = structuredClone(data);
        const definition = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation});
        const rows = table(definition).table.body.map(cellTexts);
        // The compact classification preserves the saved note without repeating the longer ownership explanation.
        expect(rows[0]).toEqual(['Payer', 'Previously settled', 'Calculated balance', 'Status']);
        expect(rows[1]).toEqual(['Former payer', '50.00', '-50.00', 'Refund due']);
        expect(rows[2][0]).toBe(`Saved coverage note.\n${label}`);
        expect(rows[2]).toHaveLength(4);
        expect(visiblePdfText(definition.content).split(label)).toHaveLength(2);
        expect(visiblePdfText(definition.content)).not.toContain(description);
        expect(data).toEqual(before);
    });

    it.each([true, false])('keeps an allocated exempt zero share ordinary when includeExampleCalculation=%s', (includeExampleCalculation) => {
        const data = poolCostFixture(false);
        // This saved allocation has one exempt attendee and no costs or carried settlements.
        data.explanation = {...data.explanation!, invoiceAmount: 0, distributableAmount: 0, exemptParticipants: 1,
            eligibleAttendanceUnits: 0, effectiveWeight: 0, weightDenominator: '0',
            contributions: [{...data.explanation!.contributions[0], isExempt: true, effectiveWeight: 0,
                weightNumerator: '0', baseShareAmount: 0}]};
        // Allocation still includes this exempt participant after transfers are squared, without a retained-history badge.
        data.shares = [{...data.shares[0], baseShareAmount: 0, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: 0, shareAmount: 0, isPaid: true, paidAt: null,
            note: 'Exempt from automatic share', settledShareNotice: null}];
        const definition = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation});
        const rows = table(definition).table.body.map(cellTexts);
        expect(rows[1]).toEqual(['Alice', '0.00', 'No payment']);
        expect(rows[2][0]).toBe('Exempt from automatic share');
        expect(rows).toHaveLength(3);
        expect(visiblePdfText(rows)).not.toContain('settlement retained');
        // All participants are exempt. Global figures still apply; the optional example may explain
        // the pool's costs, but must never invent a participant's arithmetic for this saved allocation.
        expect(breakdownText(definition)).toContain('Calculation breakdown');
        expect(exampleText(definition)).not.toContain('Base share for Participant A');
        expect(exampleText(definition)).not.toContain('Calculated balance for Participant A');
        if (!includeExampleCalculation) expect(exampleText(definition)).toBe('');
    });

    it('distinguishes a recorded refund from outstanding refunds and keeps both refund displays signed', () => {
        const data = fixture();
        data.shares = [{...data.shares[2], isPaid: true}];
        const definition = buildInvoiceSharesPdfDefinition(data);
        const content = definition.content as object[];
        const summary = visiblePdfText(content.find(item => visiblePdfText(item).startsWith('Saved settlement totals')));
        expect(summary).toMatch(/Refunds due\s*:\s*0\.00/u);
        expect(summary).toMatch(/Refunds paid\s*:\s*-25\.00/u);
        expect(summary).toMatch(/Previously settled\s*:\s*-50\.00/u);
        expect(summary).toContain('apply to this calculation');
        expect(summary).not.toContain('Payments received');
    });

    it('moves every financial column with an ordinary split note and preserves oversized pagination', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        const rows = table(definition).table.body;
        const noteCell = rows[2][0] as {id: string};
        const note = pdfNode(noteCell.id, [1, 2]);
        const queries: NodeQueries = {getFollowingNodesOnPage: () => [note], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => []};
        for (const cell of rows[1]) {
            const financial = pdfNode((cell as {id: string}).id, [1]);
            expect(financial.id).toBeTruthy();
            expect(definition.pageBreakBefore!(financial, queries)).toBe(true);
            note.pageNumbers = [1];
            expect(definition.pageBreakBefore!(financial, queries)).toBe(false);
            note.pageNumbers = [1, 2, 3];
            expect(definition.pageBreakBefore!(financial, queries)).toBe(false);
            note.pageNumbers = [1, 2];
        }
        // Header and note nodes must retain normal rendering instead of triggering recursive breaks.
        expect(definition.pageBreakBefore!(note, queries)).toBe(false);
        expect(JSON.stringify(definition)).not.toContain('"dontBreakRows":true');
        expect(JSON.stringify(definition)).not.toContain('"unbreakable":true');
    });

    it('explains one actual saved base and balance above the table and leaves row notes concise', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        const example = exampleText(definition);
        const breakdown = breakdownText(definition);
        expect(example).toContain('Example calculation');
        expect(example).toContain('Participant A');
        expect(example).toContain('200.00 Base to distribute');
        expect(example).toContain('3 Nights stayed');
        expect(example).toContain('8 Eligible nights');
        expect(example).toContain('75.00 Base share');
        expect(example).toContain('(-5.00) On-top rebates');
        expect(example).toContain('50.00 Previously settled');
        expect(example).toContain('20.00 Calculated balance');
        // The factual breakdown names pool amounts and attendance. Their formulas and explanations
        // belong to the worked example alongside the selected payer's saved arithmetic.
        expect(breakdown).toContain('On-top surcharges : 25.00');
        expect(breakdown).toContain('On-top rebates : -5.00');
        expect(breakdown).toContain('Full pool total : 220.00');
        expect(breakdown).toContain('Participants : 3');
        expect(breakdown).toContain('Total nights : 8');
        expect(example).not.toContain(invoiceText('distributionMetrics'));
        expect(example).toContain('220.00 Full pool total');
        expect(example.match(/Rounded up to cents\./g)).toHaveLength(1);
        expect(example).not.toMatch(/Alice|Former payer|Invoice submitter|Settled payer|screen filter/);
        expect(example).not.toContain('Calculated balance:');
        const rowNotes = table(definition).table.body.filter(row => typeof row[0] === 'object' && row[0] && 'colSpan' in row[0]);
        expect(rowNotes.map(row => String(cellTexts(row)[0]))).toEqual(['Includes a rebate.', expect.stringMatching(/^Settled on /)]);
    });

    it('puts each complete formula on its own row and clearly separates the example, totals and share table', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        const rows = formulaRows(definition.content);
        // All three genuine equations belong to the optional example. The global breakdown is
        // figures-only even when adjustment modes make pool-cost relationships nontrivial.
        expect(rows).toHaveLength(3);
        for (const row of rows) expect(visiblePdfText(row).match(/=/gu)).toHaveLength(1);
        expect(formulaRows(displayContent(definition, 'Calculation breakdown'))).toHaveLength(0);
        expect(standaloneTextBlocks(displayContent(definition, 'Calculation breakdown'))).toEqual(['Calculation breakdown']);
        expect(formulaRows(displayContent(definition, 'Example calculation'))).toHaveLength(3);
        const content = definition.content as object[];
        const headings = content.map(visiblePdfText);
        expect(headings.findIndex(text => text.startsWith('Calculation breakdown'))).toBeLessThan(headings.findIndex(text => text.startsWith('Example calculation')));
        expect(headings.findIndex(text => text.startsWith('Example calculation'))).toBeLessThan(headings.findIndex(text => text.startsWith('Saved settlement totals')));
        const sharesHeading = headings.findIndex(text => text === 'Calculated shares');
        expect(sharesHeading).toBeGreaterThan(headings.findIndex(text => text.startsWith('Saved settlement totals')));
        // Main sections follow the participants export's plain text heading convention, not decorated table bands.
        expect(content[sharesHeading]).toMatchObject({text: 'Calculated shares', style: 'sectionTitle', margin: [0, 8, 0, 4]});
        expect(JSON.stringify(definition.content)).not.toContain('#eff3f8');
        expect(JSON.stringify(definition.content)).not.toContain('#1e3a5f');
        expect('table' in content[sharesHeading + 1]).toBe(true);
    });

    it.each([true, false])('keeps all weighted distribution facts readable outside the example when includeExampleCalculation=%s', (includeExampleCalculation) => {
        const data = poolCostFixture(false);
        // Two saved participants attended five nights; the exempt attendee's two nights do not enter
        // the divisor. The eligible attendee's factor of 0.5 makes the actual divisor 1.5, not three.
        const own = data.explanation!.contributions[0];
        data.explanation = {...data.explanation!, assignedParticipants: 2, exemptParticipants: 1,
            attendanceUnits: 5, eligibleAttendanceUnits: 3, effectiveWeight: 1.5, weightDenominator: '15000',
            contributions: [{...own, factor: 0.5, effectiveWeight: 1.5, weightNumerator: '15000'},
                {registrationId: 2, payerRegistrationId: 2, name: 'Exempt attendee', attendanceWeight: 2,
                    factor: 1, isExempt: true, effectiveWeight: 0, weightNumerator: '0', baseShareAmount: 0}]};
        data.shares.push({registrationId: 2, name: 'Exempt attendee', baseShareAmount: 0, extraAmount: 0,
            invoiceCreditAmount: 0, paymentCreditAmount: 0, shareAmount: 0, isPaid: true, paidAt: null});
        const definition = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation});
        const breakdown = breakdownText(definition);
        const example = exampleText(definition);
        // The global breakdown owns all five applicable facts regardless of the example preference.
        expect(breakdown).toContain('Participants : 2');
        expect(breakdown).toContain('Total nights : 5');
        expect(breakdown).toContain('Eligible nights : 3');
        expect(breakdown).toContain('Exempt participants : 1');
        expect(breakdown).toContain('Total weight : 1.5');
        // The example may explain the weighting rule, but the pool's static counts stay in the
        // factual breakdown instead of becoming repeated example metrics.
        expect(example).not.toContain('Participants : 2');
        expect(example).not.toContain('Total nights : 5');
        expect(example).not.toContain('Total weight : 1.5');
        if (includeExampleCalculation) expect(example).toContain(invoiceText('nightsWeightExplanation'));
        // Compact rows wrap the facts in groups of three so labels keep enough width on portrait A4.
        const rows = metricRows(definition.content);
        expect(rows.length).toBeGreaterThanOrEqual(2);
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(3);
        expect(rows.map(visiblePdfText).join(' ')).toContain('Eligible nights : 3');
    });

    it('keeps pool costs and static distribution facts when omitting the optional example, alongside saved rows and notes', () => {
        const data = fixture();
        data.pool.needsRecalculation = true;
        const before = structuredClone(data);
        const included = buildInvoiceSharesPdfDefinition(data);
        const omitted = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation: false});
        expect(exampleText(included)).toContain('Example calculation');
        expect(exampleText(omitted)).toBe('');
        expect(table(omitted).table).toEqual(table(included).table);
        const omittedText = visiblePdfText(omitted.content);
        expect(omittedText).toContain('Calculation breakdown');
        expect(omittedText).toContain('Full pool total : 220.00');
        expect(omittedText).toContain(invoiceText('distributionMetrics'));
        expect(omittedText).toContain('Participants : 3');
        expect(omittedText).toContain('Total nights : 8');
        expect(breakdownText(omitted)).toBe(breakdownText(included));
        expect(omittedText).not.toContain('Base share for Participant A');
        expect(omittedText).not.toContain('Calculated balance for Participant A');
        expect(omittedText).toContain('Saved settlement totals');
        expect(omittedText).toMatch(/Refunds due\s*:\s*-75\.00/u);
        expect(omittedText).toContain('Calculated shares');
        // Compact exports contain no generated explanatory prose or formulas. Saved row notes,
        // payment dates, factual totals, and the short stale-state marker are preserved independently.
        expect(formulaRows(omitted.content)).toHaveLength(0);
        expect(standaloneTextBlocks(displayContent(omitted, 'Calculation breakdown'))).toEqual(['Calculation breakdown']);
        expect(standaloneTextBlocks(displayContent(omitted, 'Saved settlement totals'))).toEqual(['Saved settlement totals']);
        expect(omittedText).not.toContain(invoiceText('recordedTransferScope'));
        expect(omittedText).not.toContain('This PDF shows the saved calculation and recorded payments.');
        expect(omittedText).toContain(invoiceText('recalculationRequired'));
        expect(visiblePdfText(table(omitted).table.body)).toContain('Includes a rebate.');
        expect(visiblePdfText(table(omitted).table.body)).toContain('Settled on');
        expect(omitted.pageBreakBefore).toBe(included.pageBreakBefore);
        expect(omitted.footer).toBeDefined();
        expect(data).toEqual(before);
        expect(JSON.stringify(buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation: true}).content)).toBe(JSON.stringify(included.content));
    });

    it.each([true, false])('keeps pool-cost figures separate from optional explanations when includeExampleCalculation=%s', (includeExampleCalculation) => {
        for (const redistributed of [false, true]) {
            const definition = buildInvoiceSharesPdfDefinition(poolCostFixture(redistributed), {includeExampleCalculation});
            const text = breakdownText(definition);
            // The global overview records actual costs and used adjustment categories without
            // constructing an equation or teaching their relationship outside the optional example.
            expect(text).toContain('Invoice costs : 200.00');
            expect(text).not.toContain('Invoice costs (full pool total)');
            expect(formulaRows(displayContent(definition, 'Calculation breakdown'))).toHaveLength(0);
            expect(standaloneTextBlocks(displayContent(definition, 'Calculation breakdown'))).toEqual(['Calculation breakdown']);
            if (redistributed) {
                expect(text).toContain('Base to distribute : 195.00');
                expect(text).toContain('Redistributed surcharges : 10.00');
                expect(text).toContain('Redistributed rebates : -5.00');
            } else {
                // Equal amounts need only one fact in the global breakdown; the explanation may
                // state that invoice costs serve both scopes without an unnecessary identity equation.
                expect(text.split('200.00')).toHaveLength(2);
            }
            expect(text).not.toContain('On-top');
            const example = exampleText(definition);
            if (includeExampleCalculation) {
                expect(example).toContain('full pool total');
                if (redistributed) expect(example).toContain('(-5.00) Redistributed rebates');
                else expect(example).toContain('both the full pool total and the base to distribute');
            } else {
                expect(example).toBe('');
                expect(formulaRows(definition.content)).toHaveLength(0);
            }
        }
    });

    it('shows the combined base only when the worked example has covered contributions', () => {
        const data = fixture();
        data.explanation!.contributions[1].payerRegistrationId = 1;
        data.shares[0] = {...data.shares[0], baseShareAmount: 100, invoiceCreditAmount: 100, shareAmount: -55};
        // The example now prefers a typical positive standalone payer. Keep only this covering payer in the
        // authorized candidate set and give it a positive calculated balance so this test exercises coverage.
        data.shares = [{...data.shares[0], invoiceCreditAmount: 0, shareAmount: 45}];
        const example = exampleText(buildInvoiceSharesPdfDefinition(data));
        expect(example).toContain('Combined base shares');
        expect(example).toContain('100.00');
        expect(example).toContain('(-5.00) On-top rebates');
        expect(example).toContain('50.00 Previously settled');
        expect(example).toContain('45.00 Calculated balance');
        expect(example).not.toContain('Alice');
        expect(example.match(/Rounded up to cents\./g)).toHaveLength(1);
    });

    it('uses the saved rounding direction and omits zero steps from the example', () => {
        const data = fixture();
        data.explanation!.roundUpShares = false;
        data.shares[0] = {...data.shares[0], extraAmount: 0, paymentCreditAmount: 0, shareAmount: 75};
        // Restrict the worked candidate to the ordinary base-only payer instead of another component-rich payer.
        data.shares = [data.shares[0]];
        const example = exampleText(buildInvoiceSharesPdfDefinition(data));
        expect(example).toContain('Rounded down to cents.');
        expect(example).toContain('75.00 Base share');
        expect(example).not.toContain('Calculated balance');
        expect(example).not.toContain('Invoice credit');
        expect(example).not.toContain('Previously settled');
    });

    it.each([true, false])('uses a factual legacy availability marker without inventing calculation inputs when includeExampleCalculation=%s', (includeExampleCalculation) => {
        const data = fixture();
        delete data.explanation;
        const definition = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation});
        const breakdown = breakdownText(definition);
        expect(exampleText(definition)).toBe('');
        // Unknown older inputs remain visible as availability data. Even the explanatory export
        // cannot reconstruct attendance, total costs, or a worked payer formula from saved balances.
        expect(breakdown).toContain('Saved calculation inputs : Not saved');
        expect(standaloneTextBlocks(displayContent(definition, 'Calculation breakdown'))).toEqual(['Calculation breakdown']);
        expect(formulaRows(definition.content)).toHaveLength(0);
        expect(breakdown).not.toContain('The base calculation inputs were not saved');
        expect(breakdown).not.toContain('Total nights');
        expect(breakdown).not.toContain('Share factor');
        expect(breakdown).not.toContain('75.00 Base share');
        expect(breakdown).not.toContain('50.00 Previously settled');
        expect(breakdown).not.toContain('20.00 Calculated balance');
    });

    it.each([true, false])('keeps pool-cost arithmetic optional when no saved payer qualifies for an example and includeExampleCalculation=%s', (includeExampleCalculation) => {
        const data = poolCostFixture(true);
        data.shares = [];
        const definition = buildInvoiceSharesPdfDefinition(data, {includeExampleCalculation});
        const example = exampleText(definition);
        // The saved cost inputs still explain the shared base. A missing payer candidate suppresses
        // only that person's worked arithmetic, rather than leaking formulas into the factual overview.
        expect(breakdownText(definition)).toContain('Base to distribute : 195.00');
        expect(formulaRows(displayContent(definition, 'Calculation breakdown'))).toHaveLength(0);
        expect(example).not.toContain('Base share for Participant A');
        expect(example).not.toContain('Calculated balance for Participant A');
        if (includeExampleCalculation) {
            expect(example).toContain('195.00 Base to distribute');
            expect(formulaRows(displayContent(definition, 'Example calculation'))).toHaveLength(1);
        } else {
            expect(example).toBe('');
            expect(formulaRows(definition.content)).toHaveLength(0);
        }
    });
});
