import {computed, inject, onScopeDispose, ref, shallowRef, watch} from 'vue';
import type {InjectionKey, Ref} from 'vue';
import {useTranslation} from 'i18next-vue';
import {QueryClient} from '@tanstack/vue-query';
import type {QueryCacheNotifyEvent} from '@tanstack/vue-query';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import type {PilotActionInputs, PilotActionState, PilotContext, PilotIdentityConfirmation, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {Locale, MessageKey} from '../../types/LocalizationTypes';
import type {components} from '../../types/api/v1';
import type {RouteLocationNormalized, Router} from 'vue-router';
import {createLocalizationInstance, createTranslator, resolveLocale} from '../../modules/localization/translator';
import {PilotApi} from './api';
import {ApiFailure, isTerminalReadFailure, ObsoleteRequestError} from './transport';
import {createUpdateCoordinator} from './updateCoordinator';
import {frontendDocumentUrl, frontendIdentityMessageFeedback} from '../../modules/lib/frontendIdentity';
import {belongsToLocalizedQueryFamily} from './queryKeys';

// Development SSR can invalidate the context module between app construction and a lazy route
// import. A stable key spans those module generations; the provided value remains app/request-local.
export const pilotContextKey: InjectionKey<PilotContext> = Symbol.for('Surveyor pilot context');

/** JS-only reusable controls share the application's initialization boundary.
 * Standalone controls keep their established behavior without requiring a pilot
 * context; real HTML navigation/search never uses this interaction gate. */
export function useClientInitialization() {
    const context = inject(pilotContextKey, null);
    return computed(() => !context || context.hydrated.value);
}

/** Derive one operation state for both rendered controls and deliberate dispatch.
 * Admission belongs to the operation: a scoped read can wait for bootstrap while
 * session recovery and local draft controls remain available. No input, request,
 * retry or outcome is copied here, and an admitted operation keeps its lifetime. */
export function useActionState(inputs: PilotActionInputs = {}): PilotActionState {
    const initialized = useClientInitialization();
    // Disposal retires only future admission. Pending promises keep their existing
    // command/read settlement owners and are never canceled or replayed here.
    let active = true;
    onScopeDispose(() => { active = false; });
    const pending = computed(() => inputs.pending?.() ?? false);
    // A read barrier is not itself progress on this action. Keep its spinner
    // tied to the owning operation rather than every routine session check.
    const available = computed(isAvailable);

    /** Recheck nonreactive lifetime fences at dispatch too: a retained callback
     * can run after its component's final render and cached computed evaluation. */
    function isAvailable(): boolean {
        return active && initialized.value && !(inputs.pending?.() ?? false)
            && !(inputs.blocked?.() ?? false) && (inputs.eligible?.() ?? true);
    }

    return {available, disabled: computed(() => !available.value), pending, isAvailable};
}

export function usePilot(): PilotContext {
    const context = inject(pilotContextKey);
    if (!context) throw new Error('The pilot application context is missing.');
    const {t} = useTranslation();
    // Keep the application contract typed while letting the selected Vue binding own
    // translation dependencies, including changes to resources during development HMR.
    const messages = computed(() => createTranslator(context.locale.value, t));
    return {...context, messages};
}

/** Spread temporary read retries without another scheduler or an unbounded delay.
 * The existing two-retry limit uses 750–1000 ms, then 1500–2000 ms. The shared
 * exponential policy retains its eight-second ceiling if that limit later changes. */
function retryDelay(attempt: number): number {
    const delay = Math.min(1000 * 2 ** attempt, 8000);
    return Math.round(delay * (0.75 + Math.random() * 0.25));
}

/** Request-local on the server, application-local in the browser; never a module singleton. */
export function createPilotContext(bootstrap: FrontendPilotBootstrap, browser: boolean,
                                   requestFetch?: typeof fetch,
                                   mayReloadAutomatically: () => boolean = () => false): PilotContext {
    const session = shallowRef(bootstrap.session);
    const epoch = ref(0);
    const locale = ref<Locale>(resolveLocale(bootstrap.session.locale));
    const i18next = createLocalizationInstance(locale.value);
    const stopLanguage = watch(locale, next => { void i18next.changeLanguage(next); }, {flush: 'sync'});
    const visible = ref(browser && document.visibilityState !== 'hidden');
    const ready = ref(true);
    // The validated document initially admits reads. A later session check can pause
    // dispatch while the same authorized tree, server snapshot and local drafts remain.
    const readsReady = ref(true);
    // Construction accepts the validated initial document's session receipt,
    // matching query initialData. A failed later GET must retain that observation.
    const sessionRead = shallowRef<PilotContext['sessionRead']['value']>({error: null, updatedAt: Date.now(), pending: false});
    const initialDocumentActive = ref(true);
    const initialDocumentUrl = bootstrap.initialUrl === undefined ? undefined : frontendDocumentUrl(bootstrap.initialUrl);
    const hydrated = ref(false);
    // Mounting feature owners is distinct from proving initialization succeeded.
    // Only hydrated enables client controls/reads; this signal releases the initial
    // skeleton while the entry owner still captures setup/render/mounted failures.
    const initialContentReady = ref(false);
    const notice = ref<MessageKey | null>(bootstrap.identityFeedback === 'auth.logoutDone' ? bootstrap.identityFeedback : null);
    // Entry feedback is a typed one-time page notice. Session/read conditions keep their
    // existing independent lifetime and must not replace an admission notice's severity.
    const pageNotice = ref<components['schemas']['EntryNotice'] | null>(bootstrap.pageNotice
        ?? (bootstrap.identityFeedback === 'auth.activated' ? {kind: 'success', messageKey: 'auth.activated'} : null));
    // A confirmed command can finish on a native message destination without another
    // write. This presentation receipt is memory-only and belongs to the current actor.
    const pageCompletion = ref<PilotContext['pageCompletion']['value']>(
        bootstrap.pageCompletion?.context === bootstrap.session.context ? bootstrap.pageCompletion : null,
    );
    const personalLink = ref<string | null>(bootstrap.personalLink ?? null);
    const messages = computed(() => createTranslator(locale.value, i18next.getFixedT(locale.value)));
    const pageTitle = ref('Surveyor');
    // The application supplies live route eligibility before Router starts.
    // Contexts without a route owner retain explicit recovery only.
    const updates = createUpdateCoordinator(bootstrap.session.deployment, browser, mayReloadAutomatically);
    const queryClient = new QueryClient({defaultOptions: {
        queries: {
            staleTime: 15_000,
            gcTime: 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: (failures, error) => !(error instanceof ObsoleteRequestError)
                && (!(error instanceof ApiFailure) || (error.status >= 500 && !error.retryAfter)) && failures < 2,
            retryDelay,
        },
        mutations: {retry: false},
    }});
    const queryStateRevision = ref(0);
    const stopQueryState = queryClient.getQueryCache().subscribe(receiveQueryState);

    /** Query state changes renew observer eligibility after explicit recovery.
     * Options/observer notifications do not change read policy and must not form
     * a reactive options-update loop. No server data is stored in this signal. */
    function receiveQueryState(event: QueryCacheNotifyEvent): void {
        if (event.type === 'updated') queryStateRevision.value++;
    }
    let bootstrapRequest: Promise<void> | undefined;
    let localeRequest: Promise<void> | undefined;
    let desiredLocale: Locale | null = null;
    // Retain only a confirmed identity receipt while its authoritative session read
    // is unavailable. Retry can deliver the private link without replaying registration.
    let pendingIdentity: PilotIdentityConfirmation | undefined;
    // Identity and language have independent ordering. A confirmed language command retires
    // only older locale projections, without discarding authoritative identity/deployment data.
    let localeGeneration = 0;
    let channel: BroadcastChannel | undefined;
    let disposed = false;
    const identityGuards = new Set<() => boolean>();
    // Admission keeps its query/denial descriptor. Context retains only a live
    // presentation predicate and its actor fence, shared by rendering and reload.
    const pageOutcomes = shallowRef(new Set<{scope: PilotRequestScope;
        route: Readonly<Ref<string>>; isStatic: () => boolean}>());

    /** Explicit cookie-changing controls must pass the same draft/pending checks as navigation.
     * External identity changes remain authoritative and clear the previous identity immediately. */
    function registerIdentityGuard(guard: () => boolean): () => void {
        identityGuards.add(guard);
        return () => { identityGuards.delete(guard); };
    }

    /** Every mounted draft and retained command must admit an intentional actor switch. */
    function mayChangeIdentity(): boolean {
        return [...identityGuards].every(guard => guard());
    }

    /** Capture server-projected evidence without inventing an anonymous visitor.
     * A null pair still has this app's ordinary epoch/route/draft lifetimes. */
    function capture(): PilotRequestScope {
        return {context: session.value.context, csrfToken: session.value.csrfToken,
            locale: locale.value, epoch: epoch.value};
    }

    /** Bootstrap is evidence of the initial GET's admission and authorized feedback.
     * A later visit to the same URL is a new GET-style journey and must obtain fresh admission.
     * The reactive eligibility flag prevents reused views from reviving an old response. */
    function initialDocumentFor(url: string): FrontendPilotBootstrap | undefined {
        // A fragment selects content within the same document; it is not sent to Express.
        // Path and query still identify the original request and may never revive on return.
        if (!initialDocumentActive.value || !ready.value || initialDocumentUrl !== frontendDocumentUrl(url)
            || bootstrap.session.context !== session.value.context) return;
        return bootstrap;
    }

    /** Committed departure retires native presentation; canceled navigation retains it.
     * Omit the destination when fresh admission explicitly supersedes the initial response.
     * Identity retirement independently revokes eligibility even if the URL stays unchanged. */
    function retireInitialDocument(destination?: string): void {
        if (destination === undefined || frontendDocumentUrl(destination) !== initialDocumentUrl) initialDocumentActive.value = false;
    }

    /** Keep mounted presentation independent of retired bootstrap authority. An
     * admission owner supplies its current visit and releases this reference on
     * unmount; the captured actor prevents an old component classifying a new one. */
    function registerPageOutcome(route: Readonly<Ref<string>>, isStatic: () => boolean): () => void {
        const source = {scope: capture(), route, isStatic};
        // Publish registration reactively: a seeded denial can retire bootstrap
        // during setup, before the shell has observed this mounted owner once.
        pageOutcomes.value = new Set([...pageOutcomes.value, source]);

        return function retirePageOutcome(): void {
            const remaining = new Set(pageOutcomes.value);
            remaining.delete(source);
            pageOutcomes.value = remaining;
        };
    }

    /** Rendering and automatic release recovery share the displayed outcome,
     * including mounted admission after initial GET evidence has been retired.
     * This is presentation policy only; it neither admits reads nor blocks the
     * separate deliberate-recovery path's ordinary draft/command protection. */
    function hasStaticPageOutcome(route: Pick<RouteLocationNormalized, 'meta' | 'fullPath'>): boolean {
        const initial = initialDocumentFor(route.fullPath);
        const destination = frontendDocumentUrl(route.fullPath);
        const completion = pageCompletion.value;

        // Completion belongs to its current actor/destination. Ordinary field
        // feedback cannot turn an interactive form into a static document.
        const completed = !!completion && completion.context === session.value.context
            && frontendDocumentUrl(completion.destination) === destination;
        if (completed || (!!initial?.identityFeedback && frontendIdentityMessageFeedback.includes(initial.identityFeedback))
            || initial?.commonPage || initial?.pageEntry?.kind === 'denied' || initial?.packingError
            || initial?.identityProblem || (initial?.passwordReset && 'status' in initial.passwordReset)) return true;

        // Read the actual mounted owner's reactive classification rather than a
        // copied snapshot. Other actors, resources and disposed owners cannot
        // classify this document; fresh admission can restore dynamic content.
        for (const source of pageOutcomes.value) {
            if (isCurrent(source.scope) && source.route.value === destination && source.isStatic()) return true;
        }
        return false;
    }

    /** Static admitted outcomes remain readable during startup. All other
     * interactive routes retain the shared skeleton until initialization. */
    function requiresClientInitialization(route: Pick<RouteLocationNormalized, 'meta' | 'fullPath'>): boolean {
        return route.meta.javascriptRequired === true && !hasStaticPageOutcome(route);
    }

    function isCurrent(scope: PilotRequestScope, checkLocale = false): boolean {
        return !disposed && ready.value && scope.epoch === epoch.value && scope.context === session.value.context
            && (!checkLocale || scope.locale === locale.value);
    }

    /** Session checks control new read dispatch, not the lifetime of admitted writes
     * or already captured responses. Visibility/hydration remain each observer's policy. */
    function mayRead(scope?: PilotRequestScope, checkLocale = false): boolean {
        return !disposed && readsReady.value && ready.value && (!scope || isCurrent(scope, checkLocale));
    }

    /** Resuming an enabled observer can itself dispatch a stale query. Preserve the
     * read's terminal rejection policy through session checks; explicit Retry uses
     * mayRead instead and can deliberately recover the same observed query. */
    function mayObserve(key: readonly unknown[], firstRead = false): boolean {
        // QueryClient remains the source of this endpoint's current failure state.
        queryStateRevision.value;
        const state = queryClient.getQueryState(key);
        return mayRead() && (firstRead || state?.fetchStatus === 'fetching' || !isTerminalReadFailure(state?.error));
    }

    /** Close the old actor's entire presentation before admitting another cookie
     * context. Advancing the epoch also fences still-pending responses; canceling
     * HTTP alone cannot prevent a completed response from restoring private state. */
    function clearIdentity(): void {
        initialDocumentActive.value = false;
        pendingIdentity = undefined;
        personalLink.value = null;
        pageNotice.value = null;
        pageCompletion.value = null;
        // A previous actor's successful read and cooldown cannot describe the new
        // identity. The bootstrap promise is still drained by its existing owner.
        sessionRead.value = {error: null, pending: false};
        ready.value = false;
        readsReady.value = false;
        pageOutcomes.value = new Set();
        epoch.value++;
        void queryClient.cancelQueries();
        queryClient.clear();
        notice.value = 'state.sessionChanged';
    }

    function invalidateIdentity(): void {
        if (ready.value) clearIdentity();
        void refreshSession().catch(() => { /* Keep the private view closed until bootstrap succeeds. */ });
    }

    const api = new PilotApi(isCurrent, invalidateIdentity, requestFetch, mayRead);

    /** Publish one coherent session/language projection while retaining the server's actor evidence. */
    function receiveSession(current: components['schemas']['SessionView'], selectedLocale: Locale): void {
        // Keep the public session and the reactive translation owner in agreement. When an old
        // read loses its language authority, its remaining session fields are still useful.
        session.value = current.locale === selectedLocale ? current : {...current, locale: selectedLocale};
        locale.value = selectedLocale;
        updates.observe(current.deployment);
    }

    /** Gate focus/reconnect reads on current session evidence. A confirmed command
     * requests fresh=true to drain an older in-flight bootstrap before its display
     * refresh; failures retain the same shared read notice and server cooldown. */
    function refreshSession(fresh = false): Promise<void> {
        // Close dispatch synchronously, before visibility can re-enable a stale query.
        // Failure and server cooldown retain this barrier; presentation stays mounted.
        readsReady.value = false;
        if (disposed) return Promise.reject(new ObsoleteRequestError());
        if (bootstrapRequest) {
            // Confirmed commands need a read started after their acknowledgement.
            // Drain an older bootstrap before requesting that fresh display data.
            return fresh ? bootstrapRequest.catch(ignoreEarlierBootstrapFailure).then(refreshAfterEarlierBootstrap) : bootstrapRequest;
        }
        // Every session caller shares the existing server deadline. Reject with
        // the retained failure rather than implying that a skipped GET succeeded.
        if (!canRetryRead(sessionRead.value.error)) return Promise.reject(sessionRead.value.error);
        const generation = epoch.value;
        const capturedLocaleGeneration = localeGeneration;
        sessionRead.value = {...sessionRead.value, pending: true};

        /** Adopt only this bootstrap generation. Identity changes retire private
         * state even when locale changed meanwhile; locale generation independently
         * decides whether this response may replace the current language choice. */
        function receiveBootstrap(current: components['schemas']['SessionView']): void {
            if (disposed || generation !== epoch.value) return;

            // Capture the matching receipt before ordinary actor retirement clears private
            // state. A different authoritative actor never receives another guest's link.
            const confirmedIdentity = pendingIdentity?.session.context === current.context ? pendingIdentity : undefined;
            // An actual actor transition remains authoritative even when a language command
            // overtook this read. It must clear private queries and drafts in the usual way.
            if (current.context !== session.value.context) clearIdentity();
            const selectedLocale = capturedLocaleGeneration === localeGeneration
                ? resolveLocale(current.locale) : locale.value;
            receiveSession(current, selectedLocale);
            ready.value = true;
            readsReady.value = true;
            sessionRead.value = {error: null, updatedAt: Date.now(), pending: false};
            pendingIdentity = undefined;

            if (confirmedIdentity) {
                personalLink.value = confirmedIdentity.personalLink;
                // Registration is already committed when optional mail delivery
                // fails. Publish that advisory outcome through the existing scoped
                // notice before navigation, retaining the identity/link and never
                // turning destination recovery into another registration attempt.
                if (confirmedIdentity.emailDelivery === 'failed') {
                    pageNotice.value = {kind: 'info', messageKey: 'auth.guestEmailFailed'};
                }
                notice.value = null;
                channel?.postMessage({kind: 'identity'});
            }

            // This notice belongs to the session read, not any feature's resource read.
            // Clear only that recovered failure; logout/identity feedback remains separate.
            if (notice.value === 'state.stale') notice.value = null;
        }

        function rejectBootstrap(failure: unknown): never {
            // Obsolete responses cannot replace the current actor's read notice or
            // revive a retired receipt. Ordinary failures preserve readable state.
            if (!disposed && generation === epoch.value) {
                const error = failure instanceof Error ? failure : new Error('The session read failed.');
                sessionRead.value = {...sessionRead.value, error, pending: false};
                notice.value = 'state.stale';
            }
            throw failure;
        }

        function finishBootstrap(): void {
            bootstrapRequest = undefined;
            // An identity hint can obsolete an already pending bootstrap. Its result is ignored,
            // but a second check must follow rather than leaving recovery stalled until the next timer.
            if (!disposed && !ready.value && generation !== epoch.value) {
                queueMicrotask(resumeRetiredBootstrap);
            }
        }

        /** Drain the retired generation before dispatching replacement bootstrap.
         * Its failure remains the session owner's recovery state, never a new toast. */
        function resumeRetiredBootstrap(): void {
            // A newer bootstrap may already have restored admission before this microtask.
            if (!disposed && !ready.value) void refreshSession().catch(keepBootstrapRecovery);
        }

        function keepBootstrapRecovery(): void {
            // refreshSession already publishes the current failure and cooldown.
        }

        bootstrapRequest = api.bootstrap().then(receiveBootstrap).catch(rejectBootstrap).finally(finishBootstrap);
        return bootstrapRequest;
    }

    function ignoreEarlierBootstrapFailure(): void {
        // The existing bootstrap owner retains its failure and retry deadline.
    }

    function refreshAfterEarlierBootstrap(): Promise<void> {
        return refreshSession();
    }

    /** Serialize preference writes and share their completion across rapid clicks.
     * Callers keep their current actor and drafts; only the final admitted language
     * invalidates its dependent reads after the cookie command is confirmed. */
    function changeLocale(nextLocale: Locale): Promise<void> {
        if (!ready.value) return Promise.resolve();
        desiredLocale = nextLocale;
        if (localeRequest) return localeRequest;
        const finishUpdateCommand = updates.commandStarted();
        // Serialize cookie-writing commands, coalescing clicks to the latest desired preference.
        // A response guard alone cannot prevent an older HTTP response overwriting the newer cookie.
        async function updateLocalePreference(): Promise<void> {
            while (desiredLocale !== null) {
                const requested = desiredLocale;
                desiredLocale = null;
                if (requested === locale.value) continue;
                const scope = capture();
                const current = await api.setLocale(requested, scope);
                if (!isCurrent(scope)) { desiredLocale = null; return; }

                // Locale does not change actor identity: keep dirty editors and their focus mounted.
                // Increment only on confirmation: a failed preference must not silence a valid read.
                localeGeneration++;
                receiveSession(current, resolveLocale(current.locale));
                // Machine projections have locale-free keys and keep their current reads.
                // Retire translated families only; their new keys receive selected-language data.
                const translated = {predicate: isTranslatedQuery};
                await queryClient.cancelQueries(translated);
                await queryClient.invalidateQueries(translated);

                function isTranslatedQuery(query: Parameters<typeof belongsToLocalizedQueryFamily>[0]): boolean {
                    return belongsToLocalizedQueryFamily(query, scope.context);
                }
            }
        }

        function finishLocalePreference(): void {
            localeRequest = undefined;
            finishUpdateCommand();
        }

        localeRequest = updateLocalePreference().finally(finishLocalePreference);
        return localeRequest;
    }

    /** Bootstrap remains authoritative after a cookie-changing command. A private guest link
     * is shown only when the confirmed identity is still current, and never survives a switch. */
    async function acceptIdentity(result: PilotIdentityConfirmation): Promise<void> {
        // A focus/bootstrap read may have captured the cookie before the command changed it.
        // Retire that generation and drain its promise before asking for authoritative new state.
        // Reusing it would incorrectly compare a successful login to the old anonymous context.
        clearIdentity();
        pendingIdentity = result;
        if (bootstrapRequest) await bootstrapRequest.catch(() => {});
        await refreshSession();
        if (session.value.context !== result.session.context) throw new ObsoleteRequestError();
    }

    /** Install the browser's shared session/recovery lifetime after hydration.
     * SSR gets disposal only; browser disposal retires generations before releasing
     * listeners and caches, including statuses retained by unmounted editors. */
    function start(): () => void {
        if (!browser) return () => {
            disposed = true;
            readsReady.value = false;
            stopQueryState();
            epoch.value++;
            stopLanguage();
            updates.dispose();
            pageOutcomes.value = new Set();
            queryClient.clear();
        };
        hydrated.value = true;
        let checking = false;

        /** Bootstrap precedes resource recovery so focus/reconnect cannot reuse an
         * old cookie context. The interval checks identity only; active resource
         * observers retain their own polling and server-imposed retry deadlines. */
        async function revalidate(refreshReads = true): Promise<void> {
            if (disposed || checking || document.visibilityState === 'hidden') return;
            checking = true;
            try {
                await refreshSession();
                // Reopening admission can already start stale observers. Join those
                // reads; ordinary focus recovery must not cancel and issue them twice.
                if (ready.value && refreshReads) await queryClient.refetchQueries({type: 'active',
                    predicate: query => canRetryRead(query.state.error)}, {cancelRefetch: false});
            } catch {
                // The bootstrap owner records only a current failure. A retired
                // request must never create another actor's warning here.
            } finally { checking = false; }
        }

        function visibilityChanged(): void {
            const resumed = document.visibilityState !== 'hidden';
            // Synchronous image/disclosure watchers can dispatch in this assignment.
            // Close admission before publishing visibility, then bootstrap normally.
            if (resumed) readsReady.value = false;
            visible.value = resumed;
            if (visible.value) void revalidate();
        }
        function identityHint(): void {
            clearIdentity();
            void revalidate();
        }
        const onFocus = () => { void revalidate(); };
        document.addEventListener('visibilitychange', visibilityChanged);
        window.addEventListener('focus', onFocus);
        window.addEventListener('online', onFocus);
        if ('BroadcastChannel' in window) {
            channel = new BroadcastChannel('surveyor-identity');
            channel.addEventListener('message', identityHint);
        }
        const timer = window.setInterval(() => { void revalidate(false); }, 30_000);
        return () => {
            disposed = true;
            readsReady.value = false;
            stopQueryState();
            // Retained operation statuses observe actor generations. Retire every
            // scope on application disposal too, so detached guards release even
            // when an unresolved HTTP operation never settles after page departure.
            epoch.value++;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', visibilityChanged);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('online', onFocus);
            channel?.close();
            stopLanguage();
            updates.dispose();
            identityGuards.clear();
            pageOutcomes.value = new Set();
            void queryClient.cancelQueries();
            queryClient.clear();
        };
    }

    return {api, bootstrap, browser, queryClient, session, epoch, locale, i18next, visible, hydrated, initialContentReady, ready, readsReady, sessionRead, notice, pageNotice, pageCompletion, personalLink, messages, pageTitle, updates,
        capture, initialDocumentFor, retireInitialDocument, registerPageOutcome, hasStaticPageOutcome, requiresClientInitialization,
        isCurrent, mayRead, mayObserve, refreshSession, acceptIdentity, registerIdentityGuard, mayChangeIdentity,
        changeLocale, invalidateIdentity, start};
}

/** Observe the actual router commitment, independently of which view happens to be mounted.
 * Server rendering and browser startup share this lifetime; failure and canceled guards do
 * not consume the initial document. The returned subscription belongs to that router. */
export function observeInitialDocument(context: PilotContext, router: Router): () => void {
    return router.afterEach(function retireCommittedDocument(to, _from, failure): void {
        if (!failure) context.retireInitialDocument(to.fullPath);
    });
}

/** Keep ordinary visible read recovery within roughly one minute. Server-imposed Retry-After
 * remains authoritative, including a longer delay; no independent timer may bypass it. */
export function refreshInterval(error: Error | null, failures: number, jitter: number): number | false {
    if (error instanceof ObsoleteRequestError) return false;
    if (error instanceof ApiFailure) {
        if (error.retryAt !== null) return Math.max(error.retryAt - Date.now(), 30_000);
        // Only a validated rejection can make a client/input error terminal. An
        // unusable proxy response retains ordinary bounded read recovery instead
        // of leaving a visible shared view permanently stale after its raw 4xx.
        if (isTerminalReadFailure(error)) return false;
    }
    return error ? Math.min(30_000 * 2 ** Math.min(failures, 1), 60_000) : 30_000 + jitter;
}

/** Focus and manual refresh share the same server-imposed backoff boundary as scheduled reads. */
export function canRetryRead(error: Error | null): boolean {
    return !(error instanceof ApiFailure) || error.retryAt === null || error.retryAt <= Date.now();
}
