import {computed, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, watch} from 'vue';
import type {ComputedRef, Ref} from 'vue';
import {usePilot, canRetryRead} from '../app/context';
import {ApiFailure} from '../app/transport';
import type {LocalizationContext, MessageKey} from '../../types/LocalizationTypes';
import type {components} from '../../types/api/v1';
import type {PilotPlainMessageKey, PilotProblemPresentation} from '../../types/FrontendPilotUiTypes';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {scheduleAlertDismissal} from '../../public/js/shared/alerts';

/** Make the shared server cooldown reactive even when a failed read has no polling observer.
 * The wakeup changes availability only; the caller owns explicit retry and request scope. */
export function useReadRetry(error: () => Error | null) {
    const deadlineReady = ref(canRetryRead(error()));
    const available = computed(() => deadlineReady.value && canRetryRead(error()));
    let mounted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Replace the previous deadline whenever the owning read clears or changes its error. */
    function scheduleDeadline(): void {
        clearDeadline();
        const failure = error();
        deadlineReady.value = canRetryRead(failure);
        // SSR never creates timers. Mounted clients wake once at the server deadline,
        // without starting a GET or inventing a different backoff policy.
        if (mounted && !deadlineReady.value && failure instanceof ApiFailure && failure.retryAt !== null) {
            // Browser timers use a signed 32-bit delay. A long server deadline must
            // remain closed and wake in bounded steps instead of overflowing into a loop.
            const delay = Math.min(2_147_483_647, Math.max(0, failure.retryAt - Date.now()) + 1);
            timer = setTimeout(scheduleDeadline, delay);
        }
    }

    function clearDeadline(): void {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    }

    watch(error, scheduleDeadline, {flush: 'sync'});
    onMounted(() => { mounted = true; scheduleDeadline(); });
    onBeforeUnmount(() => { mounted = false; clearDeadline(); });
    return available;
}

/** Present the same server deadline that already controls the owning read's Retry.
 * The existing availability timer retires this projection at expiry; this helper
 * starts no timer, changes no error state and cannot initiate another request. */
export function useReadRetryAt(error: () => Error | null, available: Readonly<Ref<boolean>>): ComputedRef<number | undefined> {
    return computed(() => {
        const failure = error();
        return !available.value && failure instanceof ApiFailure && failure.retryAt !== null
            ? failure.retryAt : undefined;
    });
}

/** Actual geometry covers hidden ancestors and CSS disclosure. The pilot's
 * reactive notices and section targets share this check without changing the
 * native alert observer or its DOM-owned lifecycle. */
export function isElementVisible(element: HTMLElement): boolean {
    return element.isConnected
        && !element.closest('[hidden], .d-none, [aria-hidden="true"]') && !!element.getClientRects().length;
}

/** Bind the native transient-alert lifetime to a reactive renderer's state owner.
 * Hidden messages wait for disclosure, renewed receipts get a fresh interval, and
 * page-cache restoration restarts observation without accumulating timers/listeners. */
