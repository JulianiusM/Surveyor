/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {invoiceLabels, invoiceText} from './wording';
import pdfmake, {type TCreatedPdf} from 'pdfmake';
import type {Column, Content, ContentText, Node, NodeQueries, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import type {InvoiceCalculationDisplay, InvoiceCalculationFormula, InvoiceCalculationMetric,
    InvoiceCalculationSection, InvoiceMoneyMetric, InvoiceSharesPdfData, InvoiceSharesPdfOptions} from '../../types/InvoicePoolTypes';
import {PAGE_MARGINS, FONT_SIZE_BASE, FONT_SIZE_SMALL, FONT_SIZE_TITLE, FONT_SIZE_SECTION, formatDateTime, keyValueLine} from '../lib/pdf';
import {formatInvoiceMoney, invoicePoolCalculation, invoicePoolCalculationBreakdown, invoiceSettlementRows, presentInvoiceShare, invoiceShareColumns} from './presentation';

/** Add legal PDF line-break opportunities without truncating long names or saved notes. */
function wrapInvoicePdfText(value: string): string {
    // Split on code points so surrogate pairs stay intact; ordinary spaces already provide breaks.
    /** Insert Unicode-safe break opportunities into a long unbroken PDF word. */
    function insertWrapPoints(word: string): string {
        const characters = Array.from(word);
        const parts: string[] = [];
        for (let start = 0; start < characters.length; start += 18) {
            parts.push(characters.slice(start, start + 18).join(''));
        }
        return parts.join('\u200b');
    }
    return value.replace(/\S{19,}/gu, insertWrapPoints);
}

/** Keep one numerical term attached to its visible label without constructing invoice wording. */
function invoicePdfCalculationMetric(metric: InvoiceCalculationMetric, result = false): Column {
    // Formula results remain signed; only input negatives receive mathematical parentheses below.
    return {
        width: '*',
        stack: [
            {text: metric.value, bold: true, fontSize: FONT_SIZE_BASE},
            {text: wrapInvoicePdfText(metric.label), fontSize: FONT_SIZE_SMALL, color: result ? '#111827' : '#4b5563', margin: [0, 2, 0, 0]},
        ],
    };
}

/** Keep contextual counts and transfer totals compact while naming every visible value. */
function invoicePdfInlineMetric(metric: InvoiceCalculationMetric): Column {
    return {width: '*', text: [
        {text: metric.label, fontSize: FONT_SIZE_SMALL, color: '#4b5563'},
        {text: `: ${metric.value}`, bold: true, fontSize: FONT_SIZE_BASE},
    ]};
}

/** Separate invoice sections with the same plain heading convention used by the participants PDF. */
function invoicePdfSectionHeading(title: string): Content {
    // Shared font constants and the established sectionTitle style provide hierarchy through type and spacing.
    // A normal text node keeps semantic headings distinct from the shaded header of the financial table.
    return {text: wrapInvoicePdfText(title), style: 'sectionTitle', margin: [0, 8, 0, 4]};
}

/** Render named terms and a distinct result instead of a dense paragraph of arithmetic. */
function invoicePdfCalculationFormula(formula: InvoiceCalculationFormula): Content[] {
    const columns: Column[] = [];
    // Operators occupy their own narrow columns so labels cannot be mistaken for a different factor.
    for (const term of formula.terms) {
        if (term.operator) columns.push({text: term.operator, width: 10, alignment: 'center', color: '#4b5563'});
        const value = term.value.startsWith('-') ? `(${term.value})` : term.value;
        columns.push(invoicePdfCalculationMetric({...term, value}));
    }
    // The final signed amount and its label stay together in their own result column.
    columns.push({text: '=', width: 10, alignment: 'center', color: '#4b5563'});
    columns.push(invoicePdfCalculationMetric(formula.result, true));
    return [{columns, columnGap: 4}];
}

/** Adapt one shared calculation section while preserving its applicable facts and named values. */
function invoicePdfCalculationSection(section: InvoiceCalculationSection): Content {
    // Every step owns its heading and occupies a separate row; independent equations are never side by side.
    const stack: Content[] = [{text: [
        {text: wrapInvoicePdfText(section.title), bold: true},
        ...(section.formula?.note ? [{text: `  ${section.formula.note}`, fontSize: FONT_SIZE_SMALL, color: '#6b7280'}] : []),
    ], margin: [0, 0, 0, 3]}];
    // The presenter selects which features apply; this adapter only controls their PDF arrangement.
    if (section.formula) stack.push(...invoicePdfCalculationFormula(section.formula));
    if (section.metrics?.length) {
        // Pool facts apply to both exports. Give each metric a readable label instead of squeezing
        // all distribution counts into one line when exemptions or weighted factors add more facts.
        for (let start = 0; start < section.metrics.length; start += 3) {
            const metrics = section.metrics.slice(start, start + 3);
            stack.push({columns: metrics.map(invoicePdfInlineMetric), columnGap: 10,
                margin: [0, 0, 0, start + 3 < section.metrics.length ? 3 : 0]});
        }
    }
    // Explanations remain near the equation whose adjustment mode or eligibility they describe.
    if (section.description) stack.push({text: wrapInvoicePdfText(section.description), fontSize: FONT_SIZE_SMALL, color: '#4b5563', margin: [0, 2, 0, 0]});
    // A light bottom rule separates saved calculation phases without repeating a large explanatory panel.
    return {
        table: {widths: ['*'], body: [[{stack}]]},
        layout: {
            hLineWidth: (index: number) => index === 1 ? 0.5 : 0,
            vLineWidth: () => 0,
            hLineColor: () => '#e2e8f0',
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 4,
        },
        margin: [0, 0, 0, 5],
    };
}

/** Render one shared display model without moving facts between the breakdown and worked example. */
function invoicePdfCalculationDisplay(calculation: InvoiceCalculationDisplay): Content {
    const stack: Content[] = [invoicePdfSectionHeading(calculation.title)];
    if (calculation.description) stack.push({text: wrapInvoicePdfText(calculation.description), fontSize: FONT_SIZE_SMALL, color: '#4b5563', margin: [0, 0, 0, 4]});
    // Keep the presenter's reading order for either global pool facts or the optional payer example.
    // Each formula receives the full page width, preserving clear term labels for long and international wording.
    for (const section of calculation.sections) stack.push(invoicePdfCalculationSection(section));
    return {stack, margin: [0, 0, 0, 3]};
}

/** Render signed saved-transfer totals, with optional scope prose only in the explanatory export. */
function invoicePdfSettlementSummary(metrics: InvoiceMoneyMetric[], includeExplanation: boolean): Content {
    if (!metrics.length) return {text: ''};
    const stack: Content[] = [invoicePdfSectionHeading(invoiceText('savedSettlementTotals'))];
    // Small rows keep the important totals visible without printing unused zero-valued feature totals.
    for (let start = 0; start < metrics.length; start += 3) {
        const columns: Column[] = [];
        for (const metric of metrics.slice(start, start + 3)) columns.push(invoicePdfInlineMetric({label: metric.label, value: formatInvoiceMoney(metric.amount)}));
        stack.push({columns, columnGap: 14, margin: [0, 0, 0, 4]});
    }
    // The compact export contains facts only. The explanatory variant may clarify the distinction
    // between transfers recorded for this calculation and carried credits from earlier calculations.
    if (includeExplanation && metrics.some(metric => metric.key === 'paymentCreditAmount' || metric.key === 'paymentsReceived' || metric.key === 'refundsPaid')) {
        stack.push({text: invoiceText('recordedTransferScope'), fontSize: FONT_SIZE_SMALL, color: '#4b5563'});
    }
    return {stack, margin: [0, 0, 0, 5]};
}

/** Keep an ordinary payer row with its saved notes while allowing oversized notes to span pages. */
function keepInvoicePdfShareTogether(currentNode: Node, queries: NodeQueries): boolean {
    // Every active table cell participates. A break on the name cell alone leaves amounts
    // on the previous page, because pdfmake lays out each column from the shared row position.
    const financialCell = /^invoice-share-(\d+)-amount-\d+$/.exec(currentNode.id || '');
    if (!financialCell) return false;
    const noteId = `invoice-share-${financialCell[1]}-note`;
    // Inspect the generator's actual pagination instead of estimating text heights or truncating notes.
    const nearbyNodes = [...queries.getFollowingNodesOnPage(), ...queries.getNodesOnNextPage()];
    for (const node of nearbyNodes) {
        if (node.id !== noteId) continue;
        // A note spanning three or more pages cannot fit intact. Two-page notes may move once,
        // then continue normally; unlike unbreakable table rows, their full contents are retained.
        return node.pageNumbers.length <= 2 && node.pageNumbers[node.pageNumbers.length - 1] > currentNode.pageNumbers[0];
    }
    return false;
}

/** Export saved settlement rows; this deliberately does not recalculate the pool. */
export function buildInvoiceSharesPdfDefinition(data: InvoiceSharesPdfData, options: InvoiceSharesPdfOptions = {}): TDocumentDefinitions {
    // One presentation choice gates every newly generated explanatory paragraph and worked formula.
    // Saved row notes remain factual record data in either variant, rather than being rewritten by export.
    const includeExample = options.includeExampleCalculation !== false;
    // Export the saved calculated balance in the primary amount column, including completed refunds.
    const columns = invoiceShareColumns(data.shares);
    const labels = [invoiceLabels.payer, ...columns.map(column => column.label), invoiceText('status')];
    const body: TableCell[][] = [labels.map((text, index) => ({
        text, bold: true, fillColor: '#e5e7eb', fontSize: FONT_SIZE_SMALL,
        alignment: index > 0 && index < labels.length - 1 ? 'right' : 'left',
    }))];
    /** Render a signed amount with the shared invoice money formatter and table alignment. */
    function amountCell(amount: number, bold = false): ContentText {
        return {text: formatInvoiceMoney(amount), alignment: 'right', bold};
    }

    for (const share of data.shares) {
        const presentation = presentInvoiceShare(share);
        const financialRow: Array<ContentText & {id?: string}> = [
            {text: wrapInvoicePdfText(share.name), bold: true},
            ...columns.map(column => amountCell(Number(share[column.key] ?? 0), column.key === 'shareAmount')),
            {text: presentation.statusLabel, fontSize: FONT_SIZE_SMALL},
        ];
        // Tag every column so pagination moves the complete financial row together with its note.
        const rowId = `invoice-share-${share.registrationId}`;
        for (let index = 0; index < financialRow.length; index++) financialRow[index].id = `${rowId}-amount-${index}`;
        body.push(financialRow);

        // Saved notes already contain each person's base and factor. Do not repeat formulas or table balances.
        const details: string[] = [];
        if (share.note?.trim()) details.push(share.note.trim());
        // Retained settled history is classified by the shared presenter using frozen responsibility.
        // Its compact role label complements the preserved note without repeating payment/refund ownership prose.
        if (share.settledShareNotice) details.push(share.settledShareNotice.label);
        // The table status and signed balance document the transfer; only its date adds new information.
        if (share.isPaid && share.shareAmount !== 0 && share.paidAt) details.push(invoiceText('settledOn', {
            date: formatDateTime(share.paidAt, data.event.timezone),
        }));
        if (details.length) {
            const detailRow: TableCell[] = [
                {text: wrapInvoicePdfText(details.join('\n')), id: `${rowId}-note`, colSpan: labels.length, fontSize: FONT_SIZE_SMALL, color: '#4b5563'},
            ];
            for (let index = 1; index < labels.length; index++) detailRow.push({});
            body.push(detailRow);
        }
    }
    if (!data.shares.length) {
        const emptyRow: TableCell[] = [{text: invoiceText('noCalculatedSharesInThisPool'), colSpan: labels.length, italics: true, color: '#6b7280'}];
        for (let index = 1; index < labels.length; index++) emptyRow.push({});
        body.push(emptyRow);
    }

    // Factual headings identify the saved snapshot without recalculating or interpreting its balances.
    const content: Content[] = [
        {text: wrapInvoicePdfText(data.event.title), fontSize: FONT_SIZE_TITLE, bold: true, margin: [0, 0, 0, 6]},
        {text: wrapInvoicePdfText(invoiceText('invoiceShares', {name: data.pool.name})), fontSize: FONT_SIZE_SECTION, bold: true, margin: [0, 0, 0, 8]},
        keyValueLine(invoiceText('savedCalculation'), formatDateTime(data.pool.closedAt, data.event.timezone)),
    ];
    // The global breakdown contains only saved figures in both exports. The shared presenter owns
    // metric availability and adjustment classification; formulas and prose belong to the example.
    content.push(invoicePdfCalculationDisplay(invoicePoolCalculationBreakdown(data.explanation, data.savedAdjustments)));
    if (includeExample) {
        // The explanatory export teaches the pool-cost relationships first, then a payer's worked
        // arithmetic when provenance permits it. Cost explanation remains useful without a qualifying payer.
        const example = invoicePoolCalculation(data.explanation, data.shares, data.savedAdjustments);
        if (example.sections.length) content.push(invoicePdfCalculationDisplay(example));
    }
    if (data.pool.needsRecalculation) content.push({
        // A compact stale export names its saved state without adding a calculation explanation.
        text: invoiceText(includeExample ? 'poolInputsHaveChangedThisPDFShowsTheSaved' : 'recalculationRequired'),
        color: '#92400e', bold: true, margin: [0, 4, 0, 8],
    });
    // Aggregate unpaid transfers independently from immutable row balances; refunds keep their negative sign.
    content.push(
        invoicePdfSettlementSummary(invoiceSettlementRows(data.shares), includeExample),
        invoicePdfSectionHeading(invoiceText('calculatedShares')),
        {
            table: {
                headerRows: 1,
                // The maximum set still fits A4 portrait; omitted zero columns give names more room.
                // Status reserves enough width for the compact two-word payment/refund labels.
                widths: ['*', ...columns.map(column => column.key === 'shareAmount' ? 62 : column.key === 'paymentCreditAmount' ? 60 : 56), 55],
                body,
            },
            layout: {
                hLineWidth: (index: number) => index === 1 ? 1 : 0.5,
                vLineWidth: () => 0,
                hLineColor: () => '#d1d5db',
                paddingLeft: () => 4,
                paddingRight: () => 4,
                paddingTop: () => 5,
                paddingBottom: () => 5,
            },
        },
    );

    // Reuse the existing PDF theme and font registration, then add localized page metadata.
    return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: PAGE_MARGINS,
        defaultStyle: {fontSize: FONT_SIZE_BASE},
        // Match lib/pdf's participants export instead of introducing a separate invoice heading theme.
        styles: {sectionTitle: {fontSize: FONT_SIZE_SECTION, bold: true}},
        content,
        pageBreakBefore: keepInvoicePdfShareTogether,
        footer: (currentPage, pageCount) => ({
            columns: [
                {text: invoiceText('generatedUTC', {value: formatDateTime(data.generatedAt)}), fontSize: FONT_SIZE_SMALL, color: '#6b7280'},
                {text: invoiceText('page', {currentPage: currentPage, pageCount: pageCount}), alignment: 'right', fontSize: FONT_SIZE_SMALL, color: '#6b7280'},
            ],
            margin: [28, 0, 28, 16],
        }),
    };
}

/** Create the downloadable document from saved rows through the application's configured PDF generator. */
export function createInvoiceSharesPdf(data: InvoiceSharesPdfData, options: InvoiceSharesPdfOptions = {}): TCreatedPdf {
    // Forward presentation options unchanged so the download and the inspectable definition share one contract.
    return pdfmake.createPdf(buildInvoiceSharesPdfDefinition(data, options));
}
