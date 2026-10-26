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

import pdfmake, {TCreatedPdf} from 'pdfmake';
import type {Content, Table, TableCell, TDocumentDefinitions, TFontDictionary} from 'pdfmake/interfaces';
import type {ParticipantRow} from "../../../types/EventTypes";
import type {Event} from '../database/entities/event/Event';
import {ALLOWED_DIETARY} from "../database/entities/event/EventRegistrationDietary";

export const PAGE_MARGINS: [number, number, number, number] = [28, 28, 28, 36];
export const FONT_SIZE_BASE = 8;
export const FONT_SIZE_SMALL = 7;
export const FONT_SIZE_TITLE = 16;
export const FONT_SIZE_SECTION = 11;
const FONT_SIZE_SUBSECTION = 9;
const CHIP_MAX_PER_ROW = 7;

const fonts: TFontDictionary = {
    Roboto: {
        normal: 'fonts/Roboto/Roboto-Regular.ttf',
        bold: 'fonts/Roboto/Roboto-Medium.ttf',
        italics: 'fonts/Roboto/Roboto-Italic.ttf',
        bolditalics: 'fonts/Roboto/Roboto-MediumItalic.ttf',
    }
}
pdfmake.addFonts(fonts);

function asText(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const text = String(value).trim();
    return text.length ? text : '—';
}

/** Format an export instant in its selected zone, preserving absent/invalid
 * fallbacks and the ISO fallback when Intl cannot use that zone. */
export function formatDateTime(value: string | Date | null | undefined, timezone?: string | null): string {
    // Distinguish an absent instant from an invalid supplied string before Intl.
    if (!value) return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
        if (typeof value === 'string') {
            return value;
        }
        return '—';
    }

    // Export formatting is best effort; an unsupported zone keeps a valid instant.
    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone: timezone || 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    } catch {
        return date.toISOString();
    }
}

/** Divide admitted chip values into ordered rows without changing the source. */
function chunk<T>(values: T[], size: number): T[][] {
    // Each slice owns only this display row; caller order remains unchanged.
    const chunks: T[][] = [];
    for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
    return chunks;
}

/** Describe one text-only badge with the export's shared typography and padding. */
function chip(text: string): Content {
    // A borderless one-cell table keeps the badge together across PDF layout.
    return {
        table: {
            widths: ['auto'],
            body: [[{
                text,
                bold: true,
                fontSize: FONT_SIZE_SMALL,
                color: '#111827',
                fillColor: '#e5e7eb',
                margin: [0, 0, 0, 0]
            }]],
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            hLineColor: () => '#e5e7eb',
            vLineColor: () => '#e5e7eb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 2,
            paddingBottom: () => 2,
        },
        margin: [0, 0, 4, 4],
    } as Content;
}

/** Render nonempty values as bounded badge rows, retaining the empty marker. */
function chipGrid(values: Array<string | number | null | undefined>, maxPerRow = CHIP_MAX_PER_ROW): Content {
    // Normalize before grouping so absent values consume no visual column.
    const items = values.map(asText).filter((value) => value !== '—');
    if (!items.length) return {text: '—', color: '#6b7280'};

    return {
        stack: chunk(items, maxPerRow).map((row) => ({
            columns: row.map((value) => ({width: 'auto', ...(chip(String(value)) as object)})),
            columnGap: 4,
            margin: [0, 0, 0, 4],
        })),
    } as Content;
}

export function keyValueLine(label: string, value: string): Content {
    return {
        columns: [
            {text: `${label}:`, width: "auto", bold: true, marginRight: 4},
            {text: value, width: "*"},
        ],
        margin: [0, 0, 0, 4],
        fontSize: FONT_SIZE_BASE,
    };
}

function participantDates(participant: ParticipantRow): string {
    return `${participant.arrivalDate} -> ${participant.departureDate}`;
}

/** Select only supported saved dietary choices for this participant's export. */
function participantDietaryChoices(participant: ParticipantRow): Array<string> {
    // Unknown persisted labels never become a new dietary badge.
    return (participant.dietaryChoices || [])
        .map((choice) => choice.choice)
        .filter((choice): choice is (typeof ALLOWED_DIETARY)[number] => ALLOWED_DIETARY.includes(choice as (typeof ALLOWED_DIETARY)[number]));
}

/** Return the first saved allergy note or the shared absent-value marker. */
function participantAllergyText(participant: ParticipantRow): string {
    // Keep the note paired with its dietary choice rather than another free text.
    const allergyChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'ALLERGIES');
    return asText(allergyChoice?.additionalInfo);
}

/** Return the first saved participant comment or the shared absence marker. */
function participantCommentText(participant: ParticipantRow): string {
    // Comments remain separate from medical/dietary notes in the export.
    const commentChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'COMMENT');
    return asText(commentChoice?.additionalInfo);
}

/** Compose this participant's accepted dietary badges in their saved order. */
function participantDietaryContent(participant: ParticipantRow): Content {
    // Empty dietary evidence uses one marker rather than an empty nested stack.
    const choices = participantDietaryChoices(participant);
    if (!choices.length) return {text: '—', color: '#6b7280'};

    return {
        stack: choices.map((choice) => chip(choice)),
        margin: [0, 0, 0, 0],
    };
}

