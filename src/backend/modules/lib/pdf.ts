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

import pdfmake from 'pdfmake';
import type {Content, TFontDictionary} from 'pdfmake/interfaces';

export const PAGE_MARGINS: [number, number, number, number] = [28, 28, 28, 36];
export const FONT_SIZE_BASE = 8;
export const FONT_SIZE_SMALL = 7;
export const FONT_SIZE_TITLE = 16;
export const FONT_SIZE_SECTION = 11;

const fonts: TFontDictionary = {
    Roboto: {
        normal: 'fonts/Roboto/Roboto-Regular.ttf',
        bold: 'fonts/Roboto/Roboto-Medium.ttf',
        italics: 'fonts/Roboto/Roboto-Italic.ttf',
        bolditalics: 'fonts/Roboto/Roboto-MediumItalic.ttf',
    }
}
pdfmake.addFonts(fonts);

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
