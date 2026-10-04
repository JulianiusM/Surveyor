/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Event management functionality
 * Handles event registration, participant management, and invoice operations
 */

import {invoiceText} from '../../modules/invoice/wording';
import {formatInvoiceMoney, invoiceBalanceCaption, invoicePresentation, invoiceSettlementRows, presentInvoiceSettlement} from '../../modules/invoice/presentation';
import {formatISOInTimeZone} from './core/formatting';
import type {InvoiceCalculationDisplay, InvoiceCalculationFormula, InvoiceCalculationMetric, InvoiceCalculationShare,
    InvoiceLabels, InvoiceMoneyMetric, InvoiceShareBreakdownData, InvoiceTextKey, PoolCalculationPreview} from '../../types/InvoicePoolTypes';
import {get, post} from './core/http';
import {initEntityLists, setCurrentNavLocation} from './core/navigation';
import {getPerms, loadPerms, requireEntityPerm} from './core/permissions';
import {initEntityOverview} from "./modules/entity-cards-overview";
import {initEntityHeader} from "./modules/entity-header";
import {bindInvoiceSubmission} from './modules/invoice-submission';
import {initTakeoverOverviews} from './modules/invoice-takeovers';
import {cancelAlertDismissal, showInlineAlert} from './shared/alerts';
import {formatDuration, parseJsonScript, reloadAfterDelay, updateToLocalString} from './shared/ui-helpers';

/**
 * Reload delay constant
 */
const RELOAD_DELAY_MS = 120;

// Module-level variables - initialized in init()
let participantsData: any[] = [];
let registrationData: { id: number } | null = null;
let dataInitialized = false;
let invoiceLabels: InvoiceLabels | null = null;

interface InvoiceConfirmation {
    opener: HTMLButtonElement;
    confirmed: boolean;
    resolve: (confirmed: boolean) => void;
}
let invoiceConfirmation: InvoiceConfirmation | undefined;

/** Review only: the request and its existing payload remain with the caller until this resolves true. */
export function requestInvoiceConfirmation(subject: string, description: string, action: string, opener: HTMLButtonElement): Promise<boolean> {
    // A single gate owns confirmation state. Missing markup or an in-flight modal transition cancels safely.
    const modal = document.getElementById("invoiceCommandConfirmModal");
    const source = opener.closest<HTMLElement>('.modal');
    if (!modal || !window.bootstrap?.Modal || invoiceConfirmation || invoiceDialogTransitions.has(modal)
        || (source && invoiceDialogTransitions.has(source))) return Promise.resolve(false);
    const subjectElement = modal.querySelector<HTMLElement>('[data-invoice-command-subject]');
    const descriptionElement = modal.querySelector<HTMLElement>('[data-invoice-command-description]');
    const confirm = modal.querySelector<HTMLButtonElement>('[data-invoice-command-confirm]');
    if (!subjectElement || !descriptionElement || !confirm) return Promise.resolve(false);
    // Render the reviewed command as text; the caller retains its existing API payload until acknowledgement.
    subjectElement.textContent = subject;
    descriptionElement.textContent = description;
    confirm.textContent = action;
    /** Capture a cancellation-default review without invoking the caller's command. */
    function review(resolve: (confirmed: boolean) => void): void {
        invoiceConfirmation = {opener, confirmed: false, resolve};
        showInvoiceDialog(modal!, source, opener);
    }
    return new Promise(review);
}

/** Dismissal defaults to cancellation, including Escape and backdrop gestures. */
export function initInvoiceCommandConfirmation(): void {
    const modal = document.getElementById("invoiceCommandConfirmModal");
    if (!modal || modal.dataset.initialized === 'true') return;
    modal.dataset.initialized = 'true';
    // Only the explicit confirm action changes the result. Backdrop, Escape, and close remain cancellation.
    /** Acknowledge the current review through its dedicated action button. */
    function confirmCommand(event: Event): void {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-invoice-command-confirm]');
        if (!button || button.disabled || !invoiceConfirmation) return;
        invoiceConfirmation.confirmed = true;
        window.bootstrap?.Modal.getOrCreateInstance(modal!).hide();
    }
    /** Put initial focus on the safe cancellation action when the review becomes visible. */
    function focusCancel(): void {
        modal!.querySelector<HTMLButtonElement>('[data-invoice-command-cancel]')?.focus();
    }
    /** Restore the source draft and resolve the caller after this review modal has fully closed. */
    function finishReview(): void {
        // Release the single gate owner before reopening the source editing dialog.
        const reviewed = invoiceConfirmation;
        invoiceConfirmation = undefined;
        if (!reviewed) return;
        const source = reviewed.opener.closest<HTMLElement>('.modal');
        function finish(): void {
            reviewed!.opener.focus({preventScroll: true});
            reviewed!.resolve(reviewed!.confirmed);
        }
        // Wait for the source dialog to regain its focus trap before returning the reviewed command to its caller.
        if (source) {
            source.addEventListener('shown.bs.modal', finish, {once: true});
            showInvoiceDialog(source);
        } else finish();
    }
    // Bootstrap visibility events ensure cancellation and focus restoration happen once per complete review.
    modal.addEventListener('click', confirmCommand);
    modal.addEventListener('shown.bs.modal', focusCancel);
    modal.addEventListener('hidden.bs.modal', finishReview);
}

/** Blur a focused numeric draft before native wheel stepping, leaving the gesture free to scroll. */
export function protectInvoiceNumberFromScroll(event: WheelEvent): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number' || document.activeElement !== input) return;
    if (!input.closest('.invoice-pool, .pool-edit-modal, #invoiceSubmitForm, #poolCreateModal')) return;
    input.blur();
}

/** Install a passive wheel guard so scrolling never changes a focused invoice number draft. */
function initInvoiceNumberScrollProtection(): void {
    document.addEventListener('wheel', protectInvoiceNumberFromScroll, {capture: true, passive: true});
}

/** Consume the controller's vocabulary rather than maintaining a second browser wording table. */
function getInvoiceLabels(previewLabels?: InvoiceLabels): InvoiceLabels {
    if (previewLabels) invoiceLabels = previewLabels;
    invoiceLabels ??= parseJsonScript<InvoiceLabels>("invoiceLabelsData");
    if (!invoiceLabels) throw new Error(invoiceText('invoicePresentationIsUnavailableReloadThePage'));
    return invoiceLabels;
}

function getEventId(): string {
    return window.Surveyor.eventId ?? '';
}

/**
 * Initialize data from page scripts
 */
function initializeData(): void {
    if (dataInitialized) return;
    participantsData = parseJsonScript<any[]>("participantsData") || [];
    registrationData = parseJsonScript<{ id: number }>("registrationData");
    dataInitialized = true;
}

/**
 * Sync allergy notes requirement with checkbox
 */
export function allergyCheck(): void {
    const allergyBox = document.getElementById('diet-allergies');
    const notes = document.getElementById('allergyNotes');
    if (allergyBox instanceof HTMLInputElement && notes instanceof HTMLInputElement) {
        const _allergyBox = allergyBox as HTMLInputElement;
        const _notes = notes as HTMLInputElement;

        function sync() {
            _notes.required = _allergyBox.checked;
        }

        allergyBox.addEventListener('change', sync);
        sync();
    }
}

/**
 * Update deadline countdown display
 */
export function deadlineUpdater(): void {
    try {
        const deadlineCnt = document.getElementById('deadlineCountdown');
        const deadline = document.getElementById('deadlineText');
        const deadlineTZ = document.getElementById('deadlineTZ');

        if (!deadline || !deadlineCnt || !deadlineTZ || !deadline.dataset?.date || !deadlineTZ.dataset?.tz) {
            return;
        }

        const date = new Date(deadline.dataset.date);
        deadline.textContent = date.toLocaleString(undefined, {
            dateStyle: "full",
            timeStyle: "full"
        });
        deadlineTZ.textContent = date.toLocaleString(undefined, {
            timeZone: deadlineTZ.dataset?.tz,
            dateStyle: "full",
            timeStyle: "full"
        });

        const t = Date.parse(date.toISOString());
        if (!Number.isNaN(t)) {
            const _deadlineCnt = deadlineCnt;

            function tick() {
                const ms = t - Date.now();
                _deadlineCnt.textContent = `(${formatDuration(ms)})`;
            }

            tick();
            setInterval(tick, 60000);
        }

        const deadlineEdit = document.getElementById('deadlineEdit');
        if (deadlineEdit) {
            const elem = deadlineEdit as HTMLInputElement;
            elem.value = formatISOInTimeZone(date, deadlineTZ.dataset.tz).slice(0, 16);
        }
    } catch (e) {
        // Silently fail if deadline elements not present
        console.debug(e);
    }
}

/**
 * Initialize event registration form
 */
export function initRegistration(): void {
    const mealOptions = ['meat', 'fish', 'vegetarian', 'vegan'];

    const mealBoxes = mealOptions.map(v =>
        document.querySelector<HTMLInputElement>(`input[value="${v}"]`)!
    );

    function updateMealRules(this: HTMLInputElement, ev: Event) {
        const meat = mealBoxes[0];
        const fish = mealBoxes[1];
        const vegetarian = mealBoxes[2];
        const vegan = mealBoxes[3];

        // Vegetarian disables meat/fish/vegan
        if (this == vegetarian && vegetarian.checked) {
            meat.checked = false;
            fish.checked = false;
            vegan.checked = false;
        }

        // Vegan disables meat/fish/vegetarian
        if (this == vegan && vegan.checked) {
            meat.checked = false;
            fish.checked = false;
            vegetarian.checked = false;
        }

        // Meat/Fish disable vegetarian & vegan
        if ((this == meat || this == fish) && (meat.checked || fish.checked)) {
            vegetarian.checked = false;
            vegan.checked = false;
        }
    }

    if (mealBoxes.length > 0 && mealBoxes[0] instanceof HTMLInputElement) {
        mealBoxes.forEach(cb =>
            cb.addEventListener('change', updateMealRules)
        );
    }

    const form = document.getElementById('registrationForm');
    if (!form) {
        return;
    }

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();

        if (mealBoxes.length > 0 && mealBoxes[0] instanceof HTMLInputElement) {
            const selectedMeals = mealBoxes.filter(cb => cb.checked);
            if (selectedMeals.length === 0) {
                showInlineAlert('error', 'Please select at least one meal preference.');
                return;
            }
        }

        try {
            requireEntityPerm('ACCESS_REGISTRATION', 'register for this event');
            const formData = new FormData(form as HTMLFormElement);
            const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.fromEntries(formData.entries());
            payload.dietary = formData.getAll('dietary');

            await post(`/api/event/${getEventId()}/register`, payload);
            showInlineAlert('success', 'Registration successful.');
            reloadAfterDelay(RELOAD_DELAY_MS);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Registration failed.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize registration cancellation
 */
export function initCancelRegistration(): void {
    const btn = document.getElementById('cancelRegistrationBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (window.confirm("Are you sure you want to cancel your registration?")) {
            try {
                if (!registrationData?.id) {
                    throw new Error('Only registered participants can cancel their registration.');
                }
                await post(`/api/event/${getEventId()}/register/delete`);
                showInlineAlert('success', 'Registration cancelled!');
                reloadAfterDelay(RELOAD_DELAY_MS);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Cancellation failed.';
                showInlineAlert('error', message);
            }
        }
    });
}

/**
 * Initialize date range display
 */
export function initDateRange(): void {
    const start = document.getElementById('startSpan');
    const end = document.getElementById('endSpan');
    if (!start || !end) return;

    updateToLocalString(start, start.dataset.start!);
    updateToLocalString(end, end.dataset.end!);
}

/**
 * Initialize registration date range display
 */
export function initRegistrationDateRange(): void {
    const start = document.getElementById('arrival');
    const end = document.getElementById('departure');
    if (!start || !end) return;

    const startDate = new Date(Date.parse(start.dataset.start!));
    const endDate = new Date(Date.parse(end.dataset.end!));

    start.textContent = startDate.toLocaleString(undefined, {dateStyle: "full"});
    end.textContent = endDate.toLocaleString(undefined, {dateStyle: "full"});
}

/**
 * Serialize form data to object
 * @param form Form element
 * @returns Serialized data
 */
export function serializeForm(form: HTMLFormElement): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
    const formData = new FormData(form);
    const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.fromEntries(formData.entries());
    payload.registrations = formData.getAll('registrations');
    return payload;
}

function requireManageAssignments(): void {
    const permissions = getPerms();
    if (!permissions) throw new Error(invoiceText('permissionDataMissing'));
    if (!permissions.entity.has('MANAGE_ASSIGNMENTS')) throw new Error(invoiceText('manageAssignmentsRequired'));
}

/**
 * Serialize the editable invoice pool base parameters
 */
