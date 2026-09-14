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

import {formatISOInTimeZone} from './core/formatting';
import {get, post} from './core/http';
import {initEntityLists, setCurrentNavLocation} from './core/navigation';
import {loadPerms, requireEntityPerm, requireEntityPermsForForm} from './core/permissions';
import {initEntityOverview} from "./modules/entity-cards-overview";
import {initEntityHeader} from "./modules/entity-header";
import {bindInvoiceSubmission} from './modules/invoice-submission';
import {scheduleAlertDismissal, showInlineAlert} from './shared/alerts';
import {formatDuration, parseJsonScript, reloadAfterDelay, updateToLocalString} from './shared/ui-helpers';

/**
 * Reload delay constant
 */
const RELOAD_DELAY_MS = 120;

// Module-level variables - initialized in init()
let participantsData: any[] = [];
let registrationData: { id: number } | null = null;
let dataInitialized = false;

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
 * Initialize event update form
 */
export function initUpdate(): void {
    const form = document.getElementById('eventUpdateForm');
    if (!form) return;

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        try {
            const formData = new FormData(form as HTMLFormElement);
            const checkboxes = form.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
            for (const checkbox of checkboxes) {
                formData.set(checkbox.name, checkbox.checked ? 'on' : 'off');
            }

            requireEntityPermsForForm(formData, [
                {
                    fields: ['location', 'startDate', 'endDate', 'bindingDeadline', 'deadlineTz', 'allowRegDateUpdateAfterDeadline', 'allowRegCancelAfterDeadline'],
                    perm: 'EDIT_META',
                    action: 'update event metadata'
                },
                {fields: ['title'], perm: 'EDIT_TITLE', action: 'update the event title'},
                {fields: ['description'], perm: 'EDIT_DESC', action: 'update the description'},
                {
                    fields: ['requireDietaryInfo', 'allowDietComment', 'allowDietUpdateAfterDeadline'],
                    perm: 'MANAGE_REQUIREMENTS',
                    action: 'change dietary settings'
                },
                {fields: ['maxParticipants'], perm: 'EDIT_CAPACITY', action: 'change participant limits'},
            ]);
            await post(`/api/event/${getEventId()}/update`, Object.fromEntries(formData.entries()));
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(RELOAD_DELAY_MS);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update the event.';
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

function requireManageAssignments(action: string): void {
    requireEntityPerm('MANAGE_ASSIGNMENTS', action);
}

/**
 * Serialize the editable invoice pool base parameters
 */
export function serializePoolBaseSettings(form: HTMLFormElement): Record<string, FormDataEntryValue> {
    const formData = new FormData(form);
    const payload: Record<string, FormDataEntryValue> = {
        description: formData.get('description') || '',
        distribution: formData.get('distribution') || '',
    };
    if (formData.get('sendCalculationEmailsConfigured') === 'on') {
        payload.sendCalculationEmails = formData.get('sendCalculationEmails') === 'on' ? 'on' : '';
    }
    if (formData.get('roundUpSharesConfigured') === 'on') {
        payload.roundUpShares = formData.get('roundUpShares') === 'on' ? 'on' : '';
    }
    return payload;
}

/** Keep every selected exemption and factor when an assignment form is saved. */
export function serializePoolAssignments(form: HTMLFormElement): Record<string, unknown> {
    const formData = new FormData(form);
    const factors: Record<string, string> = {};
    form.querySelectorAll<HTMLInputElement>('[data-participant-factor]').forEach((input) => {
        if (!input.disabled && input.dataset.participantFactor) factors[input.dataset.participantFactor] = input.value;
    });
    return {
        registrations: formData.getAll('registrations'),
        exemptions: formData.getAll('exemptions'),
        assignAll: formData.get('assignAll') === 'on' ? 'on' : '',
        isDefault: formData.get('isDefault') === 'on' ? 'on' : '',
        subtractPersonalInvoices: formData.get('subtractPersonalInvoices') === 'on' ? 'on' : '',
        participantFactors: factors,
    };
}

const poolFeedbackTimers = new WeakMap<HTMLElement, () => void>();

function poolStatusElement(root: Element): HTMLElement {
    const existing = root.querySelector<HTMLElement>('.pool-form-status');
    if (existing) return existing;
    const container = document.createElement('div');
    container.className = 'pool-form-status small mt-2';
    container.setAttribute('aria-live', 'polite');
    const parent = root.tagName === 'TR' ? root.lastElementChild || root : root;
    parent.appendChild(container);
    return container;
}

function showPoolFeedback(root: Element, status: 'success' | 'info' | 'error', message: string): void {
    const container = poolStatusElement(root);
    poolFeedbackTimers.get(container)?.();
    container.classList.remove('text-success', 'text-info', 'text-danger');
    container.classList.add(status === 'error' ? 'text-danger' : status === 'success' ? 'text-success' : 'text-info');
    container.setAttribute('role', 'alert');
    container.textContent = message;
    poolFeedbackTimers.set(container, scheduleAlertDismissal(container, () => {
        container.replaceChildren();
        container.removeAttribute('role');
    }));
}

function showPoolProgress(root: Element, message: string): void {
    const container = poolStatusElement(root);
    poolFeedbackTimers.get(container)?.();
    container.classList.remove('text-success', 'text-danger');
    container.classList.add('text-info');
    container.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'spinner-border spinner-border-sm me-2';
    spinner.setAttribute('aria-hidden', 'true');
    container.replaceChildren(spinner, document.createTextNode(message));
}

function rememberPool(poolId: string | undefined): void {
    if (!poolId) return;
    try { sessionStorage.setItem('surveyor:invoice-pool', `${getEventId()}:${poolId}`); } catch { /* Storage is optional. */ }
}

interface InvoiceAdminAction {
    scope: HTMLElement;
    trigger: HTMLElement;
    pending: string;
    success: string | ((response: any) => string);
    request: () => Promise<any>;
    permission?: string;
    onSuccess?: (response: any) => void;
    reloadPool?: string;
    reload?: boolean;
}

/** Keep every financial action visibly pending until its response confirms completion. */
export async function runInvoiceAdminAction(options: InvoiceAdminAction): Promise<boolean> {
    const {scope, trigger} = options;
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
    const originalChildren = trigger.tagName === 'BUTTON' ? Array.from(trigger.childNodes) : null;
    if (originalChildren) {
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        trigger.replaceChildren(spinner, document.createTextNode('Working…'));
    }
    showPoolProgress(scope, options.pending);
    const slow = window.setTimeout(() => showPoolProgress(scope, 'Still working. The server has not confirmed this change yet. Keep this page open and do not repeat the action.'), 5000);
    let succeeded = false;
    try {
        if (options.permission) requireManageAssignments(options.permission);
        const response = await options.request();
        if (response?.status !== 'success') throw new Error('The server did not confirm this change. Reload the pool and check its saved state before repeating the action.');
        succeeded = true;
        options.onSuccess?.(response);
        showPoolFeedback(scope, 'success', typeof options.success === 'function' ? options.success(response) : options.success);
        if (options.reload) {
            rememberPool(options.reloadPool);
            reloadAfterDelay(350);
        }
        return true;
    } catch (err) {
        showPoolFeedback(scope, 'error', err instanceof Error ? err.message : 'Unable to complete this action.');
        return false;
    } finally {
        window.clearTimeout(slow);
        modal?.removeEventListener('hide.bs.modal', keepPendingVisible);
        scope.removeAttribute('aria-busy');
        if (originalChildren) trigger.replaceChildren(...originalChildren);
        if (!succeeded || !options.reload) {
            delete scope.dataset.saving;
            previousControls.forEach(({control, disabled}) => control.disabled = disabled);
        }
    }
}

async function savePoolForm(form: HTMLFormElement, payload: Record<string, unknown>, action: string, message: string): Promise<void> {
    const trigger = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!trigger) return;
    await runInvoiceAdminAction({
        scope: form, trigger, permission: action,
        pending: 'Saving pool changes…',
        success: message + (form.dataset.poolStatus === 'CLOSED' ? ' Recalculate the pool to update shares.' : ''),
        request: () => post(form.dataset.api!, payload),
        onSuccess: () => form.dataset.dirty = 'false',
        reload: true, reloadPool: form.dataset.pool,
    });
}

function poolFormSnapshot(form: HTMLFormElement): string {
    return JSON.stringify(Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="search"]), select, textarea'))
        .map(input => [input.name, input.value, input instanceof HTMLInputElement ? input.checked : false]));
}