export function useTransientNotice(element: Ref<HTMLElement | null>, transient: () => boolean,
                                   renewal: () => unknown, dismiss: () => void, inline?: () => boolean): void {
    let mounted = false;
    let paused = false;
    let listening = false;
    let observer: MutationObserver | undefined;
    type NoticeLifetime = {element: HTMLElement; renewal: unknown; cancel?: () => void};
    let lifetime: NoticeLifetime | undefined;
    let presented: {element: HTMLElement; renewal: unknown} | undefined;

    function stopObservation(): void {
        observer?.disconnect();
        observer = undefined;
    }

    function cancelLifetime(): void {
        lifetime?.cancel?.();
        lifetime = undefined;
    }

    /** Bind DOM observation only to a mounted transient receipt. Re-rendering or
     * moving the same outcome must preserve its existing timer/focus lifetime;
     * durable warnings and SSR never acquire a dismissal scheduler. */
    function observeNotice(): void {
        stopObservation();
        setLifecycleListeners(mounted && transient());
        // SSR and durable progress/warnings never schedule transient dismissals.
        if (!mounted || paused || !transient() || !element.value) {
            cancelLifetime();
            return;
        }

        // Reactive translation and moving between a retired section and its live
        // fallback belong to the same outcome. Only the semantic receipt watcher
        // may renew its deadline or inline focus; explicit lifecycle cleanup stops it.
        if (lifetime && (lifetime.element !== element.value || !Object.is(lifetime.renewal, renewal()))) cancelLifetime();
        // Vue owns this node and its ancestors. The unchanged native observer is
        // reserved for native documents; it cannot remove or renew a Vue receipt.
        // Observe disclosure and relocation, while the shared existing scheduler
        // remains the sole owner of the ten-second interval.
        observer = new MutationObserver(refreshVisibility);
        observer.observe(document.body, {subtree: true, childList: true,
            attributes: true, attributeFilter: ['class', 'style', 'hidden', 'role', 'aria-hidden']});
        refreshVisibility();
    }

    /** A hidden receipt has no timer until its first disclosure. Once shown, its
     * deadline survives translation and relocation; an expired receipt remains
     * recorded until its owner clears/renews it, preventing a DOM change from
     * scheduling it again before Vue has applied dismissal. */
    function refreshVisibility(): void {
        const target = element.value;
        if (!mounted || paused || !transient() || !target || !isElementVisible(target)) return;
        if (!lifetime) {
            const started: NoticeLifetime = {element: target, renewal: renewal()};
            lifetime = started;
            started.cancel = scheduleAlertDismissal(target, expireReceipt);

            function expireReceipt(): void {
                if (mounted && !paused && lifetime === started && transient()
                    && Object.is(started.renewal, renewal())) dismiss();
            }
        }
        presentInlineNotice(target);
    }

    /** Native inline feedback focuses the alert and scrolls its initiating host.
     * A disclosure can make the same receipt visible later; unrelated DOM mutations,
     * locale changes and page-cache restoration must not repeatedly steal focus. */
    function presentInlineNotice(target: HTMLElement): void {
        if (!mounted || paused || !transient() || !inline?.() || !isElementVisible(target)) return;
        const receipt = renewal();
        const host = target.closest<HTMLElement>('[data-command-feedback], [data-dialog-feedback], #liveAlerts')
            ?? target.parentElement ?? target;
        if (presented?.element === target && Object.is(presented.renewal, receipt)) return;
        presented = {element: target, renewal: receipt};
        target.focus();
        host.scrollIntoView(true);
    }

    /** Own one page-cache pause/resume subscription while transient feedback is
     * active. Removing it with the receipt prevents later browser lifecycle events
     * from restarting a timer belonging to disposed or durable presentation. */
    function setLifecycleListeners(enabled: boolean): void {
        if (enabled === listening) return;
        listening = enabled;
        if (enabled) {
            window.addEventListener('pagehide', pauseNotice);
            window.addEventListener('pageshow', resumeNotice);
        } else {
            window.removeEventListener('pagehide', pauseNotice);
            window.removeEventListener('pageshow', resumeNotice);
        }
    }

    function pauseNotice(): void {
        paused = true;
        stopObservation();
        cancelLifetime();
    }

    function resumeNotice(event: PageTransitionEvent): void {
        if (!event.persisted) return;
        paused = false;
        observeNotice();
    }

    // A repeated outcome can have identical text. Its owning receipt still renews
    // feedback, independently of unrelated changes or another component's message.
    watch(() => [element.value, transient(), renewal(), inline?.()], observeNotice, {flush: 'post'});
    onMounted(() => {
        mounted = true;
        observeNotice();
    });
    // A receipt can move from a removed section to its still-mounted fallback.
    // Relocation keeps an already presented receipt's focus/lifetime. A receipt
    // whose first target retired before it rendered still presents once in fallback.
    onUpdated(function presentMovedInlineNotice(): void {
        if (element.value) presentInlineNotice(element.value);
    });
    onBeforeUnmount(() => {
        mounted = false;
        stopObservation();
        cancelLifetime();
        setLifecycleListeners(false);
    });
}

/** Capture the native inline feedback host before an event's currentTarget expires.
 * Section commands stay beside their own controls; commands without a section use
 * the containing modal's fallback, then the established page-level live-alert host. */
