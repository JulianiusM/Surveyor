import {computed, onBeforeUnmount, shallowRef, watch} from 'vue';
import {useQuery, type QueryFunctionContext} from '@tanstack/vue-query';
import type {FrontendListSource} from '../../types/FrontendListTypes';
import type {PilotRead} from '../../types/FrontendPilotUiTypes';
import {refreshInterval, usePilot} from '../app/context';
import {belongsToQueryFamily} from '../app/queryKeys';
import {refetchFreshQuery, useQueryAdmission} from '../app/queryCache';
import {isReadDenial, ObsoleteRequestError} from '../app/transport';

/** Matching list detail consumers share cancellation, polling and stale-read
 * recovery. Each feature supplies actual transport, query scope and denied-data
 * retirement; this owner retains no draft, business action or permission mirror. */
export function useListDetail<T>(source: FrontendListSource<T>) {
    const context = usePilot();
    const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
    let active = true;
    const previous = shallowRef<{query: Parameters<typeof belongsToQueryFamily>[0]; result: PilotRead<T>} | null>(null);
    const revoked = shallowRef(false);
    onBeforeUnmount(() => { active = false; });
    const admission = useQueryAdmission(context, source.queryKey,
        computed(() => context.hydrated.value && context.visible.value && !revoked.value));
    const list = useQuery({
        queryKey: source.queryKey,
        ...admission,
        queryFn: read,
        refetchInterval: query => context.mayRead() && context.visible.value
            ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter) : false,
        refetchIntervalInBackground: false,
        placeholderData(value, query) {
            if (!value || !query || !belongsToQueryFamily(query, source.resourceFamily())) {
                previous.value = null;
                return undefined;
            }
            // TanStack releases placeholders after terminal failure. Preserve only
            // this actor/resource's confirmed projection until an actual denial.
            previous.value = {query, result: value};
            return value;
        },
    });
    const denied = computed(() => revoked.value || isReadDenial(list.error.value));
    const data = computed(() => {
        if (denied.value) return null;
        if (list.data.value) return list.data.value.data;
        return previous.value && belongsToQueryFamily(previous.value.query, source.resourceFamily())
            ? previous.value.result.data : undefined;
    });

    /** A fresh admitted response alone restores authority after a denied read.
     * Retired requests cannot publish a previous actor or resource's projection. */
    async function read({signal, queryKey}: QueryFunctionContext<readonly unknown[]>): Promise<PilotRead<T>> {
        const scope = context.capture();
        const resource = source.resourceId.value;
        const result = await source.read(resource, scope, signal, context.queryClient.getQueryData<PilotRead<T>>(queryKey));
        if (!active || signal.aborted || !context.isCurrent(scope) || resource !== source.resourceId.value)
            throw new ObsoleteRequestError();
        revoked.value = false;
        return result;
    }

    /** Explicit recovery dispatches a real GET even while denial suspends polling.
     * A cache hit cannot acknowledge an uncertain write or restore read authority. */
    async function refresh(): Promise<void> {
        if (!active || !context.mayRead()) throw new ObsoleteRequestError();
        const scope = context.capture();
        const resource = source.resourceId.value;
        await refetchFreshQuery<PilotRead<T>>(context.queryClient, source.queryKey.value,
            () => list.refetch({throwOnError: true}),
            () => active && resource === source.resourceId.value && context.mayRead(scope));
    }

    watch(source.resourceId, () => { revoked.value = false; previous.value = null; });
    watch(list.error, failure => {
        if (!isReadDenial(failure)) return;
        // Feature policy retires its settings/overview and personal state only
        // after the shared read owner has synchronously closed stale fallback.
        revoked.value = true;
        previous.value = null;
        source.denied(failure);
    }, {flush: 'sync'});

    return {list, data, denied, refresh, isActive: () => active};
}