function poolHasUnsavedChanges(poolId: string | undefined): boolean {
    return Array.from(document.querySelectorAll<HTMLFormElement>('.pool-base-form, .pool-assignment, .surcharge-form'))
        .some(form => form.dataset.pool === poolId && form.dataset.dirty === 'true');
}

function syncPoolParticipantFields(form: HTMLFormElement): void {
    const assignAll = form.querySelector<HTMLInputElement>('input[name="assignAll"]');
    form.querySelectorAll<HTMLElement>('[data-registration]').forEach(row => {
        const registration = row.querySelector<HTMLInputElement>('input[name="registrations"]');
        const selected = !!assignAll?.checked || !!registration?.checked;
        row.querySelectorAll<HTMLInputElement>('[data-participant-factor], input[name="exemptions"]').forEach(input => input.disabled = !selected);
    });
}

/**
 * Initialize invoice pool administration
 */
export function initInvoiceAdmin(): void {
    const poolForm = document.getElementById('poolCreateForm');
    if (poolForm) {
        poolForm.addEventListener('submit', async (e: Event) => {
            e.preventDefault();
            const form = poolForm as HTMLFormElement;
            const payload = serializeForm(form);
            for (const name of ['assignAll', 'isDefault', 'subtractPersonalInvoices', 'roundUpShares']) {
                payload[name] = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked ? 'on' : '';
            }
            delete payload.roundUpSharesConfigured;
            const trigger = form.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (!trigger) return;
            await runInvoiceAdminAction({scope: form, trigger, permission: 'create invoice pools', pending: 'Creating the invoice pool…',
                success: 'Pool created.', request: () => post(form.dataset.api!, payload), reload: true});
        });

        const assignAll = poolForm.querySelector('#assignAllPools') as HTMLInputElement | null;
        const registrations = Array.from(poolForm.querySelectorAll<HTMLInputElement>('input[name="registrations"]'));
        const syncDisabled = () => {
            const disable = !!(assignAll?.checked);
            registrations.forEach((input) => {
                input.disabled = disable;
                if (disable) input.checked = true;
            });
        };
        assignAll?.addEventListener('change', syncDisabled);
        syncDisabled();
    }

    // Keep edits local to their dialog until the user explicitly saves them.
    document.querySelectorAll<HTMLFormElement>('.pool-base-form, .pool-assignment, .surcharge-form').forEach(form => {
        if (form.classList.contains('pool-assignment')) syncPoolParticipantFields(form);
        form.dataset.initialValues = poolFormSnapshot(form);
        const trackEdits = () => form.dataset.dirty = String(poolFormSnapshot(form) !== form.dataset.initialValues);
        form.addEventListener('input', trackEdits);
        form.addEventListener('change', trackEdits);
        form.addEventListener('reset', () => queueMicrotask(() => {
            form.querySelectorAll<HTMLInputElement>('input[name="registrations"]').forEach(input => {
                delete input.dataset.originalChecked;
                input.disabled = !!form.querySelector<HTMLInputElement>('input[name="assignAll"]')?.checked;
            });
            if (form.classList.contains('pool-assignment')) syncPoolParticipantFields(form);
            trackEdits();
        }));
    });
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
        await savePoolForm(form, serializePoolBaseSettings(form), 'update invoice pool settings', 'Pool settings saved.');
    });

    // Invoice review actions lock the full row so opposite decisions cannot run together.
    document.addEventListener('click', async (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!target) return;
        try {
            const reviewActions = [
                {css: 'invoice-approve', route: 'approve', permission: 'approve invoices', pending: 'Accepting invoice…', success: 'Invoice accepted.'},
                {css: 'invoice-decline', route: 'decline', permission: 'reject invoices', pending: 'Rejecting invoice…', success: 'Invoice rejected.'},
                {css: 'invoice-close', route: 'close', permission: 'close invoices', pending: 'Closing invoice…', success: 'Invoice closed.'},
                {css: 'invoice-close-self', route: 'close-self', permission: undefined, pending: 'Closing invoice…', success: 'Invoice closed.'},
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
                        showPoolFeedback(row, 'error', 'Enter a rejection reason before rejecting this invoice.');
                        return;
                    }
                }
                await runInvoiceAdminAction({scope: row, trigger: target, permission: review.permission,
                    pending: review.pending, success: review.success,
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/${review.route}`, payload),
                    reload: true, reloadPool: target.dataset.pool});
                return;
            }
            if (target.classList.contains('pool-close') || target.classList.contains('pool-recalculate')) {
                return await calculatePool(target, target.classList.contains('pool-recalculate'));
            }
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
                await runInvoiceAdminAction({scope: modal, trigger: target, permission: 'remove surcharges or rebates',
                    pending: 'Removing the adjustment…', success: 'Adjustment removed. Closed pools require recalculation.',
                    request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/surcharges/${target.dataset.id}/delete`),
                    reload: true, reloadPool: target.dataset.pool});
            }
        } catch (err) {
            showPoolFeedback(target.closest('.modal') || target.closest('[data-invoice-row]') || target.parentElement!, 'error', err instanceof Error ? err.message : 'Request failed.');
        }
    });

    document.addEventListener('submit', async (e: Event) => {
        const form = e.target as HTMLFormElement;
        if (form.classList.contains('pool-assignment')) {
            e.preventDefault();
            await savePoolForm(form, serializePoolAssignments(form), 'update pool assignments', 'Participants and factors saved.');
        } else if (form.classList.contains('surcharge-form')) {
            e.preventDefault();
            const formData = new FormData(form);
            if (Number(formData.get('amount')) === 0) {
                showPoolFeedback(form, 'error', 'Enter a positive surcharge or a negative rebate. Amount cannot be zero.');
                return;
            }
            formData.set('subtractFromPool', formData.get('subtractFromPool') === 'on' ? 'on' : '');
            await savePoolForm(form, Object.fromEntries(formData), 'add surcharges or rebates', 'Adjustment saved.');
        }
    });

    // Pool assignment checkbox handler
    document.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.matches('.pool-assignment .pool-toggle')) {
            const form = target.closest('.pool-assignment') as HTMLFormElement | null;
            if (!form) return;
            const assignAll = form.querySelector('input[name="assignAll"]') as HTMLInputElement | null;
            const registrations = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="registrations"]'));
            const disable = !!(assignAll?.checked);
            registrations.forEach((input) => {
                if (disable) {
                    // Store original state before modifying (only if not already stored)
                    if (!Object.hasOwn(input.dataset, 'originalChecked')) {
                        input.dataset.originalChecked = String(input.checked);
                    }
                    input.disabled = true;
                    input.checked = true;
                } else {
                    // Restore original state when re-enabling
                    input.disabled = false;
                    if (Object.hasOwn(input.dataset, 'originalChecked')) {
                        const originalState = input.dataset.originalChecked ?? 'false';
                        input.checked = originalState === 'true';
                        delete input.dataset.originalChecked;
                    }
                }
            });
        }
        const assignmentForm = target.closest<HTMLFormElement>('.pool-assignment');
        if (assignmentForm) {
            syncPoolParticipantFields(assignmentForm);
            assignmentForm.dataset.dirty = String(poolFormSnapshot(assignmentForm) !== assignmentForm.dataset.initialValues);
        }
    });

    document.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('assignment-search')) {
            const term = (target as HTMLInputElement).value.toLowerCase();
            const list = target.closest('.pool-assignment')?.querySelector('.assignments-list');
            if (!list) return;
            list.querySelectorAll<HTMLElement>('[data-search-text]').forEach((row) => {
                const text = (row.dataset.searchText || '').toLowerCase();
                row.classList.toggle('d-none', !!term && !text.includes(term));
            });
        }
    });

    restoreInvoicePaidState();
    window.addEventListener('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) window.location.reload();
        else restoreInvoicePaidState();
    });

    document.addEventListener('change', async (e: Event) => {
        const input = e.target as HTMLInputElement;
        if (!input.classList.contains('share-paid') || input.disabled) return;
        const checked = input.checked;
        const previous = input.dataset.paid === 'true';
        // A browser click moves a switch immediately; keep the displayed state canonical until confirmed.
        input.checked = previous;
        const row = input.closest<HTMLElement>('[data-share-row]');
        if (!row) return;
        await runInvoiceAdminAction({scope: row, trigger: input, permission: 'mark shares paid', pending: 'Recording settlement…',
            success: 'Settlement recorded against this calculated amount.',
            request: () => post(`/api/event/${getEventId()}/invoice-pools/${input.dataset.pool}/shares/${input.dataset.id}/pay`, {isPaid: checked ? 'on' : ''}),
            onSuccess: () => {
                input.dataset.paid = String(checked);
                input.checked = checked;
                input.defaultChecked = checked;
                invalidatePoolPreview(input.dataset.pool);
                const amount = Number(input.dataset.amount);
                const total = input.closest('.invoice-pool')?.querySelector<HTMLElement>(amount < 0 ? '[data-pool-refunds]' : '[data-pool-outstanding]');
                if (total && Number.isFinite(amount) && previous !== checked) {
                    total.textContent = (Number(total.textContent) + (checked ? -1 : 1) * Math.abs(amount)).toFixed(2);
                }
                updateShareRowState(row, checked);
                input.closest('[data-share-ledger]')?.dispatchEvent(new Event('share-state-updated'));
            }});
    });
}

