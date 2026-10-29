import {hashKey, matchQuery, QueryObserver} from '@tanstack/vue-query';
import type {Query, QueryCacheNotifyEvent, QueryClient, QueryFilters} from '@tanstack/vue-query';
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import type {ComputedRef} from 'vue';
import type {FrontendContext, FrontendQueryAdmission, FrontendQueryReadPolicy, FrontendQueryRefreshOptions,
    FrontendRetainedQuery} from '../../types/FrontendUiTypes';
import {belongsToQueryFamily} from './queryKeys';
import {ApiFailure, isReadDenial, UnconfirmedResponseError} from './transport';

/** Retain a caller-selected registered Query while its replacement waits/fails.
 * A disabled observer prevents inactive GC without reading or copying a DTO.
 * Scope changes, eviction and denied/cleared data release the same cache lease. */
export function useQuerySnapshotRetention<T>(client: QueryClient,
    eligible: (query: Query<T>) => boolean) {
    const retained = shallowRef<FrontendRetainedQuery<T> | null>(null);
    const revision = ref(0);
    let disposeLease: (() => void) | undefined;
    const unsubscribe = client.getQueryCache().subscribe(receiveRetainedState);
    // Query.state is not Vue state. Cache updates invalidate these projections;
    // the registered Query still supplies every displayed value and receipt.
    const data = computed(() => currentQuery()?.state.data);
    const updatedAt = computed(() => currentQuery()?.state.dataUpdatedAt);
    watch(retentionIsInvalid, releaseInvalidScope, {flush: 'sync'});
    onBeforeUnmount(retire);

    /** Complete caller scope and cache identity both remain required. An old
     * observer can hold a removed Query after a new alias has taken its key. */
    function mayRetain(query: FrontendRetainedQuery<T>): boolean {
        const registered = client.getQueryCache().find<T>({queryKey: query.queryKey, exact: true});
        if (!registered || registered !== query) return false;
        return query.state.data !== undefined && !isReadDenial(query.state.error) && eligible(registered);
    }

    function currentQuery(): FrontendRetainedQuery<T> | undefined {
        void revision.value;
        return retained.value && mayRetain(retained.value) ? retained.value : undefined;
    }
    function retentionIsInvalid(): boolean {
        void revision.value;
        return !!retained.value && !mayRetain(retained.value);
    }
    function releaseInvalidScope(invalid: boolean): void { if (invalid) release(); }

    /** Reuse one cache lease; it has no request function or recurring read policy. */
    function retain(query: FrontendRetainedQuery<T>): boolean {
        // Reject retired scopes before allocating an observer; repeated placeholder
        // evaluation of the same registered Query must not accumulate leases.
        if (!mayRetain(query)) { release(); return false; }
        if (retained.value === query) return true;
        release();
        retained.value = query;
        // The cache owns the response. This observer prevents GC only and cannot
        // dispatch a read or become an eligible command-refresh dependency.
        const lease = new QueryObserver(client, {queryKey: query.queryKey, enabled: false});
        disposeLease = lease.subscribe(() => {});
        return true;
    }

    /** Clear the reference before disposing its observer, so synchronous cache
     * notifications cannot revive or recursively release the old snapshot. */
    function release(): void {
        retained.value = null;
        const dispose = disposeLease;
        disposeLease = undefined;
        dispose?.();
    }

    /** Explicit authority retirement differs from inactive GC. Removed, denied
     * or cleared Queries must disappear even during a replacement's outage. */
    function receiveRetainedState(event: QueryCacheNotifyEvent): void {
        if (!retained.value || event.query !== retained.value
            || event.type !== 'removed' && event.type !== 'updated') return;
        // Invalidate derived values for live updates, or release before another
        // render can consume a removed/denied Query through its old observer.
        if (event.type === 'removed' || !mayRetain(retained.value)) release();
        else revision.value++;
    }
    function retire(): void { release(); unsubscribe(); }

    return {data, updatedAt, retain, release};
}

/** Project the current key's actual invalidation state without another authority
 * flag. Callers decide which controls require this freshness; the cache continues
 * to own retained data, failures, invalidation and successful recovery. */
export function useQueryInvalidation(client: QueryClient, key: ComputedRef<readonly unknown[]>): ComputedRef<boolean> {
    const revision = ref(0);
    const stopState = client.getQueryCache().subscribe(receiveState);
    onBeforeUnmount(stopState);

    /** Observe state/identity changes only for the consumer's current logical key.
     * A prior locale/filter may remain invalidated without fencing its successor. */
    function receiveState(event: QueryCacheNotifyEvent): void {
        if ((event.type === 'updated' || event.type === 'added' || event.type === 'removed')
            && matchQuery({queryKey: key.value, exact: true}, event.query)) revision.value++;
    }

    return computed(() => {
        // Cache events invalidate this projection; every evaluation reads the
        // library's actual state instead of mirroring its flag into Vue state.
        void revision.value;
        return client.getQueryState(key.value)?.isInvalidated ?? false;
    });
}

