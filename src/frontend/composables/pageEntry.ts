import {computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef, toRaw, watch} from 'vue';
import {isNavigationFailure, useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized, Router} from 'vue-router';
import {hashKey, useQuery} from '@tanstack/vue-query';
import type {QueryCacheNotifyEvent} from '@tanstack/vue-query';
import type {components} from '../../types/api/v1';
import type {FrontendConfirmedNavigation, FrontendContext, FrontendIdentityConfirmation, FrontendPageEntryDenial, FrontendPageEntrySource, FrontendRequestScope} from '../../types/FrontendUiTypes';
import type {MessageKey} from '../../types/LocalizationTypes';
import type {EntityEntryRetirement, EntityEntryRetirementSource, EntityRouteIntent} from '../../types/FrontendEntityEntryTypes';
import {frontendDocumentUrl, safeFrontendReturn} from '../../common/lib/frontendIdentity';
import {isPlainMessageKey} from '../../common/localization/translator';
import {canRetryRead, useActionState, useFrontend} from '../app/context';
import {ApiFailure, isReadDenial, ObsoleteRequestError} from '../app/transport';
import {invalidateQueryFamilies, queryFamilyReadError, refetchFreshQueries, refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../app/queryCache';
import {belongsToQueryFamily} from '../app/queryKeys';
import {useReadRetry, useReadRetryAt} from './feedback';
import {observePageNavigation} from './pageNavigation';

/** Select matching list-entry denial dependencies from their actual key owners.
 * Missing resources additionally retire the other intent and future copies;
 * EntityEntryPage keeps the producing denial and live creation drafts intact. */
export function entityEntryRetirement(source: EntityEntryRetirementSource): EntityEntryRetirement {
    const {status, actor, resource, intent, keys} = source;
    const families = [keys.detailFamily(actor, resource), keys.editors(actor, resource), ...source.additionalFamilies];

    // Ordinary denial does not revoke independent public guest admission. A
    // missing root invalidates both intents without broadening feature authority.
    if (status === 404) families.push(keys.entry(actor, resource, intent === 'guest' ? 'detail' : 'guest'), keys.guest(actor, resource));

    // Only inactive copies retire; an already mounted duplicate owns its draft.
    return {families, inactiveFamilies: status === 404 ? [keys.duplicate(actor, resource)] : []};
}

/** Follow the router's canonical resource record, rather than reparsing its URL.
 * Vue Router admits case and trailing-slash equivalents; all resource wrappers
 * and Event's page must preserve that same guest/admin read and render intent. */
export function resourceRouteIntent(route: RouteLocationNormalized): EntityRouteIntent {
    // Matched records retain their declared spelling even when the visitor's
    // path differs. No normalization changes parameters, query values or history.
    if (route.matched.some(record => record.path.endsWith('/guest'))) return 'guest';
    return route.matched.some(record => record.path.endsWith('/admin')) ? 'admin' : 'detail';
}

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

/** Apply a server-owned entry decision to the captured route and identity. This operation is
 * also usable after a confirmed form submission; no feature URL or admission policy lives here.
 * Replacement makes a redirect one canonical destination rather than a second SPA visit.
 */
export async function navigatePageEntry(context: FrontendContext, router: Router,
                                        outcome: components['schemas']['PageEntryOutcome'],
                                        scope: FrontendRequestScope = context.capture(),
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
    // Header transitions can return to their current URL after changing identity.
    // That destination is already committed; a duplicated router replacement is not a
    // failed completion and must still publish its one-time feedback without new history.
    if (router.currentRoute.value.fullPath === destination) {
        context.pageNotice.value = notice;
        return true;
    }
    // Bind only this admitted Router attempt before lazy component delivery.
    // A later deliberate visit can have the same URL but a different route
    // object; this old actor must never cancel that newer user's navigation.
    let admittedNavigation: RouteLocationNormalized | undefined;
    const stopStart = router.beforeEach(function captureEntryNavigation(to, from): void {
        if (!admittedNavigation && to.fullPath === destination
            && frontendDocumentUrl(from.fullPath) === frontendDocumentUrl(expectedRoute)) admittedNavigation = to;
    });
    // The shell retires document flashes on accepted departure. A canonical server
    // redirect carries those same flashes into its rendered destination. Capture at
    // the final commitment phase, so expiration/dismissal during lazy delivery cannot
    // revive an old message or private link when the destination eventually arrives.
    const stopCarry = router.beforeResolve(function carryDestinationFeedback(to, from): boolean | void {
        // Identity retirement can occur while a lazy Login module is loading.
        // Cancel this obsolete admission before commitment, rather than merely
        // hiding its notice after it has moved the new actor to the wrong page.
        if (to === admittedNavigation && !context.isCurrent(scope)) return false;
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
        stopStart();
        stopCarry();
    }
}

/** A confirmed command may have a message destination instead of another form.
 * Install its receipt before that view mounts, scoped to the admitted actor and canonical
 * location. It remains application memory only; a fresh document follows GET admission.
 */
export async function completePageEntry(context: FrontendContext, router: Router, destination: string,
                                        messageKey: MessageKey, kind: 'success' | 'info',
                                        scope: FrontendRequestScope = context.capture(),
                                        origin: string = router.currentRoute.value.fullPath,
                                        navigation?: FrontendConfirmedNavigation): Promise<boolean> {
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

// useFrontend returns a component-local translation binding around these same session refs.
// Key by that request/application owner so two confirmed transitions cannot resume old navigation.
const identityNavigations = new WeakMap<FrontendContext['session'], () => void>();

/** Resume only navigation after a confirmed identity command's bootstrap failed. The session
 * owner keeps any private result; this owner retains only its confirmed context and destination.
 * A later matching Retry never replays login/registration or visits a retired origin.
 */
function retainIdentityNavigation(context: FrontendContext, router: Router, confirmedContext: string | null,
                                 outcome: components['schemas']['PageEntryOutcome'], origin: string,
                                 completion?: FrontendConfirmedNavigation): void {
    const navigation = observePageNavigation(router, {finished: resumeNavigation});
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
export async function completeIdentityEntry(context: FrontendContext, router: Router,
                                            result: FrontendIdentityConfirmation,
                                            outcome: components['schemas']['PageEntryOutcome'],
                                            origin: string = router.currentRoute.value.fullPath,
                                            navigation?: FrontendConfirmedNavigation): Promise<boolean> {
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
function navigateConfirmedEntry(context: FrontendContext, router: Router,
                                outcome: components['schemas']['PageEntryOutcome'], origin: string,
                                navigation?: FrontendConfirmedNavigation): Promise<boolean> {
    if (navigation && outcome.kind === 'redirect') {
        return navigation.navigate(outcome.url, context.capture(), origin, outcome.notice);
    }
    return navigatePageEntry(context, router, outcome, context.capture(), origin);
}

// Identity admission replaces epoch-keyed route instances, including after a healthy
// bootstrap. This application-local owner keeps only canonical delivery receipts across
// those remounts. Separate SSR requests/browser apps have separate session ref keys.
const confirmedNavigations = new WeakMap<FrontendContext['session'], ReturnType<typeof createConfirmedNavigation>>();

/** One application-owned delivery state, observed by mounted command owners.
 * Component type survives actor remounts; simultaneous instances of that same
 * type must supply distinct stable logical identities to retain separate receipts.
 * Without a supplied identity, identifyOwner deliberately uses the component type. */
function createConfirmedNavigation(context: FrontendContext, router: Router) {
    const receipt = shallowRef<{destination: string; scope: FrontendRequestScope; origin: string;
        notice: components['schemas']['EntryNotice'] | null; owner: unknown; refreshSession: boolean;
        readFamilies: readonly (readonly unknown[])[]}>();
    const pending = ref(false);
    // Query remains the only read/error owner. Cache events make that existing
    // state reactive for mounted Retry controls without copying projections or
    // retaining a feature callback in this application-owned receipt.
    const readRevision = ref(0);
    const stopReadState = context.queryClient.getQueryCache().subscribe(receiveDependencyState);
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

    /** Another irreversible command needs an empty delivery slot. Derive that
     * admission from this receipt, independently of its original mounted owner. */
    function mayNavigate(): boolean {
        return !disposed && !pending.value && receipt.value === undefined;
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

    /** Observe only this receipt's selected families. Observer retirement and
     * cache removal must release a deadline as promptly as a new read error. */
    function receiveDependencyState(event: QueryCacheNotifyEvent): void {
        const families = receipt.value?.readFamilies;
        if (families?.some(family => belongsToQueryFamily(event.query, family))) readRevision.value++;
    }

    /** Derive the most restrictive actual read deadline from the existing
     * session/query owners. No receipt stores another error or retry clock. */
    function retryError(): Error | null {
        // Subscribe reactive consumers to actual cache changes before reading
        // the existing query-owned errors through this nonreactive cache API.
        void readRevision.value;
        const confirmed = receipt.value;
        if (!confirmed) return null;
        const sessionFailure = confirmed.refreshSession ? context.sessionRead.value.error : null;
        const dependencyFailure = queryFamilyReadError(context.queryClient, confirmed.readFamilies);
        // Both serial read requirements must be ready. The later server
        // deadline supplies the one existing availability wakeup and display.
        const sessionDeadline = sessionFailure instanceof ApiFailure ? sessionFailure.retryAt ?? 0 : 0;
        const dependencyDeadline = dependencyFailure instanceof ApiFailure ? dependencyFailure.retryAt ?? 0 : 0;
        return sessionDeadline > dependencyDeadline ? sessionFailure : dependencyFailure ?? sessionFailure;
    }

    /** The shared receipt owns dispatch admission independently of any temporary
     * component. Local controls add their own mount lifetime and deadline wakeup. */
    function mayRetry(owner: unknown): boolean {
        const confirmed = receipt.value;
        return !!confirmed && !pending.value && confirmed.owner === owner && mayDeliver();
    }

    /** Read admission is distinct from canceling/marking pre-command snapshots
     * stale. A server cooldown or shared read pause must still allow the latter. */
    function mayDeliver(): boolean {
        const confirmed = receipt.value;
        // Session-refresh delivery can establish its own admission. A
        // dependency-only retry instead uses the existing shared barrier.
        return !!confirmed && !disposed && context.hydrated.value
            && (!confirmed.readFamilies.length || confirmed.refreshSession || context.mayRead(confirmed.scope))
            && canRetryRead(retryError());
    }

    function mayRetryFallback(): boolean {
        const confirmed = receipt.value;
        return !!confirmed && !mountedOwners.value.has(confirmed.owner) && mayRetry(confirmed.owner);
    }

    /** Retry delivery with the current presentation language, while retaining the confirmed
     * actor/epoch and origin. Language selection cannot invalidate a committed business result. */
    async function retry(owner: unknown, invalidateDependencies = false): Promise<boolean> {
        const confirmed = receipt.value;
        if (!confirmed || disposed || !context.hydrated.value || pending.value || confirmed.owner !== owner
            || !invalidateDependencies && !mayDeliver()) return false;

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
            // The first confirmed handoff owns cancellation/invalidation before
            // yielding. Sibling removals see this same receipt throughout that
            // await; cooldowns pause GETs without leaving old snapshots current.
            // Later Retry repeats only delivery reads, not this broad invalidation.
            if (invalidateDependencies && confirmed.readFamilies.length) {
                try { await invalidateQueryFamilies(context.queryClient, confirmed.readFamilies); }
                catch { return false; }
                if (receipt.value !== confirmed || !context.isCurrent(confirmed.scope)) return false;
            }
            if (!mayDeliver()) return false;

            // Keep this serial display requirement in the shared receipt rather
            // than retaining a feature callback after its component has retired.
            // Failure retains confirmed success; Retry repeats only reads/delivery.
            if (confirmed.refreshSession) {
                try { await context.refreshSession(true); }
                catch { return false; }
                if (receipt.value !== confirmed || !context.isCurrent(confirmed.scope)) return false;
            }
            if (confirmed.readFamilies.length) {
                try {
                    // Reuse eligible mounted read owners, including their own
                    // cancellation/authority checks. Closed or absent families
                    // stay untouched; destination mounting admits its cold GET.
                    await refetchFreshQueries(context.queryClient, {type: 'active', predicate: belongsToDependency},
                        ownsDependencyRead, {allowEmpty: true});
                } catch { return false; }
                if (!ownsDependencyRead()) return false;
            }
            // Retry only destination delivery with the current presentation
            // language. Clear this exact receipt after commitment; a newer owner
            // or failed navigation must not lose its retained recovery state.
            const committed = await navigatePageEntry(context, router,
                // Carry only feedback that is still live at Router commitment.
                // A dismissed/expired initial success must never return on Retry.
                {kind: 'redirect', url: confirmed.destination, notice: null}, context.capture(), confirmed.origin);
            if (committed && receipt.value === confirmed) receipt.value = undefined;
            return committed;
        } finally {
            pending.value = false;
            // An idle retained receipt means delivery needs deliberate recovery.
            // Its common warning already explains the confirmed operation; remove
            // only that operation's exact success to avoid two alerts for one
            // action. Equal message keys from a newer receipt remain independent.
            if (receipt.value === confirmed && confirmed.notice
                && toRaw(context.pageNotice.value) === toRaw(confirmed.notice)) context.pageNotice.value = null;
        }

        /** Keep selected key prefixes in the existing cache matcher rather than
         * interpreting feature tuple positions inside delivery recovery. */
        function belongsToDependency(query: Parameters<typeof belongsToQueryFamily>[0]): boolean {
            // These keys were captured with confirmation, before any await.
            return confirmed!.readFamilies.some(family => belongsToQueryFamily(query, family));
        }
        /** A paused session or retired origin cannot count an empty selection
         * as authority to consume this confirmed delivery receipt. */
        function ownsDependencyRead(): boolean {
            return receipt.value === confirmed && context.mayRead(confirmed!.scope)
                && frontendDocumentUrl(router.currentRoute.value.fullPath) === frontendDocumentUrl(confirmed!.origin);
        }
    }

    /** Retain one already confirmed destination for its current actor/origin.
     * Copy only read dependencies, announce its public notice once, then delegate
     * first delivery and explicit retry to this existing receipt owner. */
    async function navigate(owner: unknown, destination: string, scope: FrontendRequestScope = context.capture(),
                            origin: string = router.currentRoute.value.fullPath,
                            notice: components['schemas']['EntryNotice'] | null = null, refreshSession = false,
                            readFamilies: readonly (readonly unknown[])[] = []): Promise<boolean> {
        if (!mayNavigate() || !context.isCurrent(scope)
            || frontendDocumentUrl(router.currentRoute.value.fullPath) !== frontendDocumentUrl(origin)) return false;
        // Copy only the selected key arrays so later caller mutation cannot
        // replace the dependencies of this already confirmed command receipt.
        receipt.value = {destination: pageDestination(router, destination), scope, origin, notice, owner, refreshSession,
            readFamilies: readFamilies.map(family => [...family])};
        // The write has already confirmed this result. Announce it once through
        // the common host even if its following read/navigation later fails;
        // that delivery failure has a separate read-only recovery warning.
        if (notice) context.pageNotice.value = notice;
        return retry(owner, true);
    }

    function target(owner: unknown): string | null {
        const confirmed = receipt.value;
        return confirmed && confirmed.owner === owner ? confirmed.destination : null;
    }

    /** The retained command owns its feedback identity as well as its destination.
     * Expose only this logical owner's receipt, so a sibling cannot announce another
     * operation and remounts translate the confirmed result without a second store. */
    function notice(owner: unknown): components['schemas']['EntryNotice'] | null {
        const confirmed = receipt.value;
        return confirmed && confirmed.owner === owner ? confirmed.notice : null;
    }

    function fallbackTarget(): string | null {
        const confirmed = receipt.value;
        return confirmed && !mountedOwners.value.has(confirmed.owner) ? confirmed.destination : null;
    }

    /** The shell presents every failed delivery through one common notice.
     * Its receipt stays with the confirmed operation, independently of whether
     * the originating form remains mounted or has already retired. */
    function recoveryTarget(): string | null {
        return receipt.value?.destination ?? null;
    }

    function mayRetryRecovery(): boolean {
        const confirmed = receipt.value;
        return !!confirmed && mayRetry(confirmed.owner);
    }

    function retryRecovery(): Promise<boolean> {
        const confirmed = receipt.value;
        return confirmed ? retry(confirmed.owner) : Promise.resolve(false);
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
        stopReadState();
        if (context.browser) window.removeEventListener('beforeunload', protectPendingDeparture);
        if (confirmedNavigations.get(context.session) === navigation) confirmedNavigations.delete(context.session);
    }
    const navigation = {pending, target, notice, fallbackTarget, recoveryTarget, navigate, retry, retryFallback,
        retryRecovery, retain, identifyOwner, mayNavigate, mayRetry, mayRetryFallback, mayRetryRecovery, retryError};
    return navigation;
}

/** Retain required read/destination delivery after a confirmed command. A failed or cancelled lazy destination
 * must not make creation/deletion available again: callers keep the confirmed result and use
 * Retry to repeat this navigation, never the command. An identity remount observes this same
 * application's receipt; another committed visit or authoritative actor retires it.
 */
export function useConfirmedNavigation(identity?: string): FrontendConfirmedNavigation {
    const context = useFrontend();
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
    const available = computed(navigation.mayNavigate);
    const notice = computed(() => navigation.notice(owner));
    const fallbackTarget = computed(navigation.fallbackTarget);
    const recoveryTarget = computed(navigation.recoveryTarget);
    const retryAvailable = useReadRetry(navigation.retryError);
    const readRetryAt = useReadRetryAt(navigation.retryError, retryAvailable);
    const retryAt = computed(() => target.value ? readRetryAt.value : undefined);
    const fallbackRetryAt = computed(() => fallbackTarget.value ? readRetryAt.value : undefined);
    const recoveryRetryAt = computed(() => recoveryTarget.value ? readRetryAt.value : undefined);
    const recoveryReadError = computed(navigation.retryError);
    // These states belong to each mounted control, while the receipt and its
    // dispatch guard remain application-owned across originating-view retirement.
    const retryAction = useActionState({eligible: () => retryAvailable.value
        && navigation.mayRetry(owner), pending: () => navigation.pending.value});
    const fallbackRetryAction = useActionState({eligible: () => retryAvailable.value
        && navigation.mayRetryFallback(), pending: () => navigation.pending.value});
    const recoveryAction = useActionState({eligible: () => retryAvailable.value
        && navigation.mayRetryRecovery(), pending: () => navigation.pending.value});
    async function navigate(destination: string, scope: FrontendRequestScope = context.capture(),
                            origin: string = router.currentRoute.value.fullPath,
                            notice: components['schemas']['EntryNotice'] | null = null, refreshSession = false,
                            readFamilies: readonly (readonly unknown[])[] = []): Promise<boolean> {
        return navigation.navigate(owner, destination, scope, origin, notice, refreshSession, readFamilies);
    }

    function retry(): Promise<boolean> {
        if (!retryAction.isAvailable()) return Promise.resolve(false);
        return navigation.retry(owner);
    }

    function retryFallback(): Promise<boolean> {
        return fallbackRetryAction.isAvailable() ? navigation.retryFallback() : Promise.resolve(false);
    }
    function retryRecovery(): Promise<boolean> {
        return recoveryAction.isAvailable() ? navigation.retryRecovery() : Promise.resolve(false);
    }
    return {pending: navigation.pending, available, target, notice, fallbackTarget, navigate, retry, retryFallback,
        retryAction, fallbackRetryAction, retryAt, fallbackRetryAt,
        recoveryTarget, recoveryAction, recoveryRetryAt, recoveryReadError, retryRecovery};
}

/** One reusable read/navigation boundary for server-owned page admission. A feature supplies
 * its generated payload, API read and query family. Scope, locale, route retirement, pending
 * lazy destinations and canonical redirects follow the same rules for every module.
 */
export function usePageEntry<T extends {entry: components['schemas']['PageEntryOutcome']}>(source: FrontendPageEntrySource<T>) {
    const context = useFrontend();
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
    const deniedEntry = shallowRef<FrontendPageEntryDenial | ApiFailure>();
    const renderedScope = shallowRef<{context: string | null | undefined; epoch: number; route: string; updatedAt?: number}>();
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
    function isCurrentEntry(scope: FrontendRequestScope, expectedRoute: string, generation: number): boolean {
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
    async function denyAdmission(entry: FrontendPageEntryDenial | ApiFailure, scope: FrontendRequestScope,
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
    // The denial owner already fences current actor/resource/read generations.
    // Publish only its visible static classification, so retiring private initial
    // data cannot make this error look interactive or eligible for automatic reload.
    const retirePageOutcome = context.registerPageOutcome(documentRoute, hasStaticOutcome);
    onBeforeUnmount(retirePageOutcome);

    function hasStaticOutcome(): boolean {
        return outcome.value?.kind === 'denied' || isReadDenial(error.value);
    }
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

    function navigate(entry: components['schemas']['PageEntryOutcome'], scope?: FrontendRequestScope,
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

    /** Require this visit's new authoritative render admission before recovery continues.
     * Session revalidation may already have resumed a query. Replace that read through
     * the shared fresh-query owner instead of treating the UI's pending state as denial
     * or accepting retained data. The ordinary Retry control keeps its existing guard. */
    async function readFreshAdmission(): Promise<void> {
        const scope = context.capture();
        const expectedRoute = documentRoute.value;
        const generation = admissionGeneration;
        const key = queryKey.value;
        const identity = hashKey(key);
        const denial = deniedEntry.value;

        // A cancellation yields before replacement dispatch. Recheck the same
        // actor, visit, locale, enabled source and server deadline on both sides.
        function mayReadFresh(): boolean {
            return isCurrentEntry(scope, expectedRoute, generation) && hashKey(queryKey.value) === identity
                && context.hydrated.value && context.mayRead(scope, true)
                && source.enabled?.value !== false && retryAvailable.value;
        }
        if (!mayReadFresh()) throw new ObsoleteRequestError();
        const value = await refetchFreshQuery<T>(context.queryClient, key, () => query.refetch(), mayReadFresh);
        // A fresh denial or redirect is retained by its existing owner, but
        // cannot certify recovery. Only this read restoring its captured denial
        // may advance the generation; any other transition remains obsolete.
        const expectedGeneration = generation + (denial ? 1 : 0);
        const admitted = value.entry.kind === 'render' && !deniedEntry.value;
        if (!isCurrentEntry(scope, expectedRoute, expectedGeneration) || hashKey(queryKey.value) !== identity
            || !context.hydrated.value || !context.mayRead(scope, true) || source.enabled?.value === false
            || !retryAvailable.value || !admitted) throw new ObsoleteRequestError();
    }

    return {data: query.data, dataUpdatedAt: query.dataUpdatedAt, error,
        pending, reading: query.isFetching, outcome, admittedAt, navigate, retry, retryAction, retryAvailable, readFreshAdmission};
}
