import {computed, onBeforeUnmount, shallowRef, watch} from 'vue';
import {useQuery, type QueryFunctionContext} from '@tanstack/vue-query';
import type {FrontendListCommandSource, FrontendListSettingsRetirement, FrontendListSettingsRetirementSource,
    FrontendListSource} from '../../types/FrontendListTypes';
import type {FrontendCommandDraft, FrontendPlainMessageKey, FrontendRead} from '../../types/FrontendUiTypes';
import type {components} from '../../types/api/v1';
import {refreshInterval, useActionState, useFrontend} from '../app/context';
import {belongsToQueryFamily} from '../app/queryKeys';
import {evictQueryFamilies, refetchFreshQuery, useQueryAdmission, useQuerySnapshotRetention} from '../app/queryCache';
import {isReadDenial, ObsoleteRequestError} from '../app/transport';
import {useCommand} from './command';
import {useReadRetry, useReadRetryAt} from './feedback';

/** Matching list detail consumers share cancellation, polling and stale-read
 * recovery. Each feature supplies actual transport, query scope and denied-data
 * retirement; this owner retains no draft, business action or permission mirror. */
export function useListDetail<T>(source: FrontendListSource<T>) {
    const context = useFrontend();
    const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
    let active = true;
    const revoked = shallowRef(false);
    const previous = useQuerySnapshotRetention<FrontendRead<T>>(context.queryClient,
        query => !revoked.value && belongsToQueryFamily(query, source.resourceFamily()));
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
            if (!value || !query || !previous.retain(query)) {
                previous.release();
                return undefined;
            }
            // TanStack releases placeholders after terminal failure. The shared
            // cache lease preserves only this actor/resource's registered Query.
            return value;
        },
    });
    const denied = computed(() => revoked.value || isReadDenial(list.error.value));
    const data = computed(() => {
        if (denied.value) return null;
        if (list.data.value && !list.isPlaceholderData.value) return list.data.value.data;
        return previous.data.value?.data;
    });

    /** A fresh admitted response alone restores authority after a denied read.
     * Retired requests cannot publish a previous actor or resource's projection. */
    async function read({signal, queryKey}: QueryFunctionContext<readonly unknown[]>): Promise<FrontendRead<T>> {
        const scope = context.capture();
        const resource = source.resourceId.value;
        const result = await source.read(resource, scope, signal, context.queryClient.getQueryData<FrontendRead<T>>(queryKey));
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
        await refetchFreshQuery<FrontendRead<T>>(context.queryClient, source.queryKey.value,
            () => list.refetch({throwOnError: true}),
            () => active && resource === source.resourceId.value && context.mayRead(scope));
    }

    watch(source.resourceId, () => { revoked.value = false; previous.release(); });
    watch([list.data, list.isPlaceholderData], releaseReplacedSnapshot, {flush: 'sync'});
    function releaseReplacedSnapshot(): void {
        if (list.data.value && !list.isPlaceholderData.value) previous.release();
    }
    watch(list.error, failure => {
        if (!isReadDenial(failure)) return;
        // Feature policy retires its settings/overview and personal state only
        // after the shared read owner has synchronously closed stale fallback.
        revoked.value = true;
        previous.release();
        source.denied(failure);
    }, {flush: 'sync'});

    return {list, data, denied, refresh, isActive: () => active};
}

/** Share Settings retirement across detail families without introducing another
 * command, query or draft. Callers retain dialog closing and their fresh-read policy. */
export function useSettingsAccessRetirement(source: FrontendListSettingsRetirementSource) {
    const context = useFrontend();

    /** Losing Settings authority retires only the feature-selected editor family.
     * A still-current page recovers independent detail authority through its own
     * cooldown and merge owner after the private editor reads have been canceled. */
    return async function retireSettingsAccess(selection: FrontendListSettingsRetirement): Promise<void> {
        const scope = context.capture();
        // Cancellation/removal finishes before recovery can admit related data.
        // Resource/actor changes make this continuation obsolete.
        await evictQueryFamilies(context.queryClient, selection.families);
        if (!source.active() || selection.resourceId !== selection.currentResource() || !context.mayRead(scope)) return;
        await source.refresh();
    };
}