/** Admit a first GET for each mounted key visit, including cached terminal failure.
 * Later automatic resumes use that visit's terminal policy. Eligibility stays with
 * its actual observer so explicit command dependencies can read a paused terminal
 * query without reopening hidden, retired or differently scoped consumers. */
export function useQueryAdmission(context: FrontendContext, key: ComputedRef<readonly unknown[]>,
    eligible: ComputedRef<boolean>): FrontendQueryAdmission {
    // A second observer can join an already dispatched/paused read without another
    // fetch action. That real pending operation consumes this visit's first admission.
    const dispatched = ref(hasPendingRead());
    let active = true;
    // Reactive session objects can recreate an equal tuple during a locale command.
    // Only the logical key starts another visit; an equal machine key keeps its failure policy.
    watch(() => hashKey(key.value), beginVisit, {flush: 'sync'});
    const stopReads = context.queryClient.getQueryCache().subscribe(receiveDispatch);
    onBeforeUnmount(retireObserver);

    /** A changed key is a fresh admission journey, not the old observer's failure. */
    function beginVisit(): void {
        dispatched.value = hasPendingRead();
    }

    function hasPendingRead(): boolean {
        const status = context.queryClient.getQueryState(key.value)?.fetchStatus;
        return status === 'fetching' || status === 'paused';
    }

    /** Actual fetch dispatch consumes first-read eligibility, never manual cache aliases. */
    function receiveDispatch(event: QueryCacheNotifyEvent): void {
        if (event.type === 'updated' && event.action.type === 'fetch'
            && matchQuery({queryKey: key.value, exact: true}, event.query)) dispatched.value = true;
    }

    function mayRead(requestedKey: readonly unknown[]): boolean {
        // A key transition can retain old observer options until Vue settles them.
        // Those options never authorize another read of the retired key.
        return active && eligible.value && context.mayRead() && hashKey(requestedKey) === hashKey(key.value);
    }

    /** Query metadata may outlive a component; its callback must retire before disposal. */
    function retireObserver(): void {
        active = false;
        stopReads();
    }

    return {enabled: computed(() => active && eligible.value && context.mayObserve(key.value, !dispatched.value)),
        meta: {surveyorRead: {mayRead}}};
}

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
 * be presented; this owner hides the query library's retained-cancellation behavior.
 * Optional dependents may be absent after the caller's own required authority read.
 * Selected read failures still propagate, and required recovery remains strict. */
export async function refetchFreshQueries(client: QueryClient, filter: QueryFilters, mayRead: () => boolean,
    options: FrontendQueryRefreshOptions = {}): Promise<void> {
    const reads: Promise<unknown>[] = [];
    // TanStack's active filter excludes a terminal-paused observer. Inspect its
    // existing observer metadata instead; a closed region remains ineligible.
    const selectedFamily = filter.type === 'active' ? {...filter, type: 'all' as const} : filter;
    for (const query of client.getQueryCache().findAll(selectedFamily)) {
        if (!mayRefreshQuery(query, filter.type === 'active')) continue;
        // A sibling can retire during cancellation. Preserve the caller's active
        // filter at dispatch instead of resurrecting that inactive cached observer.
        const selected = {...filter, queryKey: query.queryKey, exact: true};
        reads.push(refetchFreshQuery(client, query.queryKey, refetchSelectedQuery, mayReadSelected));

        /** Explicit dependency reads use the already-authored query function even
         * when terminal suspension disabled its automatic observer. */
        function refetchSelectedQuery(): Promise<unknown> {
            // Query-level options belong to the last writer. Select the actually
            // eligible observer so a hidden/retired sibling's queryFn is never used.
            const observer = eligibleReadObserver(query);
            return observer ? observer.refetch({throwOnError: true}) : client.refetchQueries(selected, {throwOnError: true});
        }

        function mayReadSelected(): boolean {
            return mayRead() && (filter.type !== 'active' && !query.isDisabled() || hasEligibleReadObserver(query));
        }
    }
    // An empty/disabled family has performed no authority read. Required recovery
    // must not acknowledge an unknown command merely because Promise.all([])
    // resolves. Optional refresh is for a caller whose own required read succeeded.
    if (!reads.length && !options.allowEmpty) throw new UnconfirmedResponseError();
    try {
        await Promise.all(reads);
    } catch (error) {
        // Preserve the first observed failure, but keep the initiating action
        // pending until every already-dispatched dependent read has settled.
        await Promise.allSettled(reads);
        throw error;
    }
}

