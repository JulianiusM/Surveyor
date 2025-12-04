/**
 * Core formatting utilities
 * Provides consistent date and number formatting
 */

/**
 * Pad a number with leading zeros
 * @param num Number to pad
 * @param length Target length (default: 2)
 * @returns Padded string
 */
export function padNumber(num: number, length: number = 2): string {
    return String(num).padStart(length, '0');
}

/**
 * Format a date string or Date object for display
 * @param d Date string or null
 * @param options Intl.DateTimeFormatOptions (optional)
 * @returns Formatted date string or fallback
 */
export function formatDate(d?: string | null, options?: Intl.DateTimeFormatOptions): string {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, options);
}

/**
 * Format a date with time
 * @param d Date string or null
 * @returns Formatted date-time string or fallback
 */
export function formatDateTime(d?: string | null): string {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
}

/**
 * Format an ISO date from a Date object for a given timezone
 * @param date JavaScript Date object
 * @param timeZone IANA timezone (e.g., "Europe/Berlin", "America/New_York")
 * @returns ISO-like string (e.g., "2025-08-22T14:05:09+02:00")
 */
export function formatISOInTimeZone(date: Date, timeZone: string): string {
    // Get date/time fields in the target timezone
    const parts = new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(date).reduce((acc: Record<string, string>, p) => {
        acc[p.type] = p.value;
        return acc;
    }, {});

    // Get a numeric UTC offset label like "GMT+2" or "GMT+02:00"
    const tzNamePart = new Intl.DateTimeFormat(undefined, {
        timeZone,
        timeZoneName: 'shortOffset', // yields "GMT", "GMT+2", "GMT-05:30", etc.
    }).formatToParts(date).find(p => p.type === 'timeZoneName');

    // Parse that into "+HH:MM"
    let offset = '+00:00';
    if (tzNamePart && tzNamePart.value.startsWith('GMT')) {
        const m = tzNamePart.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (m && m.groups) {
            const sign = m.groups.sign || '+';
            const hh = String(m.groups.hh || '0').padStart(2, '0');
            const mm = String(m.groups.mm || '0').padStart(2, '0');
            offset = `${sign}${hh}:${mm}`;
        }
    }

    // Compose ISO-like string
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