/** Detail pages compose the same read/command recovery without retaining another
 * server snapshot or draft. Features inject their actual fresh read (including
 * Survey's ballot merge), lifetime and dirty policy; generated mutations stay
 * with their feature. Recovery never repeats those mutations. */
export function useListCommands(source: FrontendListCommandSource, draft: FrontendCommandDraft) {
    const context = useFrontend();
    const retryAvailable = useReadRetry(source.error);
    const retryAt = useReadRetryAt(source.error, retryAvailable);
    const command = useCommand(refreshAfterCommand, false, draft);
    const blocked = computed(() => command.action.disabled.value);
    // Fresh query delivery can settle before reconciliation releases the command
    // recovery lock. Keep the initiating read pending through that whole lifetime.
    const readAction = useActionState({eligible: mayRefresh, pending: () => source.reading() || command.recovering.value,
        blocked: () => command.recoveryAction.disabled.value});
    const retireSettingsAccess = useSettingsAccessRetirement({active: source.active, refresh});

    function mayRefresh(): boolean { return source.active() && context.mayRead() && retryAvailable.value; }

    /** A confirmed write can settle after a concurrent denial/unmount. Preserve
     * its outcome without starting a private follow-up for that retired view. */
    async function refreshAfterCommand(): Promise<void> {
        // Explicit recovery below can regain access. Automatic post-command
        // reads must first retain the current mounted resource's admission.
        if (!source.active() || source.denied()) return;
        await source.refresh();
    }

    /** Reconcile through an actually dispatched read, honoring its cooldown.
     * Failure retains the command's status and exposes ordinary stale recovery. */
    async function refresh(): Promise<boolean> {
        if (!readAction.isAvailable()) return false;
        try {
            return await command.reconcile(source.refresh);
        } catch (failure) {
            // A failed GET supplies no evidence about a previously sent write.
            // An ordinary manual read already has its query-owned stale/denied
            // surface. Only an existing confirmed-write warning needs the new
            // causal identity; uncertainty and independent validation stay intact.
            if (command.notice.value === 'state.savedRefreshFailed') command.setReadNotice('state.savedRefreshFailed', failure);
            return false;
        }
    }

    /** Unknown creation cannot be identified by a later collection read. Require
     * explicit review of that current collection before releasing uncertainty. */
    async function reviewUnknownCreation(confirmation: FrontendPlainMessageKey): Promise<void> {
        const reconciled = await refresh();
        // Keep input/status protected unless a fresh read succeeded and the user
        // deliberately acknowledges it. No creation is inferred or replayed.
        if (reconciled && !source.error() && window.confirm(context.messages.value.t(confirmation))) command.acknowledge();
    }

    /** Explain the list editor's local denial without admitting a write.
     * A visible title/capacity affordance is distinct from current write authority;
     * shared feedback retains the receipt and expiry without moving the viewport. */
    function denyInlineEdit(): void {
        // No operation, status lease or HTTP request is created for this local
        // guard. Server authorization still protects every actual field save.
        command.setError('packing.inlineMetadataDenied', 'transient');
    }

    return {command, blocked, readAction, retryAt, refresh, retireSettingsAccess, reviewUnknownCreation, denyInlineEdit};
}

/** Packing and Drivers retain the list permission wording. Other detail
 * families opt into their own presentation; safe future Problems keep the
 * existing shared decoder fallback rather than becoming guessed catalog keys. */
export function listProblemKey(problem: components['schemas']['Problem']): FrontendPlainMessageKey | undefined {
    if (problem.code === 'FORBIDDEN') return 'common.notAllowed';
}
