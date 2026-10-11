import {resolveLocale} from '../localization/translator';
import type {operations} from '../../types/api/v1';

/**
 * Translate Help's explicit native path aliases into the authored pilot query contract.
 * Native /search always owns search, including its empty prompt; an article path ignores
 * competing q/doc parameters. Only the pilot root uses the established q-first query
 * selection. SSR and browser reads must choose the same page before invoking its owner.
 */
export function resolvePilotHelpQuery(pathDoc: unknown, query: Readonly<Record<string, unknown>>):
    NonNullable<operations['getHelpPage']['parameters']['query']> {
    if (typeof pathDoc === 'string' && pathDoc.length > 0) {
        if (pathDoc.toLowerCase() === 'search') return {q: normalizedHelpSearch(query.q)};
        return {doc: pathDoc};
    }
    if (typeof query.q === 'string') return {q: normalizedHelpSearch(query.q)};
    return typeof query.doc === 'string' ? {doc: query.doc} : {};
}

/** Retain the existing browser transport bound and native whitespace normalization.
 * The owning help controller independently admits and searches the fixed source. */
function normalizedHelpSearch(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').slice(0, 100) : '';
}

/** Query state precedes fragments so native links retain the selected language.
 * This browser-safe owner is shared with the fixed-source help renderer. */
export function localizedHelpUrl(href: string, locale: string): string {
    const url = new URL(href, 'https://help.invalid');
    url.searchParams.set('locale', resolveLocale(locale));
    return `${url.pathname}${url.search}${url.hash}`;
}

/** Map native and migrated page aliases to the same maintained task guide.
 * The policy remains independent of HTML rendering, persistence and SPA transport. */
export function resolveContextualHelpUrl(requestPath: string, locale?: string): string {
    let pathname = requestPath.split(/[?#]/u, 1)[0].toLowerCase();
    // Pilot Overview represents the native dashboard. Other migrated paths retain
    // their native families; one rule set therefore serves future module migrations.
    if (/^\/frontend-pilot\/?$/u.test(pathname)) pathname = '/users/dashboard';
    else pathname = pathname.replace(/^\/frontend-pilot(?=\/)/u, '');

    const rules: Array<[RegExp, string]> = [
        [/^\/users\/dashboard(?:\/|$)/u, '/help/dashboard'],
        [/^\/users\/(?:profile|account)(?:\/|$)/u, '/help/getting_started#understand-accounts-and-profiles'],
        [/^\/users(?:\/|$)/u, '/help/getting_started'],
        [/^\/guest(?:\/|$)/u, '/help/getting_started#join-an-invitation-as-a-guest'],
        [/^\/survey(?:\/|$)/u, '/help/surveys'],
        [/^\/event(?:\/|$)/u, '/help/events'],
        [/^\/packing(?:\/|$)/u, '/help/packing_lists'],
        [/^\/activity(?:\/|$)/u, '/help/activity_plans'],
        [/^\/drivers(?:\/|$)/u, '/help/drivers_lists'],
    ];
    const destination = rules.find(([pattern]) => pattern.test(pathname))?.[1] ?? '/help';
    return locale ? localizedHelpUrl(destination, locale) : destination;
}

/** Adapt fixed-source help links without losing their native query/fragment meaning.
 * External links and separate assets retain document navigation. The adapter
 * introduces no feature state or additional navigation controls. */
export function pilotHelpUrl(href: string, locale: string): string {
    if (!href.startsWith('/help')) return href;
    const source = new URL(href, 'https://help.invalid');
    const match = /^\/help(?:\/([a-z0-9_-]+))?\/?$/iu.exec(source.pathname);
    if (!match || match[1]?.toLowerCase() === 'assets') return href;

    // Preserve native suffixes as data rather than reinterpreting their q/doc values.
    // Ordinary articles retain existing query URLs; only reserved/conflicting routes
    // need a path alias to keep the same native page selection. The shipped README is
    // the native home article, so its path alias keeps ignored home parameters inert.
    const params = new URLSearchParams(source.searchParams);
    let pathname = '/frontend-pilot/help';
    const pathDoc = match[1];
    if (pathDoc?.toLowerCase() === 'search') pathname += '/search';
    else if (params.has('q') || params.has('doc')) pathname += `/${pathDoc ?? 'readme'}`;
    else if (pathDoc) params.set('doc', pathDoc);
    params.set('locale', resolveLocale(locale));
    return `${pathname}?${params.toString()}${source.hash}`;
}
