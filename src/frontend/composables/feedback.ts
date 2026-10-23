import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue';
import type {ComputedRef, InjectionKey, Ref} from 'vue';
import {usePilot, canRetryRead} from '../app/context';
import {ApiFailure, InvalidInputError} from '../app/transport';
import type {LocalizationContext, MessageKey} from '../../types/LocalizationTypes';
import type {components} from '../../types/api/v1';
import type {PilotPlainMessageKey, PilotProblemPresentation} from '../../types/FrontendPilotUiTypes';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {formatCivilDate} from '../../modules/lib/civilDate';

// Preserve the existing transient-feedback interval in this frontend's owner.
// Native browser code remains an independent comparison implementation.
const transientNoticeLifetimeMs = 10_000;

/** Presentation scope supplied by the shell and overridden by the shared dialog.
 * It contains no command state: every receipt stays with its existing owner. */
export const noticeTargetKey: InjectionKey<Readonly<Ref<HTMLElement | null>>> = Symbol('pilot.notice-target');

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

/** Actual geometry covers hidden ancestors and CSS disclosure before expiry starts. */
export function isElementVisible(element: HTMLElement): boolean {
    return element.isConnected
        && !element.closest('[hidden], .d-none, [aria-hidden="true"]') && !!element.getClientRects().length;
}

/** Own the established transient-alert lifetime within the reactive renderer.
 * Hidden messages wait for disclosure, renewed receipts get a fresh interval, and
 * page-cache restoration restarts observation without accumulating timers/listeners. */
export function useTransientNotice(element: Ref<HTMLElement | null>, transient: () => boolean,
                                   renewal: () => unknown, dismiss: () => void): void {
    let mounted = false;
    let paused = false;
    let listening = false;
    let observer: MutationObserver | undefined;
    type NoticeLifetime = {element: HTMLElement; renewal: unknown; timer?: ReturnType<typeof setTimeout>};
    let lifetime: NoticeLifetime | undefined;

    function stopObservation(): void {
        observer?.disconnect();
        observer = undefined;
    }

    function cancelLifetime(): void {
        // This receipt owns its timer directly. Retiring it cannot cancel another
        // notice's interval or depend on a native DOM observer's global registry.
        if (lifetime?.timer !== undefined) clearTimeout(lifetime.timer);
        lifetime = undefined;
    }

    /** Bind DOM observation only to a mounted transient receipt. Re-rendering or
     * moving the same outcome must preserve its existing timer lifetime;
     * durable warnings and SSR never acquire a dismissal scheduler. */
    function observeNotice(): void {
        stopObservation();
        setLifecycleListeners(mounted && transient());
        // SSR and durable progress/warnings never schedule transient dismissals.
        if (!mounted || paused || !transient() || !element.value) {
            cancelLifetime();
            return;
        }

        // Reactive translation and movement into the shared host belong to the
        // same outcome. Only a new semantic receipt may renew its deadline.
        if (lifetime && (lifetime.element !== element.value || !Object.is(lifetime.renewal, renewal()))) cancelLifetime();
        // Vue owns this node and its ancestors, including disclosure, relocation
        // and the receipt's timer. No other frontend can remove or renew it.
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
            started.timer = setTimeout(expireReceipt, transientNoticeLifetimeMs);

            function expireReceipt(): void {
                // Retain the expired receipt until renewal/retirement, so a later
                // DOM change cannot schedule the same completed outcome again.
                started.timer = undefined;
                if (mounted && !paused && lifetime === started && transient()
                    && Object.is(started.renewal, renewal())) dismiss();
            }
        }
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
    watch(() => [element.value, transient(), renewal()], observeNotice, {flush: 'post'});
    onMounted(() => {
        mounted = true;
        observeNotice();
    });
    onBeforeUnmount(() => {
        mounted = false;
        stopObservation();
        cancelLifetime();
        setLifecycleListeners(false);
    });
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
    const descriptor = shallowRef<MessageKey | ApiFailure | InvalidInputError | null>(null);
    const transientError = ref(true);
    const errorRenewal = ref(0);
    const feedbackKind = ref<'danger' | 'info' | 'success'>('danger');

    // Translate the retained semantic descriptor at render time. Locale changes
    // alter text only; setError remains the owner of a new feedback receipt and
    // its transient/durable lifetime, including repeated identical rejections.
    const error = computed(() => {
        const value = descriptor.value;
        if (value === null) return null;
        if (typeof value === 'string') return messages.value.t(value);
        if (value instanceof InvalidInputError) return inputFailureMessage(messages.value, value);
        return value.problem ? problemMessage(messages.value, value.problem, presentation) : value.message;
    });
    /** The operation owns error lifetime; read/uncertainty failures are durable,
     * while known command rejection remains transient. Placement belongs to the renderer. */
    function setError(value: MessageKey | ApiFailure | InvalidInputError | null, lifetime: 'transient' | 'durable' = 'transient'): void {
        descriptor.value = value;
        // Repeated validation/no-op feedback can have identical text. Its new
        // receipt still starts a complete native dismissal interval.
        errorRenewal.value++;
        transientError.value = lifetime === 'transient';
        feedbackKind.value = 'danger';
    }

    /** Native form no-ops are information, with the same localized identity and
     * transient lifetime as other confirmed form feedback. They never imply a write. */
    function setInformation(value: PilotPlainMessageKey): void {
        setError(value);
        feedbackKind.value = 'info';
    }

    /** Confirmed inline property saves share the native transient receipt contract.
     * Confirmation is supplied by the operation; this helper never infers a saved write. */
    function setSuccess(value: PilotPlainMessageKey): void {
        setError(value);
        feedbackKind.value = 'success';
    }

    function clearRecoveredError(value: MessageKey | ApiFailure): void {
        // A successful read must not erase another operation's validation or conflict.
        if (descriptor.value === value) setError(null);
    }
    return {error, transientError, errorRenewal, feedbackKind, setError, setInformation, setSuccess, clearRecoveredError};
}

