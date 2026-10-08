import {matchQuery} from '@tanstack/vue-query';

/** Query families put the captured identity before feature data. Locale belongs at the end of
 * localized keys so invalidation can cover all language projections without knowing tuple offsets. */
export const packingKeys = {
    all: (context: string | undefined) => ['v1', context, 'packing'] as const,
    resource: (context: string | undefined, id: string) => [...packingKeys.all(context), id] as const,
    detail: (context: string | undefined, id: string, locale: string) =>
        [...packingKeys.resource(context, id), 'detail', {locale}] as const,
    editors: (context: string | undefined, id: string) => [...packingKeys.resource(context, id), 'editors'] as const,
    metadata: (context: string | undefined, id: string, locale: string) =>
        [...packingKeys.editors(context, id), 'metadata', {locale}] as const,
    settings: (context: string | undefined, id: string, locale: string) =>
        [...packingKeys.editors(context, id), 'settings', {locale}] as const,
    profiles: (context: string | undefined, id: string, search: string) =>
        [...packingKeys.editors(context, id), 'profiles', {search}] as const,
    creation: (context: string | undefined) => [...packingKeys.all(context), 'create-context'] as const,
    duplicate: (context: string | undefined, id: string | null) => [...packingKeys.all(context), id, 'duplicate'] as const,
    guest: (context: string | undefined, id: string) => [...packingKeys.resource(context, id), 'guest'] as const,
    events: (context: string | undefined) => [...packingKeys.all(context), 'events'] as const,
    eventFilters: (context: string | undefined, locale: string, filters: string) =>
        [...packingKeys.events(context), {locale, filters}] as const,
    eventPage: (context: string | undefined, locale: string, filters: string, parameters: unknown) =>
        [...packingKeys.eventFilters(context, locale, filters), parameters] as const,
};

/** Overview owns the mixed-feature projection, rather than placing five entity types in packing. */
export const overviewKeys = {
    all: (context: string | undefined) => ['v1', context, 'overview'] as const,
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
