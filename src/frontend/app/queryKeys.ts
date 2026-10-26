import {matchQuery} from '@tanstack/vue-query';

/** Event projections have distinct grants and lifetimes. Admission keeps a stable
 * intent prefix so resource denial can retire every cached visit of that intent. */
export const eventKeys = {
    all: (context: string | null | undefined) => ['v1', context, 'event'] as const,
    resource: (context: string | null | undefined, id: string) => [...eventKeys.all(context), id] as const,
    detail: (context: string | null | undefined, id: string, admin = false) => [...eventKeys.resource(context, id), 'detail', admin] as const,
    entry: (context: string | null | undefined, id: string, view: 'detail' | 'guest' | 'admin', visit?: number) =>
        [...eventKeys.resource(context, id), 'entry', view, ...(visit === undefined ? [] : [{visit}])] as const,
    participants: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'participants'] as const,
    links: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'links'] as const,
    things: (context: string | null | undefined, id: string, admin = false) => [...eventKeys.resource(context, id), 'things', admin] as const,
    financeFamily: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'finance'] as const,
    finance: (context: string | null | undefined, id: string, admin = false) => [...eventKeys.financeFamily(context, id), admin] as const,
    financeBreakdown: (context: string | null | undefined, id: string, poolId: string, shareId: string, admin = false) =>
        [...eventKeys.finance(context, id, admin), 'breakdown', poolId, shareId] as const,
    guest: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'guest'] as const,
    creation: (context: string | null | undefined) => [...eventKeys.all(context), 'creation'] as const,
    duplicate: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'duplicate'] as const,
    editors: (context: string | null | undefined, id: string) => [...eventKeys.resource(context, id), 'editors'] as const,
    metadata: (context: string | null | undefined, id: string) => [...eventKeys.editors(context, id), 'metadata'] as const,
    settings: (context: string | null | undefined, id: string) => [...eventKeys.editors(context, id), 'settings'] as const,
    profilesFamily: (context: string | null | undefined, id: string) => [...eventKeys.editors(context, id), 'profiles'] as const,
    profiles: (context: string | null | undefined, id: string, q: string) => [...eventKeys.profilesFamily(context, id), {q}] as const,
};

/** Matching entity keys share their literal layout through this one owner.
 * Feature extensions remain explicit; no constructor reads grants or cached data. */
function entityQueryKeys<Feature extends string>(feature: Feature) {
    // Every descendant derives from this actor/resource prefix, so grouped
    // invalidation and private-data retirement retain their established layout.
    const keys = {
        all: (context: string | null | undefined) => ['v1', context, feature] as const,
        resource: (context: string | null | undefined, id: string) => [...keys.all(context), id] as const,
        detailFamily: (context: string | null | undefined, id: string) => [...keys.resource(context, id), 'detail'] as const,
        detail: (context: string | null | undefined, id: string) => keys.detailFamily(context, id),
        entry: (context: string | null | undefined, id: string, intent: 'guest' | 'detail') =>
            [...keys.resource(context, id), 'entry', intent] as const,
        editors: (context: string | null | undefined, id: string) => [...keys.resource(context, id), 'editors'] as const,
        metadata: (context: string | null | undefined, id: string) => [...keys.editors(context, id), 'metadata'] as const,
        settings: (context: string | null | undefined, id: string) => [...keys.editors(context, id), 'settings'] as const,
        guest: (context: string | null | undefined, id: string) => [...keys.resource(context, id), 'guest'] as const,
    };
    return keys;
}

/** Event-linked lists share editor/search and creation-key composition.
 * Optional event selection retains its exact previous spelling and family prefix;
 * user-authored representations deliberately omit locale from these keys. */
function listQueryKeys<Feature extends string>(feature: Feature) {
    // Lists add only their shared search and Event-selection families; Activity
    // extends this result and standalone Survey never acquires these branches.
    const keys = {
        ...entityQueryKeys(feature),
        profilesFamily: (context: string | null | undefined, id: string) => [...keys.editors(context, id), 'profiles'] as const,
        profiles: (context: string | null | undefined, id: string, search: string) => [...keys.profilesFamily(context, id), {search}] as const,
        creation: (context: string | null | undefined, eventId?: string) =>
            [...keys.all(context), 'create-context', ...(eventId ? [{eventId}] : [])] as const,
        duplicate: (context: string | null | undefined, id: string | null, eventId?: string) =>
            [...keys.all(context), id, 'duplicate', ...(eventId ? [{eventId}] : [])] as const,
        events: (context: string | null | undefined) => [...keys.all(context), 'events'] as const,
        eventFilters: (context: string | null | undefined, _locale: string, filters: string) =>
            [...keys.events(context), {filters}] as const,
        eventPage: (context: string | null | undefined, locale: string, filters: string, parameters: unknown) =>
            [...keys.eventFilters(context, locale, filters), parameters] as const,
    };
    return keys;
}

