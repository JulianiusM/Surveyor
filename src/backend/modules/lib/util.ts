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

import {Request} from "express";
import crypto from 'node:crypto';
import {v4 as uuidv4} from 'uuid';
import type {DashboardEntities, Entity, EntityBase} from "../../../types/UserTypes";
import type {EntityItemType, EntityType} from "../../../types/UtilTypes";
import type {InvoiceCostInput, InvoiceAdjustmentInput, InvoiceCostTotals, ListCounterItem, ListCounterAssignee} from '../../../types/UtilTypes';
import settings from "../settings";
import {addCivilDays} from '../../../common/lib/civilDate';
import type {EventRegistration} from '../database/entities/event/EventRegistration';
import type {ParticipantRow} from '../../../types/EventTypes';
import type {components} from '../../../types/api/v1';

/** Project shared card data after callers evaluate ownership using the permission owner.
 * Membership, admission and ownership evaluation stay outside this pure projection. */
export function projectEntityCard(card: Entity, ownsCard: boolean, ownerCollection = false,
    sharedLifecycle = false): components['schemas']['EntityCard'] {
    // These five resource families support card actions. Output documents retain
    // their feature-owned URLs independently of these card destinations.
    const supportedType = card.type === 'packing' || card.type === 'event' || card.type === 'drivers'
        || card.type === 'survey' || card.type === 'activity';
    const ownerActions = (supportedType || sharedLifecycle) && ownerCollection && ownsCard;
    const resource = encodeURIComponent(card.id);
    const headerFamily = card.type === 'event' ? 'events' : card.type === 'drivers' ? 'drivers-lists'
        : card.type === 'survey' ? 'surveys' : card.type === 'activity' ? 'activity-plans' : 'packing-lists';
    const eventContext = card.eventContext ? {...card.eventContext,
        url: card.eventContext.url.replace(/^\/event\//u, '/event/')} : null;
    return {id: card.id, type: card.type, title: card.title, description: card.description ?? null,
        url: supportedType ? `/${card.type}/${resource}` : card.url,
        headerUrl: card.imageUrl ? supportedType ? `/api/v1/${headerFamily}/${resource}/header` : card.imageUrl : null,
        headerVersion: card.imageVersion ?? null, eventContext,
        visibility: card.visibility ?? 'default', overviewHidden: Boolean(card.overviewHidden),
        archived: Boolean(card.archive?.archived), inheritedArchived: Boolean(card.archive?.inheritedFromEventId),
        capabilities: {archive: (supportedType || sharedLifecycle) && Boolean(card.archive?.canArchive),
            restore: (supportedType || sharedLifecycle) && Boolean(card.archive?.canRestore),
            duplicate: ownerActions, remove: ownerActions},
        // Event Things to do retains its existing optional schedule context.
        // Personal Overview exposes the same controls only to an actor
        // admitted to manage that independent schedule; other viewers receive
        // neither its pause state nor a new management capability.
        ...((sharedLifecycle || supportedType && card.archive?.canManageAutomation) && card.archive?.hasAutomaticSchedule ? {automation: {
            paused: card.archive.autoArchivePaused, canManage: card.archive.canManageAutomation}} : {}),
        children: card.overview ? {total: card.overview.total, matching: card.overview.matching} : null};
}

/** Project already loaded Event registration rows for business consumers, retaining their order and fallback contract. */
export function projectEventParticipants(rows: readonly EventRegistration[]): ParticipantRow[] {
    // Names prefer the profile's explicit name; only names are trimmed. Contact
    // and dietary absence retain their existing marker/null representation.
    return rows.map((r): ParticipantRow => ({
        id: r.id,
        profileId: r.profile.id ?? null,
        name: r.profile.name?.trim() || r.profile.user?.name?.trim() || r.profile.user?.username || r.profile.guest?.username || '—',
        email: r.profile.user?.email || r.profile.guest?.email || '—',
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        dietaryChoices: r.dietaryChoices ?? null,
    }));
}

const HTML_ENTITIES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

/** Encode plain text for HTML text and quoted attributes. Script-element JSON
 * serialization and URL admission remain with their distinct delivery owners. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, function replaceCharacter(character) {return HTML_ENTITIES[character]!;});
}

// Generic currency helpers for invoice math
export function toAmount(val: string | number | undefined | null): number {
    if (val === undefined || val === null) return 0;
    const num = Number(val);
    return Number.isNaN(num) ? 0 : num;
}

export function formatAmount(amount: number): string {
    return amount.toFixed(2);
}

// Preserve the participant's submitted amount while allowing an organizer-reviewed value to drive calculations.
export function resolveInvoiceAmount(amount: string | number, correctedAmount?: string | number | null): number {
    return toAmount(correctedAmount === null || correctedAmount === undefined || correctedAmount === ''
        ? amount
        : correctedAmount);
}

/** Select saved costs included in both pool materialization and allocation.
 * Returned rows retain identity, order and all feature-owned provenance. */
export function acceptedInvoiceCosts<Value extends InvoiceCostInput>(invoices: readonly Value[]): Value[] {
    return invoices.filter(invoice => invoice.status === 'APPROVED' || invoice.status === 'CLOSED');
}

/** Compute matching raw pool costs without rounding or reading persistence.
 * Callers retain their own database writes, allocation and precision boundary. */
export function invoiceCostTotals(invoices: readonly InvoiceCostInput[],
    adjustments: readonly InvoiceAdjustmentInput[]): InvoiceCostTotals {
    const totals: InvoiceCostTotals = {invoiceTotal: 0, openAmount: 0, extraAmount: 0, subtractiveAmount: 0};
    // Preserve input order and corrected-amount fallback for each accepted row.
    for (const invoice of acceptedInvoiceCosts(invoices)) {
        const amount = resolveInvoiceAmount(invoice.amount, invoice.correctedAmount);
        totals.invoiceTotal += amount;
        if (invoice.status === 'APPROVED') totals.openAmount += amount;
    }
    // Additional and redistributed adjustments have separate stored meanings.
    for (const adjustment of adjustments) {
        if (adjustment.subtractFromPool) totals.subtractiveAmount += toAmount(adjustment.amount);
        else totals.extraAmount += toAmount(adjustment.amount);
    }
    return totals;
}

/** Count feature-selected list rows without deciding participation or visibility.
 * Null capacity is not open; old assignees retain the visible-name fallback. */
export function countListItems(items: readonly ListCounterItem[],
    assignees: ReadonlyMap<string, readonly ListCounterAssignee[]>) {
    const participants = new Set<string | undefined>();
    let open = 0;
    let empty = 0;
    // Features exclude Everyone rows or driver-only identities before this call.
    for (const item of items) {
        for (const assignment of assignees.get(uuidKey(item.id)) ?? []) {
            participants.add(assignment.profileId ? `p_${uuidKey(assignment.profileId)}` : assignment.name);
        }
        if (item.assignedCount === 0) empty++;
        if (item.assignedCount < (item.maxAssignees ?? 0)) open++;
    }
    return {participants: participants.size, open, empty};
}

/** Bind one independent process-local immediate/hourly job.
 * Repeated starts still await catch-up before the timer guard; overlap policy
 * belongs to the supplied task and startup failures prevent registration. */
export function createHourlyJob(task: () => Promise<unknown>, reportFailure: (error: unknown) => void): () => Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    /** Timer failure is reported independently from its next scheduled run. */
    async function runScheduled(): Promise<void> {
        try { await task(); }
        catch (error) { reportFailure(error); }
    }
    /** Catch up before registering exactly one interval for this job owner. */
    return async function startHourlyJob(): Promise<void> {
        await task();
        // A second initialization retains catch-up without creating another timer.
        if (timer) return;
        timer = setInterval(runScheduled, 60 * 60 * 1000);
        timer.unref();
    };
}

// Resolve a human-friendly label for the current actor, falling back to usernames where names are missing.
// This keeps email/audit messages readable without duplicating lookup logic across controllers.
export function resolveActorLabel(session: Request['session'] | undefined | null): string {
    if (session?.profile?.name) return session.profile.name;
    if (session?.profile?.user?.username) return session.profile.user.username;
    if (session?.profile?.guest?.username) return session.profile.guest.username;
    return 'an organizer';
}

// Sanitize text for use in email content to prevent injection attacks
export function sanitizeForEmail(text: string): string {
    // Remove control characters and limit to printable characters
    return text.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
}

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString('hex');
}

