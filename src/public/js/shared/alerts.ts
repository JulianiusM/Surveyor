/**
 * Shared alert/notification system
 * Provides consistent in-page alerts across the application
 */

import type {AlertObservationPolicy} from '../../../types/AlertTypes';

const ALERT_LIFETIME_MS = 10_000;
const alertSelector = '.alert, [role="alert"]';
const dismissals = new Map<HTMLElement, {
    timer: ReturnType<typeof setTimeout>;
    dismiss: () => void;
    observer?: symbol;
    preserveStartedLifetime?: boolean;
}>();

export function cancelAlertDismissal(element: HTMLElement): void {
    const pending = dismissals.get(element);
    if (pending) clearTimeout(pending.timer);
    dismissals.delete(element);
}

/** Renew a transient message's ten-second lifetime. Reusable regions can provide a clearing callback. */
export function scheduleAlertDismissal(element: HTMLElement, onDismiss?: () => void): () => void {
    const dismiss = onDismiss ?? dismissals.get(element)?.dismiss ?? (() => element.remove());
    cancelAlertDismissal(element);
    const pending = {
        timer: setTimeout(() => {
            dismissals.delete(element);
            dismiss();
        }, ALERT_LIFETIME_MS),
        dismiss,
    };
    dismissals.set(element, pending);
    return () => {
        if (dismissals.get(element) === pending) cancelAlertDismissal(element);
    };
}

function isTransientAlert(element: HTMLElement): boolean {
    return element.matches(alertSelector)
        && element.getAttribute('role') !== 'status'
        && !element.classList.contains('status-notice');
}

/** Actual geometry covers hidden ancestors and CSS disclosure. Feedback timers,
 * inline focus and reactive section targets all use this same visibility boundary. */
export function isElementVisible(element: HTMLElement): boolean {
    return element.isConnected
        && !element.closest('[hidden], .d-none, [aria-hidden="true"]') && !!element.getClientRects().length;
}

/** Hidden/disconnected alerts wait for disclosure without receiving focus or a timer. */
export function isVisibleTransientAlert(element: HTMLElement): boolean {
    return isTransientAlert(element) && isElementVisible(element);
}

/** Cover server flashes and alerts inserted or renewed by any page module.
 * Reactive inline callers can present focus after the same visibility check; ordinary
 * server flashes keep their existing lifetime without acquiring inline focus behavior.
 * A reactive receipt owner can disable content renewal: translated text changes the
 * presentation of an existing outcome rather than starting another dismissal interval.
 * Once presented, that receipt can retain its original deadline through DOM relocation;
 * an initially hidden message still waits for its first visible presentation. */
