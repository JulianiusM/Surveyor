import {matchQuery} from '@tanstack/vue-query';

/** Query families put the captured identity before feature data. Include locale only when the
 * server representation contains translated content. Machine state, user-authored content and
 * authority have one current projection; language aliases could resurrect an older grant. */
export const packingKeys = {
    all: (context: string | undefined) => ['v1', context, 'packing'] as const,
    resource: (context: string | undefined, id: string) => [...packingKeys.all(context), id] as const,
    detailFamily: (context: string | undefined, id: string) => [...packingKeys.resource(context, id), 'detail'] as const,
    detail: (context: string | undefined, id: string) => packingKeys.detailFamily(context, id),
    entry: (context: string | undefined, id: string, intent: 'guest' | 'detail') =>
        [...packingKeys.resource(context, id), 'entry', intent] as const,
    editors: (context: string | undefined, id: string) => [...packingKeys.resource(context, id), 'editors'] as const,
    metadata: (context: string | undefined, id: string) =>
        [...packingKeys.editors(context, id), 'metadata'] as const,
    settings: (context: string | undefined, id: string) =>
        [...packingKeys.editors(context, id), 'settings'] as const,
    profilesFamily: (context: string | undefined, id: string) =>
        [...packingKeys.editors(context, id), 'profiles'] as const,
    profiles: (context: string | undefined, id: string, search: string) =>
        [...packingKeys.profilesFamily(context, id), {search}] as const,
    // URL preselection changes the admitted form projection. Keep it in the key;
    // omitting it retains the family prefix for ordinary invalidation callers.
    creation: (context: string | undefined, eventId?: string) =>
        [...packingKeys.all(context), 'create-context', ...(eventId ? [{eventId}] : [])] as const,
    duplicate: (context: string | undefined, id: string | null, eventId?: string) =>
        [...packingKeys.all(context), id, 'duplicate', ...(eventId ? [{eventId}] : [])] as const,
    guest: (context: string | undefined, id: string) => [...packingKeys.resource(context, id), 'guest'] as const,
    events: (context: string | undefined) => [...packingKeys.all(context), 'events'] as const,
    // The shared picker accepts locale for providers with translated representations. Packing's
    // options contain user titles and machine dates only, so its provider deliberately omits it.
    eventFilters: (context: string | undefined, _locale: string, filters: string) =>
        [...packingKeys.events(context), {filters}] as const,
    eventPage: (context: string | undefined, locale: string, filters: string, parameters: unknown) =>
        [...packingKeys.eventFilters(context, locale, filters), parameters] as const,
};

/** Overview owns the mixed-feature projection, rather than placing five entity types in packing. */
export const overviewKeys = {
    all: (context: string | undefined) => ['v1', context, 'overview'] as const,
    // TanStack matches the partial parameter object, covering this region's older
    // searches/pages without cancelling another region or reading tuple offsets.
    regionFamily: (context: string | undefined, locale: string, collection: string, region: string) =>
        [...overviewKeys.all(context), {locale}, {collection, region}] as const,
    // Authorization is independent of language. An empty locale matcher retires all
    // translated variants of this region while retaining other independent regions.
    regionAuthority: (context: string | undefined, collection: string, region: string) =>
        [...overviewKeys.all(context), {}, {collection, region}] as const,
    region: (context: string | undefined, locale: string, parameters: unknown) =>
        [...overviewKeys.all(context), {locale}, parameters] as const,
};

export const helpKeys = {
    all: (context: string | undefined) => ['v1', context, 'help'] as const,
    page: (context: string | undefined, locale: string, parameters: unknown) =>
        [...helpKeys.all(context), {locale}, parameters] as const,
};

export function belongsToQueryFamily(query: Parameters<typeof matchQuery>[1], family: readonly unknown[]): boolean {
    return matchQuery({queryKey: family}, query);
}

/** Only these existing projection owners include translated server content. Locale-free
 * machine snapshots remain available during a language preference command. Future migrated
 * language-owned projections extend this owner rather than invalidating the whole cache. */
export function belongsToLocalizedQueryFamily(query: Parameters<typeof matchQuery>[1], context: string): boolean {
    // Match complete actor families, including obsolete locale variants and inactive pages.
    return belongsToQueryFamily(query, helpKeys.all(context)) || belongsToQueryFamily(query, overviewKeys.all(context));
}