export function serializePoolBaseSettings(form: HTMLFormElement): Record<string, FormDataEntryValue> {
    // Keep the established description/distribution fields independent of optional feature controls.
    const formData = new FormData(form);
    const payload: Record<string, FormDataEntryValue> = {
        description: formData.get('description') || '',
        distribution: formData.get('distribution') || '',
    };
    // Optional settings are serialized only when this form actually exposes their controls.
    if (formData.get("sendCalculationEmailsConfigured") === 'on') {
        payload.sendCalculationEmails = formData.get("sendCalculationEmails") === 'on' ? 'on' : '';
    }
    if (formData.get("roundUpSharesConfigured") === 'on') {
        payload.roundUpShares = formData.get("roundUpShares") === 'on' ? 'on' : '';
    }
    return payload;
}

/** Keep every selected exemption and factor when an assignment form is saved. */
export function serializePoolAssignments(form: HTMLFormElement): Record<string, unknown> {
    const formData = new FormData(form);
    const factors: Record<string, string> = {};
    // Disabled, unassigned participant controls must not send factors that no longer belong to the pool.
    form.querySelectorAll<HTMLInputElement>('[data-participant-factor]').forEach((input) => {
        if (!input.disabled && input.dataset.participantFactor) factors[input.dataset.participantFactor] = input.value;
    });
    // Send explicit unchecked flags along with all selected exemptions, retaining the existing assignment API.
    return {
        registrations: formData.getAll('registrations'),
        exemptions: formData.getAll('exemptions'),
        assignAll: formData.get("assignAll") === 'on' ? 'on' : '',
        isDefault: formData.get("isDefault") === 'on' ? 'on' : '',
        subtractPersonalInvoices: formData.get("subtractPersonalInvoices") === 'on' ? 'on' : '',
        participantFactors: factors,
    };
}

function poolStatusElement(root: Element): HTMLElement {
    const existing = root.querySelector<HTMLElement>('.pool-form-status');
    if (existing) return existing;
    const container = document.createElement('div');
    container.className = 'pool-form-status mt-2';
    container.setAttribute('aria-live', 'polite');
    const parent = root.tagName === 'TR' ? root.lastElementChild || root : root;
    parent.appendChild(container);
    return container;
}

function showPoolFeedback(root: Element, status: 'success' | 'info' | 'error', message: string): void {
    const container = poolStatusElement(root);
    clearPoolStatus(container);
    // Dialog feedback stays within its focus trap. Page actions use the app's shared alert region.
    showInlineAlert(status, message, root.closest('.modal') || !document.getElementById("liveAlerts") ? container : undefined);
}

function clearPoolStatus(container: HTMLElement): void {
    cancelAlertDismissal(container);
    container.querySelectorAll<HTMLElement>('.alert').forEach(cancelAlertDismissal);
    container.replaceChildren();
    container.classList.remove('text-success', 'text-info', 'text-danger', 'alert', 'alert-danger');
    container.removeAttribute('role');
}

function showPoolProgress(root: Element, message: string): void {
    const container = poolStatusElement(root);
    clearPoolStatus(container);
    container.classList.add('text-info');
    container.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'spinner-border spinner-border-sm me-2';
    spinner.setAttribute('aria-hidden', 'true');
    container.replaceChildren(spinner, document.createTextNode(message));
}

/** Present saved-history recovery after an ambiguous, non-idempotent cost creation. */
function showUncertainPoolExpense(root: Element, poolId?: string): void {
    // An ambiguous creation outcome needs a saved-history recovery path rather than another submit button.
    const container = poolStatusElement(root);
    clearPoolStatus(container);
    container.classList.add('alert', 'alert-danger');
    container.setAttribute('role', 'status');
    const explanation = document.createElement('p');
    explanation.textContent = invoiceText('weCouldNotConfirmWhetherThisExpenseWasSaved');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn-outline-light btn-sm';
    reload.textContent = invoiceText('reloadAndCheckSavedInvoices');
    reload.addEventListener('click', () => {
        reload.disabled = true;
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        reload.replaceChildren(spinner, document.createTextNode(invoiceText('reloading')));
        rememberPool(poolId);
        window.location.reload();
    });
    // Focus the recovery feedback inside the current dialog so its explanation is accessible.
    container.replaceChildren(explanation, reload);
    container.tabIndex = -1;
    container.focus();
    container.scrollIntoView({block: 'nearest'});
}

class ConfirmedInvoiceRejection extends Error {}

/** A create request is safe to correct only after a definite API rejection. */
export async function postOrganizerExpense(url: string, payload: FormData): Promise<any> {
    // Send the existing multipart creation command once; only explicit API rejection makes correction safe.
    const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: {'X-Requested-With': 'XMLHttpRequest'}, body: payload,
    });
    const result = await response.json();
    if (response.status >= 400 && response.status < 500 && result?.status === 'error') {
        throw new ConfirmedInvoiceRejection(typeof result.message === 'string' ? result.message : invoiceText('checkTheExpenseFieldsAndTryAgain'));
    }
    // Other response failures can follow a committed write and must be treated as uncertain.
    if (!response.ok || result?.status !== 'success') {
        throw new Error(invoiceText('theServerDidNotConfirmTheExpense'));
    }
    return result;
}

function rememberPool(poolId: string | undefined): void {
    if (!poolId) return;
    try { sessionStorage.setItem('surveyor:invoice-pool', `${getEventId()}:${poolId}`); } catch { /* Storage is optional. */ }
}

function restoreInvoiceFeedback(): void {
    try {
        const key = `surveyor:invoice-feedback:${getEventId()}`;
        const message = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        if (message) showInlineAlert('success', message);
    } catch { /* Storage is optional. */ }
}

interface InvoiceAdminAction {
    scope: HTMLElement;
    trigger: HTMLElement;
    pending: string;
    success: string | ((response: any) => string);
    request: () => Promise<any>;
    requiresManageAssignments?: boolean;
    subject?: string;
    onSuccess?: (response: any) => void;
    reloadPool?: string;
    reload?: boolean;
    lockOnUncertainFailure?: boolean;
}

/** Keep every financial action visibly pending until its response confirms completion. */
export async function runInvoiceAdminAction(options: InvoiceAdminAction): Promise<boolean> {
    const {scope, trigger} = options;
    function message(text: string): string {
        return options.subject ? invoiceText('subjectMessage', {subject: options.subject, message: text}) : text;
    }
    // Lock the action scope once, retaining each control’s original disabled state for definite completion.
    if (scope.dataset.saving === 'true') return false;
    scope.dataset.saving = 'true';
    scope.setAttribute('aria-busy', 'true');
    const controls = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button'));
    const modalClose = scope.closest('.modal')?.querySelector<HTMLButtonElement>('.modal-header .btn-close');
    const modal = scope.closest<HTMLElement>('.modal');
    const keepPendingVisible = (event: Event) => event.preventDefault();
    modal?.addEventListener('hide.bs.modal', keepPendingVisible);
    if (modalClose && !controls.includes(modalClose)) controls.push(modalClose);
    const previousControls = controls.map(control => ({control, disabled: control.disabled}));
    controls.forEach(control => control.disabled = true);
    // Compact settlement controls keep their label and geometry while pending; progress replaces only the icon.
    // Other invoice buttons retain the established temporary Working label and restore their original nodes.
    const originalChildren = trigger.tagName === 'BUTTON' ? Array.from(trigger.childNodes) : null;
    const settlementIcon = trigger.querySelector<HTMLElement>('[data-share-settlement-icon]');
    let settlementProgress: HTMLSpanElement | undefined;
    if (settlementIcon) {
        settlementProgress = document.createElement('span');
        settlementProgress.className = 'spinner-border spinner-border-sm invoice-settlement-progress';
        settlementProgress.setAttribute('aria-hidden', 'true');
        settlementIcon.classList.add('is-pending');
        settlementIcon.appendChild(settlementProgress);
    } else if (originalChildren) {
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        trigger.replaceChildren(spinner, document.createTextNode(invoiceText('working')));
    }
    const switchProgress = trigger.tagName === 'INPUT' ? document.createElement('span') : null;
    if (switchProgress) {
        switchProgress.className = 'spinner-border spinner-border-sm ms-2';
        switchProgress.setAttribute('role', 'status');
        switchProgress.setAttribute('aria-label', options.pending);
        trigger.parentElement?.appendChild(switchProgress);
    }
    // Announce immediate and delayed progress while the original command waits for server confirmation.
    showPoolProgress(scope, message(options.pending));
    const slow = window.setTimeout(() => showPoolProgress(scope, message(invoiceText('stillWorkingTheServerHasNotConfirmedThisChange'))), 5000);
    let succeeded = false;
    let requestStarted = false;
    let uncertain = false;
    try {
        if (options.requiresManageAssignments) requireManageAssignments();
        // A frontend review authorizes this request; server permissions and existing payload contracts still apply.
        requestStarted = true;
        const response = await options.request();
        if (response?.status !== 'success') throw new Error(invoiceText('theServerDidNotConfirmThisChangeReloadThe'));
        succeeded = true;
        options.onSuccess?.(response);
        const successMessage = message(typeof options.success === 'function' ? options.success(response) : options.success);
        showPoolFeedback(scope, 'success', successMessage);
        if (options.reload) {
            rememberPool(options.reloadPool);
            try { sessionStorage.setItem(`surveyor:invoice-feedback:${getEventId()}`, successMessage); } catch { /* Alerts still appear without storage. */ }
            reloadAfterDelay(1000);
        }
        return true;
    } catch (err) {
        // A lost response to cost creation is not permission to retry: keep that non-idempotent form locked.
        uncertain = !!options.lockOnUncertainFailure && requestStarted && !succeeded && !(err instanceof ConfirmedInvoiceRejection);
        if (uncertain) showUncertainPoolExpense(scope, options.reloadPool);
        else showPoolFeedback(scope, 'error', message(err instanceof Error ? err.message : invoiceText('unableToCompleteThisAction')));
        return false;
    } finally {
        // Definite completion restores controls and button nodes; navigation or uncertain creation stays locked.
        window.clearTimeout(slow);
        modal?.removeEventListener('hide.bs.modal', keepPendingVisible);
        scope.removeAttribute('aria-busy');
        switchProgress?.remove();
        settlementProgress?.remove();
        settlementIcon?.classList.remove('is-pending');
        if (originalChildren) trigger.replaceChildren(...originalChildren);
        if (!uncertain && (!succeeded || !options.reload)) {
            delete scope.dataset.saving;
            previousControls.forEach(({control, disabled}) => control.disabled = disabled);
        }
    }
}

/** Save an allocation form through the shared pending-state flow and preserve its closed-pool guidance. */
async function savePoolForm(form: HTMLFormElement, payload: Record<string, unknown>, messageKey: InvoiceTextKey, closedMessageKey: InvoiceTextKey): Promise<void> {
    const trigger = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!trigger) return;
    // The shared action flow owns permission checks, pending controls, and failure feedback for every pool form.
    await runInvoiceAdminAction({
        scope: form, trigger, requiresManageAssignments: true,
        pending: invoiceText('savingPoolChanges'),
        success: invoiceText(form.dataset.poolStatus === 'CLOSED' ? closedMessageKey : messageKey),
        request: () => post(form.dataset.api!, payload),
        onSuccess: () => form.dataset.dirty = 'false',
        reload: true, reloadPool: form.dataset.pool,
    });
}

/** Capture editable form values for local dirty tracking, excluding its display-only search field. */
function poolFormSnapshot(form: HTMLFormElement): string {
    return JSON.stringify(Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="search"]), select, textarea'))
        .map(input => [input.name, input.value, input instanceof HTMLInputElement ? input.checked : false]));
}

/** Detect drafts that would make a saved-data calculation preview misleading. */
function poolHasUnsavedChanges(poolId: string | undefined): boolean {
    return Array.from(document.querySelectorAll<HTMLFormElement>('.pool-base-form, .pool-assignment, .surcharge-form'))
        .some(form => form.dataset.pool === poolId && form.dataset.dirty === 'true');
}

/** Enable factor and exemption drafts only for participants included by the current assignment draft. */
function syncPoolParticipantFields(form: HTMLFormElement): void {
    const assignAll = form.querySelector<HTMLInputElement>("input[name=\"assignAll\"]");
    // Assign-all and explicit selections share one eligibility rule; no assignment is saved by this UI update.
    for (const row of form.querySelectorAll<HTMLElement>('[data-registration]')) {
        const registration = row.querySelector<HTMLInputElement>('input[name="registrations"]');
        const selected = !!assignAll?.checked || !!registration?.checked;
        for (const input of row.querySelectorAll<HTMLInputElement>('[data-participant-factor], input[name="exemptions"]')) {
            input.disabled = !selected;
        }
    }
}

/**
 * Initialize invoice pool administration
 */
