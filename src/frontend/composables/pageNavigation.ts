import {shallowRef} from 'vue';
import type {NavigationFailure, RouteLocationNormalized, Router} from 'vue-router';
import type {PilotPageNavigation, PilotPageNavigationOptions} from '../../types/FrontendPilotUiTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';

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