/** Browser form restoration must never override the payment state rendered by the server. */
export function restoreInvoicePaidState(): void {
    document.querySelectorAll<HTMLInputElement>('.share-paid[data-paid]').forEach(input => {
        input.checked = input.dataset.paid === 'true';
        input.defaultChecked = input.checked;
        const row = input.closest<HTMLElement>('[data-share-row]');
        if (row) updateShareRowState(row, input.checked);
    });
}

function updateShareRowState(row: HTMLElement, paid: boolean): void {
    const amount = Number(row.dataset.shareAmount);
    const status = paid || amount === 0 ? 'settled' : amount < 0 ? 'refund' : 'due';
    row.dataset.shareStatus = status;
    const badge = row.querySelector<HTMLElement>('[data-share-state]');
    if (badge) {
        badge.textContent = status === 'settled' ? 'Settled' : status === 'refund' ? 'Refund' : 'Due';
        badge.className = `badge ${status === 'settled' ? 'bg-success' : status === 'refund' ? 'bg-info text-dark' : 'bg-warning text-dark'}`;
    }
    const note = row.querySelector<HTMLElement>('[data-share-balance-note]');
    if (note) note.textContent = paid ? 'Already settled' : amount < 0 ? 'Amount to pay out' : amount > 0 ? 'Amount to collect' : 'No payment due';
}

