/**
 * Event management functionality
 * Handles event registration, participant management, and invoice operations
 */

import {initEntityLists, setCurrentNavLocation} from './core/navigation';
import {loadPerms, requireEntityPerm, requireEntityPermsForForm} from './core/permissions';
import {post} from './core/http';
import {showInlineAlert} from './shared/alerts';
import {formatISOInTimeZone} from './core/formatting';
import {formatDuration, parseJsonScript, reloadAfterDelay, updateToLocalString} from './shared/ui-helpers';

/**
 * Reload delay constant
 */
const RELOAD_DELAY_MS = 120;

const participantsData = parseJsonScript<any[]>("participantsData") || [];
const registrationData = parseJsonScript<{ id: number }>("registrationData");

function getEventId(): string {
    return window.Surveyor.eventId ?? '';
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
        if (!isNaN(t)) {
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
    }
}

/**
 * Initialize event registration form
 */
export function initRegistration(): void {
    const form = document.getElementById('registrationForm');
    if (!form) {
        return;
    }

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
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
            const checkbox = form.querySelector("#requireDietEdit") as HTMLInputElement;
            if (checkbox) {
                formData.set(checkbox.name, checkbox.checked ? 'on' : 'off');
            }

            requireEntityPermsForForm(formData, [
                {
                    fields: ['location', 'startDate', 'endDate', 'deadlineTz'],
                    perm: 'EDIT_META',
                    action: 'update event metadata'
                },
                {fields: ['title'], perm: 'EDIT_TITLE', action: 'update the event title'},
                {fields: ['description'], perm: 'EDIT_DESC', action: 'update the description'},
                {fields: ['requireDietaryInfo'], perm: 'MANAGE_REQUIREMENTS', action: 'change dietary settings'},
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
function serializeForm(form: HTMLFormElement): Record<string, any> {
    const formData = new FormData(form);
    const payload: Record<string, any> = Object.fromEntries(formData as any);
    payload.registrations = formData.getAll('registrations');
    return payload;
}

function requireManageAssignments(action: string): void {
    requireEntityPerm('MANAGE_ASSIGNMENTS', action);
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

                await post((poolForm as HTMLElement).dataset.api!, payload);
                showInlineAlert('success', 'Pool created');
                reloadAfterDelay(RELOAD_DELAY_MS);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'An error occurred';
                showInlineAlert('error', message);
            }
        });

        const assignAll = poolForm.querySelector('#assignAllPools') as HTMLInputElement | null;
        const defaultBox = poolForm.querySelector('#defaultPool') as HTMLInputElement | null;
        const registrations = poolForm.querySelector('#poolRegistrations') as HTMLSelectElement | null;
        const syncDisabled = () => {
            if (!registrations) return;
            registrations.disabled = !!(assignAll?.checked || defaultBox?.checked);
        };
        assignAll?.addEventListener('change', syncDisabled);
        defaultBox?.addEventListener('change', syncDisabled);
        syncDisabled();
    }

    // Invoice action handlers
    document.addEventListener('click', async (e: Event) => {
        const target = e.target as HTMLElement;
        try {
            if (target.classList.contains('invoice-approve')) {
                requireManageAssignments('approve invoices');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/approve`);
                showInlineAlert('success', 'Invoice approved');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('invoice-decline')) {
                requireManageAssignments('decline invoices');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/decline`);
                showInlineAlert('info', 'Invoice declined');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('invoice-close')) {
                requireManageAssignments('close invoices');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/close`);
                showInlineAlert('success', 'Invoice closed');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('pool-close')) {
                requireManageAssignments('close invoice pools');
                if (!confirm("Are you sure you want to close the pool? This cannot be undone as shares will be calculated instantly.")) return
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.id}/close`);
                showInlineAlert('success', 'Pool closed with adjustments');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
            if (target.classList.contains('surcharge-remove')) {
                requireManageAssignments('remove surcharges');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/surcharges/${target.dataset.id}/delete`);
                showInlineAlert('info', 'Surcharge removed');
                return reloadAfterDelay(RELOAD_DELAY_MS);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Request failed.';
            showInlineAlert('error', message);
        }
    });

    // Form submission handlers
    document.addEventListener('submit', async (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('pool-assignment')) {
            e.preventDefault();
            const api = (target as HTMLElement).getAttribute('data-api')!;
            const formData = new FormData(target as HTMLFormElement);
            const payload: {
                [k: string]: FormDataEntryValue | FormDataEntryValue[]
            } = Object.fromEntries(formData.entries());
            payload.registrations = formData.getAll('registrations');
            try {
                requireManageAssignments('update pool assignments');
                await post(api, payload);
                showInlineAlert('success', 'Assignments updated');
                reloadAfterDelay(RELOAD_DELAY_MS);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unable to update assignments.';
                showInlineAlert('error', message);
            }
        }
        if (target.classList.contains('surcharge-form')) {
            e.preventDefault();
            const api = (target as HTMLElement).getAttribute('data-api')!;
            const payload = Object.fromEntries(new FormData(target as HTMLFormElement).entries());
            try {
                requireManageAssignments('add surcharges');
                await post(api, payload);
                showInlineAlert('success', 'Surcharge added');
                reloadAfterDelay(RELOAD_DELAY_MS);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unable to add the surcharge.';
                showInlineAlert('error', message);
            }
        }
    });

    // Pool assignment checkbox handler
    document.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.matches('.pool-assignment input[type="checkbox"]')) {
            const form = target.closest('.pool-assignment') as HTMLFormElement | null;
            if (!form) return;
            const assignAll = form.querySelector('input[name="assignAll"]') as HTMLInputElement | null;
            const isDefault = form.querySelector('input[name="isDefault"]') as HTMLInputElement | null;
            const select = form.querySelector('select[name="registrations"]') as HTMLSelectElement | null;
            if (select) select.disabled = !!(assignAll?.checked || isDefault?.checked);
        }
    });

    // Share paid status handler
    document.addEventListener('change', async (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('share-paid')) {
            const checked = (target as HTMLInputElement).checked;
            try {
                requireManageAssignments('mark shares paid');
                await post(`/api/event/${getEventId()}/invoice-pools/${target.dataset.pool}/shares/${target.dataset.id}/pay`, {
                    isPaid: checked ? 'on' : ''
                });
                showInlineAlert('success', 'Share updated');
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to set share as paid.';
                showInlineAlert('error', message);
            }
        }
    });
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
    let takeovers: any[] = [];
    const payerWrapper = payerSelect?.closest('.admin-only') as HTMLElement | null;

    const filterBeneficiaries = () => {
        const term = (searchInput?.value || '').toLowerCase();
        beneficiaryList.querySelectorAll('[data-search-text]').forEach((row) => {
            const text = (row as HTMLElement).getAttribute('data-search-text') || '';
            (row as HTMLElement).classList.toggle('d-none', !!term && !text.includes(term));
        });
    };

    const renderBeneficiaries = (payerId: number) => {
        beneficiaryList.innerHTML = '';
        if (!payerId) return;
        const covered = new Set(
            takeovers
                .filter((t) => t.payerRegistrationId === payerId)
                .map((t) => t.beneficiaryRegistrationId),
        );
        assignedIds.forEach((id) => {
            if (id === payerId) return;
            const participant = participantsData.find((p) => p.id === id);
            const row = document.createElement('label');
            row.className = 'list-group-item bg-dark text-white d-flex align-items-center gap-2';
            row.setAttribute('data-search-text', (participant?.name || `participant ${id}`).toLowerCase());
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'form-check-input me-2';
            checkbox.value = String(id);
            checkbox.checked = covered.has(id);
            const span = document.createElement('span');
            span.textContent = participant ? `${participant.name} (${participant.email})` : `Participant #${id}`;
            row.appendChild(checkbox);
            row.appendChild(span);
            beneficiaryList.appendChild(row);
        });
        filterBeneficiaries();
    };

    payerSelect?.addEventListener('change', () => renderBeneficiaries(Number(payerSelect?.value || 0)));
    searchInput?.addEventListener('input', filterBeneficiaries);

    document.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest('.manage-takeovers') as HTMLElement | null;
        if (!btn) return;
        const poolRoot = btn.closest('.invoice-pool') || btn.closest('[data-pool]');
        if (!poolRoot) return;
        activePoolId = poolRoot.getAttribute('data-pool');
        assignedIds = JSON.parse(poolRoot.getAttribute('data-assigned') || '[]');
        takeovers = JSON.parse(poolRoot.getAttribute('data-takeovers') || '[]');
        activeMode = (btn.getAttribute('data-mode') as 'admin' | 'participant') || 'participant';
        if (payerWrapper) payerWrapper.classList.toggle('d-none', activeMode === 'participant');
        if (activeMode === 'admin' && payerSelect) {
            requireManageAssignments('manage takeovers');
            payerSelect.innerHTML = '';
            assignedIds.forEach((id) => {
                const participant = participantsData.find((p) => p.id === id);
                const opt = document.createElement('option');
                opt.value = String(id);
                opt.textContent = participant ? `${participant.name} (${participant.email})` : `Participant #${id}`;
                payerSelect.appendChild(opt);
            });
            if (payerSelect.options.length && !payerSelect.value) payerSelect.selectedIndex = 0;
            renderBeneficiaries(Number(payerSelect.value || 0));
        } else {
            renderBeneficiaries(registrationData?.id || 0);
        }
        if (searchInput) searchInput.value = '';
        filterBeneficiaries();
        const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
        if (modal) modal.show();
    });

    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        if (!activePoolId) return;
        const selected = Array.from(beneficiaryList.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
        const beneficiaries = selected.filter((box) => box.checked).map((box) => box.value);
        const payload: Record<string, any> = {beneficiaries};
        if (activeMode === 'admin' && payerSelect) payload.payerId = payerSelect.value;
        const endpoint = activeMode === 'admin'
            ? `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers/manage`
            : `/api/event/${getEventId()}/invoice-pools/${activePoolId}/takeovers`;
        try {
            await post(endpoint, payload);
            showInlineAlert('success', 'Takeovers updated');
            reloadAfterDelay(RELOAD_DELAY_MS);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to update takeovers.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize invoice submission form
 */
export function initInvoiceSubmission(): void {
    const form = document.getElementById('invoiceSubmitForm');
    if (!form) return;
    form.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        const poolSelect = document.getElementById('invoicePool') as HTMLSelectElement | null;
        const poolId = poolSelect?.value;
        try {
            if (!registrationData?.id) {
                throw new Error('You must be registered for the event to submit invoices.');
            }
            const formData = new FormData(form as HTMLFormElement);
            const endpoint = `/api/event/${getEventId()}/invoice-pools/${poolId}/submit`;
            await post(endpoint, formData);
            showInlineAlert('success', 'Invoice submitted');
            reloadAfterDelay(RELOAD_DELAY_MS);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Invoice submission failed.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize event management page
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    allergyCheck();
    deadlineUpdater();
    initDateRange();
    initRegistrationDateRange();
    initEntityLists();

    initTakeoverModal();
    initInvoiceAdmin();
    initInvoiceSubmission();

    if (getEventId()) {
        initRegistration();
        initCancelRegistration();
        initUpdate();
    }
}

// Expose to global scope
window.Surveyor.init = init;
