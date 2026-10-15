import {computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {isNavigationFailure, useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized, Router} from 'vue-router';
import {hashKey, useQuery} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {PilotConfirmedNavigation, PilotContext, PilotPageEntryDenial, PilotPageEntrySource, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import {frontendDocumentUrl, safeFrontendReturn} from '../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../modules/localization/translator';
import {canRetryRead, useActionState, usePilot} from '../app/context';
import {ApiFailure, isReadDenial, ObsoleteRequestError} from '../app/transport';
import {retireQueryFamily, useQueryAdmission} from '../app/queryCache';
import {useReadRetry} from './feedback';

/** Admit SPA navigation only for an ordinary primary click. Modified clicks, downloads
 * and explicit targets retain their captured href and native tab/window behavior. */
export function isOrdinaryNavigation(event: MouseEvent, anchor?: HTMLAnchorElement): boolean {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return false;
    // Delegated content handlers supply the actual anchor; direct handlers use
    // currentTarget. Both retain one policy for modifiers, downloads and targets.
    const link = anchor ?? event.currentTarget as HTMLAnchorElement | null;
    return !link?.hasAttribute('download') && (!link?.target || link.target === '_self');
}

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

    function rememberDestination(to: RouteLocationNormalized, from: RouteLocationNormalized): void {
        destination = frontendDocumentUrl(to.fullPath) !== frontendDocumentUrl(from.fullPath) ? to : undefined;
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
    if (!context.isCurrent(scope, true)
        || frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(expectedRoute)) return false;
    if (outcome.kind === 'denied') return false;
    if (outcome.kind === 'render') return true;

    // The existing return owner rejects external and malformed destinations. The server's
    // projection supplies the actual destination; frontend code only enforces that boundary.
    const destination = pageDestination(router, outcome.url);
    // A server-owned canonical redirect can follow an identity redirect before a page is
    // shown. Keep that transition's feedback until its rendered destination; ordinary user
    // departures still clear it in the shell, and identity retirement removes old notices.
    let notice = outcome.notice ?? context.pageNotice.value;
    let personalLink: string | null = null;
    // Native header transitions can return to their current URL after changing identity.
    // That destination is already committed; a duplicated router replacement is not a
    // failed completion and must still publish its one-time feedback without new history.
    if (router.currentRoute.value.fullPath === destination) {
        context.pageNotice.value = notice;
        return true;
    }
    // The shell retires document flashes on accepted departure. A canonical server
    // redirect carries those same flashes into its rendered destination. Capture at
    // the final commitment phase, so expiration/dismissal during lazy delivery cannot
    // revive an old message or private link when the destination eventually arrives.
    const stopCarry = router.beforeResolve(function carryDestinationFeedback(to, from): void {
        if (to.fullPath !== destination || frontendDocumentUrl(from.fullPath) !== frontendDocumentUrl(expectedRoute)
            || !context.isCurrent(scope)) return;
        notice = outcome.notice ?? context.pageNotice.value;
        personalLink = context.personalLink.value;
    });
    try {
        const result = await router.replace(destination);
        if (isNavigationFailure(result) || !context.isCurrent(scope)
            || router.currentRoute.value.fullPath !== destination) return false;

        // Apply one-time feedback after commitment. A cancelled dirty-form guard leaves its input
        // and earlier notice untouched; the shell dismisses this notice on the next committed visit.
        context.pageNotice.value = notice;
        context.personalLink.value = personalLink;
        return true;
    } catch {
        // Failed lazy delivery is already reported by the router's application-owned error
        // handler. Admission must leave this visit intact rather than reject a watch callback.
        return false;
    } finally {
        stopCarry();
    }
}

/** A confirmed command may have a native message destination instead of another form.
 * Install its receipt before that view mounts, scoped to the admitted actor and canonical
 * location. It remains application memory only; a fresh document follows native GET admission.
 */
export async function completePageEntry(context: PilotContext, router: Router, destination: string,
                                        messageKey: MessageKey, kind: 'success' | 'info',
                                        scope: PilotRequestScope = context.capture(),
                                        origin: string = router.currentRoute.value.fullPath,
                                        navigation?: PilotConfirmedNavigation): Promise<boolean> {
    if (!context.isCurrent(scope) || frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(origin)
        || !isPlainMessageKey(messageKey)) return false;
    const previous = context.pageCompletion.value;
    const receipt = {context: scope.context, destination: pageDestination(router, destination), messageKey, kind};
    context.pageCompletion.value = receipt;
    const installed = context.pageCompletion.value;

    // A confirmed command belongs to its actor, not the language used to submit it.
    // Capture the current locale for navigation; the typed receipt translates reactively.
    const committed = await navigateConfirmedEntry(context, router,
        {kind: 'redirect', url: receipt.destination, notice: null}, origin, navigation);
    // Identity retirement may already have removed this receipt. Restore an earlier
    // presentation only when this unsuccessful navigation still owns the current one.
    if (!committed && !navigation && context.pageCompletion.value === installed) context.pageCompletion.value = previous;
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
                                 outcome: components['schemas']['PageEntryOutcome'], origin: string,
                                 completion?: PilotConfirmedNavigation): void {
    const navigation = observePageNavigation(router, resumeNavigation);
    const stop = watch(() => [context.ready.value, context.session.value?.context, context.epoch.value], resumeNavigation);
    identityNavigations.set(context.session, retireNavigation);

    function retireNavigation(): void {
        stop();
        navigation.dispose();
        if (identityNavigations.get(context.session) === retireNavigation) identityNavigations.delete(context.session);
    }

    /** Consume this confirmed destination only from its original visit and the
     * matching recovered actor. Retire the observers before navigating so a later
     * bootstrap cannot deliver this identity command's destination a second time. */
    function resumeNavigation(): void {
        if (frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(origin)) {
            retireNavigation();
            return;
        }
        if (!context.ready.value || navigation.pending()) return;

        const matches = context.session.value?.context === confirmedContext;
        retireNavigation();
        if (matches) void navigateConfirmedEntry(context, router, outcome, origin, completion);
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
                                            origin: string = router.currentRoute.value.fullPath,
                                            navigation?: PilotConfirmedNavigation): Promise<boolean> {
    identityNavigations.get(context.session)?.();
    try {
        await context.acceptIdentity(result);
    } catch {
        if (!context.ready.value && frontendDocumentUrl(router.currentRoute.value.fullPath) === frontendDocumentUrl(origin)) {
            retainIdentityNavigation(context, router, result.session.context, outcome, origin, navigation);
            return false;
        }
        // A superseding authoritative actor is never allowed to consume this confirmation.
        if (context.session.value?.context !== result.session.context) return false;
    }
    return navigateConfirmedEntry(context, router, outcome, origin, navigation);
}

/** The caller's existing admission result supplies all policy and feedback. Retained
 * completion only adds delivery recovery; render/denial still follow the ordinary boundary. */
function navigateConfirmedEntry(context: PilotContext, router: Router,
                                outcome: components['schemas']['PageEntryOutcome'], origin: string,
                                navigation?: PilotConfirmedNavigation): Promise<boolean> {
    if (navigation && outcome.kind === 'redirect') {
        return navigation.navigate(outcome.url, context.capture(), origin, outcome.notice);
    }
    return navigatePageEntry(context, router, outcome, context.capture(), origin);
}

// Identity admission replaces epoch-keyed route instances, including after a healthy
// bootstrap. This application-local owner keeps only canonical delivery receipts across
// those remounts. Separate SSR requests/browser apps have separate session ref keys.
const confirmedNavigations = new WeakMap<PilotContext['session'], ReturnType<typeof createConfirmedNavigation>>();

/** One application-owned delivery state, observed by mounted command owners.
 * Component type survives actor remounts; simultaneous instances of that same
 * type must supply distinct stable logical identities to retain separate receipts.
 * Without a supplied identity, identifyOwner deliberately uses the component type. */
function createConfirmedNavigation(context: PilotContext, router: Router) {
    const receipt = shallowRef<{destination: string; scope: PilotRequestScope; origin: string;
        notice: components['schemas']['EntryNotice'] | null; owner: unknown; refreshSession: boolean}>();
    const pending = ref(false);
    const mountedOwners = shallowRef(new Map<unknown, number>());
    const logicalOwners = new Map<unknown, Map<string, object>>();
    let owners = 0;
    let disposed = false;

    /** Repeated regions provide their stable caller-owned identity. Namespace it by
     * component type inside this application, without exposing fields or feature policy. */
    function identifyOwner(component: unknown, identity?: string): unknown {
        if (identity === undefined) return component;
        let identities = logicalOwners.get(component);
        if (!identities) {
            identities = new Map();
            logicalOwners.set(component, identities);
        }
        let owner = identities.get(identity);
        if (!owner) {
            owner = {};
            identities.set(identity, owner);
        }
        return owner;
    }

    // A release update must not silently reload the old creation form while its confirmed
    // entity's destination is still awaiting delivery. No receipt is persisted or replayed.
    const removeUpdateGuard = context.updates.registerGuard(canReload);
    const removeIdentityGuard = context.registerIdentityGuard(canChangeIdentity);
    const removeNavigationGuard = router.beforeEach(admitNavigation);
    const removeNavigationFinish = router.afterEach(retireDepartedReceipt);
    const stopIdentity = watch(() => [context.ready.value, context.session.value?.context, context.epoch.value], retireObsoleteReceipt);
    if (context.browser) window.addEventListener('beforeunload', protectPendingDeparture);

    function canReload(): boolean {
        return !pending.value && receipt.value === undefined;
    }

    function canChangeIdentity(): boolean {
        return !pending.value;
    }

    function admitNavigation(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
        return !pending.value || to.fullPath === receipt.value?.destination
            || frontendDocumentUrl(to.fullPath) === frontendDocumentUrl(from.fullPath);
    }

    function protectPendingDeparture(event: BeforeUnloadEvent): void {
        // Failed delivery retains the confirmed destination too. Browser reload/close must
        // ask for deliberate departure instead of silently returning to a repeatable form.
        if (canReload()) return;
        event.preventDefault();
        event.returnValue = '';
    }

    /** Consume retained delivery only after an accepted departure from its origin. */
    function retireDepartedReceipt(_to: RouteLocationNormalized, _from: RouteLocationNormalized,
                                   failure?: unknown): void {
        // Failed/canceled navigation still belongs to the form that confirmed the write.
        if (!failure && receipt.value
            && frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(receipt.value.origin)) {
            receipt.value = undefined;
        }
    }

    function retireObsoleteReceipt(): void {
        if (receipt.value && !context.isCurrent(receipt.value.scope)) receipt.value = undefined;
    }

    function requiresSessionRefresh(): boolean {
        return receipt.value?.refreshSession ?? false;
    }

    /** The shared receipt owns dispatch admission independently of any temporary
     * component. Local controls add their own mount lifetime and deadline wakeup. */
    function mayRetry(owner: unknown): boolean {
        return !disposed && context.hydrated.value && !pending.value && receipt.value?.owner === owner
            && (!requiresSessionRefresh() || canRetryRead(context.sessionRead.value.error));
    }

    function mayRetryFallback(): boolean {
        const confirmed = receipt.value;
        return !!confirmed && !mountedOwners.value.has(confirmed.owner) && mayRetry(confirmed.owner);
    }

    /** Retry delivery with the current presentation language, while retaining the confirmed
     * actor/epoch and origin. Language selection cannot invalidate a committed business result. */
    async function retry(owner: unknown): Promise<boolean> {
        const confirmed = receipt.value;
        if (!confirmed || !mayRetry(owner)) return false;

        // A receipt may survive a remount, but cannot cross another actor or an
        // accepted departure from its originating form. Retire that obsolete
        // continuation before attempting delivery; the business command stays done.
        if (!context.isCurrent(confirmed.scope)
            || frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(confirmed.origin)) {
            receipt.value = undefined;
            return false;
        }

        pending.value = true;
        try {
            // Keep this serial display requirement in the shared receipt rather
            // than retaining a feature callback after its component has retired.
            // Failure retains confirmed success; Retry repeats only reads/delivery.
            if (confirmed.refreshSession) {
                try { await context.refreshSession(true); }
                catch { return false; }
                if (receipt.value !== confirmed || !context.isCurrent(confirmed.scope)) return false;
            }
            // Retry only destination delivery with the current presentation
            // language. Clear this exact receipt after commitment; a newer owner
            // or failed navigation must not lose its retained recovery state.
            const committed = await navigatePageEntry(context, router,
                {kind: 'redirect', url: confirmed.destination, notice: confirmed.notice}, context.capture(), confirmed.origin);
            if (committed && receipt.value === confirmed) receipt.value = undefined;
            return committed;
        } finally {
            pending.value = false;
        }
    }

    async function navigate(owner: unknown, destination: string, scope: PilotRequestScope = context.capture(),
                            origin: string = router.currentRoute.value.fullPath,
                            notice: components['schemas']['EntryNotice'] | null = null, refreshSession = false): Promise<boolean> {
        if (disposed || pending.value || receipt.value || !context.isCurrent(scope)
            || frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(origin)) return false;
        receipt.value = {destination: pageDestination(router, destination), scope, origin, notice, owner, refreshSession};
        return retry(owner);
    }

    function target(owner: unknown): string | null {
        const confirmed = receipt.value;
        return confirmed && confirmed.owner === owner ? confirmed.destination : null;
    }

    function fallbackTarget(): string | null {
        const confirmed = receipt.value;
        return confirmed && !mountedOwners.value.has(confirmed.owner) ? confirmed.destination : null;
    }

    function retryFallback(): Promise<boolean> {
        const confirmed = receipt.value;
        if (!confirmed || mountedOwners.value.has(confirmed.owner)) return Promise.resolve(false);
        return retry(confirmed.owner);
    }

    /** Track each mounted logical consumer so one instance cannot retire another's receipt. */
    function retain(owner: unknown): () => void {
        // Publish a fresh count map for reactive fallback delivery, retaining no form values.
        owners++;
        const counts = new Map(mountedOwners.value);
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
        mountedOwners.value = counts;
        return releaseOwner;

        function releaseOwner(): void {
            release(owner);
        }
    }

    /** Release one mounted consumer without discarding another consumer's receipt.
     * The final release retires the application-local navigation and every guard;
     * disposing an older owner must not remove a newer navigation from the registry. */
    function release(owner: unknown): void {
        const counts = new Map(mountedOwners.value);
        const count = (counts.get(owner) ?? 1) - 1;
        if (count > 0) counts.set(owner, count);
        else counts.delete(owner);
        mountedOwners.value = counts;

        if (--owners > 0) return;
        disposed = true;
        receipt.value = undefined;
        logicalOwners.clear();
        removeUpdateGuard();
        removeIdentityGuard();
        removeNavigationGuard();
        removeNavigationFinish();
        stopIdentity();
        if (context.browser) window.removeEventListener('beforeunload', protectPendingDeparture);
        if (confirmedNavigations.get(context.session) === navigation) confirmedNavigations.delete(context.session);
    }
    const navigation = {pending, target, fallbackTarget, navigate, retry, retryFallback, retain, identifyOwner,
        mayRetry, mayRetryFallback, requiresSessionRefresh};
    return navigation;
}

/** Retain only navigation after a confirmed command. A failed or cancelled lazy destination
 * must not make creation/deletion available again: callers keep the confirmed result and use
 * Retry to repeat this navigation, never the command. An identity remount observes this same
 * application's receipt; another committed visit or authoritative actor retires it.
 */
export function useConfirmedNavigation(identity?: string): PilotConfirmedNavigation {
    const context = usePilot();
    const router = useRouter();
    const component = getCurrentInstance()?.type ?? {};
    let shared = confirmedNavigations.get(context.session);
    if (!shared) {
        shared = createConfirmedNavigation(context, router);
        confirmedNavigations.set(context.session, shared);
    }
    const navigation = shared;
    const owner = navigation.identifyOwner(component, identity);
    onBeforeUnmount(navigation.retain(owner));
    const target = computed(() => navigation.target(owner));
    const fallbackTarget = computed(navigation.fallbackTarget);
    const sessionRetryAvailable = useReadRetry(() => context.sessionRead.value.error);
    // These states belong to each mounted control, while the receipt and its
    // dispatch guard remain application-owned across originating-view retirement.
    const retryAction = useActionState({eligible: () => (!navigation.requiresSessionRefresh() || sessionRetryAvailable.value)
        && navigation.mayRetry(owner), pending: () => navigation.pending.value});
    const fallbackRetryAction = useActionState({eligible: () => (!navigation.requiresSessionRefresh() || sessionRetryAvailable.value)
        && navigation.mayRetryFallback(), pending: () => navigation.pending.value});
    async function navigate(destination: string, scope: PilotRequestScope = context.capture(),
                            origin: string = router.currentRoute.value.fullPath,
                            notice: components['schemas']['EntryNotice'] | null = null, refreshSession = false): Promise<boolean> {
        return navigation.navigate(owner, destination, scope, origin, notice, refreshSession);
    }

    function retry(): Promise<boolean> {
        if (!retryAction.isAvailable()) return Promise.resolve(false);
        return navigation.retry(owner);
    }

    function retryFallback(): Promise<boolean> {
        return fallbackRetryAction.isAvailable() ? navigation.retryFallback() : Promise.resolve(false);
    }
    return {pending: navigation.pending, target, fallbackTarget, navigate, retry, retryFallback, retryAction, fallbackRetryAction};
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
    const documentRoute = computed(() => frontendDocumentUrl(route.fullPath));
    const initialRoute = documentRoute.value;
    const initialContext = context.session.value?.context;
    const initialLocale = context.locale.value;
    let admissionGeneration = 0;
    // A validated transport denial removes admission too, without inventing a
    // server-owned page outcome or message key. Retain either original descriptor
    // until a fresh admitted read restores this actor/resource's authority.
    const deniedEntry = shallowRef<PilotPageEntryDenial | ApiFailure>();
    const renderedScope = shallowRef<{context: string | undefined; epoch: number; route: string; updatedAt?: number}>();
    let followed: components['schemas']['PageEntryOutcome'] | undefined;
    const navigation = observePageNavigation(router);
    const queryKey = computed(() => [...source.key.value, {context: context.session.value?.context,
        epoch: context.epoch.value, route: documentRoute.value, locale: context.locale.value}]);

    /** Language changes do not grant authority. Only another admission family or actor
     * starts an independent decision; an old response may not cross that generation. */
    function admissionIdentity(): string {
        return hashKey([...source.key.value, {context: context.session.value?.context, epoch: context.epoch.value}]);
    }
    function retireAdmission(): void {
        admissionGeneration++;
        deniedEntry.value = undefined;
        renderedScope.value = undefined;
        followed = undefined;
    }
    watch(admissionIdentity, retireAdmission, {flush: 'sync'});

    onBeforeUnmount(() => {
        active = false;
        navigation.dispose();
    });

    /** Apply the same lifetime check before admission and after asynchronous retirement.
     * A held cancellation must not publish a decision into a later visit or generation. */
    function isCurrentEntry(scope: PilotRequestScope, expectedRoute: string, generation: number): boolean {
        return active && !navigation.pending() && generation === admissionGeneration
            && documentRoute.value === expectedRoute && context.isCurrent(scope, true);
    }

    /** A pending lazy destination retires the old page before currentRoute changes. A late
     * response must neither redirect the new visit nor restore another locale/resource's data. */
    async function readCurrentEntry({signal, queryKey: capturedKey}: {signal: AbortSignal; queryKey: readonly unknown[]}): Promise<T> {
        const expectedRoute = documentRoute.value;
        const scope = context.capture();
        const generation = admissionGeneration;
        const family = source.key.value;
        let value: T;
        try {
            value = await source.read(scope, signal);
        } catch (failure) {
            // Failed old reads must not publish into a departed document any more
            // than successful ones. Only a current, validated read denial retires
            // the admission family and invokes its feature-owned dependencies.
            if (!isCurrentEntry(scope, expectedRoute, generation)) throw new ObsoleteRequestError();
            if (isReadDenial(failure)) {
                await denyAdmission(failure, scope, family, capturedKey);
                if (!isCurrentEntry(scope, expectedRoute, generation + 1)) throw new ObsoleteRequestError();
            }
            throw failure;
        }
        if (!isCurrentEntry(scope, expectedRoute, generation)) throw new ObsoleteRequestError();
        if (value.entry.kind === 'denied') {
            await denyAdmission(value.entry, scope, family, capturedKey);
            if (!isCurrentEntry(scope, expectedRoute, generation + 1)) throw new ObsoleteRequestError();
        } else if (value.entry.kind === 'render') {
            // Only a newly validated server read restores admission after denial. A
            // locale cache hit or captured SSR seed cannot clear this authority barrier.
            if (deniedEntry.value) {
                admissionGeneration++;
                deniedEntry.value = undefined;
                // Fresh restoration supersedes cached denials too. Returning to that
                // language must read new admission rather than reinstate an old denial.
                await retireQueryFamily(context.queryClient, family, new ObsoleteRequestError(), capturedKey);
                if (!isCurrentEntry(scope, expectedRoute, generation + 1)) throw new ObsoleteRequestError();
            }
        }
        return value;
    }

    /** Retire presentation before awaiting cache cancellation. A successful typed
     * denial replaces its producing query's payload; a thrown transport denial has
     * no replacement body, so that query must lose its previous private data too.
     * The original barrier descriptor remains readable through either retirement.
     * Feature policy is invoked in this turn, capturing its resource before navigation. */
    async function denyAdmission(entry: PilotPageEntryDenial | ApiFailure, scope: PilotRequestScope,
                                 family: readonly unknown[], capturedKey: readonly unknown[]): Promise<void> {
        admissionGeneration++;
        deniedEntry.value = entry;
        renderedScope.value = undefined;
        context.retireInitialDocument();
        const preservedKey = entry instanceof ApiFailure ? undefined : capturedKey;
        const error = entry instanceof ApiFailure ? entry : new ObsoleteRequestError();
        await Promise.all([retireQueryFamily(context.queryClient, family, error, preservedKey),
            source.onDenied?.(entry, scope)]);
    }

    /** Initial document eligibility is evaluated at seeding time, not captured forever
     * by this component. Back after eviction/GC must obtain a new GET-style admission. */
    function initialData(): T | undefined {
        return context.initialDocumentFor(initialRoute) && documentRoute.value === initialRoute
            && context.session.value?.context === initialContext && context.locale.value === initialLocale ? source.initial : undefined;
    }

    const readAdmission = useQueryAdmission(context, queryKey,
        computed(() => context.hydrated.value && source.enabled?.value !== false));
    const query = useQuery<T>({
        queryKey,
        ...readAdmission,
        queryFn: readCurrentEntry,
        initialData,
    });

    /** Admission keys vary with locale, but a language read must not unmount an admitted
     * editor. Keep an admitted subtree mounted while a redirect asks its departure guards;
     * otherwise the redirect itself would remove the guard before it can protect the draft.
     * Denials retire controls immediately. This retains only the render decision within its
     * actor generation/resource route, never another payload or localized body. The
     * receipt records the actual successful query time; a failed locale key cannot
     * manufacture a new receipt or erase that admitted decision's previous one. */
    function rememberRender(): void {
        const entry = query.data.value?.entry;
        if (entry?.kind === 'render' && !deniedEntry.value) {
            const previous = currentRenderedScope.value;
            const updatedAt = !query.isFetching.value && !query.error.value
                ? query.dataUpdatedAt.value : previous?.updatedAt;
            renderedScope.value = {context: context.session.value?.context, epoch: context.epoch.value,
                route: documentRoute.value, updatedAt};
        } else if (entry?.kind === 'denied') {
            // Initial or retained typed denials follow the same retirement rule as
            // network decisions. Do not repeat cleanup for the response just handled.
            if (!(deniedEntry.value instanceof ApiFailure) && entry !== deniedEntry.value)
                void denyAdmission(entry, context.capture(), source.key.value, queryKey.value);
        }
    }
    const currentRenderedScope = computed(() => {
        const rendered = renderedScope.value;
        return rendered && rendered.context === context.session.value?.context && rendered.epoch === context.epoch.value
            && rendered.route === documentRoute.value ? rendered : undefined;
    });
    // Structural sharing can retain the exact entry object after a successful
    // equal read. Observe its completed query state as well as its payload so
    // retained admission reports the latest real receipt after a later failure.
    watch([query.data, query.dataUpdatedAt, query.isFetching, query.error], rememberRender, {immediate: true});
    // Presentation can retain only an admitted render decision, never a denied
    // resource's private payload. A redirect waits behind that subtree's existing
    // departure guards; a current denial always wins over the retained decision.
    const outcome = computed<components['schemas']['PageEntryOutcome'] | undefined>(() => {
        if (deniedEntry.value) return deniedEntry.value instanceof ApiFailure ? undefined : deniedEntry.value;
        const entry = query.data.value?.entry;
        if (entry?.kind === 'denied' || entry?.kind === 'render') return entry;
        return currentRenderedScope.value ? {kind: 'render'} : entry;
    });
    // The denial barrier keeps authority retired independently of presentation.
    // A newer failed recovery owns its diagnostic/deadline; an empty locale key
    // falls back to the original denial without reviving an old render snapshot.
    const error = computed(() => query.error.value
        ?? (deniedEntry.value instanceof ApiFailure ? deniedEntry.value : null));
    // A denied resource/actor may not present an earlier successful read as its
    // current authority. No command confirmation or copied form value is a receipt.
    const admittedAt = computed(() => context.ready.value && !deniedEntry.value && !isReadDenial(error.value)
        ? currentRenderedScope.value?.updatedAt : undefined);
    const pending = computed(() => !outcome.value && !error.value && query.isPending.value);

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
    const retryAvailable = useReadRetry(() => error.value);
    const retryAction = useActionState({eligible: mayRetryEntry, pending: () => query.isFetching.value});

    function mayRetryEntry(): boolean {
        return active && !navigation.pending() && context.mayRead()
            && source.enabled?.value !== false && retryAvailable.value;
    }

    /** Retry admission itself, without replaying navigation or any form command.
     * The ordinary query owns errors and the existing read operation fences its
     * captured actor/route/generation. An explicit retry must still honor enabled
     * state and the transport's server deadline even though refetch bypasses it. */
    async function retry(): Promise<void> {
        if (!retryAction.isAvailable()) return;
        await query.refetch();
    }

    return {data: query.data, dataUpdatedAt: query.dataUpdatedAt, error,
        pending, reading: query.isFetching, outcome, admittedAt, navigate, retry, retryAction, retryAvailable};
}