export const packingKeys = listQueryKeys('packing');
export const driversKeys = listQueryKeys('drivers');

/** Activity adds only its independently admitted requirement and job families. */
export const activityKeys = {
    ...listQueryKeys('activity'),
    requirements: (context: string | null | undefined, id: string) => [...activityKeys.editors(context, id), 'requirements'] as const,
    recommendations: (context: string | null | undefined, id: string) => [...activityKeys.editors(context, id), 'recommendations'] as const,
    recommendationJob: (context: string | null | undefined, id: string, jobId: string) =>
        [...activityKeys.recommendations(context, id), 'job', jobId] as const,
};

/** Surveys retain standalone creation and participation, without Event keys. */
export const surveyKeys = {
    ...entityQueryKeys('survey'),
    creation: (context: string | null | undefined) => [...surveyKeys.all(context), 'create-context'] as const,
    duplicate: (context: string | null | undefined, id: string | null) => [...surveyKeys.all(context), id, 'duplicate'] as const,
};

/** Overview owns the mixed-feature projection, rather than placing five entity types in packing. */
export const overviewKeys = {
    all: (context: string | null | undefined) => ['v1', context, 'overview'] as const,
    // TanStack matches the partial parameter object, covering this region's older
    // searches/pages without cancelling another region or reading tuple offsets.
    regionFamily: (context: string | null | undefined, locale: string, collection: string, region: string) =>
        [...overviewKeys.all(context), {locale}, {collection, region}] as const,
    // Authorization is independent of language. An empty locale matcher retires all
    // translated variants of this region while retaining other independent regions.
    regionAuthority: (context: string | null | undefined, collection: string, region: string) =>
        [...overviewKeys.all(context), {}, {collection, region}] as const,
    region: (context: string | null | undefined, locale: string, parameters: unknown) =>
        [...overviewKeys.all(context), {locale}, parameters] as const,
};

export const helpKeys = {
    all: (context: string | null | undefined) => ['v1', context, 'help'] as const,
    page: (context: string | null | undefined, locale: string, parameters: unknown) =>
        [...helpKeys.all(context), {locale}, parameters] as const,
};

/** Private profile administration uses actor-scoped, language-independent machine projections. */
export const identityAdministrationKeys = {
    all: (context: string | null | undefined) => ['v1', context, 'identity-administration'] as const,
    entry: (context: string | null | undefined, view: 'edit' | 'manage' | 'create') =>
        [...identityAdministrationKeys.all(context), 'entry', view] as const,
    workflow: (context: string | null | undefined, kind: 'token' | 'entry' | 'deactivate' | 'delete-account') =>
        [...identityAdministrationKeys.all(context), 'workflow-entry', kind] as const,
    current: (context: string | null | undefined) => [...identityAdministrationKeys.all(context), 'current'] as const,
    profiles: (context: string | null | undefined) => [...identityAdministrationKeys.all(context), 'profiles'] as const,
};

export function belongsToQueryFamily(query: Parameters<typeof matchQuery>[1], family: readonly unknown[]): boolean {
    return matchQuery({queryKey: family}, query);
}

/** Match every Event-finance audience and descendant through its authored family.
 * Resource extraction follows the existing Event prefix; the finance factory alone
 * defines the remaining shape, including its discriminator and descendant boundary. */
function belongsToEventFinanceFamily(query: Parameters<typeof matchQuery>[1], context: string | null): boolean {
    // Read only the resource following the current prefix, without fixing that
    // prefix's length or independently interpreting a finance segment's position.
    const [resourceId] = query.queryKey.slice(eventKeys.all(context).length);
    return typeof resourceId === 'string'
        && belongsToQueryFamily(query, eventKeys.financeFamily(context, resourceId));
}

/** Only these existing projection owners include translated server content. Locale-free
 * machine snapshots remain available during a language preference command. Future
 * language-owned projections extend this owner rather than invalidating the whole cache. */
export function belongsToLocalizedQueryFamily(query: Parameters<typeof matchQuery>[1], context: string | null): boolean {
    // Match complete actor families, including obsolete locale variants and inactive pages.
    return belongsToQueryFamily(query, helpKeys.all(context)) || belongsToQueryFamily(query, overviewKeys.all(context))
        // Finance contains request-local presenter wording. Reuse its family
        // definition while other Event projections remain locale-independent.
        || belongsToEventFinanceFamily(query, context);
}
