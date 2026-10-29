import {computed, onBeforeUnmount, ref, watch} from 'vue';
import type {ComputedRef} from 'vue';
import {hashKey, useQuery} from '@tanstack/vue-query';
import type {Query, QueryFunctionContext} from '@tanstack/vue-query';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {eventKeys, overviewKeys} from '../../app/queryKeys';
import {refreshInterval, useActionState, useFrontend} from '../../app/context';
import {refetchFreshQuery, retireQueryFamily, useQueryAdmission, useQuerySnapshotRetention} from '../../app/queryCache';
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
    read: (scope: FrontendRequestScope, signal: AbortSignal) => Promise<T>,
    eligible: ComputedRef<boolean>,
    polling: ComputedRef<boolean> = eligible,
    retainPrevious?: (previousKey: readonly unknown[], currentKey: readonly unknown[]) => boolean) {
    const context = useFrontend();
    const revoked = ref(false);
    // The shared cache owner retains a registered locale Query without copying
    // its DTO or granting this visit current-language command authority.
    const previous = useQuerySnapshotRetention<T>(context.queryClient, mayRetain);
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
            if (!previousQuery || !previous.retain(previousQuery)) {
                previous.release();
                return undefined;
            }
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
        if (query.data.value && !query.isPlaceholderData.value) return query.data.value;
        return previous.data.value;
    });
    const current = computed(() => !denied.value && eligible.value && !!query.data.value && !query.isPlaceholderData.value
        && (!retainPrevious || confirmedKey.value === hashKey(key.value)));
    const updatedAt = computed(() => {
        if (!data.value) return undefined;
        // A failed cold locale key has no successful timestamp of its own. The
        // displayed cache Query supplies its existing receipt without a mirror.
        return query.data.value && !query.isPlaceholderData.value ? query.dataUpdatedAt.value
            : previous.updatedAt.value;
    });
    const loading = computed(() => !denied.value && !data.value && query.isPending.value);
    const failure = computed(() => readFailureMessage(context.messages.value, query.error.value));
    const readAction = useActionState({eligible: mayRefresh, pending: () => query.isFetching.value});
    watch(() => hashKey(key.value), resetVisit, {flush: 'sync'});
    watch(query.error, retireDenied, {flush: 'sync'});
    watch([query.data, query.isPlaceholderData], releaseReplacedSnapshot, {flush: 'sync'});
    watch(eligible, retireHiddenRead, {flush: 'sync'});
    onBeforeUnmount(retire);

    function refreshSectionInterval(state: Query<T>): number | false {
        return eligible.value && context.visible.value && context.mayRead()
            ? refreshInterval(state.state.error, state.state.fetchFailureCount, jitter) : false;
    }

    /** The feature selects matching actor/resource/intent and eligibility; the
     * shared cache owner separately enforces registration and read retirement. */
    function mayRetain(previousQuery: Query<T>): boolean {
        return !!retainPrevious && eligible.value && !revoked.value
            && retainPrevious(previousQuery.queryKey, key.value);
    }

    /** Current-language delivery replaces only the display snapshot; the form
     * stays mounted and retains its independently owned genuine draft. */
    function releaseReplacedSnapshot(): void {
        if (query.data.value && !query.isPlaceholderData.value
            && confirmedKey.value === hashKey(key.value)) previous.release();
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
    }
    function retire(): void { mounted = false; }
    function mayRefresh(): boolean { return mounted && eligible.value && context.mayRead() && retryAvailable.value; }
    /** Lost eligibility releases fallback authority and cancels this section's
     * read; ordinary disclosure changes only affect its polling option. */
    function retireHiddenRead(visible: boolean): void {
        if (!visible) {
            // Release the cache lease before a canceled read can notify observers.
            previous.release();
            void context.queryClient.cancelQueries({queryKey: key.value, exact: true});
        }
    }

    /** Retire cached private content while retaining the observer's error/recovery
     * surface. A new successful GET is the only source of restored authority. */
    function retireDenied(error: Error | null): void {
        if (!isReadDenial(error)) return;
        // Mark display/read authority before cancellation yields to another read.
        revoked.value = true;
        previous.release();
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