/** Project one already-authorized participant into the five export columns. */
function buildParticipantRow(participant: ParticipantRow): TableCell[] {
    // Normalize contact/notes independently; neither note substitutes for the other.
    const email = participant.email ?? '—';
    const allergy = participantAllergyText(participant);
    const comment = participantCommentText(participant);
    const infoStack: Content[] = [];
    if (allergy !== '—') {
        infoStack.push({text: 'Allergies:', color: '#aa0000', fontSize: FONT_SIZE_SUBSECTION},
            {text: allergy, fontSize: FONT_SIZE_BASE, marginBottom: 4});
    }
    if (comment !== '—') {
        infoStack.push({text: 'Comment:', color: '#cc9911', fontSize: FONT_SIZE_SUBSECTION},
            {text: comment, fontSize: FONT_SIZE_BASE});
    }
    if (infoStack.length === 0) {
        infoStack.push({text: '—', fontSize: FONT_SIZE_BASE});
    }

    // Preserve column order and mail-link behavior after the optional note stack.
    return [
        {text: participant.name, fontSize: FONT_SIZE_BASE},
        email === '—'
            ? {text: '—', color: '#6b7280', fontSize: FONT_SIZE_BASE}
            : {text: email, link: `mailto:${email}`, fontSize: FONT_SIZE_BASE},
        {text: participantDates(participant), fontSize: FONT_SIZE_SMALL},
        participantDietaryContent(participant),
        {stack: infoStack}
    ];
}

/** Build a repeatable-header participant table, including its five-column empty row. */
export function buildParticipantsTable(participants: ParticipantRow[]): Table {
    // Header and data share the same fixed column order and export widths.
    const body: TableCell[][] = [
        [
            {text: 'Name', bold: true, fillColor: '#e5e7eb'},
            {text: 'Email', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dates', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dietary', bold: true, fillColor: '#e5e7eb'},
            {text: 'Information', bold: true, fillColor: '#e5e7eb'},
        ],
    ];

    if (!participants.length) {
        body.push([
            {text: 'No registrations yet.', colSpan: 5, italics: true, color: '#6b7280', margin: [0, 6, 0, 6]},
            {},
            {},
            {},
            {},
        ]);
    } else {
        for (const participant of participants) body.push(buildParticipantRow(participant));
    }

    return {
        headerRows: 1,
        widths: [70, 115, 45, 55, 200],
        body,
        dontBreakRows: true,
    };
}

/** Compose available event metadata with separators only between real values. */
function buildEventInfoInline(event: Event): Content {
    // The local accumulator omits absent fields without leaving stray bullets.
    const fragments: Content[] = [];
    const push = (label: string, value?: string | null) => {
        if (!value) return;
        if (fragments.length) fragments.push({text: ' • ', color: '#9ca3af'});
        fragments.push({text: [{text: `${label}: `, bold: true}, {text: value}]});
    };

    if (event.location) push('Location', asText(event.location) === '—' ? null : asText(event.location));
    push('Dates', `${asText(event.startDate)} -> ${asText(event.endDate)}`);
    if (event.bindingDeadline) {
        push('Binding deadline', formatDateTime(event.bindingDeadline, event.timezone));
        push('Timezone', asText(event.timezone));
    }

    return {
        text: fragments,
        fontSize: FONT_SIZE_BASE,
        lineHeight: 1.12,
        margin: [0, 0, 0, 4],
    };
}

/** Display only positive totals through the existing common badge layout. */
function buildTotalsStack(values: Record<string, number>): Content {
    // Zero categories remain omitted; grouping never changes the supplied totals.
    const items = Object.entries(values)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}: ${count}`);

    return chipGrid(items, 8);
}

/** Assemble the authorized participant document with existing sections, table
 * and pagination. The caller-owned date totals receive the established Total row. */
export function buildParticipantsPdfDefinition(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TDocumentDefinitions {
    // Retain the existing input update before composing the summary and table.
    data.dateTotals['Total'] = data.participants.length;
    const content: Content[] = [
        {text: data.event.title, style: 'title', margin: [0, 0, 0, 8]},
        {text: 'Event info', style: 'sectionTitle', margin: [0, 0, 0, 4]},
        buildEventInfoInline(data.event),
        data.event.description ? keyValueLine('Description', data.event.description) : '',
        {text: 'Participants', style: 'sectionTitle', margin: [0, 8, 0, 4]},
        buildTotalsStack(data.dateTotals),
        {text: 'Dietary totals', style: 'subsectionTitle', margin: [0, 4, 0, 4]},
        buildTotalsStack(data.totals),
        {
            table: buildParticipantsTable(data.participants),
            layout: {
                hLineWidth: (i: number, node: {
                    table?: { body?: unknown[] }
                }) => (i === 0 || i === 1 || i === (node.table?.body?.length || 0) ? 1 : 0.5),
                vLineWidth: () => 0.5,
                hLineColor: () => '#d1d5db',
                vLineColor: () => '#d1d5db',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4,
            },
            margin: [0, 0, 0, 8],
        },
    ];

    // Document-wide styles and footer apply after feature content is prepared.
    return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: PAGE_MARGINS,
        content,
        defaultStyle: {fontSize: FONT_SIZE_BASE},
        styles: {
            title: {fontSize: FONT_SIZE_TITLE, bold: true},
            sectionTitle: {fontSize: FONT_SIZE_SECTION, bold: true},
            subsectionTitle: {fontSize: FONT_SIZE_SUBSECTION, bold: true},
        },
        footer: (currentPage, pageCount) => ({
            columns: [
                {
                    text: `Generated: ${formatDateTime(data.generatedAt)} UTC`,
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
                {
                    text: `Page ${currentPage} / ${pageCount}`,
                    alignment: 'right',
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
            ],
            margin: [28, 0, 28, 16],
        }),
    };
}

export function createParticipantsPdf(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TCreatedPdf {
    return pdfmake.createPdf(buildParticipantsPdfDefinition(data));
}