/**
 * Keep large invoice histories usable by filtering and paging rows in-place.
 */
export function initInvoiceLedgers(): void {
    document.querySelectorAll<HTMLElement>('[data-invoice-ledger]').forEach((ledger) => {
        const rows = Array.from(ledger.querySelectorAll<HTMLTableRowElement>('[data-invoice-row]'));
        const search = ledger.querySelector<HTMLInputElement>('[data-invoice-search-input]');
        const status = ledger.querySelector<HTMLSelectElement>('[data-invoice-status-filter]');
        const pageSize = ledger.querySelector<HTMLSelectElement>('[data-invoice-page-size]');
        const previous = ledger.querySelector<HTMLButtonElement>('[data-invoice-page-previous]');
        const next = ledger.querySelector<HTMLButtonElement>('[data-invoice-page-next]');
        const summary = ledger.querySelector<HTMLElement>('[data-invoice-page-summary]');
        const empty = ledger.querySelector<HTMLElement>('[data-invoice-empty]');
        let currentPage = 1;

        const render = (): void => {
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
            const pageRows = new Set(matchingRows.slice(start, start + size));
            rows.forEach((row) => {
                row.hidden = !pageRows.has(row);
            });

            if (empty) empty.hidden = matchingRows.length > 0;
            if (summary) {
                const first = matchingRows.length ? start + 1 : 0;
                const last = Math.min(start + size, matchingRows.length);
                summary.textContent = `${first}–${last} of ${matchingRows.length} invoices`;
            }
            if (previous) previous.disabled = currentPage <= 1;
            if (next) next.disabled = currentPage >= pageCount;
        };

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
    });
}

