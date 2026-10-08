import {computed, onBeforeUnmount, shallowRef, watch} from 'vue';
import {isNavigationFailure, useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized, Router} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {PilotContext, PilotPageEntrySource, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import {safeFrontendReturn} from '../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../modules/localization/translator';
import {usePilot} from '../app/context';
import {ObsoleteRequestError} from '../app/transport';

/** Normalize the existing safe return boundary through the router's query serializer. */
function pageDestination(router: Router, url: string): string {
    const resolved = router.resolve(safeFrontendReturn(url));
    // Router redirects may reserialize a decoded query. Resolve its structured location
    // once so equivalent encoded return paths do not appear to be a failed commitment.
    return router.resolve({path: resolved.path, query: resolved.query, hash: resolved.hash}).fullPath;
}

/** Lazy delivery starts before currentRoute changes. Reads and confirmed continuations share
 * this observation rule, while each caller releases its own application-owned subscriptions. */
function observePageNavigation(router: Router, onFinish?: () => void) {
    let destination: RouteLocationNormalized | undefined;
    const removeStart = router.beforeEach(rememberDestination);
    const removeFinish = router.afterEach(finishDestination);
    const removeError = router.onError(failDestination);

    function rememberDestination(to: RouteLocationNormalized): void {
        destination = to;
    }

    function finishDestination(to: RouteLocationNormalized): void {
        if (destination === to) destination = undefined;
        onFinish?.();
    }

    function failDestination(_error: unknown, to: RouteLocationNormalized): void {
        finishDestination(to);
    }

    function pending(): boolean {
        return destination !== undefined;
    }

    function dispose(): void {
        removeStart();
        removeFinish();
        removeError();
    }
    return {pending, dispose};
}

/** Apply a server-owned entry decision to the captured route and identity. This operation is
 * also usable after a confirmed form submission; no feature URL or admission policy lives here.
 * Replacement makes a native redirect one canonical destination rather than a second SPA visit.
 */
export async function navigatePageEntry(context: PilotContext, router: Router,
                                        outcome: components['schemas']['PageEntryOutcome'],
                                        scope: PilotRequestScope = context.capture(),
                                        expectedRoute: string = router.currentRoute.value.fullPath): Promise<boolean> {
    if (!context.isCurrent(scope, true) || router.currentRoute.value.fullPath !== expectedRoute) return false;
    if (outcome.kind === 'denied') return false;
    if (outcome.kind === 'render') return true;

    // The existing return owner rejects external and malformed destinations. The server's
    // projection supplies the actual destination; frontend code only enforces that boundary.
    const destination = pageDestination(router, outcome.url);
    try {
        const result = await router.replace(destination);
        if (isNavigationFailure(result) || !context.isCurrent(scope)
            || router.currentRoute.value.fullPath !== destination) return false;

        // Apply one-time feedback after commitment. A cancelled dirty-form guard leaves its input
        // and earlier notice untouched; the shell dismisses this notice on the next committed visit.
        context.pageNotice.value = outcome.notice;
        return true;
    } catch {
        // Failed lazy delivery is already reported by the router's application-owned error
        // handler. Admission must leave this visit intact rather than reject a watch callback.
        return false;
    }
}

/** A confirmed command may have a native message destination instead of another form.
 * Install its receipt before that view mounts, scoped to the admitted actor and canonical
 * location. It remains application memory only; a fresh document follows native GET admission.
 */
export async function completePageEntry(context: PilotContext, router: Router, destination: string,
                                        messageKey: MessageKey, kind: 'success' | 'info',
                                        scope: PilotRequestScope = context.capture(),
                                        origin: string = router.currentRoute.value.fullPath): Promise<boolean> {
    if (!context.isCurrent(scope) || router.currentRoute.value.fullPath !== origin
        || !isPlainMessageKey(messageKey)) return false;
    const previous = context.pageCompletion.value;
    const receipt = {context: scope.context, destination: pageDestination(router, destination), messageKey, kind};
    context.pageCompletion.value = receipt;
    const installed = context.pageCompletion.value;

    // A confirmed command belongs to its actor, not the language used to submit it.
    // Capture the current locale for navigation; the typed receipt translates reactively.
    const committed = await navigatePageEntry(context, router,
        {kind: 'redirect', url: receipt.destination, notice: null}, context.capture(), origin);
    // Identity retirement may already have removed this receipt. Restore an earlier
    // presentation only when this unsuccessful navigation still owns the current one.
    if (!committed && context.pageCompletion.value === installed) context.pageCompletion.value = previous;
    return committed;
}

// usePilot returns a component-local translation binding around these same session refs.
// Key by that request/application owner so two confirmed transitions cannot resume old navigation.
const identityNavigations = new WeakMap<PilotContext['session'], () => void>();

/** Resume only navigation after a confirmed identity command's bootstrap failed. The session
 * owner keeps any private result; this owner retains only its confirmed context and destination.
 * A later matching Retry never replays login/registration or visits a retired origin.
 */
function retainIdentityNavigation(context: PilotContext, router: Router, confirmedContext: string,
                                 outcome: components['schemas']['PageEntryOutcome'], origin: string): void {
    const navigation = observePageNavigation(router, resumeNavigation);
    const stop = watch(() => [context.ready.value, context.session.value?.context, context.epoch.value], resumeNavigation);
    identityNavigations.set(context.session, retireNavigation);

    function retireNavigation(): void {
        stop();
        navigation.dispose();
        if (identityNavigations.get(context.session) === retireNavigation) identityNavigations.delete(context.session);
    }

    function resumeNavigation(): void {
        if (router.currentRoute.value.fullPath !== origin) {
            retireNavigation();
            return;
        }
        if (!context.ready.value || navigation.pending()) return;
        const matches = context.session.value?.context === confirmedContext;
        retireNavigation();
        if (matches) void navigatePageEntry(context, router, outcome, context.capture(), origin);
    }
    // A Retry can finish in the same tick that the failed command relinquishes its handler.
    resumeNavigation();
}

/** Admit a confirmed identity and its intended navigation through one reusable operation.
 * A transient bootstrap failure closes the private view; shell Retry restores the matching
 * actor and resumes this destination once. A mismatch or committed departure retires it.
 */
export async function completeIdentityEntry(context: PilotContext, router: Router,
                                            result: components['schemas']['IdentityResult'],
                                            outcome: components['schemas']['PageEntryOutcome'],
                                            origin: string = router.currentRoute.value.fullPath): Promise<boolean> {
    identityNavigations.get(context.session)?.();
    try {
        await context.acceptIdentity(result);
    } catch {
        if (!context.ready.value && router.currentRoute.value.fullPath === origin) {
            retainIdentityNavigation(context, router, result.session.context, outcome, origin);
            return false;
        }
        // A superseding authoritative actor is never allowed to consume this confirmation.
        if (context.session.value?.context !== result.session.context) return false;
    }
    return navigatePageEntry(context, router, outcome, context.capture(), origin);
}

/** One reusable read/navigation boundary for server-owned page admission. A feature supplies
 * its generated payload, API read and query family. Scope, locale, route retirement, pending
 * lazy destinations and canonical redirects follow the same rules for every migrated module.
 */
export function usePageEntry<T extends {entry: components['schemas']['PageEntryOutcome']}>(source: PilotPageEntrySource<T>) {
    const context = usePilot();
    const route = useRoute();
    const router = useRouter();
    let active = true;
    const initialRoute = route.fullPath;
    const initialContext = context.session.value?.context;
    const initialLocale = context.locale.value;
    let followed: components['schemas']['PageEntryOutcome'] | undefined;
    const navigation = observePageNavigation(router);

    onBeforeUnmount(() => {
        active = false;
        navigation.dispose();
    });

    /** A pending lazy destination retires the old page before currentRoute changes. A late
     * response must neither redirect the new visit nor restore another locale/resource's data. */
    async function readCurrentEntry({signal}: {signal: AbortSignal}): Promise<T> {
        const expectedRoute = route.fullPath;
        const scope = context.capture();
        const value = await source.read(scope, signal);
        if (!active || navigation.pending() || route.fullPath !== expectedRoute || !context.isCurrent(scope, true)) {
            throw new ObsoleteRequestError();
        }
        return value;
    }

    const query = useQuery<T>({
        queryKey: computed(() => [...source.key.value, {context: context.session.value?.context,
            epoch: context.epoch.value, route: route.fullPath, locale: context.locale.value}]),
        enabled: computed(() => context.ready.value && context.hydrated.value && source.enabled?.value !== false),
        queryFn: readCurrentEntry,
        initialData: () => route.fullPath === initialRoute && context.session.value?.context === initialContext
            && context.locale.value === initialLocale ? source.initial : undefined,
    });
    const renderedScope = shallowRef<{context: string | undefined; epoch: number; route: string}>();

    /** Admission keys vary with locale, but a language read must not unmount an admitted
     * editor. Keep an admitted subtree mounted while a redirect asks its departure guards;
     * otherwise the redirect itself would remove the guard before it can protect the draft.
     * Denials retire controls immediately. This retains only the render decision within its
     * actor generation/resource route, never another payload or localized body. */
    function rememberRender(entry: components['schemas']['PageEntryOutcome'] | undefined): void {
        if (entry?.kind === 'render') {
            renderedScope.value = {context: context.session.value?.context, epoch: context.epoch.value, route: route.fullPath};
        } else if (entry?.kind === 'denied') {
            renderedScope.value = undefined;
        }
    }
    watch(() => query.data.value?.entry, rememberRender, {immediate: true});
    const outcome = computed<components['schemas']['PageEntryOutcome'] | undefined>(() => {
        const entry = query.data.value?.entry;
        if (entry?.kind === 'denied' || entry?.kind === 'render') return entry;
        const rendered = renderedScope.value;
        return rendered && rendered.context === context.session.value?.context && rendered.epoch === context.epoch.value
            && rendered.route === route.fullPath ? {kind: 'render'} : entry;
    });
    const pending = computed(() => !outcome.value && !query.error.value && query.isPending.value);

    /** Only read-owned redirects are automatic. Denials stay rendered by the feature's ordinary
     * message surface; render decisions reveal that feature's own controls and projections. */
    async function followEntry(entry: components['schemas']['PageEntryOutcome'] | undefined): Promise<void> {
        if (!context.browser || !active || navigation.pending() || !entry || entry === followed) return;
        followed = entry;
        if (entry.kind === 'redirect') await navigatePageEntry(context, router, entry);
    }
    // Follow the raw server decision while the presentation retains any admitted draft.
    // A canceled or failed redirect keeps that subtree and its guards intact.
    watch(() => query.data.value?.entry, followEntry, {immediate: true});

    function navigate(entry: components['schemas']['PageEntryOutcome'], scope?: PilotRequestScope,
                      expectedRoute?: string): Promise<boolean> {
        return navigatePageEntry(context, router, entry, scope, expectedRoute);
    }
    return {data: query.data, error: query.error, pending, outcome, navigate};
}
