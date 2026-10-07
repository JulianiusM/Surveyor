import {computed, inject, ref, shallowRef} from 'vue';
import type {InjectionKey} from 'vue';
import {QueryClient} from '@tanstack/vue-query';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import type {PilotContext, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {Locale, MessageKey} from '../../types/LocalizationTypes';
import {createTranslator} from '../../modules/localization/translator';
import {ApiFailure, ObsoleteRequestError, PilotApi} from './api';

export const pilotContextKey: InjectionKey<PilotContext> = Symbol('Surveyor pilot context');

export function usePilot(): PilotContext {
    const context = inject(pilotContextKey);
    if (!context) throw new Error('The pilot application context is missing.');
    return context;
}

/** Request-local on the server, application-local in the browser; never a module singleton. */
export function createPilotContext(bootstrap: FrontendPilotBootstrap, browser: boolean,
                                   requestFetch?: typeof fetch): PilotContext {
    const session = shallowRef(bootstrap.session);
    const epoch = ref(0);
    const locale = ref<Locale>(createTranslator(bootstrap.session.locale).locale);
    const visible = ref(browser && document.visibilityState !== 'hidden');
    const ready = ref(true);
    const hydrated = ref(false);
    const notice = ref<MessageKey | null>(null);
    const personalLink = ref<string | null>(null);
    const messages = computed(() => createTranslator(locale.value));
    const queryClient = new QueryClient({defaultOptions: {
        queries: {
            staleTime: 15_000,
            gcTime: 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: (failures, error) => !(error instanceof ObsoleteRequestError)
                && (!(error instanceof ApiFailure) || (error.status >= 500 && !error.retryAfter)) && failures < 2,
            retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
        },
        mutations: {retry: false},
    }});
    let bootstrapRequest: Promise<void> | undefined;
    let localeRequest: Promise<void> | undefined;
    let desiredLocale: Locale | null = null;
    let channel: BroadcastChannel | undefined;
    let disposed = false;
    const identityGuards = new Set<() => boolean>();

    /** Explicit cookie-changing controls must pass the same draft/pending checks as navigation.
     * External identity changes remain authoritative and clear the previous identity immediately. */
    function registerIdentityGuard(guard: () => boolean): () => void {
        identityGuards.add(guard);
        return () => { identityGuards.delete(guard); };
    }

    function mayChangeIdentity(): boolean {
        return [...identityGuards].every(guard => guard());
    }

    function capture(): PilotRequestScope {
        return {context: session.value.context, csrfToken: session.value.csrfToken,
            locale: locale.value, epoch: epoch.value};
    }

    function isCurrent(scope: PilotRequestScope, checkLocale = false): boolean {
        return !disposed && ready.value && scope.epoch === epoch.value && scope.context === session.value.context
            && (!checkLocale || scope.locale === locale.value);
    }

    function clearIdentity(): void {
        personalLink.value = null;
        ready.value = false;
        epoch.value++;
        void queryClient.cancelQueries();
        queryClient.clear();
        notice.value = 'state.sessionChanged';
    }

    function invalidateIdentity(): void {
        if (ready.value) clearIdentity();
        void refreshSession().catch(() => { /* Keep the private view closed until bootstrap succeeds. */ });
    }

    const api = new PilotApi(isCurrent, invalidateIdentity, requestFetch);

    /** One bootstrap gate precedes focus/reconnect reads, preventing automatic fetches with an old cookie scope. */
    function refreshSession(): Promise<void> {
        if (bootstrapRequest) return bootstrapRequest;
        const generation = epoch.value;
        bootstrapRequest = api.bootstrap().then(current => {
            if (disposed || generation !== epoch.value) return;
            if (current.context !== session.value.context) clearIdentity();
            session.value = current;
            locale.value = createTranslator(current.locale).locale;
            ready.value = true;
        }).finally(() => {
            bootstrapRequest = undefined;
            // An identity hint can obsolete an already pending bootstrap. Its result is ignored,
            // but a second check must follow rather than leaving recovery stalled until the next timer.
            if (!disposed && !ready.value && generation !== epoch.value) {
                queueMicrotask(() => { void refreshSession().catch(() => {}); });
            }
        });
        return bootstrapRequest;
    }

    function changeLocale(nextLocale: Locale): Promise<void> {
        if (!ready.value) return Promise.resolve();
        desiredLocale = nextLocale;
        if (localeRequest) return localeRequest;
        // Serialize cookie-writing commands, coalescing clicks to the latest desired preference.
        // A response guard alone cannot prevent an older HTTP response overwriting the newer cookie.
        localeRequest = (async () => {
            while (desiredLocale !== null) {
                const requested = desiredLocale;
                desiredLocale = null;
                if (requested === locale.value) continue;
                const scope = capture();
                const current = await api.setLocale(requested, scope);
                if (!isCurrent(scope)) { desiredLocale = null; return; }
                // Locale does not change actor identity: keep dirty editors and their focus mounted.
                session.value = current;
                locale.value = createTranslator(current.locale).locale;
                await queryClient.cancelQueries();
                await queryClient.invalidateQueries();
            }
        })().finally(() => { localeRequest = undefined; });
        return localeRequest;
    }

    /** Bootstrap remains authoritative after a cookie-changing command. A private guest link
     * is shown only when the confirmed identity is still current, and never survives a switch. */
    async function acceptIdentity(result: import('../../types/api/v1').components['schemas']['IdentityResult']): Promise<void> {
        // A focus/bootstrap read may have captured the cookie before the command changed it.
        // Retire that generation and drain its promise before asking for authoritative new state.
        // Reusing it would incorrectly compare a successful login to the old anonymous context.
        clearIdentity();
        if (bootstrapRequest) await bootstrapRequest.catch(() => {});
        await refreshSession();
        if (session.value.context !== result.session.context) throw new ObsoleteRequestError();
        personalLink.value = result.personalLink;
        notice.value = null;
        channel?.postMessage({kind: 'identity'});
    }

    function start(): () => void {
        if (!browser) return () => queryClient.clear();
        hydrated.value = true;
        let checking = false;
        async function revalidate(refreshReads = true): Promise<void> {
            if (checking || document.visibilityState === 'hidden') return;
            checking = true;
            try {
                await refreshSession();
                if (ready.value && refreshReads) await queryClient.refetchQueries({type: 'active',
                    predicate: query => canRetryRead(query.state.error)});
            } catch {
                // Last confirmed data stays visible on a temporary read failure. A known context loss
                // already set ready=false and cleared private state before reaching this branch.
                notice.value = 'state.stale';
            } finally { checking = false; }
        }
        function visibilityChanged(): void {
            visible.value = document.visibilityState !== 'hidden';
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
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', visibilityChanged);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('online', onFocus);
            channel?.close();
            identityGuards.clear();
            void queryClient.cancelQueries();
            queryClient.clear();
        };
    }

    return {api, bootstrap, browser, queryClient, session, epoch, locale, visible, hydrated, ready, notice, personalLink, messages,
        capture, isCurrent, refreshSession, acceptIdentity, registerIdentityGuard, mayChangeIdentity,
        changeLocale, invalidateIdentity, start};
}

/** Retry-After applies to interval retries too, rather than creating an independent hammering timer. */
export function refreshInterval(error: Error | null, failures: number, jitter: number): number | false {
    if (error instanceof ObsoleteRequestError) return false;
    if (error instanceof ApiFailure) {
        if (error.retryAt !== null) return Math.max(error.retryAt - Date.now(), 30_000);
        if (error.status < 500 && error.status !== 429) return false;
    }
    return error ? Math.min(30_000 * 2 ** Math.min(failures, 2), 120_000) : 30_000 + jitter;
}

/** Focus and manual refresh share the same server-imposed backoff boundary as scheduled reads. */
export function canRetryRead(error: Error | null): boolean {
    return !(error instanceof ApiFailure) || error.retryAt === null || error.retryAt <= Date.now();
}