/** Filter the persisted settlement list without changing its financial state. */
export function initShareLedgers(): void {
    document.querySelectorAll<HTMLElement>('[data-share-ledger]').forEach(ledger => {
        const body = ledger.querySelector<HTMLElement>('[data-share-body]');
        const rows = Array.from(ledger.querySelectorAll<HTMLTableRowElement>('[data-share-row]'));
        const search = ledger.querySelector<HTMLInputElement>('input[data-share-search]');
        const filter = ledger.querySelector<HTMLSelectElement>('[data-share-filter]');
        const sort = ledger.querySelector<HTMLSelectElement>('[data-share-sort]');
        const size = ledger.querySelector<HTMLSelectElement>('[data-share-page-size]');
        const previous = ledger.querySelector<HTMLButtonElement>('[data-share-previous]');
        const next = ledger.querySelector<HTMLButtonElement>('[data-share-next]');
        const summary = ledger.querySelector<HTMLElement>('[data-share-page-summary]');
        const empty = ledger.querySelector<HTMLElement>('[data-share-empty]');
        let page = 1;
        const render = () => {
            const query = search?.value.trim().toLowerCase() || '';
            const status = filter?.value || '';
            const pageSize = Math.max(1, Number(size?.value) || 25);
            const matching = rows.filter(row => (!query || (row.dataset.shareSearch || '').includes(query))
                && (!status || row.dataset.shareStatus === status));
            matching.sort((a, b) => {
                const difference = Number(a.dataset.shareAmount) - Number(b.dataset.shareAmount);
                if (difference && sort?.value === 'amount-asc') return difference;
                if (difference && sort?.value === 'amount-desc') return -difference;
                return (a.dataset.shareName || '').localeCompare(b.dataset.shareName || '', undefined, {sensitivity: 'base'});
            });
            const pages = Math.max(1, Math.ceil(matching.length / pageSize));
            page = Math.min(Math.max(1, page), pages);
            const start = (page - 1) * pageSize;
            const visible = new Set(matching.slice(start, start + pageSize));
            rows.forEach(row => { row.hidden = !visible.has(row); });
            // Reordering the existing rows preserves expanded details and payment controls.
            matching.forEach(row => body?.append(row));
            if (summary) summary.textContent = `${matching.length ? start + 1 : 0}–${Math.min(start + pageSize, matching.length)} of ${matching.length} shares`;
            if (empty) empty.hidden = matching.length > 0;
            if (previous) previous.disabled = page <= 1;
            if (next) next.disabled = page >= pages;
        };
        const reset = () => { page = 1; render(); };
        search?.addEventListener('input', reset);
        [filter, sort, size].forEach(control => control?.addEventListener('change', reset));
        previous?.addEventListener('click', () => { page--; render(); });
        next?.addEventListener('click', () => { page++; render(); });
        ledger.addEventListener('share-state-updated', render);
        render();
    });
}

function initTakeoverOverviews(): void {
    document.querySelectorAll<HTMLElement>('[data-takeover-overview]').forEach(overview => {
        const search = overview.querySelector<HTMLInputElement>('[data-takeover-overview-search]');
        search?.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            overview.querySelectorAll<HTMLElement>('[data-takeover-overview-row]').forEach(row => {
                row.hidden = !!query && !(row.dataset.searchText || '').includes(query);
            });
        });
    });
}

interface PoolCalculationShare {
    registrationId: number;
    payerName: string;
    baseShareAmount: number | string;
    extraAmount: number | string;
    invoiceCreditAmount: number | string;
    paymentCreditAmount: number | string;
    shareAmount: number | string;
    isPaid: boolean;
    note?: string | null;
}

