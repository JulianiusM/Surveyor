import {computed, onBeforeUnmount, ref, watch} from 'vue';
import type {ComputedRef} from 'vue';
import {hashKey, useQuery} from '@tanstack/vue-query';
import type {Query, QueryFunctionContext} from '@tanstack/vue-query';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {refreshInterval, useActionState, usePilot} from '../../app/context';
import {refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import {isReadDenial, ObsoleteRequestError} from '../../app/transport';
import {readFailureMessage, useReadRetry, useReadRetryAt} from '../../composables/feedback';

/** Share Event section delivery without sharing its business projection or drafts.
 * Each caller supplies its admitted key/read and visibility. Disclosure controls
 * recurring polling separately from the initial count read and deliberate recovery.
 * Denials retire private data immediately; transient failures retain only that same
 * scoped query's result. Collapsing a disclosure keeps that admitted snapshot/draft. */
export function useEventSection<T>(key: ComputedRef<readonly unknown[]>,
                                   read: (scope: PilotRequestScope, signal: AbortSignal) => Promise<T>,
                                   eligible: ComputedRef<boolean>,
                                   polling: ComputedRef<boolean> = eligible) {
    const context = usePilot();
    const revoked = ref(false);
    let mounted = true;
    const admission = useQueryAdmission(context, key,
        computed(() => eligible.value && context.hydrated.value && context.visible.value && !revoked.value));
    const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
    const query = useQuery({queryKey: key, ...admission, queryFn: readSection,
        // The option itself must react to disclosure; reading it only inside the
        // interval callback leaves an existing timer running after a collapse.
        refetchInterval: computed(() => polling.value ? refreshSectionInterval : false),
        refetchIntervalInBackground: false});
    const retryAvailable = useReadRetry(() => query.error.value);
    const retryAt = useReadRetryAt(() => query.error.value, retryAvailable);
    const denied = computed(() => revoked.value || isReadDenial(query.error.value));
    const data = computed(() => denied.value || !eligible.value ? null : query.data.value);
    const loading = computed(() => !denied.value && !data.value && query.isPending.value);
    const failure = computed(() => readFailureMessage(context.messages.value, query.error.value));
    const readAction = useActionState({eligible: mayRefresh, pending: () => query.isFetching.value});
    watch(() => hashKey(key.value), resetVisit, {flush: 'sync'});
    watch(query.error, retireDenied, {flush: 'sync'});
    watch(eligible, retireHiddenRead, {flush: 'sync'});
    onBeforeUnmount(retire);

    function refreshSectionInterval(state: Query<T>): number | false {
        return eligible.value && context.visible.value && context.mayRead()
            ? refreshInterval(state.state.error, state.state.fetchFailureCount, jitter) : false;
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
        return result;
    }

    function resetVisit(): void { revoked.value = false; }
    function retire(): void { mounted = false; }
    function mayRefresh(): boolean { return mounted && eligible.value && context.mayRead() && retryAvailable.value; }
    function retireHiddenRead(visible: boolean): void {
        if (!visible) void context.queryClient.cancelQueries({queryKey: key.value, exact: true});
    }

    /** Retire cached private content while retaining the observer's error/recovery
     * surface. A new successful GET is the only source of restored authority. */
    function retireDenied(error: Error | null): void {
        if (!isReadDenial(error)) return;
        // Mark display/read authority before cancellation yields to another read.
        revoked.value = true;
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
    return {query, data, denied, loading, failure, retryAt, retryAvailable, readAction, refresh};
}
