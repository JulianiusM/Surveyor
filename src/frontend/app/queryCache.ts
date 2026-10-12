import {matchQuery} from '@tanstack/vue-query';
import type {QueryCacheNotifyEvent, QueryClient, QueryFilters} from '@tanstack/vue-query';
import {belongsToQueryFamily} from './queryKeys';
import {UnconfirmedResponseError} from './transport';

/** Observe actual successful reads, including equal responses. Observer idle/data
 * changes are insufficient: cancellation can return retained data, and manual cache
 * aliases are presentation delivery rather than another successful network read. */
export function observeQueryReads<T>(client: QueryClient, key: () => readonly unknown[],
                                     receive: (data: T, updatedAt: number) => void): () => void {
    return client.getQueryCache().subscribe(function receiveRead(event): void {
        if (!isNetworkReadSuccess(event) || !matchQuery({queryKey: key(), exact: true}, event.query)) return;
        // The feature's validated query function owns this key's data contract.
        // Capture this success action, rather than a later manual cache alias.
        receive(event.action.data as T, event.query.state.dataUpdatedAt);
    });
}

/** Require a new successful read before a continuation can adopt authority.
 * Cancel explicitly: refetch's cancelRefetch option can reuse a cold pending fetch,
 * while a canceled warm fetch may resolve with retained data instead of rejecting.
 * The public underlying promise rejects cancellation and carries this actual read,
 * independently of manual cache aliases, timestamps and structural sharing. */
export async function refetchFreshQuery<T>(client: QueryClient, key: readonly unknown[],
                                          refetch: () => Promise<unknown>, mayRead: () => boolean): Promise<T> {
    const filter = {queryKey: key, exact: true};
    const previous = client.getQueryCache().find(filter)?.promise;
    await client.cancelQueries(filter);
    // Cancellation yields. The feature's captured actor/resource/lifecycle must
    // still admit dispatch; an observer may now belong to a different current key.
    if (!mayRead()) throw new UnconfirmedResponseError();
    const observerRead = refetch();
    // Capture synchronously after dispatch. A warm replacement can reuse fetching
    // status without a new fetch action, but its public promise still changes.
    const current = client.getQueryCache().find(filter)?.promise;
    const [, data] = await Promise.all([observerRead, current]);
    if (!current || current === previous || data === undefined) throw new UnconfirmedResponseError();
    // The feature's validated query function supplies this key's data contract.
    // Use its successful result, never the observer's possibly retained snapshot.
    return data as T;
}

/** A family refresh certifies each currently readable active region independently.
 * The caller still owns which family/actor is relevant and whether its result may
 * be presented; this owner hides the query library's retained-cancellation behavior. */
export async function refetchFreshQueries(client: QueryClient, filter: QueryFilters, mayRead: () => boolean): Promise<void> {
    const reads: Promise<unknown>[] = [];
    for (const query of client.getQueryCache().findAll(filter)) {
        if (query.isDisabled() || query.isStatic()) continue;
        // A sibling can retire during cancellation. Preserve the caller's active
        // filter at dispatch instead of resurrecting that inactive cached observer.
        const selected = {...filter, queryKey: query.queryKey, exact: true};
        reads.push(refetchFreshQuery(client, query.queryKey, function refetchSelectedQuery() {
            return client.refetchQueries(selected, {throwOnError: true});
        }, mayRead));
    }
    // An empty/disabled family has performed no authority read. It must not
    // acknowledge an unknown command merely because Promise.all([]) resolves.
    if (!reads.length) throw new UnconfirmedResponseError();
    await Promise.all(reads);
}

/** The public cache action distinguishes network success from setQueryData. */
function isNetworkReadSuccess(event: QueryCacheNotifyEvent): event is Extract<QueryCacheNotifyEvent, {type: 'updated'}>
    & {action: {type: 'success'; data: unknown; manual?: boolean}} {
    return event.type === 'updated' && event.action.type === 'success' && !event.action.manual;
}

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