/** Explain only safe generated rule metadata using the feature's visible labels.
 * Translation happens at render time so a rejected draft survives language changes
 * with the same receipt, original controls, selected file and error identity. */
function inputFailureMessage(messages: LocalizationContext, error: InvalidInputError): string {
    if (!error.diagnostic) return messages.t(error.messageKey ?? 'api:errors.VALIDATION_FAILED');
    const {field, rule, limit, type} = error.diagnostic;
    let label = messages.t(field.label);
    if (field.row) {
        const row = messages.t(field.row.label);
        label = field.row.day
            ? messages.t('validation.dayRowField', {day: formatCivilDate(field.row.day, messages.locale) ?? field.row.day,
                row, number: field.row.number, field: label})
            : messages.t('validation.rowField', {row, number: field.row.number, field: label});
    }

    // Bounds come directly from the generated failure, never another local copy
    // of a schema. Unknown future rules still identify the field to correct.
    let reason = messages.t('validation.invalid');
    if (rule === 'maxLength' && limit !== undefined) reason = messages.t('validation.maxLength', {limit});
    else if (rule === 'minLength' && limit === 1) reason = messages.t('validation.required');
    else if (rule === 'minLength' && limit !== undefined) reason = messages.t('validation.minLength', {limit});
    else if (rule === 'maximum' && limit !== undefined) reason = messages.t('validation.maximum', {limit});
    else if (rule === 'minimum' && limit !== undefined) reason = messages.t('validation.minimum', {limit});
    else if (rule === 'minItems' && limit !== undefined) reason = messages.t('validation.minItems', {limit});
    else if (rule === 'required') reason = messages.t('validation.required');
    else if (rule === 'nonBlank') reason = messages.t('validation.nonBlank');
    else if (rule === 'type' && type === 'integer') reason = messages.t('validation.integer');
    else if (rule === 'format' || rule === 'pattern' || rule === 'enum') reason = messages.t('validation.invalid');
    return messages.t('validation.fieldError', {field: label, reason});
}