export function initInvoiceAdmin(): void {
    // Bind pool creation and restore per-pool navigation before connecting the independent edit forms.
    const poolForm = document.getElementById("poolCreateForm");
    if (poolForm) {
        /** Normalize pool creation flags and save through the standard pending-feedback flow. */
        async function createPoolFromForm(e: Event) {
            e.preventDefault();
            const form = poolForm as HTMLFormElement;
            // Normalize unchecked flags explicitly because the generic form serializer omits unchecked inputs.
            const payload = serializeForm(form);
            for (const name of ["assignAll", "isDefault", "subtractPersonalInvoices", "roundUpShares"]) {
                payload[name] = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked ? 'on' : '';
            }
            delete payload.roundUpSharesConfigured;
            // Submit one creation request through the established pending-state and permission flow.
            const trigger = form.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (!trigger) return;
            await runInvoiceAdminAction({scope: form, trigger, requiresManageAssignments: true, pending: invoiceText('creatingTheInvoicePool'),
                success: invoiceText('poolCreated'), request: () => post(form.dataset.api!, payload), reload: true});
        }
        poolForm.addEventListener('submit', createPoolFromForm);

        const assignAll = poolForm.querySelector('#assignAllPools') as HTMLInputElement | null;
        const registrations = Array.from(poolForm.querySelectorAll<HTMLInputElement>('input[name="registrations"]'));
        /** Keep explicit registration controls consistent with this new pool's assign-all draft. */
        function syncDisabled() {
            const disable = !!(assignAll?.checked);
            registrations.forEach((input) => {
                input.disabled = disable;
                if (disable) input.checked = true;
            });
        }
        assignAll?.addEventListener('change', syncDisabled);
        syncDisabled();
    }

    // Keep edits local to their dialog until the user explicitly saves them.
    for (const form of document.querySelectorAll<HTMLFormElement>('.pool-base-form, .pool-assignment, .surcharge-form')) {
        if (form.classList.contains('pool-assignment')) syncPoolParticipantFields(form);
        form.dataset.initialValues = poolFormSnapshot(form);
        const trackEdits = () => form.dataset.dirty = String(poolFormSnapshot(form) !== form.dataset.initialValues);
        form.addEventListener('input', trackEdits);
        form.addEventListener('change', trackEdits);
        /** Reconcile dirty tracking after native reset restores the saved input values. */
        function restoreSavedDraft() {
            // Native reset updates fields after its event; defer reconciliation until those values are restored.
            /** Restore membership controls and dirty tracking after the browser applies the reset. */
            function reconcileReset() {
                for (const input of form.querySelectorAll<HTMLInputElement>('input[name="registrations"]')) {
                    delete input.dataset.originalChecked;
                    input.disabled = !!form.querySelector<HTMLInputElement>("input[name=\"assignAll\"]")?.checked;
                }
                if (form.classList.contains('pool-assignment')) syncPoolParticipantFields(form);
                // Recompute the draft comparison and announce discard only after its controls are consistent.
                trackEdits();
                showPoolFeedback(form, 'info', invoiceText('unsavedEditsDiscardedTheFormNowShowsItsSaved'));
            }
            queueMicrotask(reconcileReset);
        }
        form.addEventListener('reset', restoreSavedDraft);
    }
    try {
        const remembered = sessionStorage.getItem('surveyor:invoice-pool');
        const poolId = remembered?.startsWith(`${getEventId()}:`) ? remembered.slice(getEventId().length + 1) : null;
        if (poolId) {
            const body = document.getElementById(`pool-${poolId}-body`);
            body?.classList.add('show');
            const trigger = body?.parentElement?.querySelector<HTMLElement>('.accordion-button');
            trigger?.classList.remove('collapsed');
            trigger?.setAttribute('aria-expanded', 'true');
            sessionStorage.removeItem('surveyor:invoice-pool');
        }
    } catch { /* Storage is optional. */ }

    document.addEventListener('submit', async (e: Event) => {
        const form = e.target as HTMLFormElement;
        if (!form.classList.contains('pool-base-form')) return;
        e.preventDefault();
        await savePoolForm(form, serializePoolBaseSettings(form), 'poolSettingsSaved', 'poolSettingsSavedClosed');
    });

    // Invoice review actions lock the full row so opposite decisions cannot run together.
    // Delegate review and calculation actions; every financial transition passes its explicit review gate.
    /** Review and dispatch a clicked invoice decision or pool calculation action. */
    async function handleInvoiceReviewClick(e: Event) {
        const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!target) return;
        try {
            // Identify the clicked action first, then capture only the fields relevant to that existing command.
            const reviewActions = [
                {css: 'invoice-approve', route: 'approve', requiresManageAssignments: true, pending: invoiceText('acceptingInvoice'), success: invoiceText('invoiceAccepted2'), confirmation: 'confirmAcceptInvoice' as const},
                {css: 'invoice-decline', route: 'decline', requiresManageAssignments: true, pending: invoiceText('rejectingInvoice'), success: invoiceText('invoiceRejected2'), confirmation: 'confirmRejectInvoice' as const},
                {css: 'invoice-close', route: 'close', requiresManageAssignments: true, pending: invoiceText('closingInvoice'), success: invoiceText('invoiceClosed2'), confirmation: 'confirmCloseInvoice' as const},
                {css: 'invoice-close-self', route: 'close-self', requiresManageAssignments: undefined, pending: invoiceText('closingInvoice'), success: invoiceText('invoiceClosed2'), confirmation: 'confirmCloseInvoice' as const},
            ];
            const review = reviewActions.find(action => target.classList.contains(action.css));
            if (review) {
                const row = target.closest<HTMLElement>('[data-invoice-row]') || target.parentElement!;
                const payload: Record<string, string> = {};
                if (review.route === 'approve') {
                    payload.correctedAmount = row.querySelector<HTMLInputElement>('.invoice-corrected-amount')?.value.trim() || '';
                    payload.correctedDescription = row.querySelector<HTMLTextAreaElement>('.invoice-corrected-description')?.value.trim() || '';
                }
                if (review.route === 'decline') {
                    payload.rejectionReason = row.querySelector<HTMLTextAreaElement>('.invoice-rejection-reason')?.value.trim() || '';
                    if (!payload.rejectionReason) {
                        showPoolFeedback(row, 'error', invoiceText('enterARejectionReasonBeforeRejectingThisInvoice'));
                        return;
                    }
                }
                // A stable DOM hook provides the submitted amount; translated column labels are never selectors.
                const amount = row.querySelector<HTMLElement>('[data-invoice-submitted-amount]')?.textContent || '';
                if (!await requestInvoiceConfirmation(invoiceText('invoiceNumber', {id: target.dataset.id || ''}), invoiceText(review.confirmation, {amount: payload.correctedAmount || amount}),
                    target.textContent?.trim() || invoiceText('confirm'), target)) return;
                // No mutation or optimistic state toggle occurs until the separate confirmation has resolved true.
                await runInvoiceAdminAction({scope: row, trigger: target, requiresManageAssignments: review.requiresManageAssignments,
                    pending: review.pending, success: review.success,
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/${review.route}`, payload),
                    reload: true, reloadPool: target.dataset.pool});
                return;
            }
            if (target.classList.contains('pool-close') || target.classList.contains('pool-recalculate')) {
                return await calculatePool(target, target.classList.contains('pool-recalculate'));
            }
            if (target.classList.contains('pool-submission-state')) return await changePoolSubmissionState(target);
            if (target.classList.contains('pool-open-calculation') || target.classList.contains('pool-preview-refresh')) {
                return await loadPoolCalculationPreview(target.dataset.id);
            }
            if (target.classList.contains('pool-rollback')) return await submitPoolAction(target, 'rollback');
            if (target.classList.contains('pool-notify')) return await submitPoolAction(target, 'notify');
            if (target.classList.contains('pool-return')) {
                rememberPool(target.dataset.id);
                return window.location.reload();
            }
            if (target.classList.contains('surcharge-remove')) {
                const modal = target.closest<HTMLElement>('.modal') || target.parentElement!;
                if (!await requestInvoiceConfirmation(invoiceText('removeAdjustment'), target.getAttribute('aria-label') || invoiceText('removeThisSavedAdjustment'),
                    invoiceText('removeAdjustment'), target)) return;
                await runInvoiceAdminAction({scope: modal, trigger: target, requiresManageAssignments: true,
                    pending: invoiceText('removingTheAdjustment'), success: invoiceText('adjustmentRemovedClosedPoolsRequireRecalculation'),
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/surcharges/${target.dataset.id}/delete`),
                    reload: true, reloadPool: target.dataset.pool});
            }
        } catch (err) {
            showPoolFeedback(target.closest('.modal') || target.closest('[data-invoice-row]') || target.parentElement!, 'error', err instanceof Error ? err.message : invoiceText('requestFailed'));
        }
    }
    document.addEventListener('click', handleInvoiceReviewClick);

    /** Capture one organizer expense and use saved-history recovery for an uncertain creation result. */
    async function handleOrganizerExpenseSubmit(e: Event) {
        const form = e.target as HTMLFormElement;
        // Capture multipart expense fields before disabling controls, keeping optional empty proofs out of the request.
        if (form.classList.contains('pool-expense-form')) {
            e.preventDefault();
            if (form.dataset.saving === 'true') return;
            const trigger = form.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (!trigger) return;
            const payload = new FormData(form);
            payload.set('description', String(payload.get('description') || '').trim());
            if (!payload.get('description')) {
                showPoolFeedback(form, 'error', invoiceText('enterADescriptionForThisExpense'));
                return;
            }
            // An empty paid-by selection preserves the established unattributed organizer request.
            // Capture the explicit registration before locking controls; the server rechecks current pool eligibility.
            if (!String(payload.get('registrationId') || '').trim()) payload.delete('registrationId');
            const proof = payload.get('proof');
            if (proof instanceof File && proof.size === 0) payload.delete('proof');
            await runInvoiceAdminAction({scope: form, trigger, requiresManageAssignments: true, pending: invoiceText('addingThePoolExpense'),
                success: invoiceText(form.dataset.poolStatus === 'CLOSED' ? 'expenseAddedClosed' : 'expenseAddedAndAccepted'),
                request: () => postOrganizerExpense(form.dataset.api!, payload), reload: true, reloadPool: form.dataset.pool,
                lockOnUncertainFailure: true});
        } else if (form.classList.contains('pool-assignment')) {
            // Assignment edits update inputs only; a closed pool's shares remain saved until recalculation.
            e.preventDefault();
            await savePoolForm(form, serializePoolAssignments(form), 'participantsAndFactorsSaved', 'participantsAndFactorsSavedClosed');
        } else if (form.classList.contains('surcharge-form')) {
            // Signed adjustments require a nonzero amount and retain the same explicit form-save boundary.
            e.preventDefault();
            const formData = new FormData(form);
            if (Number(formData.get('amount')) === 0) {
                showPoolFeedback(form, 'error', invoiceText('enterAPositiveSurchargeOrANegativeRebateAmount'));
                return;
            }
            formData.set("subtractFromPool", formData.get("subtractFromPool") === 'on' ? 'on' : '');
            await savePoolForm(form, Object.fromEntries(formData), 'adjustmentSaved', 'adjustmentSavedClosed');
        }
    }
    document.addEventListener('submit', handleOrganizerExpenseSubmit);

    // Pool assignment checkbox handler
    /** Coordinate this invoice interaction using its captured DOM state and the shared action flow. */
    function updatePoolAssignmentFlags(e: Event) {
        const target = e.target as HTMLElement;
        if (target.matches('.pool-assignment .pool-toggle')) {
            const form = target.closest('.pool-assignment') as HTMLFormElement | null;
            if (!form) return;
            const assignAll = form.querySelector("input[name=\"assignAll\"]") as HTMLInputElement | null;
            const registrations = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="registrations"]'));
            const disable = !!(assignAll?.checked);
            // Coordinate this invoice interaction using its captured DOM state and the shared action flow.
            for (const input of registrations) {
                if (disable) {
                    // Store original state before modifying (only if not already stored)
                    if (!Object.hasOwn(input.dataset, "originalChecked")) {
                        input.dataset.originalChecked = String(input.checked);
                    }
                    input.disabled = true;
                    input.checked = true;
                } else {
                    // Restore original state when re-enabling
                    input.disabled = false;
                    if (Object.hasOwn(input.dataset, "originalChecked")) {
                        const originalState = input.dataset.originalChecked ?? 'false';
                        input.checked = originalState === 'true';
                        delete input.dataset.originalChecked;
                    }
                }
            }
        }
        const assignmentForm = target.closest<HTMLFormElement>('.pool-assignment');
        if (assignmentForm) {
            syncPoolParticipantFields(assignmentForm);
            assignmentForm.dataset.dirty = String(poolFormSnapshot(assignmentForm) !== assignmentForm.dataset.initialValues);
        }
    }
    document.addEventListener('change', updatePoolAssignmentFlags);

    /** Filter the assignment chooser visually without changing selections, factors, or exemptions. */
    function filterPoolParticipants(e: Event) {
        const target = e.target as HTMLElement;
        if (target.classList.contains('assignment-search')) {
            // Search only the current pool's chooser; hiding a row must not disable or alter its saved draft fields.
            const term = (target as HTMLInputElement).value.toLowerCase();
            const list = target.closest('.pool-assignment')?.querySelector('.assignments-list');
            if (!list) return;
            list.querySelectorAll<HTMLElement>('[data-search-text]').forEach((row) => {
                const text = (row.dataset.searchText || '').toLowerCase();
                row.classList.toggle('d-none', !!term && !text.includes(term));
            });
        }
    }
    document.addEventListener('input', filterPoolParticipants);

    restoreInvoicePaidState();
    window.addEventListener('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) window.location.reload();
        else restoreInvoicePaidState();
    });

    document.addEventListener('click', handleShareSettlementClick);
}

