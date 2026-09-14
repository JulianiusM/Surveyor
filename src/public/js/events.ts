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
import {showInlineAlert} from './shared/alerts';
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

function showPoolFeedback(root: Element, status: 'success' | 'info' | 'error', message: string): void {
    const container = root.querySelector<HTMLElement>('.pool-form-status');
    if (!container) return showInlineAlert(status, message);
    container.classList.remove('text-success', 'text-info', 'text-danger');
    container.classList.add(status === 'error' ? 'text-danger' : status === 'success' ? 'text-success' : 'text-info');
    container.textContent = message;
}

function rememberPool(poolId: string | undefined): void {
    if (!poolId) return;
    try { sessionStorage.setItem('surveyor:invoice-pool', `${getEventId()}:${poolId}`); } catch { /* Storage is optional. */ }
}

async function savePoolForm(form: HTMLFormElement, payload: Record<string, unknown>, action: string, message: string): Promise<void> {
    if (form.dataset.saving === 'true') return;
    form.dataset.saving = 'true';
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
    buttons.forEach(button => button.disabled = true);
    showPoolFeedback(form, 'info', 'Saving changes…');
    try {
        requireManageAssignments(action);
        await post(form.dataset.api!, payload);
        form.dataset.dirty = 'false';
        showPoolFeedback(form, 'success', message + (form.dataset.poolStatus === 'CLOSED' ? ' Recalculate the pool to update shares.' : ''));
        rememberPool(form.dataset.pool);
        reloadAfterDelay(600);
    } catch (err) {
        showPoolFeedback(form, 'error', err instanceof Error ? err.message : 'Unable to save changes.');
        delete form.dataset.saving;
        buttons.forEach(button => button.disabled = false);
    }
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
            try {
                requireManageAssignments('manage invoice pools');
                const payload = serializeForm(poolForm as HTMLFormElement);
                const checkbox = poolForm.querySelector('#assignAllPools') as HTMLInputElement | null;
                if (checkbox) payload.assignAll = checkbox.checked ? 'on' : '';
                const defaultBox = poolForm.querySelector('#defaultPool') as HTMLInputElement | null;
                if (defaultBox) payload.isDefault = defaultBox.checked ? 'on' : '';
                const subtractBox = poolForm.querySelector('#subtractPersonalInvoicesCreate') as HTMLInputElement | null;
                if (subtractBox) payload.subtractPersonalInvoices = subtractBox.checked ? 'on' : '';
                const roundingBox = poolForm.querySelector<HTMLInputElement>('input[name="roundUpShares"]');
                if (roundingBox) payload.roundUpShares = roundingBox.checked ? 'on' : '';
                delete payload.roundUpSharesConfigured;

                await post((poolForm as HTMLElement).dataset.api!, payload);
                showInlineAlert('success', 'Pool created');
                reloadAfterDelay(RELOAD_DELAY_MS);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'An error occurred';
                showInlineAlert('error', message);
            }
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

    // Invoice action handlers
    document.addEventListener('click', async (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!target) return;
        try {
            if (target.classList.contains('invoice-approve')) {
                requireManageAssignments('approve invoices');
                const row = target.closest<HTMLElement>('[data-invoice-row]');
                const correctedAmount = row?.querySelector<HTMLInputElement>('.invoice-corrected-amount')?.value.trim() || '';
                const correctedDescription = row?.querySelector<HTMLTextAreaElement>('.invoice-corrected-description')?.value.trim() || '';
                await post(
                    `/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/approve`,
                    {correctedAmount, correctedDescription},
                );
                showInlineAlert('success', 'Invoice accepted');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('invoice-decline')) {
                requireManageAssignments('reject invoices');
                const row = target.closest<HTMLElement>('[data-invoice-row]');
                const rejectionReason = row?.querySelector<HTMLTextAreaElement>('.invoice-rejection-reason')?.value.trim() || '';
                if (!rejectionReason) throw new Error('Enter a rejection reason before rejecting this invoice.');
                await post(
                    `/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/decline`,
                    {rejectionReason},
                );
                showInlineAlert('info', 'Invoice rejected');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('invoice-close')) {
                requireManageAssignments('close invoices');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/close`);
                showInlineAlert('success', 'Invoice closed');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('invoice-close-self')) {
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/close-self`);
                showInlineAlert('success', 'Invoice closed');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('pool-close')) {
                requireManageAssignments('close invoice pools');
                return await calculatePool(target, false);
            }
            if (target.classList.contains('pool-recalculate')) {
                requireManageAssignments('recalculate invoice pools');
                return await calculatePool(target, true);
            }
            if (target.classList.contains('pool-open-calculation') || target.classList.contains('pool-preview-refresh')) {
                return await loadPoolCalculationPreview(target.dataset.id);
            }
            if (target.classList.contains('pool-rollback')) {
                requireManageAssignments('roll back pool changes');
                return await submitPoolAction(target, 'rollback');
            }
            if (target.classList.contains('pool-notify')) {
                requireManageAssignments('send settlement emails');
                return await submitPoolAction(target, 'notify');
            }
            if (target.classList.contains('pool-return')) {
                rememberPool(target.dataset.id);
                return window.location.reload();
            }
            if (target.classList.contains('surcharge-remove')) {
                requireManageAssignments('remove surcharges or rebates');
                if (target.dataset.saving === 'true') return;
                target.dataset.saving = 'true';
                target.disabled = true;
                const modal = target.closest('.modal') || document.body;
                try {
                    await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/surcharges/${target.dataset.id}/delete`);
                    showPoolFeedback(modal, 'success', 'Adjustment removed. Closed pools require recalculation.');
                    rememberPool(target.dataset.pool);
                    return reloadAfterDelay(600);
                } catch (err) {
                    delete target.dataset.saving;
                    target.disabled = false;
                    showPoolFeedback(modal, 'error', err instanceof Error ? err.message : 'Unable to remove adjustment.');
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Request failed.';
            showInlineAlert('error', message);
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

    // Share paid status handler
    document.addEventListener('change', async (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('share-paid')) {
            const input = target as HTMLInputElement;
            const checked = input.checked;
            if (input.disabled) return;
            input.disabled = true;
            try {
                requireManageAssignments('mark shares paid');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/shares/${target.dataset.id}/pay`, {
                    isPaid: checked ? 'on' : ''
                });
                invalidatePoolPreview(target.dataset.pool);
                const amount = Number(input.dataset.amount);
                const state = input.closest('[data-share-row]')?.querySelector<HTMLElement>('[data-share-state]');
                if (state) state.textContent = checked ? 'Settled' : amount < 0 ? 'Refund due' : amount > 0 ? 'To pay' : 'No payment due';
                const total = input.closest('.invoice-pool')?.querySelector<HTMLElement>(amount < 0 ? '[data-pool-refunds]' : '[data-pool-outstanding]');
                if (total && Number.isFinite(amount)) {
                    total.textContent = (Number(total.textContent) + (checked ? -1 : 1) * Math.abs(amount)).toFixed(2);
                }
                showInlineAlert('success', 'Settlement recorded against this calculated amount. Recalculation will carry it forward.');
            } catch (err) {
                input.checked = !checked;
                const message = err instanceof Error ? err.message : 'Failed to set share as paid.';
                showInlineAlert('error', message);
            } finally {
                input.disabled = false;
            }
        }
    });
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
    if (confirm?.dataset.saving === 'true') return;
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
    if (refresh) refresh.disabled = true;
    showPoolFeedback(modal, 'info', 'Preparing the calculation preview…');
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
        if (modal.dataset.previewRequest === requestId && refresh) refresh.disabled = false;
    }
}

