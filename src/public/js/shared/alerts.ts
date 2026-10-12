/**
 * Shared alert/notification system
 * Provides consistent in-page alerts across the application
 */

const ALERT_LIFETIME_MS = 10_000;
const alertSelector = '.alert, [role="alert"]';
const dismissals = new Map<HTMLElement, {timer: ReturnType<typeof setTimeout>; dismiss: () => void}>();

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

/** Cover server flashes and alerts inserted or renewed by any page module. */
export function initAlertDismissal(root: Document | HTMLElement = document): () => void {
    const refresh = (element: HTMLElement, renew = true) => {
        if (!element.isConnected || !isTransientAlert(element)
            || element.closest('[hidden], .d-none, [aria-hidden="true"]') || !element.getClientRects().length) {
            cancelAlertDismissal(element);
            return;
        }
        if (renew || !dismissals.has(element)) scheduleAlertDismissal(element);
    };
    const collect = (node: Node, candidates: Set<HTMLElement>, descendants = false) => {
        const element = node instanceof HTMLElement ? node : node.parentElement;
        if (!element) return;
        const ancestor = element.closest<HTMLElement>(alertSelector);
        if (ancestor) candidates.add(ancestor);
        if (descendants) element.querySelectorAll<HTMLElement>(alertSelector).forEach(alert => candidates.add(alert));
        // A region that just changed from alert to status must cancel its old timer as well.
        if (dismissals.has(element)) candidates.add(element);
    };
    root.querySelectorAll<HTMLElement>(alertSelector).forEach(element => refresh(element));
    const observer = new MutationObserver(records => {
        const candidates = new Set<HTMLElement>();
        for (const record of records) {
            collect(record.target, candidates);
            for (const added of record.addedNodes) collect(added, candidates, true);
            if (record.type === 'attributes' && record.target instanceof HTMLElement) {
                record.target.querySelectorAll<HTMLElement>(alertSelector).forEach(element => refresh(element, false));
            }
        }
        for (const element of dismissals.keys()) {
            if (!element.isConnected) cancelAlertDismissal(element);
        }
        candidates.forEach(element => refresh(element));
    });
    observer.observe(root, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'hidden', 'role', 'aria-hidden'],
    });
    return () => {
        observer.disconnect();
        for (const element of dismissals.keys()) {
            if (root.contains(element) || !element.isConnected) cancelAlertDismissal(element);
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
