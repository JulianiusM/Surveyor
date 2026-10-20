import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import type {ComputedRef} from 'vue';
import {hashKey, QueryObserver, useQuery} from '@tanstack/vue-query';
import type {Query, QueryCacheNotifyEvent, QueryFunctionContext} from '@tanstack/vue-query';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {eventKeys, overviewKeys} from '../../app/queryKeys';
import {refreshInterval, useActionState, usePilot} from '../../app/context';
import {refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import {isReadDenial, ObsoleteRequestError} from '../../app/transport';
import {readFailureMessage, useReadRetry, useReadRetryAt} from '../../composables/feedback';

/** Event admission and detail failures retire the same affected projections.
 * Administration, roster and Settings retain their independently granted scopes;
 * only a missing root invalidates all of that Event's cached private projections. */
export function eventDeniedQueries(actor: string | null | undefined, resource: string,
                                  intent: 'detail' | 'guest' | 'admin', status: number): EntityEntryRetirement {
    const families: (readonly unknown[])[] = intent === 'guest' ? [eventKeys.guest(actor, resource)]
        : [eventKeys.detail(actor, resource, intent === 'admin'), eventKeys.things(actor, resource, intent === 'admin'),
            eventKeys.finance(actor, resource, intent === 'admin')];
    if (status === 404) {
        // Other intents and token visits cannot retain a missing Event. The
        // producing owner separately preserves its live denial/recovery query.
        for (const view of ['detail', 'guest', 'admin'] as const) {
            if (view !== intent) families.push(eventKeys.entry(actor, resource, view));
        }
        families.push(eventKeys.guest(actor, resource));
        families.push(eventKeys.detail(actor, resource), eventKeys.detail(actor, resource, true),
            eventKeys.participants(actor, resource), eventKeys.links(actor, resource), eventKeys.things(actor, resource),
            eventKeys.things(actor, resource, true), eventKeys.editors(actor, resource), eventKeys.financeFamily(actor, resource),
            overviewKeys.all(actor));
    }
    // A mounted creation draft remains independent of its source's read authority.
    return {families, inactiveFamilies: status === 404
        ? [eventKeys.entry(actor, resource, intent), eventKeys.duplicate(actor, resource)] : []};
}

/** Share Event section delivery without sharing its business projection or drafts.
 * Each caller supplies its admitted key/read and visibility. Disclosure controls
 * recurring polling separately from the initial count read and deliberate recovery.
 * Denials retire private data immediately; transient failures retain only that same
 * scoped query's result. Collapsing a disclosure keeps that admitted snapshot/draft. */
export function useEventSection<T>(key: ComputedRef<readonly unknown[]>,
                                   read: (scope: PilotRequestScope, signal: AbortSignal) => Promise<T>,
                                   eligible: ComputedRef<boolean>,
                                   polling: ComputedRef<boolean> = eligible,
                                   retainPrevious?: (previousKey: readonly unknown[], currentKey: readonly unknown[]) => boolean) {
    const context = usePilot();
    const revoked = ref(false);
    // A localized consumer can retain its existing registered Query while a new
    // language read waits/fails. The cache remains the sole snapshot owner; this
    // reference never copies its DTO or grants current-language command authority.
    type RetainedQuery = Pick<Query<T>, 'queryKey' | 'state'>;
    const previous = shallowRef<RetainedQuery | null>(null);
    let disposeRetention: (() => void) | undefined;
    const confirmedKey = ref<string | null>(null);
    let mounted = true;
    const admission = useQueryAdmission(context, key,
        computed(() => eligible.value && context.hydrated.value && context.visible.value && !revoked.value));
    const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
    const query = useQuery({queryKey: key, ...admission, queryFn: readSection,
        /** Retain a feature-selected registered locale Query while its new read
         * waits; every other source keeps the existing cold-read behavior. */
        placeholderData(value, previousQuery) {
            // Check the complete caller scope before pinning the prior Query.
            if (!previousQuery || !mayRetain(previousQuery)) {
                releaseRetainedSnapshot();
                return undefined;
            }
            retainSnapshot(previousQuery);
            return value;
        },
        // The option itself must react to disclosure; reading it only inside the
        // interval callback leaves an existing timer running after a collapse.
        refetchInterval: computed(() => polling.value ? refreshSectionInterval : false),
        refetchIntervalInBackground: false});
    const retryAvailable = useReadRetry(() => query.error.value);
    const retryAt = useReadRetryAt(() => query.error.value, retryAvailable);
    const denied = computed(() => revoked.value || isReadDenial(query.error.value));
    const data = computed(() => {
        if (denied.value || !eligible.value) return null;
        // TanStack drops placeholder data after a failed new-language read. Keep
        // that same admitted cache reference mounted until recovery or denial.
        if (query.data.value) return query.data.value;
        return previous.value && mayRetain(previous.value) ? previous.value.state.data : undefined;
    });
    const current = computed(() => !denied.value && eligible.value && !!query.data.value && !query.isPlaceholderData.value
        && (!retainPrevious || confirmedKey.value === hashKey(key.value)));
    const updatedAt = computed(() => {
        if (!data.value) return undefined;
        // A failed cold locale key has no successful timestamp of its own. The
        // displayed cache Query supplies its existing receipt without a mirror.
        return query.data.value && !query.isPlaceholderData.value ? query.dataUpdatedAt.value
            : previous.value && mayRetain(previous.value) ? previous.value.state.dataUpdatedAt : undefined;
    });
    const loading = computed(() => !denied.value && !data.value && query.isPending.value);
    const failure = computed(() => readFailureMessage(context.messages.value, query.error.value));
    const readAction = useActionState({eligible: mayRefresh, pending: () => query.isFetching.value});
    const unsubscribe = context.queryClient.getQueryCache().subscribe(retireRemovedSnapshot);
    watch(() => hashKey(key.value), resetVisit, {flush: 'sync'});
    watch(query.error, retireDenied, {flush: 'sync'});
    watch([query.data, query.isPlaceholderData], releaseReplacedSnapshot, {flush: 'sync'});
    watch(eligible, retireHiddenRead, {flush: 'sync'});
    onBeforeUnmount(retire);

    function refreshSectionInterval(state: Query<T>): number | false {
        return eligible.value && context.visible.value && context.mayRead()
            ? refreshInterval(state.state.error, state.state.fetchFailureCount, jitter) : false;
    }

    /** Only the caller's matching actor/resource/intent can retain a cached
     * snapshot. Evicted or denied Queries cannot become fallback authority. */
    function mayRetain(previousQuery: RetainedQuery): boolean {
        if (!retainPrevious || !eligible.value || revoked.value
            || !retainPrevious(previousQuery.queryKey, key.value) || isReadDenial(previousQuery.state.error)) return false;
        // A removed locale alias may still be referenced by TanStack's observer;
        // requiring the registered object prevents its later resurrection.
        return context.queryClient.getQueryCache().find({queryKey: previousQuery.queryKey, exact: true}) === previousQuery;
    }

    /** Keep the cache-owned prior locale alive during a prolonged outage. This
     * disabled observer pins its Query without fetching or copying its DTO. */
    function retainSnapshot(previousQuery: RetainedQuery): void {
        if (previous.value === previousQuery) return;
        releaseRetainedSnapshot();
        previous.value = previousQuery;
        // A retained invoice File must not be released by inactive-query GC. The
        // disabled lease has no polling/read policy and does not refetch itself.
        const lease = new QueryObserver(context.queryClient, {queryKey: previousQuery.queryKey, enabled: false});
        disposeRetention = lease.subscribe(() => {});
    }

    function releaseRetainedSnapshot(): void {
        previous.value = null;
        const dispose = disposeRetention;
        disposeRetention = undefined;
        dispose?.();
    }

    /** Current-language delivery replaces only the display snapshot; the form
     * stays mounted and retains its independently owned genuine draft. */
    function releaseReplacedSnapshot(): void {
        if (query.data.value && !query.isPlaceholderData.value
            && confirmedKey.value === hashKey(key.value)) releaseRetainedSnapshot();
    }

    /** A sibling's authority retirement can remove the retained locale while
     * this observer is idle after transient failure. Close that fallback now. */
    function retireRemovedSnapshot(event: QueryCacheNotifyEvent): void {
        if (!previous.value || event.query !== previous.value) return;
        // Cache removal and denial clear the reference itself, making retirement
        // reactive even without another current-locale read or key transition.
        if (event.type === 'removed' || event.query.state.data === undefined || isReadDenial(event.query.state.error))
            releaseRetainedSnapshot();
    }

    /** Capture the actor and machine key before I/O. A late response cannot open
     * a different Event, identity or retired observer even when HTTP completed. */
    async function readSection({signal, queryKey}: QueryFunctionContext<readonly unknown[]>): Promise<T> {
        const scope = context.capture();
        const result = await read(scope, signal);
        // Keep cancellation and component/key retirement distinct from rejection.
        if (!mounted || !eligible.value || signal.aborted || !context.isCurrent(scope) || hashKey(queryKey) !== hashKey(key.value))
            throw new ObsoleteRequestError();
        revoked.value = false;
        // A warm locale alias may retain display but cannot enable commands until
        // this visit's read has positively confirmed its current representation.
        confirmedKey.value = hashKey(queryKey);
        return result;
    }

    function resetVisit(): void {
        revoked.value = false;
        confirmedKey.value = null;
        if (previous.value && !mayRetain(previous.value)) releaseRetainedSnapshot();
    }
    function retire(): void { mounted = false; releaseRetainedSnapshot(); unsubscribe(); }
    function mayRefresh(): boolean { return mounted && eligible.value && context.mayRead() && retryAvailable.value; }
    /** Lost eligibility releases fallback authority and cancels this section's
     * read; ordinary disclosure changes only affect its polling option. */
    function retireHiddenRead(visible: boolean): void {
        if (!visible) {
            // Release the cache lease before a canceled read can notify observers.
            releaseRetainedSnapshot();
            void context.queryClient.cancelQueries({queryKey: key.value, exact: true});
        }
    }

    /** Retire cached private content while retaining the observer's error/recovery
     * surface. A new successful GET is the only source of restored authority. */
    function retireDenied(error: Error | null): void {
        if (!isReadDenial(error)) return;
        // Mark display/read authority before cancellation yields to another read.
        revoked.value = true;
        releaseRetainedSnapshot();
        void retireQueryFamily(context.queryClient, key.value, error!);
    }

    /** Explicit refresh performs a new GET, including after terminal denial.
     * Warm cancellation/cache aliases cannot masquerade as command recovery. */
    async function refresh(): Promise<void> {
        if (!mayRefresh()) throw new ObsoleteRequestError();
        const scope = context.capture();
        const admittedKey = hashKey(key.value);
        // Select this observer after cancellation so a sibling cannot supply its read.
        await refetchFreshQuery<T>(context.queryClient, key.value, refetch, isCurrent);
        function refetch(): Promise<unknown> { return query.refetch({throwOnError: true}); }
        function isCurrent(): boolean {
            return mounted && eligible.value && context.mayRead(scope) && hashKey(key.value) === admittedKey;
        }
    }
    return {query, data, current, updatedAt, denied, loading, failure, retryAt, retryAvailable, readAction, refresh};
}