/** Review a signed saved balance, record its settlement status, and refresh the ledger after confirmation. */
async function handleShareSettlementClick(event: Event): Promise<void> {
    // Read the clicked row’s server-rendered amount and paid flag without changing either before review.
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.share-settlement');
    if (!button || button.disabled) return;
    const row = button.closest<HTMLElement>('[data-share-row]');
    const ledger = row?.closest<HTMLElement>('[data-share-ledger]');
    if (!row || !ledger || ledger.dataset.saving === 'true') return;
    const previous = button.dataset.paid === 'true';
    const settled = !previous;
    const originalBalance = Number(button.dataset.amount);
    const labels = getInvoiceLabels();
    const action = presentInvoiceSettlement(originalBalance, previous, labels).actionLabel;
    // Capture the signed saved amount before opening the gate. It remains the amount recorded by
    // the existing API; touch scrolling or dismissing the review can never toggle persisted state.
    const reviewKey = settled ? originalBalance < 0 ? 'confirmRecordRefund' : 'confirmRecordPayment'
        : originalBalance < 0 ? 'confirmReverseRefund' : 'confirmReversePayment';
    if (!await requestInvoiceConfirmation(row.dataset.shareName || labels.payer,
        invoiceText(reviewKey, {amount: formatInvoiceMoney(originalBalance)}),
        action, button)) return;
    const pool = button.closest<HTMLElement>('.invoice-pool');
    const settlementData = button.dataset;
    /** Apply the confirmed status and signed transfer totals without changing saved allocation amounts. */
    function applySettlement(): void {
        // Publish the server-confirmed paid flag before the shared owner refreshes recorded-transfer details.
        settlementData.paid = String(settled);
        invalidatePoolPreview(settlementData.pool);
        const selector = originalBalance < 0 ? '[data-pool-refunds], [data-pool-header-refunds]'
            : '[data-pool-outstanding], [data-pool-header-outstanding]';
        const totals = pool?.querySelectorAll<HTMLElement>(selector) || [];
        if (Number.isFinite(originalBalance)) {
            // Collapsed and expanded contexts share the same signed aggregate; refresh both after confirmation.
            for (const total of totals) {
                total.textContent = formatInvoiceMoney(Number(total.textContent) + (settled ? -1 : 1) * originalBalance);
            }
        }
    }
    // Keep the ledger locked while the unchanged payment endpoint confirms the new settlement status.
    const completed = await runInvoiceAdminAction({
        scope: ledger, trigger: button, requiresManageAssignments: true, subject: row.dataset.shareName,
        pending: invoiceText(settled ? originalBalance < 0 ? 'recordingRefund' : 'recordingPayment' : originalBalance < 0 ? 'removingRefundRecord' : 'removingPaymentRecord'),
        success: invoiceText(settled ? originalBalance < 0 ? 'refundRecorded' : 'paymentRecorded' : originalBalance < 0 ? 'refundRecordRemoved' : 'paymentRecordRemoved'),
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${button.dataset.pool}/shares/${button.dataset.id}/pay`, {isPaid: settled ? 'on' : ''}),
        onSuccess: applySettlement,
    });
    // After confirmation, refresh the same status in the row and saved-detail template without repeating its balance.
    if (completed) {
        updateShareRowState(row, settled, originalBalance);
        if (pool) updatePoolSettlementSummary(pool);
        ledger.dispatchEvent(new Event('share-state-updated'));
    }
}

/** Browser form restoration must never override the payment state rendered by the server. */
export function restoreInvoicePaidState(): void {
    const pools = new Set<HTMLElement>();
    // Restore each saved row once; collect its pool rather than rebuilding aggregate details for every payer.
    for (const button of document.querySelectorAll<HTMLButtonElement>('.share-settlement[data-paid]')) {
        const row = button.closest<HTMLElement>('[data-share-row]');
        if (row) updateShareRowState(row, button.dataset.paid === 'true', Number(button.dataset.amount));
        const pool = button.closest<HTMLElement>('.invoice-pool');
        if (pool) pools.add(pool);
    }
    // The same presentation owner refreshes optional recorded-transfer rows from authoritative rendered amounts.
    for (const pool of pools) updatePoolSettlementSummary(pool);
}

/** Refresh recorded transfers after confirmation without changing saved allocation or reimplementing accounting rules. */
function updatePoolSettlementSummary(pool: HTMLElement): void {
    const group = pool.querySelector<HTMLElement>('[data-pool-saved-settlement]');
    const values = group?.querySelector<HTMLElement>('[data-pool-saved-settlement-values]');
    if (!group || !values) return;
    const shares: InvoiceCalculationShare[] = [];
    // Organizer rows expose their existing numeric DTO only. The current paid flag follows the confirmed control.
    for (const row of pool.querySelectorAll<HTMLElement>('[data-share-financial]')) {
        const share = JSON.parse(row.dataset.shareFinancial!) as InvoiceCalculationShare;
        const action = row.querySelector<HTMLButtonElement>('.share-settlement');
        if (action) share.isPaid = action.dataset.paid === 'true';
        shares.push(share);
    }
    const metrics: InvoiceMoneyMetric[] = [];
    for (const metric of invoiceSettlementRows(shares)) {
        // Outstanding transfers have their own compact primary totals; retain useful credits and completed transfers here.
        if (metric.key !== 'outstandingAmount' && metric.key !== 'creditAmount') metrics.push(metric);
    }
    // Recording payment does not recalculate base allocations; preserve the saved rounding evidence unchanged.
    const rounding = JSON.parse(group.dataset.poolSavedRounding || 'null') as InvoiceMoneyMetric | null;
    if (rounding) metrics.push(rounding);
    values.replaceChildren();
    for (const metric of metrics) appendInvoiceCalculationMetric(values, {label: metric.label, value: formatInvoiceMoney(metric.amount)});
    group.hidden = metrics.length === 0;
}

/** Refresh financial text and the reusable breakdown without moving filtered or paged rows. */
function updateShareRowState(row: HTMLElement, paid: boolean, originalBalance: number): void {
    const labels = getInvoiceLabels();
    // Amount sorting and the primary number retain the calculated balance after recording payment.
    const settlement = presentInvoiceSettlement(originalBalance, paid, labels);
    const status = settlement.status;
    row.dataset.shareAmount = String(originalBalance);
    row.dataset.shareStatus = status;
    const badge = row.querySelector<HTMLElement>('[data-share-state]');
    if (badge) {
        badge.textContent = settlement.statusLabel;
        badge.className = `badge ${status === 'settled' ? 'bg-success' : status === 'refund' ? 'bg-info text-dark' : 'bg-warning text-dark'}`;
    }
    const balance = row.querySelector<HTMLElement>('[data-share-balance]');
    if (balance) balance.textContent = formatInvoiceMoney(originalBalance);
    // The caption follows the confirmed marker and saved sign, just as it did in the original organizer ledger.
    // Personal rows are read-only; this update is reached only through organizer settlement controls.
    const caption = row.querySelector<HTMLElement>('[data-share-balance-note]');
    if (caption) caption.textContent = invoiceBalanceCaption({shareAmount: originalBalance, isPaid: paid});
    // Keep the reusable breakdown's status synchronized with the row. Its saved financial components
    // stay unchanged: recording settlement describes the original balance instead of zeroing it.
    const details = row.querySelector<HTMLTemplateElement>('template[data-share-details]')?.content;
    const detailStatus = details?.querySelector<HTMLElement>('[data-share-details-status]');
    if (detailStatus) detailStatus.textContent = settlement.statusLabel;
    const action = row.querySelector<HTMLButtonElement>('.share-settlement');
    if (action) {
        // Update the existing label and icon, preserving the same compact markup as View breakdown.
        const label = action.querySelector<HTMLElement>('[data-share-settlement-label]');
        const icon = action.querySelector<HTMLElement>('[data-share-settlement-icon]');
        if (label) label.textContent = settlement.actionLabel;
        else action.textContent = settlement.actionLabel;
        if (icon) icon.className = `bi me-1 ${paid ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'}`;
        action.setAttribute('aria-label', invoiceText('actionForPayer', {action: settlement.actionLabel, payer: row.dataset.shareName || labels.payer}));
    }
}

/** Filter, sort and paginate long invoice histories without hiding records from the rendered audit trail. */
export function initInvoiceLedgers(): void {
    // Bind one invoice ledger’s independent search, status, and paging controls.
    for (const ledger of document.querySelectorAll<HTMLElement>('[data-invoice-ledger]')) {
        const rows = Array.from(ledger.querySelectorAll<HTMLTableRowElement>('[data-invoice-row]'));
        const search = ledger.querySelector<HTMLInputElement>('[data-invoice-search-input]');
        const status = ledger.querySelector<HTMLSelectElement>('[data-invoice-status-filter]');
        const pageSize = ledger.querySelector<HTMLSelectElement>('[data-invoice-page-size]');
        const previous = ledger.querySelector<HTMLButtonElement>('[data-invoice-page-previous]');
        const next = ledger.querySelector<HTMLButtonElement>('[data-invoice-page-next]');
        const summary = ledger.querySelector<HTMLElement>('[data-invoice-page-summary]');
        const empty = ledger.querySelector<HTMLElement>('[data-invoice-empty]');
        let currentPage = 1;

        /** Apply display filters and paging while keeping saved row amounts and payment controls intact. */
        function render(): void {
            // Select matching audit rows, then clamp the page when search or status changes reduce the result set.
            const query = search?.value.trim().toLowerCase() || '';
            const selectedStatus = status?.value || '';
            const size = Math.max(Number(pageSize?.value) || 25, 1);
            const matchingRows = rows.filter((row) => {
                const matchesSearch = !query || (row.dataset.invoiceSearch || '').includes(query);
                const matchesStatus = !selectedStatus || row.dataset.invoiceStatus === selectedStatus;
                return matchesSearch && matchesStatus;
            });
            const pageCount = Math.max(Math.ceil(matchingRows.length / size), 1);
            currentPage = Math.min(Math.max(currentPage, 1), pageCount);
            const start = (currentPage - 1) * size;
            // Hide off-page nodes without removing the saved audit history or recreating its action controls.
            const pageRows = new Set(matchingRows.slice(start, start + size));
            rows.forEach((row) => {
                row.hidden = !pageRows.has(row);
            });

            if (empty) empty.hidden = matchingRows.length > 0;
            if (summary) {
                const first = matchingRows.length ? start + 1 : 0;
                const last = Math.min(start + size, matchingRows.length);
                summary.textContent = invoiceText('invoicePageSummary', {start: first, end: last, count: matchingRows.length});
            }
            if (previous) previous.disabled = currentPage <= 1;
            if (next) next.disabled = currentPage >= pageCount;
        }

        search?.addEventListener('input', () => {
            currentPage = 1;
            render();
        });
        status?.addEventListener('change', () => {
            currentPage = 1;
            render();
        });
        pageSize?.addEventListener('change', () => {
            currentPage = 1;
            render();
        });
        previous?.addEventListener('click', () => {
            currentPage -= 1;
            render();
        });
        next?.addEventListener('click', () => {
            currentPage += 1;
            render();
        });
        render();
    }
}

/** Filter the persisted settlement list without changing its financial state. */
export function initShareLedgers(): void {
    // Bind one saved-share ledger without allowing filtering to mutate its financial state.
    for (const ledger of document.querySelectorAll<HTMLElement>('[data-share-ledger]')) {
        const body = ledger.querySelector<HTMLElement>('[data-share-body]');
        const rows = Array.from(ledger.querySelectorAll<HTMLTableRowElement>('[data-share-row]'));
        const search = ledger.querySelector<HTMLInputElement>('input[data-share-search]');
        const filter = ledger.querySelector<HTMLSelectElement>('[data-share-filter]');
        const sort = ledger.querySelector<HTMLSelectElement>('[data-share-sort]');
        const size = ledger.querySelector<HTMLSelectElement>('[data-share-page-size]');
        const previous = ledger.querySelector<HTMLButtonElement>('[data-share-previous]');
        const next = ledger.querySelector<HTMLButtonElement>('[data-share-next]');
        const refresh = ledger.querySelector<HTMLButtonElement>('[data-share-refresh]');
        const summary = ledger.querySelector<HTMLElement>('[data-share-page-summary]');
        const empty = ledger.querySelector<HTMLElement>('[data-share-empty]');
        /** Populate one shared dialog from the selected organizer template or personal presentation payload. */
        function openSavedShareBreakdown(event: Event) {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.share-details-open');
            if (!button) return;
            const row = button.closest<HTMLElement>('[data-share-row]');
            const modal = document.querySelector<HTMLElement>(button.dataset.bsTarget || '');
            const content = modal?.querySelector<HTMLElement>('[data-share-details-content]');
            if (!row || !modal || !content) return;
            // A personal ledger keeps only authorized plain data per row and renders the selected pool lazily.
            // Organizer rows retain their established inert templates and their live settlement-status hook.
            if (row.dataset.shareBreakdown) {
                const payload = JSON.parse(row.dataset.shareBreakdown) as InvoiceShareBreakdownData;
                renderSavedShareBreakdown(content, payload);
            } else {
                const template = row.querySelector<HTMLTemplateElement>('template[data-share-details]');
                if (!template) return;
                content.replaceChildren(template.content.cloneNode(true));
            }
            // The visible dialog context follows the selected pool or payer, never the previously viewed row.
            const name = modal.querySelector<HTMLElement>('[data-share-details-payer]');
            if (name) name.textContent = row.dataset.shareName || invoiceText('payer');
        }
        ledger.addEventListener('click', openSavedShareBreakdown);
        let page = 1;
        /** Apply display filters and paging while keeping saved row amounts and payment controls intact. */
        function render() {
            refresh?.classList.remove('btn-warning');
            refresh?.classList.add('btn-outline-light');
            // Filter and sort using calculated balances; recorded settlements never replace these display values.
            const query = search?.value.trim().toLowerCase() || '';
            const status = filter?.value || '';
            const pageSize = Math.max(1, Number(size?.value) || 25);
            /** Match either payer or pool rows using the same explicit saved status and search text. */
            function matchesDisplay(row: HTMLElement): boolean {
                return (!query || (row.dataset.shareSearch || '').includes(query))
                    && (!status || row.dataset.shareStatus === status);
            }
            /** Apply the requested amount order, with the displayed payer or pool name as a stable tie-breaker. */
            function compareDisplay(a: HTMLElement, b: HTMLElement): number {
                const difference = Number(a.dataset.shareAmount) - Number(b.dataset.shareAmount);
                if (difference && sort?.value === 'amount-asc') return difference;
                if (difference && sort?.value === 'amount-desc') return -difference;
                return (a.dataset.shareName || '').localeCompare(b.dataset.shareName || '', undefined, {sensitivity: 'base'});
            }
            const matching = rows.filter(matchesDisplay);
            matching.sort(compareDisplay);
            const pages = Math.max(1, Math.ceil(matching.length / pageSize));
            page = Math.min(Math.max(1, page), pages);
            const start = (page - 1) * pageSize;
            // Move existing rows rather than rebuilding controls, retaining each button's pending and focus state.
            const visible = new Set(matching.slice(start, start + pageSize));
            for (const row of rows) row.hidden = !visible.has(row);
            // Keep the same payment controls when the user changes this view.
            for (const row of matching) body?.append(row);
            if (summary) summary.textContent = invoiceText('sharePageSummary', {start: matching.length ? start + 1 : 0, end: Math.min(start + pageSize, matching.length), count: matching.length});
            if (empty) empty.hidden = matching.length > 0;
            if (previous) previous.disabled = page <= 1;
            if (next) next.disabled = page >= pages;
        }
        /** Start a changed display request at its first page without altering saved financial data. */
        function reset(): void { page = 1; render(); }
        /** Navigate the previous page; render clamps the range after filters have changed. */
        function showPrevious(): void { page--; render(); }
        /** Navigate the next page; render clamps the range after filters have changed. */
        function showNext(): void { page++; render(); }
        /** Apply deferred ordering and status filters only when the user explicitly refreshes the ledger. */
        function refreshDisplay(): void {
            render();
            showPoolFeedback(ledger, 'info', invoiceText('listRefreshed', {invoiceText: summary?.textContent || invoiceText('theCurrentFiltersAndOrderingHaveBeenApplied')}));
        }
        /** Mark a changed status filter while keeping a settling row stationary until user navigation. */
        function markChangedFilter(): void {
            // A confirmed transfer updates its badge immediately; it cannot silently remove the focused row.
            if (filter?.value) {
                refresh?.classList.remove('btn-outline-light');
                refresh?.classList.add('btn-warning');
            }
        }
        search?.addEventListener('input', reset);
        for (const control of [filter, sort, size]) control?.addEventListener('change', reset);
        previous?.addEventListener('click', showPrevious);
        next?.addEventListener('click', showNext);
        refresh?.addEventListener('click', refreshDisplay);
        ledger.addEventListener('share-state-updated', markChangedFilter);
        render();
    }
}

/** Create an escaped presentation node; saved names and notes never enter HTML parsing. */
function invoiceTextElement(tag: keyof HTMLElementTagNameMap, text: string, className = ''): HTMLElement {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
}

/** Append one labeled presentation value to the same definition-list layout used by Pug. */
function appendInvoiceCalculationMetric(target: HTMLElement, metric: InvoiceCalculationMetric): HTMLElement {
    const value = invoiceTextElement('dd', metric.value);
    target.append(invoiceTextElement('dt', metric.label), value);
    return value;
}

/** Render labeled operands and a visibly distinct result without reconstructing financial arithmetic. */
function renderInvoiceCalculationFormula(formula: InvoiceCalculationFormula): HTMLElement {
    const block = document.createElement('div');
    const equation = document.createElement('div');
    equation.className = 'invoice-calculation-formula d-flex flex-wrap align-items-end gap-2 p-3 border border-secondary-subtle rounded-3 bg-black';
    equation.setAttribute('role', 'group');
    equation.setAttribute('aria-label', formula.result.label);
    // Operators are independent nodes, allowing long labels and signed values to wrap on narrow screens.
    for (const term of formula.terms) {
        if (term.operator) equation.append(invoiceTextElement('span', term.operator, 'invoice-calculation-operator align-self-center'));
        const operand = document.createElement('div');
        operand.className = 'invoice-calculation-term d-flex flex-column';
        const value = term.value.startsWith('-') ? `(${term.value})` : term.value;
        operand.append(invoiceTextElement('strong', value), invoiceTextElement('small', term.label, 'text-secondary'));
        equation.append(operand);
    }
    // The presenter supplies the saved result and rounding note; this renderer only distinguishes them visually.
    equation.append(invoiceTextElement('span', '=', 'invoice-calculation-operator align-self-center'));
    const result = document.createElement('div');
    result.className = 'invoice-calculation-term invoice-calculation-result d-flex flex-column';
    result.append(invoiceTextElement('strong', formula.result.value, 'text-info'),
        invoiceTextElement('small', formula.result.label, 'text-secondary'));
    equation.append(result);
    block.append(equation);
    if (formula.note) block.append(invoiceTextElement('p', formula.note, 'small text-secondary mt-2 mb-0'));
    return block;
}

/** Render a structured explanation consistently for live previews and the selected personal share. */
function renderInvoiceCalculation(target: HTMLElement, calculation: InvoiceCalculationDisplay, showTitle = true): void {
    target.replaceChildren();
    const display = document.createElement('div');
    display.className = 'invoice-calculation';
    display.dataset.calculationDisplay = '';
    // Titles, contextual descriptions, and metric labels arrive already localized from the presentation owner.
    if (showTitle) display.append(invoiceTextElement('h6', calculation.title, 'mb-2'));
    if (calculation.description) display.append(invoiceTextElement('p', calculation.description, 'small text-secondary mb-3'));
    for (const section of calculation.sections) {
        const container = document.createElement('section');
        container.className = 'invoice-calculation-section mt-3';
        container.dataset.calculationSection = section.key;
        container.append(invoiceTextElement('h6', section.title, 'mb-2'));
        if (section.description) container.append(invoiceTextElement('p', section.description, 'small text-secondary mb-2'));
        // Coverage summaries retain the presenter's beneficiary order. Saved names remain escaped text,
        // and the compact roster appears before the contribution figures that it introduces.
        if (section.items?.length) {
            const items = document.createElement('ul');
            items.className = 'small text-secondary ps-3 mb-2';
            for (const item of section.items) items.append(invoiceTextElement('li', item));
            container.append(items);
        }
        // Preserve presenter order and feature relevance. The view must not hide a meaningful zero or add unused totals.
        if (section.metrics?.length) {
            const metrics = document.createElement('dl');
            metrics.className = 'invoice-share-breakdown small mb-2';
            for (const metric of section.metrics) appendInvoiceCalculationMetric(metrics, metric);
            container.append(metrics);
        }
        if (section.formula) container.append(renderInvoiceCalculationFormula(section.formula));
        display.append(container);
    }
    target.append(display);
}

/** Render only the selected personal pool's authorized financial trace in its shared read-only dialog. */
function renderSavedShareBreakdown(target: HTMLElement, payload: InvoiceShareBreakdownData): void {
    target.replaceChildren();
    // Stale shares retain frozen evidence; describe their state without substituting current editable inputs.
    if (payload.needsRecalculation) {
        target.append(invoiceTextElement('p', invoiceText('recalculationRequiredTheseAmountsAndCalculationInputsAreFrom'), 'small text-warning'));
    }
    // Applied responsibility can change while this payer's actual transfer history remains available.
    // This notice is already localized from frozen evidence, never reconstructed from pending pool inputs.
    if (payload.settledShareNotice) {
        const notice = invoiceTextElement('p', payload.settledShareNotice.description, 'small text-warning');
        notice.dataset.shareSettlementHistory = '';
        target.append(notice);
    }
    const components = document.createElement('dl');
    components.className = 'invoice-share-breakdown small mt-3 mb-3';
    for (const component of payload.components) {
        appendInvoiceCalculationMetric(components, {label: component.label, value: formatInvoiceMoney(component.amount)});
    }
    const status = appendInvoiceCalculationMetric(components, {label: invoiceText('paymentStatus'), value: payload.statusLabel});
    status.dataset.shareDetailsStatus = '';
    target.append(components);
    // Concrete own and covered contributions are distinct from the preserved saved audit notes below.
    const explanation = document.createElement('details');
    explanation.className = 'small mb-3';
    explanation.append(invoiceTextElement('summary', payload.calculation.title, 'text-info'));
    const calculation = document.createElement('div');
    calculation.className = 'mt-3';
    renderInvoiceCalculation(calculation, payload.calculation, false);
    explanation.append(calculation);
    target.append(explanation);
    if (payload.notes.length) {
        const notes = document.createElement('details');
        notes.className = 'small';
        notes.append(invoiceTextElement('summary', invoiceText('calculationNotes'), 'text-info'));
        const list = document.createElement('ul');
        list.className = 'ps-3 mt-2 mb-0';
        for (const note of payload.notes) list.append(invoiceTextElement('li', note, 'text-secondary'));
        notes.append(list);
        target.append(notes);
    }
}

type InvoiceChangeAction = 'revise' | 'reject-accepted';

/** Capture only the reviewed invoice fields; the caller sends this after explicit confirmation. */
export function invoiceChangePayload(action: InvoiceChangeAction, expectedRevision: number, fields: FormData): Record<string, unknown> {
    // Freeze the revision with the reviewed draft; the backend retains its existing revision/confirmation contract.
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error(invoiceText('reloadThePageToGetTheCurrentPoolRevision'));
    const confirmation = {confirmed: true, expectedRevision};
    // Each action owns its allowed fields, so a correction draft cannot leak into a rejection request.
    if (action === 'reject-accepted') {
        const rejectionReason = String(fields.get("rejectionReason") || '').trim();
        if (!rejectionReason) throw new Error(invoiceText('enterARejectionReason'));
        return {...confirmation, rejectionReason};
    }
    const correctedAmount = Number(fields.get("correctedAmount"));
    if (!Number.isFinite(correctedAmount) || correctedAmount <= 0 || correctedAmount > 99999999.99
        || Math.abs(correctedAmount * 100 - Math.round(correctedAmount * 100)) > 0.00001) {
        throw new Error(invoiceText('enterAPositiveAmountWithNoMoreThanTwo'));
    }
    return {...confirmation, correctedAmount, correctedDescription: String(fields.get("correctedDescription") || '').trim() || null};
}

const invoiceDialogTransitions = new WeakSet<HTMLElement>();
const invoiceDialogOpeners = new WeakMap<HTMLElement, HTMLElement>();

/** Sequence Bootstrap dialogs while retaining the focus origin and avoiding overlapping transitions. */
function showInvoiceDialog(target: HTMLElement, previous?: HTMLElement | null, opener?: HTMLElement): void {
    if (invoiceDialogTransitions.has(target) || (previous && invoiceDialogTransitions.has(previous))) return;
    const modal = window.bootstrap?.Modal?.getOrCreateInstance(target);
    if (!modal) return;
    // Preserve the original action's focus across edit, review, and cancellation transitions.
    const originalOpener = opener || (previous && invoiceDialogOpeners.get(previous)) || invoiceDialogOpeners.get(target);
    if (originalOpener) invoiceDialogOpeners.set(target, originalOpener);
    invoiceDialogTransitions.add(target);
    if (previous) invoiceDialogTransitions.add(previous);
    target.addEventListener('shown.bs.modal', () => {
        invoiceDialogTransitions.delete(target);
        if (previous) invoiceDialogTransitions.delete(previous);
    }, {once: true});
    target.addEventListener('hidden.bs.modal', () => {
        if (!invoiceDialogTransitions.has(target) && originalOpener?.isConnected) originalOpener.focus({preventScroll: true});
    }, {once: true});
    const show = () => modal.show();
    // Hide the current dialog completely before showing the next to retain a single Bootstrap focus trap.
    if (previous && previous !== target && previous.classList.contains('show')) {
        previous.addEventListener('hidden.bs.modal', show, {once: true});
        window.bootstrap?.Modal?.getOrCreateInstance(previous)?.hide();
    } else show();
}

/** Bind revision-aware invoice correction, rejection, and retraction reviews without optimistic writes. */
function initInvoiceLifecycleDialogs(): void {
    interface InvoiceTarget {poolId: string; invoiceId: string; revision: number; amount: string; description: string; originalDescription: string; closed: boolean;}
    // Keep each edit form's source revision separate from the captured payload awaiting final confirmation.
    const forms = new WeakMap<HTMLFormElement, InvoiceTarget>();
    let pending: {action: InvoiceChangeAction; invoice: InvoiceTarget; source: HTMLElement; payload: Record<string, unknown>} | undefined;
    let retraction: InvoiceTarget | undefined;
    const readTarget = (button: HTMLElement): InvoiceTarget => {
        const revision = Number(button.dataset.revision);
        if (!button.dataset.revision || !Number.isSafeInteger(revision) || revision < 0) throw new Error(invoiceText('reloadThePageBeforeChangingThisInvoice'));
        return {poolId: button.dataset.pool || '', invoiceId: button.dataset.id || '', revision,
            amount: Number(button.dataset.amount).toFixed(2), description: button.dataset.description || '',
            originalDescription: button.dataset.originalDescription || '', closed: button.dataset.poolStatus === 'CLOSED'};
    };
    const prepare = (modal: HTMLElement, invoice: InvoiceTarget) => {
        const subject = modal.querySelector<HTMLElement>('[data-invoice-change-subject]');
        if (subject) subject.textContent = invoiceText('countedInvoiceDetails', {invoiceId: invoice.invoiceId, amount: invoice.amount});
        const status = modal.querySelector<HTMLElement>('.pool-form-status');
        if (status) {
            clearPoolStatus(status);
        }
    };
    /** Open and confirm revision-aware invoice changes using the captured review context. */
    async function handleInvoiceLifecycleClick(event: Event) {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!button) return;
        try {
            // Opening an edit captures its invoice context and draft without making a persistence request.
            if (button.matches('.invoice-edit-open, .invoice-reject-open')) {
                const invoice = readTarget(button);
                const editing = button.classList.contains('invoice-edit-open');
                const modal = document.getElementById(editing ? "invoiceEditModal" : "invoiceRejectModal");
                const form = modal?.querySelector<HTMLFormElement>('form');
                if (!modal || !form) return;
                form.reset();
                if (editing) {
                    form.querySelector<HTMLInputElement>('[name="correctedAmount"]')!.value = invoice.amount;
                    form.querySelector<HTMLTextAreaElement>('[name="correctedDescription"]')!.value = invoice.description;
                }
                forms.set(form, invoice);
                prepare(modal, invoice);
                showInvoiceDialog(modal, null, button);
            } else if (button.classList.contains('invoice-confirm-back')) {
                const confirm = document.getElementById("invoiceConfirmModal");
                if (pending && confirm?.dataset.saving !== 'true') showInvoiceDialog(pending.source, confirm);
            } else if (button.classList.contains('invoice-confirm-submit')) {
                // Only the final confirmation submits the frozen review payload; no current form fields are reread.
                const modal = button.closest<HTMLElement>('.modal');
                if (!modal || !pending) return;
                const reviewed = pending;
                await runInvoiceAdminAction({scope: modal, trigger: button, requiresManageAssignments: true,
                    subject: invoiceText('invoiceNumber', {id: reviewed.invoice.invoiceId}),
                    pending: reviewed.action === 'revise' ? invoiceText('savingTheConfirmedCorrection') : invoiceText('savingTheConfirmedRejection'),
                    success: invoiceText(reviewed.invoice.closed ? reviewed.action === 'revise' ? 'invoiceCorrectedClosed' : 'invoiceRejectedClosed' : reviewed.action === 'revise' ? 'invoiceCorrected' : 'invoiceRejectedFromThePool'),
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${reviewed.invoice.poolId}/invoices/${reviewed.invoice.invoiceId}/${reviewed.action}`, reviewed.payload),
                    reload: true, reloadPool: reviewed.invoice.poolId});
            } else if (button.classList.contains('invoice-retract-open')) {
                // Retraction reviews the untouched submitted record using its own captured context.
                const modal = document.getElementById("invoiceRetractModal");
                if (!modal) return;
                retraction = readTarget(button);
                prepare(modal, retraction);
                const description = modal.querySelector<HTMLElement>('[data-invoice-retract-description]');
                if (description) description.textContent = retraction.description;
                showInvoiceDialog(modal, null, button);
            } else if (button.classList.contains('invoice-retract-confirm')) {
                // Reuse the existing revision-checked withdrawal API after the explicit retraction acknowledgement.
                const modal = button.closest<HTMLElement>('.modal');
                if (!modal || !retraction) return;
                const invoice = retraction;
                await runInvoiceAdminAction({scope: modal, trigger: button, subject: invoiceText('invoiceNumber', {id: invoice.invoiceId}),
                    pending: invoiceText('retractingTheInvoice'), success: invoiceText('invoiceRetractedItsDetailsAndProofRemainInYour'),
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${invoice.poolId}/invoices/${invoice.invoiceId}/retract`, {confirmed: true, expectedRevision: invoice.revision}),
                    onSuccess: () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#invoiceHistory`),
                    reload: true, reloadPool: invoice.poolId});
            }
        } catch (error) {
            showPoolFeedback(button.closest('.modal') || button.closest('[data-invoice-row]') || button.parentElement!, 'error', error instanceof Error ? error.message : invoiceText('unableToChangeTheInvoice'));
        }
    }
    document.addEventListener('click', handleInvoiceLifecycleClick);
    /** Capture a proposed invoice edit and display its separate final review before mutation. */
    function reviewInvoiceLifecycleSubmit(event: Event) {
        const form = event.target as HTMLFormElement;
        if (!form.classList.contains('invoice-lifecycle-form')) return;
        event.preventDefault();
        const invoice = forms.get(form);
        const source = form.closest<HTMLElement>('.modal');
        const modal = document.getElementById("invoiceConfirmModal");
        if (!invoice || !source || !modal) return;
        if (invoiceDialogTransitions.has(source) || invoiceDialogTransitions.has(modal)) return;
        try {
            // Validate and freeze the proposed fields before showing the final review in a separate dialog.
            const action = form.dataset.action as InvoiceChangeAction;
            const payload = invoiceChangePayload(action, invoice.revision, new FormData(form));
            pending = {action, invoice, source, payload};
            prepare(modal, invoice);
            const review = modal.querySelector<HTMLElement>('[data-invoice-change-review]');
            if (review) {
                review.replaceChildren();
                const entries = action === 'revise'
                    ? [[invoiceText('newAmount'), Number(payload.correctedAmount).toFixed(2)], [invoiceText('description'), String(payload.correctedDescription ?? invoice.originalDescription) || invoiceText('noDescription')]]
                    : [[invoiceText('rejectionReason'), String(payload.rejectionReason)]];
                // Insert names, descriptions, and rejection reasons as text so submitted content is never parsed as HTML.
                for (const [label, value] of entries) {
                    const line = document.createElement('p');
                    const title = document.createElement('strong');
                    title.textContent = `${label}: `;
                    line.append(title, document.createTextNode(value));
                    review.append(line);
                }
            }
            const warning = modal.querySelector<HTMLElement>('[data-invoice-closed-warning]');
            // Closed-pool guidance explains that the correction changes future calculations rather than saved payments.
            if (warning) warning.hidden = !invoice.closed;
            const confirm = modal.querySelector<HTMLButtonElement>('.invoice-confirm-submit');
            if (confirm) confirm.textContent = action === 'revise' ? invoiceText('confirmCorrection') : invoiceText('confirmRejection');
            showInvoiceDialog(modal, source);
        } catch (error) {
            showPoolFeedback(form, 'error', error instanceof Error ? error.message : invoiceText('checkTheInvoiceFields'));
        }
    }
    document.addEventListener('submit', reviewInvoiceLifecycleSubmit);
}

