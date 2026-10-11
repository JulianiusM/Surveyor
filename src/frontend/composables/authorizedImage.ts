import {computed, onBeforeUnmount, ref, watch, type Ref} from 'vue';
import type {PilotAuthorizedImage, PilotImageRead} from '../../types/FrontendPilotUiTypes';
import {canRetryRead, refreshInterval, usePilot} from '../app/context';

/** Bind a feature-owned binary read to the same captured actor as its JSON projection.
 * Resource/version changes retire the previous image immediately. The owning feature
 * decides whether an image exists and how to read it; this lifecycle knows no endpoint.
 * Only a missing image retries. A healthy version keeps its existing browser URL
 * through JSON polling, manual refresh and language changes. */
export function useAuthorizedImage(id: Ref<string>, version: Ref<string | null | undefined>,
                                   read: PilotImageRead, enabled?: Ref<boolean>): PilotAuthorizedImage {
    const context = usePilot();
    const source = ref<string | null>(null);
    // A collapsed region can remain mounted. Its feature supplies disclosure,
    // while the shared context remains the single browser-visibility owner.
    const visible = computed(() => context.visible.value && (enabled?.value ?? true));
    let controller: AbortController | null = null;
    let retryTimer: number | undefined;
    let generation = 0;
    let failures = 0;
    let error: Error | null = null;
    let active = true;

    function clearRetry(): void {
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        retryTimer = undefined;
    }

    function mayRead(): boolean {
        return active && context.browser && context.ready.value && visible.value && !!version.value;
    }

    /** Release both a pending read and any browser URL before replacing its authority. */
    function clear(): void {
        generation++;
        clearRetry();
        controller?.abort();
        controller = null;
        if (source.value) URL.revokeObjectURL(source.value);
        source.value = null;
        error = null;
        failures = 0;
    }

    /** The existing read policy supplies the same bounded backoff and server deadline
     * as JSON regions. Hidden/disposed owners schedule nothing, and a terminal denial
     * waits for the feature's next successful projection rather than polling privately. */
    function scheduleRecovery(): void {
        if (retryTimer !== undefined || source.value || controller || !mayRead() || !error) return;
        const interval = refreshInterval(error, Math.max(0, failures - 1), 0);
        if (interval === false) return;
        retryTimer = window.setTimeout(retryMissingImage, interval);
    }

    function retryMissingImage(): void {
        retryTimer = undefined;
        void refresh();
    }

    /** A successful feature read can recover this same version without replacing a
     * healthy image. The transport also owns cooldown, so timers and explicit reads
     * cannot bypass Retry-After or duplicate an already pending binary request. */
    async function refresh(): Promise<void> {
        if (source.value || controller || !mayRead() || !canRetryRead(error)) return;
        clearRetry();

        const request = new AbortController();
        controller = request;
        const scope = context.capture();
        const currentGeneration = generation;
        const resource = id.value;
        const imageVersion = version.value;

        function ownsRead(): boolean {
            return active && !request.signal.aborted && controller === request
                && currentGeneration === generation && resource === id.value
                && imageVersion === version.value && context.isCurrent(scope);
        }

        try {
            const blob = await read(resource, scope, request.signal);
            // An endpoint may ignore cancellation. A retired resource/version or
            // actor still cannot install its completed image into this component.
            if (ownsRead()) {
                source.value = URL.createObjectURL(blob);
                error = null;
                failures = 0;
            }
        } catch (failure) {
            // An old rejection cannot install backoff over a newer version/actor.
            // Optional images retain the existing silent presentation; recovery
            // restores that presentation without adding another notice or control.
            if (ownsRead()) {
                error = failure instanceof Error ? failure : new Error('The authorized image read failed.');
                failures++;
            }
        } finally {
            if (controller === request) {
                controller = null;
                scheduleRecovery();
            }
        }
    }

    function receiveImage(): void {
        clear();
        void refresh();
    }

    /** Keep downloaded bytes while hidden, but retire a pending request. Resume only
     * the still-admitted missing image; its previous failure deadline remains intact. */
    function receiveVisibility(visible: boolean): void {
        if (!visible) {
            generation++;
            clearRetry();
            controller?.abort();
            controller = null;
            return;
        }
        void refresh().then(scheduleRecovery);
    }

    watch([id, version, () => context.session.value?.context, context.epoch, context.ready],
        receiveImage, {immediate: true, flush: 'sync'});
    watch(visible, receiveVisibility, {flush: 'sync'});
    onBeforeUnmount(function retireImage(): void {
        active = false;
        clear();
    });
    return {source, refresh};
}
