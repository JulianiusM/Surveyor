import type {CivilDateWeek, CivilDateWindow} from '../../types/CivilDateTypes';

/** Step an ISO calendar day in UTC for existing Event and Activity calculations.
 * Keep their historical ISO parsing and RangeError behavior; this primitive
 * does not apply the separate display-date validator or a viewer's timezone.
 * Pure arithmetic retains complete signed date keys outside four-digit years. */
export function addCivilDays(value: string, days: number): string {
    // Calendar stepping preserves the saved day across month, leap-year and DST
    // boundaries without converting through a local clock or elapsed hours.
    const date = new Date(value + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return civilDateKey(date);
}

/** Keep complete ISO date keys when pure stepping or a Monday projection crosses
 * a four-digit year boundary. Admitted stored plan dates retain their own bounds. */
function civilDateKey(date: Date): string {
    const iso = date.toISOString();
    return iso.slice(0, iso.indexOf('T'));
}

/** Parse a real stored calendar day, without interpreting it in a local zone.
 * The ISO parser also preserves years below 100, unlike Date.UTC's numeric overload. */
export function parseCivilDate(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value + 'T00:00:00.000Z');
    // JavaScript normalizes impossible month days. A round trip rejects those
    // values instead of displaying or grouping a different stored day.
    return Number.isFinite(date.getTime()) && civilDateKey(date) === value ? date : null;
}

/** Format a stored civil day in the selected language, independent of the
 * browser/server zone. Null leaves each feature's absent/invalid fallback intact. */
export function formatCivilDate(value: string, locale: string, options: Intl.DateTimeFormatOptions = {}): string | null {
    const date = parseCivilDate(value);
    if (!date) return null;
    // UTC is a representation coordinate, not the Event's deadline timezone:
    // the calendar day and weekday must never shift with the viewer's offset.
    return date.toLocaleDateString(locale, {...options, timeZone: 'UTC'});
}

/** Enumerate Monday–Sunday weeks once for Vue creation and versioned Activity
 * presentation. This pure projection never changes stored dates or assignments. */
export function civilDateWeeks(start: string, end: string): CivilDateWeek[] {
    const first = parseCivilDate(start);
    const finish = parseCivilDate(end);
    const weeks: CivilDateWeek[] = [];
    if (!first || !finish || first > finish) return weeks;

    // All arithmetic uses UTC calendar parts. Local offsets and DST therefore
    // cannot split a Monday week, repeat a day or omit a boundary day.
    const monday = new Date(first);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    while (monday <= finish) {
        const days: string[] = [];
        for (let offset = 0; offset < 7; offset++) {
            const current = new Date(monday);
            current.setUTCDate(current.getUTCDate() + offset);
            if (current >= first && current <= finish) days.push(civilDateKey(current));
        }
        weeks.push({start: civilDateKey(monday), days});
        monday.setUTCDate(monday.getUTCDate() + 7);
    }
    return weeks;
}

/** Select a bounded saved-calendar window using constant date arithmetic.
 * The caller supplies the effective duration policy; this pure owner neither reads settings
 * nor edits saved dates. Invalid requested starts fall back to the first saved day. */
export function civilDateWindow(startDate: string, endDate: string, maxDurationDays: number,
    requestedStart?: unknown): CivilDateWindow {
    // UTC timestamps count civil days without allocating or walking the saved interval.
    const start = parseCivilDate(startDate);
    const finish = parseCivilDate(endDate);
    if (!start || !finish || start > finish) throw new RangeError('Invalid calendar interval');
    const oversized = (finish.getTime() - start.getTime()) / 86_400_000 + 1 > maxDurationDays;
    if (!oversized) return {startDate, endDate, previous: null, next: null, oversized, maxDurationDays};

    // Every oversized projection has at most 42 inclusive days. Clamp before
    // enumeration so even a malicious century-wide saved range stays bounded.
    const requested = typeof requestedStart === 'string' ? parseCivilDate(requestedStart) : null;
    const selected = requested && requested >= start && requested <= finish ? requested : start;
    const selectedEnd = new Date(Math.min(selected.getTime() + 41 * 86_400_000, finish.getTime()));
    const previous = selected > start
        ? civilDateKey(new Date(Math.max(start.getTime(), selected.getTime() - 42 * 86_400_000))) : null;
    const next = selectedEnd < finish ? civilDateKey(new Date(selectedEnd.getTime() + 86_400_000)) : null;
    return {startDate: civilDateKey(selected), endDate: civilDateKey(selectedEnd), previous, next, oversized, maxDurationDays};
}