function invalidatePoolPreview(poolId: string | undefined): void {
    const modal = document.getElementById(`pool-${poolId}-calculation`);
    if (!modal) return;
    delete modal.dataset.previewRevision;
    const confirm = modal.querySelector<HTMLButtonElement>('.pool-close, .pool-recalculate');
    if (confirm) confirm.disabled = true;
}

/** Render the actual server calculation using text nodes for participant-supplied details. */
export function renderPoolCalculationPreview(modal: HTMLElement, preview: PoolCalculationPreview): void {
    // Validate revision and amount fields before enabling calculation; a malformed preview cannot be confirmed.
    const rows = modal.querySelector<HTMLTableSectionElement>('[data-pool-preview-rows]');
    if (!rows) throw new Error(invoiceText('calculationPreviewIsUnavailableReloadThePage'));
    const amountFields = ["baseShareAmount", "extraAmount", "invoiceCreditAmount", "paymentCreditAmount", "shareAmount"] as const;
    if (!Number.isSafeInteger(preview.revision) || preview.revision < 0 || !Array.isArray(preview.shares)) {
        throw new Error(invoiceText('theCalculationPreviewCouldNotBeVerifiedRefreshThe'));
    }
    for (const share of preview.shares) {
        for (const field of amountFields) {
            if (share[field] === null || share[field] === '' || !Number.isFinite(Number(share[field]))) {
                throw new Error(invoiceText('theCalculationPreviewCouldNotBeVerifiedRefreshThe'));
            }
        }
    }
    // Build text-only rows, keeping user names and saved notes out of HTML parsing.
    rows.replaceChildren();
    const vocabulary = getInvoiceLabels(preview.labels);
    const columns = invoicePresentation.columns(preview.shares);
    renderPreviewColumns(modal, vocabulary.payer, columns);
    let outstanding = 0;
    let refunds = 0;
    for (const share of preview.shares) {
        const row = document.createElement('tr');
        const payer = document.createElement('td');
        payer.dataset.label = vocabulary.payer;
        const name = document.createElement('strong');
        name.textContent = share.payerName || invoiceText('participant', {id: share.registrationId});
        payer.appendChild(name);
        // Keep preview rows compact: these details contain the allocator's saved/projected audit notes only.
        // The shared example above the table explains the arithmetic; full payer calculations remain in saved breakdowns.
        const notes = (share.note || '').split(' • ').filter(note => note.trim());
        if (notes.length) {
            const details = document.createElement('details');
            details.className = 'small mt-1';
            const summary = document.createElement('summary');
            summary.textContent = invoiceText('calculationDetails');
            details.append(summary);
            const list = document.createElement('ul');
            list.className = 'text-secondary ps-3 mb-0';
            // Preserve supplied wording and names as text, without expanding another formula or inventing an empty state.
            for (const text of notes) {
                const note = document.createElement('li');
                note.textContent = text;
                list.appendChild(note);
            }
            details.append(list);
            payer.appendChild(details);
        }
        row.appendChild(payer);
        // Common columns include only financial components actually used by this calculation. Their labels
        // and visibility come from the same presenter as saved views, exports, and emails.
        for (const column of columns) {
            const cell = document.createElement('td');
            cell.dataset.label = column.label;
            cell.textContent = formatInvoiceMoney(share[column.key]);
            // Settlement completion changes the status only; the primary cell keeps the calculated amount.
            if (column.key === "shareAmount") {
                cell.className = 'fw-semibold';
                const state = document.createElement('small');
                state.className = 'd-block text-info fw-normal';
                state.textContent = presentInvoiceSettlement(Number(share.shareAmount), share.isPaid, vocabulary).statusLabel;
                cell.appendChild(state);
            }
            row.appendChild(cell);
        }
        rows.appendChild(row);
        if (!share.isPaid) {
            outstanding += Math.max(Number(share.shareAmount), 0);
            refunds += Math.min(Number(share.shareAmount), 0);
        }
    }
    const due = modal.querySelector<HTMLElement>('[data-pool-preview-outstanding]');
    const credit = modal.querySelector<HTMLElement>('[data-pool-preview-refunds]');
    // Keep meaningful credits and rounding evidence separate from transfers; the shared example owns adjustment modes.
    const reconciliation = modal.querySelector<HTMLElement>('[data-pool-preview-reconciliation]');
    if (reconciliation) reconciliation.hidden = true;
    if (preview.totals) {
        const totals = preview.totals;
        const keys = ["invoiceAmount", "redistributedAmount", "distributableAmount", "allocatedBaseAmount",
            "roundingDifference", "adjustmentAmount", "grossAmount", "invoiceCreditAmount", "expectedNetAmount",
            "calculatedAmount", "paymentCreditAmount", "outstandingAmount", "creditAmount"] as const;
        if (keys.some(key => typeof totals[key] !== 'number' || !Number.isFinite(totals[key]))) {
            throw new Error(invoiceText('theCalculationTotalsCouldNotBeVerifiedRefreshThe'));
        }
        // Validate the full response above even though the template exposes only useful nonzero source components.
        // Each present row is reset on every render, so a later ordinary preview cannot retain earlier exceptions.
        let hasRelevantTotals = false;
        for (const key of keys) {
            const value = modal.querySelector<HTMLElement>(`[data-preview-total="${key}"]`);
            const row = modal.querySelector<HTMLElement>(`[data-preview-total-row="${key}"]`);
            if (value) value.textContent = formatInvoiceMoney(totals[key]);
            if (row) {
                row.hidden = totals[key] === 0;
                if (!row.hidden) hasRelevantTotals = true;
            }
        }
        // Transfer totals remain authoritative server values; visibility changes never recalculate financial amounts.
        outstanding = totals.outstandingAmount;
        refunds = -totals.creditAmount;
        if (reconciliation) reconciliation.hidden = !hasRelevantTotals;
    }
    // Attach the saved numerical evidence and publish the exact revision reviewed by the organizer.
    const hasCalculation = renderPreviewCalculationBasis(modal, preview);
    if (reconciliation) reconciliation.hidden = reconciliation.hidden && !hasCalculation;
    const settlementHint = modal.querySelector<HTMLElement>('[data-pool-preview-settlement-hint]');
    if (settlementHint) settlementHint.hidden = !columns.some(column => column.key === 'paymentCreditAmount');
    if (due) due.textContent = outstanding.toFixed(2);
    if (credit) credit.textContent = refunds.toFixed(2);
    modal.querySelector<HTMLElement>('[data-pool-preview-table]')?.removeAttribute('hidden');
    modal.querySelector<HTMLElement>('[data-pool-preview-summary]')?.removeAttribute('hidden');
    modal.dataset.previewRevision = String(preview.revision);
}