/** Read the existing failure of the same eligible observers a dependency refresh
 * would dispatch. The latest server deadline controls a multi-region Retry; hidden
 * or inactive snapshots cannot close a mounted consumer's unrelated recovery. */
export function queryFamilyReadError(client: QueryClient, families: readonly (readonly unknown[])[]): Error | null {
    let failure: Error | null = null;
    // Inspect actual query state rather than copying errors into a navigation
    // receipt. Terminal-paused but eligible mounted readers still participate.
    for (const query of client.getQueryCache().getAll()) {
        if (!belongsToSelectedFamily(query, families) || !mayRefreshQuery(query, true) || !query.state.error) continue;
        const candidate = query.state.error;
        const selectedDeadline = failure instanceof ApiFailure ? failure.retryAt ?? 0 : 0;
        const candidateDeadline = candidate instanceof ApiFailure ? candidate.retryAt ?? 0 : 0;
        if (!failure || candidateDeadline > selectedDeadline) failure = candidate;
    }
    return failure;
}

/** Keep explicit dependency dispatch and its Retry presentation on one observer
 * eligibility contract, including terminal suspension and static projections. */
function mayRefreshQuery(query: Parameters<typeof matchQuery>[1], activeOnly: boolean): boolean {
    return !query.isStatic() && (!(activeOnly || query.isDisabled()) || hasEligibleReadObserver(query));
}

/** Feature callers select prefixes; this cache owner keeps tuple shapes private. */
function belongsToSelectedFamily(query: Parameters<typeof belongsToQueryFamily>[0], families: readonly (readonly unknown[])[]): boolean {
    for (const family of families) {
        if (belongsToQueryFamily(query, family)) return true;
    }
    return false;
}

/** Each actual observer owns its visibility/activity and disposal policy. Looking at
 * observer options avoids the query's last-writer metadata overriding another mounted
 * consumer. Existing enabled observers retain their ordinary QueryClient contract. */
function eligibleReadObserver(query: Parameters<typeof matchQuery>[1]): Parameters<typeof matchQuery>[1]['observers'][number] | undefined {
    // Select from actual observer options: the query-level metadata may belong
    // to a later hidden consumer, and legacy enabled observers still participate.
    for (const observer of query.observers) {
        const policy = observer.options.meta?.surveyorRead as FrontendQueryReadPolicy | undefined;
        if (policy ? policy.mayRead(query.queryKey) : observer.getCurrentResult().isEnabled) return observer;
    }
}

function hasEligibleReadObserver(query: Parameters<typeof matchQuery>[1]): boolean {
    return eligibleReadObserver(query) !== undefined;
}

/** The public cache action distinguishes network success from setQueryData. */
function isNetworkReadSuccess(event: QueryCacheNotifyEvent): event is Extract<QueryCacheNotifyEvent, {type: 'updated'}>
    & {action: {type: 'success'; data: unknown; manual?: boolean}} {
    return event.type === 'updated' && event.action.type === 'success' && !event.action.manual;
}

/** Mark caller-selected projections stale after a confirmed command without
 * detaching observed recovery controls or forcing hidden/inactive reads. Cancel
 * first so an older held response cannot restore the pre-command projection. */
export async function invalidateQueryFamilies(client: QueryClient, families: readonly (readonly unknown[])[]): Promise<void> {
    function belongsToAffectedFamily(query: Parameters<typeof belongsToQueryFamily>[0]): boolean {
        return belongsToSelectedFamily(query, families);
    }
    const filter = {predicate: belongsToAffectedFamily};
    // Both mutations begin in this turn. Cancellation reverts a held fetch before
    // invalidation, and invalidation never launches a GET outside read admission.
    const cancellation = client.cancelQueries(filter);
    const invalidation = client.invalidateQueries({...filter, refetchType: 'none'});
    await Promise.all([cancellation, invalidation]);
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
 * Choosing the resource and containing projections remains the caller's policy.
 * An optional producing admission family survives even while its observed query
 * is disabled: TanStack counts that observer as inactive during initialization. */
export async function evictQueryFamilies(client: QueryClient, families: readonly (readonly unknown[])[],
    type: 'all' | 'active' | 'inactive' = 'all',
    preservedFamily?: readonly unknown[]): Promise<void> {
    /** Match only caller-selected resource families, preserving unrelated actors and endpoints. */
    function belongsToAffectedFamily(query: Parameters<typeof belongsToQueryFamily>[0]): boolean {
        // A producing denial belongs to the admission owner. Removing a paused
        // observer here would lose that receipt before its subtree can render it.
        if (preservedFamily && belongsToQueryFamily(query, preservedFamily)) return false;
        return belongsToSelectedFamily(query, families);
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