export function generateUniqueId() {
    return uuidv4();
}

// This classifies the spelling for identity comparison; request admission owns
// UUID validity. Do not impose version bits or reinterpret non-UUID/opaque text.
const UUID_IDENTITY_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Key a stored/admitted UUID independently of ASCII letter case, without
 * trimming, coercion or changing another identifier/token's spelling. */
export function uuidKey(id: string): string {
    return UUID_IDENTITY_SHAPE.test(id) ? id.toLowerCase() : id;
}

/** Compare two present resource references. Absence is never identity evidence;
 * callers retain explicit nullable-field and omitted-input rules. */
export function sameUuid(left: string | null | undefined, right: string | null | undefined): boolean {
    return typeof left === 'string' && left.length > 0 && typeof right === 'string' && right.length > 0
        && uuidKey(left) === uuidKey(right);
}

/** Index one loaded batch by UUID identity while retaining each original row.
 * Returned values keep their stored ID spelling for persistence and presentation. */
export function indexByUuid<Value>(values: Iterable<Value>, id: (value: Value) => string): Map<string, Value> {
    const index = new Map<string, Value>();
    for (const value of values) index.set(uuidKey(id(value)), value);
    return index;
}

/** Group one loaded batch by UUID identity, preserving row order and stored values. */
export function groupByUuid<Value>(values: Iterable<Value>, id: (value: Value) => string): Map<string, Value[]> {
    const groups = new Map<string, Value[]>();
    // Bucket each row once; aliases share a bucket without copying or reordering rows.
    for (const value of values) {
        const key = uuidKey(id(value));
        const rows = groups.get(key) ?? [];
        rows.push(value);
        groups.set(key, rows);
    }
    return groups;
}