/** Match the preview header to the relevant saved financial components before rendering its payer rows. */
function renderPreviewColumns(modal: HTMLElement, payerLabel: string, columns: readonly {label: string}[]): void {
    const header = modal.querySelector<HTMLTableRowElement>('[data-pool-preview-columns]');
    if (!header) return;
    // Rebuild the header on each response so a later ordinary preview drops previously used optional columns.
    header.replaceChildren();
    const payer = document.createElement('th');
    payer.setAttribute('scope', 'col');
    payer.textContent = payerLabel;
    header.appendChild(payer);
    // Labels are catalog-owned plain text. Short responsive card labels use the same values in each payer cell.
    for (const column of columns) {
        const heading = document.createElement('th');
        heading.setAttribute('scope', 'col');
        heading.textContent = column.label;
        header.appendChild(heading);
    }
}

/** Render numbers in the preview breakdown and arithmetic in its separate optional example disclosure. */
function renderPreviewCalculationBasis(modal: HTMLElement, preview: PoolCalculationPreview): boolean {
    const basis = modal.querySelector<HTMLElement>('[data-pool-preview-basis]');
    const content = modal.querySelector<HTMLElement>('[data-pool-preview-basis-lines]');
    const distribution = modal.querySelector<HTMLElement>('[data-pool-preview-distribution]');
    const example = modal.querySelector<HTMLElement>('[data-pool-preview-example]');
    if (!basis || !content) return false;
    // This typed overview contains only labelled cost and distribution numbers. It remains independently
    // available even when missing contribution evidence prevents an illustrative personal calculation.
    const breakdown = invoicePresentation.poolBreakdown(preview.explanation);
    if (distribution) renderInvoiceCalculation(distribution, breakdown, false);
    // The example explains total/base arithmetic first, then the selected anonymous payer's calculation.
    // Its separate collapsed disclosure owns the title, so the renderer must not repeat a heading in its body.
    const calculation = preview.calculation || invoicePresentation.calculation(preview.explanation, preview.shares);
    renderInvoiceCalculation(content, calculation, false);
    // Missing numeric evidence never creates an empty example heading or a made-up payer.
    content.hidden = !calculation.sections.length;
    if (example) example.hidden = !calculation.sections.length;
    const hasCalculation = breakdown.sections.length > 0 || calculation.sections.length > 0;
    basis.hidden = !breakdown.sections.length;
    return hasCalculation;
}

