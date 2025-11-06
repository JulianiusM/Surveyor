import {v4 as uuidv4} from 'uuid';
import crypto from 'crypto';
import {Request} from "express";

import {APIError} from "./errors";

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function generateUniqueId() {
    return uuidv4();
}

// Returns 'YYYY-MM-DD' in the server's local time zone
export function toLocalISODate(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function toLocalISOTime(dateObj: Date) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    const h = String(dateObj.getUTCHours()).padStart(2, '0');
    const min = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const sec = String(dateObj.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}:${sec}`;
}

export /**
 * Rewrite an ISO string into a given IANA timezone WITHOUT changing the wall-clock
 * date/time fields. Example: "2025-06-01T12:23:00Z" -> Europe/Berlin => "2025-06-01T12:23:00+02:00"
 *
 * @param {string} isoString - Any ISO 8601 datetime (with or without offset).
 * @param {string} timeZone  - IANA timezone, e.g. "Europe/Berlin".
 * @returns {string} ISO-like string with the same Y-M-D and time, but with the correct tz offset.
 */
function rewriteISOToZone(isoString: string, timeZone: string) {
    // 1) Parse *fields only* (ignore original offset when rebuilding)
    const m = isoString.trim().match(
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/
    );
    if (!m) throw new Error("Invalid ISO datetime");

    const [, y, mo, d, h, mi, s = "00", ms = "0"] = m;
    const Y = +y, M = +mo, D = +d, H = +h, Min = +mi, S = +s, Ms = +ms.padEnd(3, "0");

    // 2) Helper: get offset in minutes for a given UTC epoch in the target zone
    function getOffsetMinutes(epochMs: number) {
        const p = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(new Date(epochMs)).find(x => x.type === 'timeZoneName');

        // p.value examples: "GMT", "GMT+2", "GMT-05:30"
        const m = p && p.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (!m) return 0;
        const sign = (m.groups?.sign === '-') ? -1 : 1;
        const hh = m.groups?.hh ? parseInt(m.groups.hh, 10) : 0;
        const mm = m.groups?.mm ? parseInt(m.groups.mm, 10) : 0;
        return sign * (hh * 60 + mm);
    }

    // 3) Solve for the UTC instant whose *local time in the zone* equals the parsed fields
    //    L = U + offset(U). Start with a guess and iterate (offset only changes at DST edges).
    let guess = Date.UTC(Y, M - 1, D, H, Min, S, Ms);
    let lastOffset = getOffsetMinutes(guess);
    let utc = guess - lastOffset * 60_000;
    for (let i = 0; i < 3; i++) {
        const off = getOffsetMinutes(utc);
        if (off === lastOffset) break;
        lastOffset = off;
        utc = guess - off * 60_000;
    }

    // 5) Build the offset label ±HH:MM
    const offMin = getOffsetMinutes(utc);
    const sign = offMin < 0 ? '-' : '+';
    const abs = Math.abs(offMin);
    const offHH = String(Math.floor(abs / 60)).padStart(2, '0');
    const offMM = String(abs % 60).padStart(2, '0');
    const offsetStr = `${sign}${offHH}:${offMM}`;

    // 6) Return the *original* wall-clock fields with the computed offset
    const pad = (n: any, len = 2) => String(n).padStart(len, '0');
    const hasSeconds = m[6] !== undefined;
    const hasMillis = m[7] !== undefined;

    const timeCore =
        `${pad(H)}:${pad(Min)}` +
        (hasSeconds ? `:${pad(S)}` : '') +
        (hasMillis ? `.${pad(Ms, 3)}` : '');

    return `${pad(Y, 4)}-${pad(M, 2)}-${pad(D, 2)}T${timeCore}${offsetStr}`;
}

export function fromISOtoLocal(isoDateStr: string) {
    const isoDate = isoDateStr.slice(0, 19);
    const [y, m, d] = isoDate.split('-');
    const [day, time] = d.split('T');
    let h = 0, min = 0, sec = 0;
    if (time) {
        [h, min, sec] = time.split(':').map(Number);
    }
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(day), h, min, sec || 0));
}

export async function performAPIAction(req: Request, action: {
    actionUser: (body: any, userId: number) => Promise<void>,
    actionGuest: (body: any, guestId: number) => Promise<void>,
}) {
    const userId = req.session.user?.id;
    const guestId = req.session.guest?.id;
    if (userId) await action.actionUser(req.body, userId);
    else if (guestId) await action.actionGuest(req.body, guestId);
    else throw new APIError('Unknown user', {}, 401);
}

export function getResource(req: Request, entityName: string) {
    return req.resource ? req.resource[entityName] : undefined;
}

export function getAdditional(req: Request, entityName: string, appendList: any[] = []) {
    appendList.push(req.resource ? req.resource[entityName] : undefined);
    return appendList;
}

export function isWithinWindow(start: string | Date, end: string | Date, a: string | Date, d: string | Date) {
    return a <= d && a >= start && d <= end;
}

export async function ignoreException(fct: () => any) {
    try {
        return await fct();
    } catch (err) {
        console.warn(err);
    }
}