interface PoolCalculationPreview {
    revision: number;
    shares: PoolCalculationShare[];
    totals?: {
        invoiceAmount: number;
        redistributedAmount: number;
        distributableAmount: number;
        allocatedBaseAmount: number;
        roundingDifference: number;
        adjustmentAmount: number;
        grossAmount: number;
        invoiceCreditAmount: number;
        expectedNetAmount: number;
        calculatedAmount: number;
        paymentCreditAmount: number;
        outstandingAmount: number;
        creditAmount: number;
    };
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
    const rows = modal.querySelector<HTMLTableSectionElement>('[data-pool-preview-rows]');
    if (!rows) throw new Error('Calculation preview is unavailable. Reload the page.');
    const amountFields = ['baseShareAmount', 'extraAmount', 'invoiceCreditAmount', 'paymentCreditAmount', 'shareAmount'] as const;
    if (!Number.isSafeInteger(preview.revision) || preview.revision < 0 || !Array.isArray(preview.shares)
        || preview.shares.some(share => amountFields.some(field => share[field] === null || share[field] === '' || !Number.isFinite(Number(share[field]))))) {
        throw new Error('The calculation preview could not be verified. Refresh the preview before continuing.');
    }
    rows.replaceChildren();
    const labels = ['Base', 'Adjustments', 'Invoice credit', 'Previously settled', 'Remaining due / refund'];
    let outstanding = 0;
    let refunds = 0;
    for (const share of preview.shares) {
        const row = document.createElement('tr');
        const payer = document.createElement('td');
        payer.dataset.label = 'Payer';
        const name = document.createElement('strong');
        name.textContent = share.payerName || `Participant #${share.registrationId}`;
        payer.appendChild(name);
        if (share.note) {
            const details = document.createElement('details');
            details.className = 'small mt-1';
            const summary = document.createElement('summary');
            summary.textContent = 'Calculation details';
            const notes = document.createElement('ul');
            notes.className = 'text-secondary ps-3 mb-0';
            for (const text of share.note.split(' • ').filter(Boolean)) {
                const note = document.createElement('li');
                note.textContent = text;
                notes.appendChild(note);
            }
            details.append(summary, notes);
            payer.appendChild(details);
        }
        row.appendChild(payer);
        amountFields.forEach((field, index) => {
            const cell = document.createElement('td');
            cell.dataset.label = labels[index];
            cell.textContent = Number(share[field]).toFixed(2);
            if (field === 'shareAmount') {
                cell.className = 'fw-semibold';
                const state = document.createElement('small');
                state.className = 'd-block text-info fw-normal';
                state.textContent = Number(share.shareAmount) < 0 ? 'Refund due'
                    : Number(share.shareAmount) > 0 ? 'To pay' : 'Settled';
                cell.appendChild(state);
            }
            row.appendChild(cell);
        });
        rows.appendChild(row);
        if (!share.isPaid) {
            outstanding += Math.max(Number(share.shareAmount), 0);
            refunds += Math.max(-Number(share.shareAmount), 0);
        }
    }
    const due = modal.querySelector<HTMLElement>('[data-pool-preview-outstanding]');
    const credit = modal.querySelector<HTMLElement>('[data-pool-preview-refunds]');
    const reconciliation = modal.querySelector<HTMLElement>('[data-pool-preview-reconciliation]');
    if (reconciliation) reconciliation.hidden = true;
    if (preview.totals) {
        const totals = preview.totals;
        const keys = ['invoiceAmount', 'redistributedAmount', 'distributableAmount', 'allocatedBaseAmount',
            'roundingDifference', 'adjustmentAmount', 'grossAmount', 'invoiceCreditAmount', 'expectedNetAmount',
            'calculatedAmount', 'paymentCreditAmount', 'outstandingAmount', 'creditAmount'] as const;
        if (keys.some(key => typeof totals[key] !== 'number' || !Number.isFinite(totals[key]))) {
            throw new Error('The calculation totals could not be verified. Refresh the preview before continuing.');
        }
        for (const key of keys) {
            const value = modal.querySelector<HTMLElement>(`[data-preview-total="${key}"]`);
            if (value) value.textContent = totals[key].toFixed(2);
        }
        const remaining = modal.querySelector<HTMLElement>('[data-preview-total="remainingAmount"]');
        if (remaining) remaining.textContent = (totals.calculatedAmount - totals.paymentCreditAmount).toFixed(2);
        const roundingNote = modal.querySelector<HTMLElement>('[data-preview-rounding-note]');
        if (roundingNote) {
            roundingNote.textContent = totals.roundingDifference > 0
                ? `Rounding each base share up adds ${totals.roundingDifference.toFixed(2)} to the total before settlement credits.`
                : totals.roundingDifference < 0
                    ? `Rounding each base share down leaves a shortfall of ${Math.abs(totals.roundingDifference).toFixed(2)} before settlement credits.`
                    : 'The rounded base shares match the amount to distribute exactly.';
        }
        outstanding = totals.outstandingAmount;
        refunds = totals.creditAmount;
        if (reconciliation) reconciliation.hidden = false;
    }
    if (due) due.textContent = outstanding.toFixed(2);
    if (credit) credit.textContent = refunds.toFixed(2);
    modal.querySelector<HTMLElement>('[data-pool-preview-table]')?.removeAttribute('hidden');
    modal.querySelector<HTMLElement>('[data-pool-preview-summary]')?.removeAttribute('hidden');
    modal.dataset.previewRevision = String(preview.revision);
}