/** Load a current read-only calculation, reject superseded results, and unlock reviewed confirmation. */
async function loadPoolCalculationPreview(poolId: string | undefined): Promise<void> {
    const modal = document.getElementById(`pool-${poolId}-calculation`);
    if (!modal) return;
    const confirm = modal.querySelector<HTMLButtonElement>('.pool-close, .pool-recalculate');
    if (modal.dataset.saving === 'true' || modal.dataset.previewLoading === 'true') return;
    // Remove the old confirmation revision before requesting new data; unsaved edits prevent a meaningful preview.
    invalidatePoolPreview(poolId);
    modal.querySelector<HTMLElement>('[data-pool-preview-table]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-summary]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-reconciliation]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-basis]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-example]')?.setAttribute('hidden', '');
    // A request token prevents a late response from replacing a newer preview or enabling its confirmation.
    const requestId = String(Number(modal.dataset.previewRequest || 0) + 1);
    modal.dataset.previewRequest = requestId;
    const unsaved = poolHasUnsavedChanges(poolId);
    const warning = modal.querySelector<HTMLElement>('.pool-unsaved-warning');
    if (warning) warning.hidden = !unsaved;
    if (unsaved) {
        showPoolFeedback(modal, 'error', invoiceText('saveOrDiscardPendingEditsThenRefreshThisPreview'));
        return;
    }
    // Keep visible progress active while fetching; only a validated current response unlocks confirmation.
    const refresh = modal.querySelector<HTMLButtonElement>('.pool-preview-refresh');
    modal.dataset.previewLoading = 'true';
    const refreshLabel = refresh ? Array.from(refresh.childNodes) : [];
    if (refresh) {
        refresh.disabled = true;
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        refresh.replaceChildren(spinner, document.createTextNode(invoiceText('preparing')));
    }
    modal.setAttribute('aria-busy', 'true');
    showPoolProgress(modal, invoiceText('preparingTheCalculationPreview'));
    const delayed = window.setTimeout(() => {
        if (modal.dataset.previewRequest === requestId) showPoolProgress(modal, invoiceText('stillPreparingThePreviewNoChangesHaveBeenMade'));
    }, 5000);
    try {
        requireManageAssignments();
        const response = await get(`/api/event/${getEventId()}/invoice-pools/${poolId}/preview`);
        if (modal.dataset.previewRequest !== requestId) return;
        // Rendering verifies financial data and attaches the revision before the confirm button becomes usable.
        renderPoolCalculationPreview(modal, response.data || response);
        if (confirm) confirm.disabled = false;
        showPoolFeedback(modal, 'info', invoiceText('previewReadyReviewEachPayerBeforeApplyingThisCalculation'));
    } catch (err) {
        if (modal.dataset.previewRequest !== requestId) return;
        invalidatePoolPreview(poolId);
        showPoolFeedback(modal, 'error', err instanceof Error ? err.message : invoiceText('unableToLoadTheCalculationPreview'));
    } finally {
        window.clearTimeout(delayed);
        // Only the owning request may restore progress controls, avoiding interference with a newer fetch.
        if (modal.dataset.previewRequest === requestId) {
            delete modal.dataset.previewLoading;
            modal.removeAttribute('aria-busy');
            if (refresh) {
                refresh.disabled = false;
                refresh.replaceChildren(...refreshLabel);
            }
        }
    }
}

/** Apply only the reviewed calculation revision after checking for unsaved allocation edits. */
async function calculatePool(target: HTMLButtonElement, recalculate: boolean): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || modal.dataset.saving === 'true') return;
    // Revalidate local edits and the reviewed revision immediately before sending the existing close/recalculate command.
    if (poolHasUnsavedChanges(target.dataset.id)) {
        invalidatePoolPreview(target.dataset.id);
        showPoolFeedback(modal, 'error', invoiceText('saveOrDiscardYourPendingEditsAndRefreshThe'));
        return;
    }
    const revision = modal.dataset.previewRevision;
    if (revision === undefined || !Number.isSafeInteger(Number(revision))) {
        showPoolFeedback(modal, 'error', invoiceText('refreshAndReviewTheCalculationPreviewBeforeContinuing'));
        return;
    }
    // The organizer’s preview choice overrides only this calculation’s notification preference.
    const sendEmails = !!modal.querySelector<HTMLInputElement>("input[name=\"sendEmails\"]")?.checked;
    const applied = await runInvoiceAdminAction({scope: modal, trigger: target, requiresManageAssignments: true,
        pending: invoiceText('applyingTheReviewedCalculation'),
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${recalculate ? 'recalculate' : 'close'}`, {
            sendEmails, expectedRevision: Number(revision),
        }),
        success: invoiceText(recalculate ? sendEmails ? 'poolRecalculatedWithEmails' : 'poolRecalculatedWithoutEmails' : sendEmails ? 'poolClosedWithEmails' : 'poolClosedWithoutEmails'),
        reload: true, reloadPool: target.dataset.id,
    });
    if (!applied) invalidatePoolPreview(target.dataset.id);
}

/** Confirm an optional pool-state change while retaining the existing pool and its inputs. */
async function changePoolSubmissionState(target: HTMLButtonElement): Promise<void> {
    const pool = target.closest<HTMLElement>('.invoice-pool');
    if (!pool || pool.dataset.saving === 'true') return;
    const status = target.dataset.status;
    const revision = Number(pool.dataset.poolRevision);
    // Capture the rendered revision and permitted nonfinancial target; do not infer lifecycle from translated labels.
    if ((status !== 'OPEN' && status !== 'ORGANIZER_ONLY') || !Number.isSafeInteger(revision) || revision < 0) {
        showPoolFeedback(pool, 'error', invoiceText('poolChangedBeforeSubmissionState'));
        return;
    }
    // Reopening the page must not discard local allocation drafts without first saving or resetting them.
    if (poolHasUnsavedChanges(target.dataset.id)) {
        showPoolFeedback(pool, 'error', invoiceText('saveOrDiscardPendingEditsThenRefreshThisPreview'));
        return;
    }
    const organizerOnly = status === 'ORGANIZER_ONLY';
    const action = invoiceText(organizerOnly ? 'closeParticipantInvoices' : 'openParticipantInvoices');
    if (!await requestInvoiceConfirmation(pool.dataset.poolName || '',
        invoiceText(organizerOnly ? 'confirmCloseParticipantInvoices' : 'confirmOpenParticipantInvoices'), action, target)) return;
    // The common pending flow locks the pool and publishes only the server-confirmed state after reload.
    await runInvoiceAdminAction({scope: pool, trigger: target, requiresManageAssignments: true,
        pending: invoiceText('changingParticipantInvoiceAccess'),
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/submission-state`, {status, expectedRevision: revision}),
        success: invoiceText(organizerOnly ? 'participantInvoicesClosed' : 'participantInvoicesOpened'),
        reload: true, reloadPool: target.dataset.id,
    });
}

