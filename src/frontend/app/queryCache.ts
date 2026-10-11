import {matchQuery} from '@tanstack/vue-query';
import type {QueryClient} from '@tanstack/vue-query';
import {belongsToQueryFamily} from './queryKeys';

/** Retire a denied family's snapshots without disconnecting mounted recovery controls.
 * Inactive variants are evicted; an observed query keeps only its error state, so an
 * explicit refetch remains attached to the cache instead of a removed Query instance.
 * The caller owns the denial decision and retires its presentation/read generation first. */
export async function retireQueryFamily(client: QueryClient, family: readonly unknown[], error: Error,
                                       preservedKey?: readonly unknown[]): Promise<void> {
    // A typed denial may itself be a successful response inside this family. Preserve
    // that producing query: canceling it here would discard its decision and recovery read.
    function isRetiredQuery(query: Parameters<typeof belongsToQueryFamily>[0]): boolean {
        return belongsToQueryFamily(query, family)
            && (!preservedKey || !matchQuery({queryKey: preservedKey, exact: true}, query));
    }
    const filter = {predicate: isRetiredQuery};
    const queries = client.getQueryCache().findAll(filter);

    // Cancellation starts synchronously. Clear snapshots in the same turn after its
    // revert, before an observer can display previous data or another read can start.
    const cancellation = client.cancelQueries(filter);
    for (const query of queries) {
        if (!query.getObserversCount()) {
            client.removeQueries({queryKey: query.queryKey, exact: true});
            continue;
        }
        query.setState({data: undefined, dataUpdatedAt: 0, error, errorUpdatedAt: Date.now(),
            fetchFailureCount: 1, fetchFailureReason: error, fetchStatus: 'idle', status: 'error'});
    }
    // Await cancellation only after retirement; no later cache mutation can erase a
    // newly admitted response or another actor's replacement of this family.
    await cancellation;
}

/** Discard the feature owner's affected query families without redacting DTOs into
 * unauthoritative snapshots. Cancel first so held reads cannot restore private data.
 * Choosing the resource and containing projections remains the caller's policy. */
export async function evictQueryFamilies(client: QueryClient, families: readonly (readonly unknown[])[],
                                         type: 'all' | 'active' | 'inactive' = 'all'): Promise<void> {
    function belongsToAffectedFamily(query: Parameters<typeof belongsToQueryFamily>[0]): boolean {
        for (const family of families) {
            if (belongsToQueryFamily(query, family)) return true;
        }
        return false;
    }

    const filter = {predicate: belongsToAffectedFamily, type};
    // Inactive snapshots must leave in the denial turn, before a cold observer can
    // consume them. Active owners first retire their controls/read generation; allow
    // their reactive disabled/unmounted state to settle before removing those queries.
    const cancellation = client.cancelQueries(filter);
    if (type === 'inactive') client.removeQueries(filter);
    await cancellation;
    if (type !== 'inactive') client.removeQueries(filter);
}
