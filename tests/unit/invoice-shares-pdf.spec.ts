import {describe, expect, it} from 'vitest';
import type {ContentTable, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {buildInvoiceSharesPdfDefinition, type InvoiceSharesPdfData} from '../../src/modules/lib/pdf';

function fixture(): InvoiceSharesPdfData {
    return {
        event: {title: 'Summer gathering', timezone: 'Europe/Berlin'},
        pool: {name: 'Shared groceries', closedAt: new Date('2026-09-14T10:00:00Z'), needsRecalculation: false},
        generatedAt: '2026-09-14T12:00:00Z',
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

function table(definition: TDocumentDefinitions): ContentTable {
    return (definition.content as object[]).find((content) => 'table' in content) as ContentTable;
}

function cellTexts(row: TableCell[]): unknown[] {
    return row.map((cell) => typeof cell === 'object' && cell !== null && 'text' in cell ? cell.text : cell);
}

describe('saved invoice shares PDF', () => {
    it('fits seven financial columns within portrait A4 and repeats the header', () => {
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
        const nameWidth = 595.28 - 56 - fixedWidths - 7 * (layout.paddingLeft() + layout.paddingRight()) - 8 * layout.vLineWidth();
        expect(nameWidth).toBeGreaterThan(140);
        expect(nameWidth + fixedWidths).toBeLessThan(539.28);
        expect(JSON.stringify(content)).not.toContain('"noWrap":true');
    });

    it('preserves signed credits and rebates and shows paid balances as zero remaining', () => {
        const definition = buildInvoiceSharesPdfDefinition(fixture());
        const rows = table(definition).table.body.map(cellTexts);
        expect(rows).toContainEqual(['Alice', '75.00', '-5.00', '0.00', '50.00', '20.00', 'Unpaid']);
        expect(rows).toContainEqual(['Former payer', '0.00', '0.00', '0.00', '50.00', '-50.00', 'Refund due']);
        expect(rows).toContainEqual(['Invoice submitter', '25.00', '0.00', '100.00', '-50.00', '-25.00', 'Refund due']);
        expect(rows).toContainEqual(['Settled payer', '100.00', '25.00', '0.00', '75.00', '0.00', 'Paid']);
        expect(rows.some((row) => String(row[0]).includes('Settled in this calculation: 50.00 on'))).toBe(true);
        const summaries = (definition.content as Array<{columns?: Array<{text: string}>}>).filter((item) => item.columns);
        expect(summaries.map((item) => item.columns!.map((column) => column.text))).toEqual(expect.arrayContaining([
            ['Still to collect:', '20.00'], ['Refunds still to pay:', '75.00'], ['Net remaining:', '-55.00'],
            ['Settled in this calculation (net):', '50.00'],
        ]));
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
        expect(rows[2][0]).toMatchObject({colSpan: 7});
        expect(String(cellTexts(rows[2])[0]).replaceAll('\u200b', '')).toBe(data.shares[0].note);
        expect(data).toEqual(before);
    });

    it('clearly identifies stale saved calculations and handles empty pools', () => {
        const data = fixture();
        data.pool.needsRecalculation = true;
        data.shares = [];
        const definition = buildInvoiceSharesPdfDefinition(data);
        expect(JSON.stringify(definition.content)).toContain('This PDF shows the saved calculation and recorded payments.');
        expect(table(definition).table.body[1][0]).toMatchObject({text: 'No calculated shares in this pool.', colSpan: 7});
    });

    it('keeps already paid refunds signed in settlement details', () => {
        const data = fixture();
        data.shares = [{...data.shares[2], isPaid: true}];
        const rows = table(buildInvoiceSharesPdfDefinition(data)).table.body.map(cellTexts);
        expect(rows[1]).toEqual(['Invoice submitter', '25.00', '0.00', '100.00', '-50.00', '0.00', 'Paid']);
        expect(rows[2][0]).toBe('Settled in this calculation: -25.00.');
    });
});
