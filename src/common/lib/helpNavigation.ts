import {resolveLocale} from '../localization/translator';
import type {operations} from '../../types/api/v1';

/**
 * Resolve explicit Help article/search paths and the root's query selection.
 * The /search path always owns search, including its empty prompt; an article path ignores
 * competing q/doc parameters. Only the frontend root uses the established q-first query
 * selection. SSR and browser reads must choose the same page before invoking its owner.
 */
export function resolveFrontendHelpQuery(pathDoc: unknown, query: Readonly<Record<string, unknown>>):
    NonNullable<operations['getHelpPage']['parameters']['query']> {
    if (typeof pathDoc === 'string' && pathDoc.length > 0) {
        if (pathDoc.toLowerCase() === 'search') return {q: normalizedHelpSearch(query.q)};
        return {doc: pathDoc};
    }
    if (typeof query.q === 'string') return {q: normalizedHelpSearch(query.q)};
    return typeof query.doc === 'string' ? {doc: query.doc} : {};
}

/** Retain the existing browser transport bound and whitespace normalization.
 * The owning help controller independently admits and searches the fixed source. */
function normalizedHelpSearch(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').slice(0, 100) : '';
}

/** Query state precedes fragments so links retain the selected language.
 * This browser-safe owner is shared with the fixed-source help renderer. */
export function localizedHelpUrl(href: string, locale: string): string {
    const url = new URL(href, 'https://help.invalid');
    url.searchParams.set('locale', resolveLocale(locale));
    return `${url.pathname}${url.search}${url.hash}`;
}

/** Map each canonical page family to its maintained task guide.
 * The policy remains independent of HTML rendering, persistence and SPA transport. */
export function resolveContextualHelpUrl(requestPath: string, locale?: string): string {
    const pathname = requestPath.split(/[?#]/u, 1)[0].toLowerCase();

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

/** Adapt fixed-source help links without losing their query/fragment meaning.
 * External links and separate assets retain document navigation. The adapter
 * introduces no feature state or additional navigation controls. */
export function frontendHelpUrl(href: string, locale: string): string {
    if (!href.startsWith('/help')) return href;
    const source = new URL(href, 'https://help.invalid');
    const match = /^\/help(?:\/([a-z0-9_-]+))?\/?$/iu.exec(source.pathname);
    if (!match || match[1]?.toLowerCase() === 'assets') return href;

    // The canonical root owns q/doc selection. Article aliases
    // still ignore competing selectors, so retain their explicit pathname.
    const params = new URLSearchParams(source.searchParams);
    let pathname = '/help';
    const pathDoc = match[1];
    if (pathDoc?.toLowerCase() === 'search') pathname += '/search';
    else if (pathDoc && (params.has('q') || params.has('doc'))) pathname += `/${pathDoc}`;
    else if (pathDoc) params.set('doc', pathDoc);
    params.set('locale', resolveLocale(locale));
    return `${pathname}?${params.toString()}${source.hash}`;
}
