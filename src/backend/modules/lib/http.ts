import type {Request, RequestHandler, Response} from 'express';
import logger from 'morgan';
import type {Options as AccessLogOptions} from 'morgan';
import {resolveLocale, resolvePreferredLocale} from '../../../common/localization/translator';

/** Resolve response language through the shared catalog policy: explicit header,
 * then cookie, then quality-ordered accepted languages. Negotiation never changes
 * the captured actor or grants authority to any localized presentation. */
export function requestLocale(req: Request): string {
    const explicitLocale = req.get('X-Surveyor-Locale') ?? req.cookies?.surveyor_locale;
    if (explicitLocale !== undefined && explicitLocale !== null) return resolveLocale(explicitLocale);

    // Express orders accepted ranges by quality. Preserve that order and skip unsupported/invalid
    // hints before choosing the application fallback; explicit header/cookie choices stay authoritative.
    const languages = req.acceptsLanguages();
    return resolvePreferredLocale(languages || []);
}

type UrlSpan = {start: number; end: number};
type MappedUrl = {value: string; source: UrlSpan[]; offset: number};

/** Preserve the full existing access-log format while projecting only URL secrets. */
export function createAccessLogger(options?: AccessLogOptions<Request, Response>): RequestHandler {
    // Morgan still owns method, status, length, timing and ordinary log delivery.
    // The same token covers normal, rejected and unmatched requests at app entry.
    logger.token<Request>('url', req => redactAccessLogUrl(req.originalUrl ?? req.url));
    return logger('dev', options);
}

/** Redact only capabilities in their original URL spelling, including encoded
 * next/returnTo destinations. Route names, IDs, harmless query fields, separators
 * and percent-encoding outside a secret remain byte-for-byte diagnostic evidence.
 * This projection never changes the request or interprets its authentication. */
export function redactAccessLogUrl(original: string): string {
    const secrets: UrlSpan[] = [];
    const pending: MappedUrl[] = [{value: original, offset: 0,
        source: Array.from({length: original.length}, (_, start) => ({start, end: start + 1}))}];

    // Work iteratively so deeply nested return URLs cannot exhaust the stack.
    // Each nested task is a strictly smaller query value and keeps offsets back
    // to the untouched original, avoiding URLSearchParams reserialization.
    while (pending.length) inspectLogUrl(pending.pop()!, secrets, pending);
    secrets.sort((left, right) => left.start - right.start || right.end - left.end);
    let result = '';
    let cursor = 0;
    for (const secret of secrets) {
        if (secret.end <= cursor) continue;
        result += original.slice(cursor, Math.max(cursor, secret.start)) + '[REDACTED]';
        cursor = secret.end;
    }
    return result + original.slice(cursor);
}

/** Inspect actual capability route families without masking ordinary URL data. */
function inspectLogUrl(url: MappedUrl, secrets: UrlSpan[], pending: MappedUrl[]): void {
    const query = url.value.indexOf('?');
    const fragment = url.value.indexOf('#');
    const end = fragment < 0 ? url.value.length : fragment;
    const pathEnd = query >= 0 && query < end ? query : end;
    const origin = /^(?:https?:)?\/\/[^/?#]+/iu.exec(url.value)?.[0].length ?? 0;
    const pathname = url.value.slice(origin, pathEnd);

    // These are the existing public capability path positions, including denied
    // or unmatched suffixes. The guest ID and all unrelated segments stay visible.
    const capability = /^(?:\/guest\/[^/]+\/login\/|\/users\/(?:reset-password|activate)\/)([^/]+)/iu.exec(pathname);
    if (capability) {
        const start = origin + capability[0].length - capability[1]!.length;
        addSecretSpan(url, start, start + capability[1]!.length, secrets);
    }
    if (query < 0 || query >= end) return;

    // Scan raw fields rather than rebuilding the query. Duplicate names, empty
    // fields, plus spelling and percent hex case remain exactly as received.
    let start = query + 1;
    while (start <= end) {
        const separator = url.value.indexOf('&', start);
        const fieldEnd = separator < 0 || separator > end ? end : separator;
        const equal = url.value.indexOf('=', start);
        if (equal >= start && equal < fieldEnd) {
            const name = decodeLogQuery(url, start, equal).value;
            const valueStart = equal + 1;
            const provider = /^\/users\/oidc\/callback(?:\/|$)/iu.test(pathname);
            const reset = /^\/api\/v1\/auth\/reset-password(?:\/|$)/iu.test(pathname);
            const event = /^\/(?:event|api\/v1\/events)(?:\/|$)/iu.test(pathname);
            if (provider && ['code', 'state', 'session_state', 'id_token', 'access_token', 'refresh_token'].includes(name)
                || reset && name === 'token' || event && name === 'regToken') {
                addSecretSpan(url, valueStart, fieldEnd, secrets);
            } else if (name === 'next' || name === 'returnTo') {
                // Decode only the nested value, carrying each character's raw
                // offset forward so masking cannot rewrite its harmless siblings.
                pending.push(decodeLogQuery(url, valueStart, fieldEnd));
            }
        }
        if (fieldEnd === end) break;
        start = fieldEnd + 1;
    }
}

/** Map one nonempty secret's logical bounds to its exact original raw bytes. */
function addSecretSpan(url: MappedUrl, start: number, end: number, secrets: UrlSpan[]): void {
    if (start < end) secrets.push({start: url.source[url.offset + start]!.start, end: url.source[url.offset + end - 1]!.end});
}

/** Decode one query layer while retaining exact source spans for every code unit.
 * Invalid percent/UTF-8 fragments remain literal diagnostics; valid neighboring
 * route delimiters still decode and identify the actual secret-bearing position. */
function decodeLogQuery(url: MappedUrl, start: number, end: number): MappedUrl {
    const raw = url.value.slice(start, end);
    const unchanged = {value: raw, source: url.source, offset: url.offset + start};
    // Raw nested next URLs share their existing mapping view. Rebuilding a
    // per-character map at every smaller suffix would allocate quadratically.
    if (!raw.includes('%') && !raw.includes('+')) return unchanged;
    let result: MappedUrl | undefined;
    for (let index = start; index < end;) {
        let width = 1;
        let decoded = url.value[index] === '+' ? ' ' : url.value[index]!;
        if (url.value[index] === '%' && /^[\da-f]{2}$/iu.test(url.value.slice(index + 1, index + 3))) {
            // Decode a UTF-8 code point at a time. Grouping all adjacent escapes
            // would let a secret mask consume neighboring nonsecret URL bytes.
            const first = Number.parseInt(url.value.slice(index + 1, index + 3), 16);
            const bytes = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
                : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
            const encoded = url.value.slice(index, Math.min(end, index + bytes * 3));
            try {
                decoded = decodeURIComponent(encoded);
                width = encoded.length;
            } catch { /* Keep this malformed fragment without hiding adjacent diagnostics. */ }
        }
        if (!result && decoded !== url.value.slice(index, index + width)) {
            // Copy preceding mapping references only after an actual decode.
            // A malformed escape that stays literal retains the shared view.
            result = {value: url.value.slice(start, index),
                source: url.source.slice(url.offset + start, url.offset + index), offset: 0};
        }
        if (result) {
            const span = {start: url.source[url.offset + index]!.start, end: url.source[url.offset + index + width - 1]!.end};
            result.value += decoded;
            for (let unit = 0; unit < decoded.length; unit++) result.source.push(span);
        }
        index += width;
    }
    return result ?? unchanged;
}