/** Request saved-input rollback or saved-share notifications through the existing command endpoints. */
async function submitPoolAction(target: HTMLButtonElement, action: 'rollback' | 'notify'): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || modal.dataset.saving === 'true') return;
    // Rollback restores local inputs; notification requests reuse saved shares. Both use the standard pending flow.
    const completed = await runInvoiceAdminAction({scope: modal, trigger: target, requiresManageAssignments: true,
        pending: action === 'rollback' ? invoiceText('restoringTheLastCalculatedPoolSettings') : invoiceText('requestingSettlementEmails'),
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${action}`),
        success: response => response.message || (action === 'rollback'
            ? invoiceText('poolChangesRolledBackExistingSharesAndRecordedPayments') : invoiceText('settlementEmailsRequested2')),
        onSuccess: /** Coordinate this invoice interaction using its captured DOM state and the shared action flow. */
        function onSuccess() {
            if (action !== 'rollback') return;
            invalidatePoolPreview(target.dataset.id);
            const returnButton = modal.querySelector<HTMLButtonElement>('.pool-return');
            if (returnButton) returnButton.hidden = false;
            // Leave the outcome visible, including any external changes that still need recalculation.
            modal.addEventListener('hidden.bs.modal', () => {
                rememberPool(target.dataset.id);
                window.location.reload();
            }, {once: true});
        },
    });
    if (!completed) return;
    target.disabled = true;
    if (action === 'notify') {
        // Wait until the shared pending flow has removed its dismissal guard. Only an explicit
        // successful response closes this dialog; rejected or uncertain sends retain their feedback.
        // Keep the send button locked through the closing animation, then restore it for a later
        // deliberate notification request after the organizer opens the dialog again.
        /** Restore the notification action only after Bootstrap has completed dismissal. */
        function restoreNotificationAction() { target.disabled = false; }
        modal.addEventListener('hidden.bs.modal', restoreNotificationAction, {once: true});
        window.bootstrap?.Modal.getOrCreateInstance(modal).hide();
    }
}

/**
 * Initialize takeover modal for invoice management
 */
function initTakeoverModal(): void {
    const modalElement = document.getElementById("takeoverModal");
    const formElement = modalElement?.querySelector<HTMLFormElement>('#takeoverForm');
    const beneficiaryElement = modalElement?.querySelector<HTMLElement>('.takeover-beneficiaries');
    if (!modalElement || !formElement || !beneficiaryElement) return;
    // Capture checked nodes for every deferred named handler; optional chooser controls remain explicitly nullable.
    const modalEl = modalElement;
    const form = formElement;
    const beneficiaryList = beneficiaryElement;
    const payerSelect = modalEl.querySelector<HTMLSelectElement>('#takeoverPayer');
    const searchInput = modalEl.querySelector<HTMLInputElement>('.takeover-search');

    // This shared dialog keeps one pool/payer context at a time; opening another pool replaces its selection.
    let activePoolId: string | null = null;
    let activeMode: 'admin' | 'participant' = 'admin';
    let assignedIds: number[] = [];
    let takeovers: {payerRegistrationId: number; beneficiaryRegistrationId: number}[] = [];
    let poolClosed = false;
    let participantTakeoversBlocked = false;
    const payerWrapper = payerSelect?.closest('.admin-only') as HTMLElement | null;
    const summary = modalEl.querySelector<HTMLElement>('[data-takeover-summary]');
    const context = modalEl.querySelector<HTMLElement>('[data-takeover-status]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const participantName = (id: number) => participantsData.find(p => p.id === id)?.name || invoiceText('participant', {id: id});
    const activePayer = () => activeMode === 'admin' ? Number(payerSelect?.value || 0) : registrationData?.id || 0;

    const updateSummary = () => {
        if (!summary) return;
        const payerId = activePayer();
        const selected = Array.from(beneficiaryList.querySelectorAll<HTMLInputElement>('input:checked')).map(input => participantName(Number(input.value)));
        summary.textContent = !payerId ? invoiceText('chooseAPayerToManageCoverage')
            : invoiceText(selected.length ? 'payerCoversOthers' : 'payerCoversSelf', {payer: participantName(payerId), count: selected.length});
    };
    const filterBeneficiaries = () => {
        const term = (searchInput?.value || '').toLowerCase();
        beneficiaryList.querySelectorAll<HTMLElement>('[data-search-text]').forEach(row => {
            row.classList.toggle('d-none', !!term && !(row.dataset.searchText || '').includes(term));
        });
    };
    /** Render one eligible coverage choice with explicit reasons for unavailable participants. */
    function renderBeneficiaries(payerId: number) {
        // Derive current coverage and block invalid one-level chains before constructing selectable participants.
        beneficiaryList.replaceChildren();
        const covered = new Set(takeovers.filter(t => t.payerRegistrationId === payerId).map(t => t.beneficiaryRegistrationId));
        const payerCovered = takeovers.some(t => t.beneficiaryRegistrationId === payerId);
        // Render one eligible coverage choice with explicit reasons for unavailable participants.
        for (const id of assignedIds.filter(id => id !== payerId)) {
            const participant = participantsData.find(p => p.id === id);
            const owner = takeovers.find(t => t.beneficiaryRegistrationId === id && t.payerRegistrationId !== payerId);
            const isPayer = takeovers.some(t => t.payerRegistrationId === id);
            const unavailable = !payerId || (payerCovered && !covered.has(id)) || isPayer
                || (activeMode === 'participant' && (!!owner || participantTakeoversBlocked));
            // Each choice carries a plain-text name, optional email, and a catalog-owned reason when unavailable.
            const row = document.createElement('label');
            row.className = 'list-group-item bg-dark text-white d-flex align-items-start gap-3 py-3';
            row.dataset.searchText = `${participantName(id)} ${participant?.email || ''}`.toLowerCase();
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input mt-1 flex-shrink-0';
            checkbox.value = String(id);
            checkbox.checked = covered.has(id);
            checkbox.disabled = unavailable;
            const details = document.createElement('span');
            const name = document.createElement('strong');
            name.className = 'd-block';
            name.textContent = participantName(id);
            details.appendChild(name);
            if (participant?.email) {
                const email = document.createElement('small');
                email.className = 'd-block text-secondary';
                email.textContent = participant.email;
                details.appendChild(email);
            }
            const reason = payerCovered ? invoiceText('thisPayerIsAlreadyCoveredBySomeoneElse')
                : isPayer ? invoiceText('alreadyCoversAnotherParticipantClearThatCoverageFirst')
                : owner ? invoiceText(activeMode === 'admin' ? 'coveredByParticipantReassign' : 'coveredByParticipant', {payer: participantName(owner.payerRegistrationId)}) : '';
            if (reason) {
                const note = document.createElement('small');
                note.className = 'd-block text-warning mt-1';
                note.textContent = reason;
                details.appendChild(note);
            }
            row.append(checkbox, details);
            beneficiaryList.appendChild(row);
        }
        // Keep empty results and organizer/participant permissions explicit, then refresh visible coverage counts.
        if (!beneficiaryList.children.length) {
            const empty = document.createElement('p');
            empty.className = 'text-secondary small p-3 mb-0';
            empty.textContent = invoiceText('noOtherParticipantsAreAssignedToThisPool');
            beneficiaryList.appendChild(empty);
        }
        if (submit) submit.disabled = !payerId || (activeMode === 'participant' && participantTakeoversBlocked);
        filterBeneficiaries();
        updateSummary();
    }

    payerSelect?.addEventListener('change', () => renderBeneficiaries(activePayer()));
    searchInput?.addEventListener('input', filterBeneficiaries);
    beneficiaryList.addEventListener('change', updateSummary);

    /** Hydrate the selected pool’s coverage and the actor’s payer-selection authority. */
    function openTakeoverChooser(e: Event) {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('.manage-takeovers');
        if (!btn) return;
        const poolRoot = btn.closest<HTMLElement>('.invoice-pool') || btn.closest<HTMLElement>('[data-pool]');
        if (!poolRoot) return;
        // Hydrate the chosen pool’s saved coverage; this chooser never infers state from translated display text.
        activePoolId = poolRoot.dataset.pool || null;
        assignedIds = JSON.parse(poolRoot.dataset.assigned || '[]');
        takeovers = JSON.parse(poolRoot.dataset.takeovers || '[]');
        poolClosed = poolRoot.dataset.poolStatus === 'CLOSED';
        // ORGANIZER_ONLY and CLOSED both block participant edits; only CLOSED organizer edits await recalculation.
        participantTakeoversBlocked = poolRoot.dataset.poolStatus !== 'OPEN';
        activeMode = btn.dataset.mode === 'admin' ? 'admin' : 'participant';
        const title = modalEl.querySelector<HTMLElement>('[data-takeover-title]');
        if (title) title.textContent = invoiceText(poolRoot.dataset.poolName ? 'manageNamedTakeovers' : 'manageTakeovers2', {pool: poolRoot.dataset.poolName || ''});
        const feedback = form.querySelector<HTMLElement>('.pool-form-status');
        if (feedback) clearPoolStatus(feedback);
        if (context) {
            context.hidden = false;
            context.textContent = poolClosed
                ? invoiceText('theseChangesAffectTheNextCalculationRecordedPaymentsStay')
                : invoiceText('saveCoverageForOnePayerAtATimeCovered');
        }
        if (payerWrapper) payerWrapper.classList.toggle('d-none', activeMode === 'participant');
        // Organizers choose the payer; participant mode uses the authenticated registration and existing endpoint.
        if (activeMode === 'admin' && payerSelect) {
            requireManageAssignments();
            payerSelect.replaceChildren();
            assignedIds.forEach(id => {
                const opt = document.createElement('option');
                opt.value = String(id);
                opt.textContent = participantName(id);
                payerSelect.appendChild(opt);
            });
            if (btn.dataset.payer) payerSelect.value = btn.dataset.payer;
            if (!payerSelect.value && payerSelect.options.length) payerSelect.selectedIndex = 0;
        }
        if (searchInput) searchInput.value = '';
        renderBeneficiaries(activePayer());
        showInvoiceDialog(modalEl, btn.closest<HTMLElement>('.modal'), btn);
    }
    document.addEventListener('click', openTakeoverChooser);

    /** Submit one payer’s coverage through the existing organizer or participant endpoint. */
    async function saveTakeoverChoices(e: Event) {
        e.preventDefault();
        if (!activePoolId || form.dataset.saving === 'true') return;
        if (activeMode === 'participant' && participantTakeoversBlocked) {
            showPoolFeedback(form, 'error', invoiceText('participantTakeoverChangesAreOnlyAvailableWhileThePool'));
            return;
        }
        // Capture the selected beneficiaries once and retain the current organizer/participant request shape.
        const beneficiaries = Array.from(beneficiaryList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter(box => box.checked).map(box => box.value);
        const payload: Record<string, unknown> = {beneficiaries};
        if (activeMode === 'admin') payload.payerId = activePayer();
        const endpoint = activeMode === 'admin'
            ? `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers/manage`
            : `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers`;
        if (!submit) return;
        // The shared action flow checks organizer permissions and locks the form until the saved outcome is known.
        await runInvoiceAdminAction({scope: form, trigger: submit,
            requiresManageAssignments: activeMode === 'admin',
            pending: invoiceText('savingTakeovers'), request: () => post(endpoint, payload),
            success: invoiceText(poolClosed ? 'takeoversSavedClosed' : 'takeoversSaved'),
            reload: true, reloadPool: activePoolId,
        });
    }
    form.addEventListener('submit', saveTakeoverChoices);
}

/**
 * Initialize invoice submission form
 */
export function initInvoiceSubmission(): void {
    // Return a successful submission to its authoritative history while restoring the enclosing collapsed section.
    if (window.location.hash === '#invoiceHistory') {
        for (const id of ["participantInvoiceCollapse", "invoicePoolCollapse"]) {
            document.getElementById(id)?.classList.add('show');
            const toggle = document.querySelector(`[data-bs-target="#${id}"]`);
            toggle?.classList.remove('collapsed');
            toggle?.setAttribute('aria-expanded', 'true');
        }
        document.getElementById("invoiceHistory")?.scrollIntoView({block: 'start'});
    }
    // One binder owns upload progress, duplicate-submit prevention, and uncertain-result recovery.
    const form = document.getElementById("invoiceSubmitForm") as HTMLFormElement | null;
    if (form) bindInvoiceSubmission(form, {eventId: getEventId(), registered: !!registrationData?.id});
}

/**
 * Initialize event management page
 */
export function init(): void {
    // Initialize data from page scripts first
    initializeData();

    setCurrentNavLocation();
    loadPerms();
    allergyCheck();
    deadlineUpdater();
    initDateRange();
    initRegistrationDateRange();
    initEntityLists();
    initEntityOverview("#entityLists");

    // Bind review gates before financial controls; all invoice initializers consume the same rendered page data.
    initTakeoverModal();
    initInvoiceCommandConfirmation();
    initInvoiceNumberScrollProtection();
    initInvoiceAdmin();
    initInvoiceLifecycleDialogs();
    initInvoiceLedgers();
    initShareLedgers();
    initTakeoverOverviews();
    initInvoiceSubmission();
    restoreInvoiceFeedback();

    // Registration and common entity-header behavior retain their existing event-specific initialization.
    if (getEventId()) {
        initRegistration();
        initCancelRegistration();


        initEntityHeader();
    }
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