export function inlineFeedbackTarget(initiator?: Event | Element): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const source = initiator instanceof Event ? initiator.currentTarget : initiator;
    if (source instanceof Element) {
        const section = source.closest('[data-entity-section]');
        const feedback = section?.querySelector<HTMLElement>('[data-command-feedback]');
        if (feedback) return feedback;
        const dialog = source.closest('[role="dialog"], .modal');
        const fallback = dialog?.querySelector<HTMLElement>('[data-dialog-feedback]');
        if (fallback) return fallback;
    }
    return document.getElementById('liveAlerts');
}

/** Known contract Problems retain message identity across language changes. A safe detail
 * from a future server remains authoritative text; never guess its key or parameters. */
export function problemMessage(messages: LocalizationContext,
    problem: components['schemas']['Problem'] | components['schemas']['SafeProblemDetails'],
    presentation?: PilotProblemPresentation): string {
    if (!validateProblem(problem)) return problem.detail;
    // Structural validation precedes operation-specific selection. A future problem
    // must never acquire known behavior just because its unvalidated code resembles one.
    const key = presentation?.(problem);
    return key ? messages.t(key) : messages.t(problem.messageKey, problem.params);
}

/** Read-state warnings explain retained/cold data separately from the server's issue.
 * Only transport-validated details are publishable; HTML, malformed payloads and
 * network exception text never become user diagnostics or machine policy. */
export function readFailureMessage(messages: LocalizationContext, error?: Error | null): string | null {
    if (!(error instanceof ApiFailure)) return null;
    return error.problem ? problemMessage(messages, error.problem) : error.safeDetail;
}

/** Keep message identity, rather than translated text, so a mounted form's validation follows
 * language changes. Only validated known Problems drive typed behavior; safe future details remain text. */
export function useFeedbackError(presentation?: PilotProblemPresentation) {
    const {messages} = usePilot();
    const descriptor = shallowRef<MessageKey | ApiFailure | null>(null);
    const transientError = ref(true);
    const errorRenewal = ref(0);
    const errorPresentation = ref<'flash' | 'inline'>('flash');
    const feedbackKind = ref<'danger' | 'info' | 'success'>('danger');

    // Translate the retained semantic descriptor at render time. Locale changes
    // alter text only; setError remains the owner of a new feedback receipt and
    // its transient/durable lifetime, including repeated identical rejections.
    const error = computed(() => {
        const value = descriptor.value;
        if (value === null) return null;
        if (typeof value === 'string') return messages.value.t(value);
        return value.problem ? problemMessage(messages.value, value.problem, presentation) : value.message;
    });
    /** The operation owns error lifetime; read/uncertainty failures are durable,
     * while known command rejection follows the native transient flash behavior. */
    function setError(value: MessageKey | ApiFailure | null, lifetime: 'transient' | 'durable' = 'transient',
                      presentation: 'flash' | 'inline' = 'flash'): void {
        descriptor.value = value;
        // Repeated validation/no-op feedback can have identical text. Its new
        // receipt still starts a complete native dismissal interval.
        errorRenewal.value++;
        transientError.value = lifetime === 'transient';
        // Client inline validation and server POST flashes share message state but
        // retain their native presentation. Durable failures never become dismissible.
        errorPresentation.value = presentation;
        feedbackKind.value = 'danger';
    }

    /** Native form no-ops are information, with the same localized identity and
     * transient lifetime as other confirmed form feedback. They never imply a write. */
    function setInformation(value: PilotPlainMessageKey, presentation: 'flash' | 'inline' = 'flash'): void {
        setError(value, 'transient', presentation);
        feedbackKind.value = 'info';
    }

    /** Confirmed inline property saves share the native transient receipt contract.
     * Confirmation is supplied by the operation; this helper never infers a saved write. */
    function setSuccess(value: PilotPlainMessageKey, presentation: 'flash' | 'inline' = 'inline'): void {
        setError(value, 'transient', presentation);
        feedbackKind.value = 'success';
    }

    function clearRecoveredError(value: MessageKey | ApiFailure): void {
        // A successful read must not erase another operation's validation or conflict.
        if (descriptor.value === value) setError(null);
    }
    return {error, transientError, errorRenewal, errorPresentation, feedbackKind, setError, setInformation, setSuccess, clearRecoveredError};
}
