import {shallowRef, watch} from 'vue';
import type {InjectionKey} from 'vue';
import type {NavigationFailure, RouteLocationNormalized, Router} from 'vue-router';
import type {PilotPageNavigation, PilotPageNavigationOptions, PilotPageReadiness, PilotPageReadinessSource} from '../../types/FrontendPilotUiTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';

export const pageReadinessKey: InjectionKey<PilotPageReadiness> = Symbol('pilot.page-readiness');

/** Coordinate Router scrolling with the mounted page's admitted render. The
 * page owns its read; this owner retains only a callback registration and pending
 * subscriptions, never data, request status or another saved-position store. */
export function createPageReadiness(router: Router): PilotPageReadiness {
    const source = shallowRef<PilotPageReadinessSource>();
    const waiting = new Set<() => void>();
    let disposed = false;

    /** Replace the mounted presentation source, retaining its reactive getters.
     * A retiring page may release only its own registration, never its successor. */
    function register(current: PilotPageReadinessSource): () => void {
        if (disposed) return () => {};
        // Readiness stays with the page's existing computed values rather than
        // being copied into a second loading or authorization flag.
        source.value = current;
        return function releaseReadiness(): void {
            if (source.value !== current) return;
            source.value = undefined;
            // Unmount can retire a renderer before another route commits. Its
            // pending scroll work must not wait forever for disposed content.
            for (const cancel of waiting) cancel();
        };
    }

    /** Wait only for this committed visit. A later navigation cannot inherit an
     * older anchor/history intent, even if it returns to the same public URL. */
    function wait(destination: RouteLocationNormalized): Promise<boolean> {
        if (disposed) return Promise.resolve(false);
        return new Promise(function awaitRenderedVisit(resolve) {
            // Subscribe before checking so a mounted/cached owner can complete
            // synchronously without leaving an orphaned watcher behind.
            const stop = watch(settled, finish, {flush: 'post'});
            waiting.add(cancel);
            if (settled()) finish();

            function settled(): boolean {
                return router.currentRoute.value !== destination
                    || (source.value?.destination.value === destination.fullPath && source.value.ready.value);
            }

            function finish(): void {
                if (!settled()) return;
                stop();
                waiting.delete(cancel);
                resolve(router.currentRoute.value === destination);
            }

            function cancel(): void {
                stop();
                waiting.delete(cancel);
                resolve(false);
            }
        });
    }

    /** Application retirement must not leave an unresolved Router callback or
     * a subscription to a disposed page. Mounted owners separately unregister. */
    function dispose(): void {
        disposed = true;
        for (const cancel of waiting) cancel();
        source.value = undefined;
    }

    return {register, wait, dispose};
}

/** Track actual lazy navigation for one mounted/application owner. Callers choose
 * the relevant URL boundary and retain their existing read/feedback decisions;
 * this owner coordinates subscriptions, latest-target retirement and disposal. */
export function observePageNavigation(router: Router, options: PilotPageNavigationOptions = {}): PilotPageNavigation {
    const destination = shallowRef<RouteLocationNormalized>();
    const removeStart = router.beforeEach(rememberDestination);
    const removeFinish = router.afterEach(finishDestination);
    const removeError = router.onError(failDestination);

    /** Record before asynchronous component delivery, using the caller's boundary.
     * Fragment changes remain local for document readers; shell progress can use
     * path-only delivery, while locale/region coordination sees every transition. */
    function rememberDestination(to: RouteLocationNormalized, from: RouteLocationNormalized): void {
        const scope = options.scope ?? 'document';
        const relevant = scope === 'all' || (scope === 'path' ? to.path !== from.path
            : frontendDocumentUrl(to.fullPath) !== frontendDocumentUrl(from.fullPath));
        destination.value = relevant ? to : undefined;
        options.started?.(to, from);
    }

    /** An older cancelled import must not retire its successor's pending state.
     * Finish callbacks still receive every outcome so feature-owned feedback and
     * focus can retain their established commitment/failure rules. */
    function finishDestination(to: RouteLocationNormalized, from?: RouteLocationNormalized,
                               failure?: NavigationFailure | void): void {
        if (destination.value === to) destination.value = undefined;
        options.finished?.(to, from, failure);
    }

    function failDestination(_error: unknown, to: RouteLocationNormalized): void {
        // Preserve the existing delivery-error callback shape: this is not an
        // accepted route commitment or a synthetic NavigationFailure receipt.
        finishDestination(to);
    }

    function pending(): boolean { return destination.value !== undefined; }

    /** Each caller releases its own router lifetime; no global route/cache state
     * or feature callback survives its mounted/application owner. */
    function dispose(): void {
        removeStart();
        removeFinish();
        removeError();
        destination.value = undefined;
    }

    return {destination, pending, dispose};
}