async function loadPoolCalculationPreview(poolId: string | undefined): Promise<void> {
    const modal = document.getElementById(`pool-${poolId}-calculation`);
    if (!modal) return;
    const confirm = modal.querySelector<HTMLButtonElement>('.pool-close, .pool-recalculate');
    if (modal.dataset.saving === 'true' || modal.dataset.previewLoading === 'true') return;
    invalidatePoolPreview(poolId);
    modal.querySelector<HTMLElement>('[data-pool-preview-table]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-summary]')?.setAttribute('hidden', '');
    modal.querySelector<HTMLElement>('[data-pool-preview-reconciliation]')?.setAttribute('hidden', '');
    const requestId = String(Number(modal.dataset.previewRequest || 0) + 1);
    modal.dataset.previewRequest = requestId;
    const unsaved = poolHasUnsavedChanges(poolId);
    const warning = modal.querySelector<HTMLElement>('.pool-unsaved-warning');
    if (warning) warning.hidden = !unsaved;
    if (unsaved) {
        showPoolFeedback(modal, 'error', 'Save or discard pending edits, then refresh this preview.');
        return;
    }
    const refresh = modal.querySelector<HTMLButtonElement>('.pool-preview-refresh');
    modal.dataset.previewLoading = 'true';
    const refreshLabel = refresh ? Array.from(refresh.childNodes) : [];
    if (refresh) {
        refresh.disabled = true;
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        refresh.replaceChildren(spinner, document.createTextNode('Preparing…'));
    }
    modal.setAttribute('aria-busy', 'true');
    showPoolProgress(modal, 'Preparing the calculation preview…');
    const delayed = window.setTimeout(() => {
        if (modal.dataset.previewRequest === requestId) showPoolProgress(modal, 'Still preparing the preview. No changes have been made.');
    }, 5000);
    try {
        requireManageAssignments('preview invoice calculations');
        const response = await get(`/api/event/${getEventId()}/invoice-pools/${poolId}/preview`);
        if (modal.dataset.previewRequest !== requestId) return;
        renderPoolCalculationPreview(modal, response.data || response);
        if (confirm) confirm.disabled = false;
        showPoolFeedback(modal, 'info', 'Preview ready. Review each payer before applying this calculation.');
    } catch (err) {
        if (modal.dataset.previewRequest !== requestId) return;
        invalidatePoolPreview(poolId);
        showPoolFeedback(modal, 'error', err instanceof Error ? err.message : 'Unable to load the calculation preview.');
    } finally {
        window.clearTimeout(delayed);
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

async function calculatePool(target: HTMLButtonElement, recalculate: boolean): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || modal.dataset.saving === 'true') return;
    if (poolHasUnsavedChanges(target.dataset.id)) {
        invalidatePoolPreview(target.dataset.id);
        showPoolFeedback(modal, 'error', 'Save or discard your pending edits and refresh the preview before calculating.');
        return;
    }
    const revision = modal.dataset.previewRevision;
    if (revision === undefined || !Number.isSafeInteger(Number(revision))) {
        showPoolFeedback(modal, 'error', 'Refresh and review the calculation preview before continuing.');
        return;
    }
    const sendEmails = !!modal.querySelector<HTMLInputElement>('input[name="sendEmails"]')?.checked;
    const applied = await runInvoiceAdminAction({scope: modal, trigger: target, permission: 'calculate invoice shares',
        pending: 'Applying the reviewed calculation…',
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${recalculate ? 'recalculate' : 'close'}`, {
            sendEmails, expectedRevision: Number(revision),
        }),
        success: (recalculate ? 'Pool recalculated. Previous settlements have been credited.' : 'Pool closed and shares calculated.')
            + (sendEmails ? ' Settlement emails requested.' : ' No calculation emails requested.'),
        reload: true, reloadPool: target.dataset.id,
    });
    if (!applied) invalidatePoolPreview(target.dataset.id);
}

async function submitPoolAction(target: HTMLButtonElement, action: 'rollback' | 'notify'): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || modal.dataset.saving === 'true') return;
    const completed = await runInvoiceAdminAction({scope: modal, trigger: target, permission: action === 'rollback' ? 'roll back pool changes' : 'send settlement emails',
        pending: action === 'rollback' ? 'Restoring the last calculated pool settings…' : 'Requesting settlement emails…',
        request: () => post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${action}`),
        success: response => response.message || (action === 'rollback'
            ? 'Pool changes rolled back. Existing shares and recorded payments were kept.' : 'Settlement emails requested.'),
        onSuccess: () => {
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
    if (completed) target.disabled = true;
}

/**
 * Initialize takeover modal for invoice management
 */
function initTakeoverModal(): void {
    const modalEl = document.getElementById('takeoverModal');
    const form = modalEl?.querySelector('#takeoverForm') as HTMLFormElement | null;
    const payerSelect = modalEl?.querySelector('#takeoverPayer') as HTMLSelectElement | null;
    const beneficiaryList = modalEl?.querySelector('.takeover-beneficiaries') as HTMLElement | null;
    const searchInput = modalEl?.querySelector('.takeover-search') as HTMLInputElement | null;
    if (!modalEl || !form || !beneficiaryList) return;

    let activePoolId: string | null = null;
    let activeMode: 'admin' | 'participant' = 'admin';
    let assignedIds: number[] = [];
    let takeovers: {payerRegistrationId: number; beneficiaryRegistrationId: number}[] = [];
    let poolClosed = false;
    const payerWrapper = payerSelect?.closest('.admin-only') as HTMLElement | null;
    const summary = modalEl.querySelector<HTMLElement>('[data-takeover-summary]');
    const context = modalEl.querySelector<HTMLElement>('[data-takeover-status]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const participantName = (id: number) => participantsData.find(p => p.id === id)?.name || `Participant #${id}`;
    const activePayer = () => activeMode === 'admin' ? Number(payerSelect?.value || 0) : registrationData?.id || 0;

    const updateSummary = () => {
        if (!summary) return;
        const payerId = activePayer();
        const selected = Array.from(beneficiaryList.querySelectorAll<HTMLInputElement>('input:checked')).map(input => participantName(Number(input.value)));
        summary.textContent = !payerId ? 'Choose a payer to manage coverage.'
            : `${participantName(payerId)} covers ${selected.length ? `${selected.length} other participant${selected.length === 1 ? '' : 's'}` : 'their own share only'}.`;
    };
    const filterBeneficiaries = () => {
        const term = (searchInput?.value || '').toLowerCase();
        beneficiaryList.querySelectorAll<HTMLElement>('[data-search-text]').forEach(row => {
            row.classList.toggle('d-none', !!term && !(row.dataset.searchText || '').includes(term));
        });
    };
    const renderBeneficiaries = (payerId: number) => {
        beneficiaryList.replaceChildren();
        const covered = new Set(takeovers.filter(t => t.payerRegistrationId === payerId).map(t => t.beneficiaryRegistrationId));
        const payerCovered = takeovers.some(t => t.beneficiaryRegistrationId === payerId);
        assignedIds.filter(id => id !== payerId).forEach(id => {
            const participant = participantsData.find(p => p.id === id);
            const owner = takeovers.find(t => t.beneficiaryRegistrationId === id && t.payerRegistrationId !== payerId);
            const isPayer = takeovers.some(t => t.payerRegistrationId === id);
            const unavailable = !payerId || (payerCovered && !covered.has(id)) || isPayer
                || (activeMode === 'participant' && (!!owner || poolClosed));
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
            const reason = payerCovered ? 'This payer is already covered by someone else.'
                : isPayer ? 'Already covers another participant. Clear that coverage first.'
                : owner ? `Covered by ${participantName(owner.payerRegistrationId)}${activeMode === 'admin' ? '; selecting reassigns this participant.' : '.'}` : '';
            if (reason) {
                const note = document.createElement('small');
                note.className = 'd-block text-warning mt-1';
                note.textContent = reason;
                details.appendChild(note);
            }
            row.append(checkbox, details);
            beneficiaryList.appendChild(row);
        });
        if (!beneficiaryList.children.length) {
            const empty = document.createElement('p');
            empty.className = 'text-secondary small p-3 mb-0';
            empty.textContent = 'No other participants are assigned to this pool.';
            beneficiaryList.appendChild(empty);
        }
        if (submit) submit.disabled = !payerId || (activeMode === 'participant' && poolClosed);
        filterBeneficiaries();
        updateSummary();
    };

    payerSelect?.addEventListener('change', () => renderBeneficiaries(activePayer()));
    searchInput?.addEventListener('input', filterBeneficiaries);
    beneficiaryList.addEventListener('change', updateSummary);

    document.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('.manage-takeovers');
        if (!btn) return;
        const poolRoot = btn.closest<HTMLElement>('.invoice-pool') || btn.closest<HTMLElement>('[data-pool]');
        if (!poolRoot) return;
        activePoolId = poolRoot.dataset.pool || null;
        assignedIds = JSON.parse(poolRoot.dataset.assigned || '[]');
        takeovers = JSON.parse(poolRoot.dataset.takeovers || '[]');
        poolClosed = poolRoot.dataset.poolStatus === 'CLOSED';
        activeMode = btn.dataset.mode === 'admin' ? 'admin' : 'participant';
        const title = modalEl.querySelector<HTMLElement>('[data-takeover-title]');
        if (title) title.textContent = `Manage takeovers${poolRoot.dataset.poolName ? ` · ${poolRoot.dataset.poolName}` : ''}`;
        const feedback = form.querySelector<HTMLElement>('.pool-form-status');
        if (feedback) feedback.textContent = '';
        if (context) {
            context.hidden = false;
            context.textContent = poolClosed
                ? 'These changes affect the next calculation. Recorded payments stay with the person who made them, even if coverage changes.'
                : 'Save coverage for one payer at a time. Covered participants cannot cover somebody else.';
        }
        if (payerWrapper) payerWrapper.classList.toggle('d-none', activeMode === 'participant');
        if (activeMode === 'admin' && payerSelect) {
            requireManageAssignments('manage takeovers');
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
        window.bootstrap?.Modal?.getOrCreateInstance(modalEl)?.show();
    });

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        if (!activePoolId || form.dataset.saving === 'true') return;
        if (activeMode === 'participant' && poolClosed) {
            showPoolFeedback(form, 'error', 'Participant takeover changes are only available while the pool is open.');
            return;
        }
        const beneficiaries = Array.from(beneficiaryList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter(box => box.checked).map(box => box.value);
        const payload: Record<string, unknown> = {beneficiaries};
        if (activeMode === 'admin') payload.payerId = activePayer();
        const endpoint = activeMode === 'admin'
            ? `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers/manage`
            : `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers`;
        if (!submit) return;
        await runInvoiceAdminAction({scope: form, trigger: submit,
            permission: activeMode === 'admin' ? 'manage takeovers' : undefined,
            pending: 'Saving takeovers…', request: () => post(endpoint, payload),
            success: 'Takeovers saved.' + (poolClosed ? ' Recalculate the pool to apply these changes.' : ''),
            reload: true, reloadPool: activePoolId,
        });
    });
}

/**
 * Initialize invoice submission form
 */
export function initInvoiceSubmission(): void {
    if (window.location.hash === '#invoiceHistory') {
        for (const id of ['participantInvoiceCollapse', 'invoicePoolCollapse']) {
            document.getElementById(id)?.classList.add('show');
            const toggle = document.querySelector(`[data-bs-target="#${id}"]`);
            toggle?.classList.remove('collapsed');
            toggle?.setAttribute('aria-expanded', 'true');
        }
        document.getElementById('invoiceHistory')?.scrollIntoView({block: 'start'});
    }
    const form = document.getElementById('invoiceSubmitForm') as HTMLFormElement | null;
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

    initTakeoverModal();
    initInvoiceAdmin();
    initInvoiceLedgers();
    initShareLedgers();
    initTakeoverOverviews();
    initInvoiceSubmission();

    if (getEventId()) {
        initRegistration();
        initCancelRegistration();
        initUpdate();

        initEntityHeader();
    }
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