async function calculatePool(target: HTMLButtonElement, recalculate: boolean): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || target.dataset.saving === 'true') return;
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
    target.dataset.saving = 'true';
    target.disabled = true;
    const refresh = modal.querySelector<HTMLButtonElement>('.pool-preview-refresh');
    if (refresh) refresh.disabled = true;
    showPoolFeedback(modal, 'info', 'Applying the reviewed calculation. Please wait…');
    const delayed = window.setTimeout(() => showPoolFeedback(modal, 'info', 'Still applying the calculation. Keep this page open and do not calculate again.'), 8000);
    try {
        await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${recalculate ? 'recalculate' : 'close'}`, {
            sendEmails, expectedRevision: Number(revision),
        });
        rememberPool(target.dataset.id);
        showPoolFeedback(modal, 'success', (recalculate ? 'Pool recalculated. Previous settlements have been credited.' : 'Pool closed and shares calculated.')
            + (sendEmails ? ' Settlement emails requested.' : ' No calculation emails sent.'));
        reloadAfterDelay(600);
    } catch (err) {
        invalidatePoolPreview(target.dataset.id);
        showPoolFeedback(modal, 'error', (err instanceof Error ? err.message : 'Unable to calculate the pool.') + ' Refresh the preview before trying again.');
        delete target.dataset.saving;
        if (refresh) refresh.disabled = false;
    } finally {
        window.clearTimeout(delayed);
    }
}

async function submitPoolAction(target: HTMLButtonElement, action: 'rollback' | 'notify'): Promise<void> {
    const modal = target.closest<HTMLElement>('.modal');
    if (!modal || target.dataset.saving === 'true') return;
    target.dataset.saving = 'true';
    target.disabled = true;
    showPoolFeedback(modal, 'info', action === 'rollback' ? 'Restoring the last calculated pool settings…' : 'Sending settlement emails…');
    try {
        const response = await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/${action}`);
        if (action === 'rollback') {
            invalidatePoolPreview(target.dataset.id);
            showPoolFeedback(modal, 'success', response.message || 'Pool changes rolled back. Existing shares and recorded payments were kept.');
            const returnButton = modal.querySelector<HTMLButtonElement>('.pool-return');
            if (returnButton) returnButton.hidden = false;
            // Leave the outcome visible, including any external changes that still need recalculation.
            modal.addEventListener('hidden.bs.modal', () => {
                rememberPool(target.dataset.id);
                window.location.reload();
            }, {once: true});
        } else {
            showPoolFeedback(modal, 'success', response.message || 'Settlement emails sent to payers with an email address.');
        }
    } catch (err) {
        showPoolFeedback(modal, 'error', err instanceof Error ? err.message : 'Unable to complete this action.');
        delete target.dataset.saving;
        target.disabled = false;
    }
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
            : `${participantName(payerId)} covers ${selected.length ? selected.join(', ') : 'their own share only'}.`;
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
        form.dataset.saving = 'true';
        if (submit) submit.disabled = true;
        showPoolFeedback(form, 'info', 'Saving takeovers…');
        try {
            await post(endpoint, payload);
            showPoolFeedback(form, 'success', 'Takeovers saved. Closed pools require recalculation.');
            rememberPool(activePoolId);
            reloadAfterDelay(600);
        } catch (err) {
            delete form.dataset.saving;
            if (submit) submit.disabled = false;
            showPoolFeedback(form, 'error', err instanceof Error ? err.message : 'Unable to update takeovers.');
        }
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