/** Resolve submitted UUID references against one loaded batch. Partial sequences,
 * ordering and multiplicity are preserved; a missing reference rejects the sequence. */
export function resolveUuidReferences<Value>(ids: readonly string[], values: Iterable<Value>,
    id: (value: Value) => string): Value[] | undefined {
    const index = indexByUuid(values, id);
    const resolved: Value[] = [];

    // Lookup once per submitted reference; no row is copied or queried again.
    for (const reference of ids) {
        const value = index.get(uuidKey(reference));
        if (value === undefined) return undefined;
        resolved.push(value);
    }
    return resolved;
}

/** Resolve a complete unique list order, rejecting even differently spelled
 * aliases of one UUID. Partial-order workflows use resolveUuidReferences instead. */
export function resolveCompleteUuidOrder<Value extends {id: string}>(ids: readonly string[],
    values: readonly Value[]): Value[] | undefined {
    if (ids.length !== values.length) return undefined;
    const resolved = resolveUuidReferences(ids, values, value => value.id);
    if (!resolved || new Set(resolved.map(value => uuidKey(value.id))).size !== values.length) return undefined;
    return resolved;
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

/**
 * Rewrite an ISO string into a given IANA timezone WITHOUT changing the wall-clock
 * date/time fields. Example: "2025-06-01T12:23:00Z" -> Europe/Berlin => "2025-06-01T12:23:00+02:00"
 *
 * @param {string} isoString - Any ISO 8601 datetime (with or without offset).
 * @param {string} timeZone  - IANA timezone, e.g. "Europe/Berlin".
 * @returns {string} ISO-like string with the same Y-M-D and time, but with the correct tz offset.
 */
export function rewriteISOToZone(isoString: string, timeZone: string): string {
    // 1) Parse *fields only* (ignore original offset when rebuilding)
    const m = new RegExp(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/).exec(isoString.trim());
    if (!m) throw new Error("Invalid ISO datetime");

    const [, y, mo, d, h, mi, s = "00", ms = "0"] = m;
    const Y = +y, M = +mo, D = +d, H = +h, Min = +mi, S = +s, Ms = +ms.padEnd(3, "0");

    // 2) Helper: get offset in minutes for a given UTC epoch in the target zone
    /** Interpret this zone's offset at the supplied instant using supported GMT
     * forms. Unmatched representations retain the existing zero-minute fallback. */
    function getOffsetMinutes(epochMs: number) {
        const p = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(new Date(epochMs)).find(x => x.type === 'timeZoneName');

        // p.value examples: "GMT", "GMT+2", "GMT-05:30"
        const m = p?.value.match(/^GMT(?:(?<sign>[+-])(?<hh>\d{1,2})(?::?(?<mm>\d{2}))?)?$/);
        if (!m) return 0;
        const sign = (m.groups?.sign === '-') ? -1 : 1;
        const hh = m.groups?.hh ? Number.parseInt(m.groups.hh, 10) : 0;
        const mm = m.groups?.mm ? Number.parseInt(m.groups.mm, 10) : 0;
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

/** Rebuild the existing timezone-free wall-clock fields as a UTC Date, ignoring suffixes. */
export function fromISOtoLocal(isoDateStr: string) {
    // This legacy conversion intentionally preserves fields rather than parsing an instant.
    const isoDate = isoDateStr.slice(0, 19);
    const [y, m, d] = isoDate.split('-');
    const [day, time] = d.split('T');
    let h = 0, min = 0, sec = 0;
    if (time) {
        [h, min, sec] = time.split(':').map(Number);
    }
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(day), h, min, sec || 0));
}

export function now() {
    return new Date();
}

export function coerceLimit(n: any, def = 10, max = 25) {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.min(Math.max(v, 1), max);
}

export function maskEmail(email?: string | null) {
    if (!email) return '';
    const [user, domain] = email.split('@');
    if (!domain) return email.replace(/.(?=.{2})/g, '*');
    const u = user.length <= 2 ? user[0] + '*' : user.slice(0, 2) + '***';
    const parts = domain.split('.');
    const d0 = parts[0] || '';
    const d = (d0.slice(0, 1) || '*') + '***' + (parts.length > 1 ? '.' + parts.slice(1).join('.') : '');
    return `${u}@${d}`;
}

export function getResource(req: Request, entityName: string) {
    return req.resource ? req.resource[entityName] : undefined;
}

export function isWithinWindow(start: string | Date, end: string | Date, a: string | Date, d: string | Date) {
    return a <= d && a >= start && d <= end;
}

/**
 * Utility: compare YYYY-MM-DD strings (lexicographic works for ISO dates).
 */
function minDate(a: string, b: string) {
    return a < b ? a : b;
}

function maxDate(a: string, b: string) {
    return a > b ? a : b;
}

/**
 * Pure helper that builds date totals from an event window and registrations.
 * Each registration contributes 1 to every day between arrival and departure (inclusive).
 * Endpoint processing retains shared stepping errors without enumerating a later year.
 */
export function buildDateTotals(
    eventStart: string,
    eventEnd: string,
    regs: Array<{ arrivalDate: string | null; departureDate: string | null }>
): Record<string, number> {
    // Initialize all days in the event window to 0
    const totals: Record<string, number> = {};
    let cur = eventStart;
    while (cur <= eventEnd) {
        totals[cur] = 0;
        // Validate the same final step as before, but do not compare its extended
        // year with a four-digit endpoint after the last event day is included.
        const nextDay = addCivilDays(cur, 1);
        if (cur === eventEnd) break;
        cur = nextDay;
    }

    // Tally each registration
    for (const r of regs) {
        const arr = r.arrivalDate ?? eventStart;
        const dep = r.departureDate ?? eventEnd;

        // Clamp to event window
        let start = maxDate(arr, eventStart);
        let end = minDate(dep, eventEnd);
        if (start > end) continue; // outside window or invalid

        // Increment each covered day
        let d = start;
        while (d <= end) {
            totals[d] = (totals[d] ?? 0) + 1;
            // Attendance has its own clamped endpoint. Keep its final step's error
            // behavior while preventing a second traversal beyond that endpoint.
            const nextDay = addCivilDays(d, 1);
            if (d === end) break;
            d = nextDay;
        }
    }

    return totals;
}

/** Await a best-effort operation and retain its established warning-only failure handling. */
export async function ignoreException(fct: () => any) {
    // Recovery belongs to the caller; this boundary neither retries nor rethrows.
    try {
        return await fct();
    } catch (err) {
        console.warn(err);
    }
}

export function jsonReplacer(key: any, value: any) {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

// Builds the guest edit link for emails and redirects using Node.js URL API
export function buildGuestLink(guestId: string, token: string) {
    // Construct the path segments and ensure proper encoding
    const pathSegments = ['guest', guestId, 'login', token]
        .map(segment => encodeURIComponent(String(segment)))
        .join('/');
    // Ensure rootUrl ends with a slash
    let base = settings.value.rootUrl;
    base = base.endsWith('/') ? base : base + '/';
    return new URL(pathSegments, base).toString();
}

export const ENTITIES: Record<string, EntityType> = {
    ACTIVITY: 'activity',
    DRIVERS: 'drivers',
    EVENT: 'event',
    PACKING: 'packing',
    SURVEY: 'survey',
}

export const ENTITY_ITEMS: Record<string, EntityItemType> = {
    ACTIVITY: 'activitySlot',
    DRIVERS: 'driversItem',
    EVENT: 'eventRegistration',
    PACKING: 'packingItem',
    SURVEY: 'surveyItem',
}

// simple allowlist to keep LIKE fast and avoid expensive patterns
export const SQL_ALLOW_LIST = /^[a-z0-9._+\-@ ]{3,}$/i;

export function merge<A>(a: A[], b: A[], predicate = (a: A, b: A) => a === b) {
    const c = [...a]; // copy to avoid side effects
    // add all items from B to copy C if they're not already present
    b.forEach((bItem) => (c.some((cItem) => predicate(bItem, cItem)) ? null : c.push(bItem)))
    return c;
}

/** Flatten the supplied feature collections into overview cards in their existing order. */
export function convertToSingleList(entities: Partial<DashboardEntities>) {
    // Feature-specific records enter the same card projector with an explicit root type.
    const list: Entity[] = [];
    for (const survey of entities.surveys ?? []) {
        list.push(convertEntity(survey, ENTITIES.SURVEY));
    }
    for (const activity of entities.activityPlans ?? []) {
        list.push(convertEntity(activity, ENTITIES.ACTIVITY));
    }
    for (const packing of entities.packingLists ?? []) {
        list.push(convertEntity(packing, ENTITIES.PACKING));
    }
    for (const driver of entities.driversLists ?? []) {
        list.push(convertEntity(driver, ENTITIES.DRIVERS));
    }
    for (const event of entities.events ?? []) {
        list.push(convertEntity(event, ENTITIES.EVENT));
    }
    return list;
}

/** Stable opaque image identity, shared by card and detail projections without disclosing storage paths. */
export function getHeaderImageVersion(storagePath?: string | null): string | null {
    return storagePath ? crypto.createHash('sha256').update(storagePath).digest('base64url') : null;
}

export function convertEntity(entity: EntityBase, entityType: EntityType) {
    const entityUrl = `/${entityType}/${entity.id}`
    return {
        id: entity.id,
        title: entity.title,
        description: entity.description,
        imageUrl: entity.headerImg ? `${entityUrl}/header` : undefined,
        imageVersion: getHeaderImageVersion(entity.headerImg),
        type: entityType,
        ownerId: entity.ownerId,
        url: entityUrl,
        eventId: entity.eventId,
    } as Entity;
}

/** Preserve arrays, wrap one truthy value, or return the caller's existing fallback. */
export function normalizeToArray<A>(thing: A | A[], fallback: A[] = []) {
    // Preserve the original reference and false/zero absence semantics for legacy callers.
    let arr: A[] = fallback;
    if (Array.isArray(thing)) {
        arr = thing;
    } else if (thing) {
        arr = [thing];
    }

    return arr;
}