export function initAlertDismissal(root: Document | HTMLElement = document,
                                   policy: AlertObservationPolicy = {}): () => void {
    const owner = Symbol('alert-observer');

    function refresh(element: HTMLElement, renew = true): void {
        const pending = dismissals.get(element);
        // A document-level native observer can see the same reactive alert. It
        // must not renew, cancel or replace that receipt owner's clearing callback.
        if (pending?.preserveStartedLifetime && pending.observer !== owner) return;
        if (!isTransientAlert(element)) {
            cancelAlertDismissal(element);
            return;
        }
        if (!isElementVisible(element)) {
            // Teleport can temporarily hide/detach a previously shown receipt.
            // Keep its started deadline; the first unseen receipt has no timer.
            if (!pending?.preserveStartedLifetime) cancelAlertDismissal(element);
            return;
        }
        // DOM-rendered native alerts remove themselves. Reactive renderers instead
        // clear their owning state. Timer policy belongs to the observing owner,
        // while visibility and the ten-second interval have one implementation.
        if (renew || !dismissals.has(element)) {
            const onDismiss = policy.onDismiss;
            scheduleAlertDismissal(element, onDismiss ? () => onDismiss(element) : undefined);
            const started = dismissals.get(element)!;
            started.observer = owner;
            started.preserveStartedLifetime = policy.preserveStartedLifetime ?? false;
        }
        policy.onVisible?.(element);
    }

    function collect(node: Node, candidates: Set<HTMLElement>, descendants = false): void {
        const element = node instanceof HTMLElement ? node : node.parentElement;
        if (!element) return;
        const ancestor = element.closest<HTMLElement>(alertSelector);
        if (ancestor) candidates.add(ancestor);
        if (descendants) {
            for (const alert of element.querySelectorAll<HTMLElement>(alertSelector)) candidates.add(alert);
        }
        // A region that just changed from alert to status must cancel its old timer as well.
        if (dismissals.has(element)) candidates.add(element);
    }

    // A component can own the alert element itself, rather than an enclosing region.
    if (root instanceof HTMLElement && root.matches(alertSelector)) refresh(root);
    for (const element of root.querySelectorAll<HTMLElement>(alertSelector)) refresh(element);
    const observer = new MutationObserver(handleMutations);

    /** Native content renews its alert. Receipt-owned content and disclosure only
     * start a missing lifetime; the owning receipt explicitly renews an existing one. */
    function handleMutations(records: MutationRecord[]): void {
        const candidates = new Set<HTMLElement>();
        for (const record of records) {
            // A tab/dialog can disclose a mounted component by changing an ancestor.
            // Visibility changes start missing timers without renewing visible messages.
            if (root instanceof HTMLElement && record.target instanceof HTMLElement
                && record.target !== root && record.target.contains(root)) {
                refresh(root, false);
                continue;
            }
            collect(record.target, candidates);
            for (const added of record.addedNodes) collect(added, candidates, true);
            if (record.type === 'attributes' && record.target instanceof HTMLElement) {
                for (const element of record.target.querySelectorAll<HTMLElement>(alertSelector)) refresh(element, false);
            }
        }
        for (const [element, pending] of dismissals) {
            // Other observers can run during a reactive renderer's relocation.
            // Only its explicit receipt/lifecycle cleanup may retire that timer.
            if (!element.isConnected && !pending.preserveStartedLifetime) cancelAlertDismissal(element);
        }
        for (const element of candidates) refresh(element, policy.renewContent ?? true);
    }

    const options: MutationObserverInit = {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'role', 'aria-hidden'],
    };
    observer.observe(root, options);
    if (root instanceof HTMLElement) {
        for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
            observer.observe(ancestor, {attributes: true, attributeFilter: options.attributeFilter});
        }
    }
    return function stopAlertObservation(): void {
        observer.disconnect();
        for (const [element, pending] of dismissals) {
            // Explicit owner cleanup still cancels a relocated receipt on pagehide
            // or unmount. A separate document observer must leave that owner intact.
            if (pending.observer === owner || (!pending.preserveStartedLifetime
                && (root.contains(element) || !element.isConnected))) cancelAlertDismissal(element);
        }
    };
}

/**
 * Show an inline alert message
 * @param status Alert type (success, info, error)
 * @param message Message to display
 * @param container Optional container element (defaults to #liveAlerts)
 */
export function showInlineAlert(
    status: 'success' | 'info' | 'error',
    message: string,
    container?: HTMLElement
): void {
    const alertBox = container || document.getElementById('liveAlerts');
    if (!alertBox) return;

    const cls = {
        success: 'alert-success',
        info: 'alert-info',
        error: 'alert-danger',
    }[status] || 'alert-info';

    const alert = document.createElement('div');
    alert.classList.add('alert', cls, 'alert-dismissible', 'fade', 'show');
    alert.role = 'alert';
    alert.tabIndex = -1;
    alert.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close';
    close.setAttribute('data-bs-dismiss', 'alert');
    close.setAttribute('aria-label', 'Dismiss notification');
    close.addEventListener('click', () => cancelAlertDismissal(alert), {once: true});
    alert.appendChild(close);

    alertBox.appendChild(alert);
    scheduleAlertDismissal(alert);
    alert.focus();
    alertBox.scrollIntoView(true)
}
