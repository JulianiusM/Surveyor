/* ========== Assign / Unassign ================================ */

import {
    formatISOInTimeZone,
    initEntityLists,
    loadPerms,
    post,
    setCurrentNavLocation,
    showInlineAlert
} from "./modules/module_functions";

declare global {
    interface Window {
        bootstrap: {
            Modal: {
                getOrCreateInstance(element: HTMLElement): {show(): void; hide(): void};
            };
        };
    }
}

function parseJsonScript<T>(id: string): T | null {
    const el = document.getElementById(id);
    if (!el || !el.textContent) return null;
    try {
        return JSON.parse(el.textContent) as T;
    } catch {
        return null;
    }
}

const participantsData = parseJsonScript<any[]>("participantsData") || [];
const registrationData = parseJsonScript<{id: number}>("registrationData");
const RELOAD_DELAY_MS = 120;

export function allergyCheck() {
    const allergyBox = document.getElementById('diet-allergies');
    const notes = document.getElementById('allergyNotes');
    if (allergyBox && notes) {
        function sync() {
            // @ts-ignore
            notes.required = allergyBox.checked;
        }

        allergyBox.addEventListener('change', sync);
        sync();
    }
}

export function deadlineUpdater() {
    function fmt(ms: number) {
        if (ms <= 0) return "closed";
        const s = Math.floor(ms / 1000);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

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
            function tick() {
                const ms = t - Date.now();
                // @ts-ignore
                deadlineCnt.textContent = `(${fmt(ms)})`;
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
    }
}

export function initRegistration() {
    const form = document.getElementById('registrationForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const formData = new FormData(form as HTMLFormElement);
            // Turn single-value fields into an object…
            // @ts-ignore
            const payload: any = Object.fromEntries(formData);

            // …then explicitly collect multi-value fields:
            payload.dietary = formData.getAll('dietary'); // <-- ARRAY of selected values
            // @ts-ignore
            await post(`/event/${window.EVENT_ID}/register`, payload);
            showInlineAlert('success', 'Registration successful.');
            setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initUpdate() {
    const form = document.getElementById('eventUpdateForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const formData = new FormData(form as HTMLFormElement);
            const checkbox = form.querySelector("#requireDietEdit") as HTMLInputElement;
            if (checkbox) {
                formData.set(checkbox.name, checkbox.checked ? 'on' : 'off');
            }
            // @ts-ignore
            await post(`/event/${EVENT_ID}/update`, Object.fromEntries(formData));
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initCancelRegistration() {
    const btn = document.getElementById('cancelRegistrationBtn');
    if (!btn) return;

    btn.addEventListener('click', async e => {
        if (window.confirm("Are you sure you want to cancel your registration?")) {
            try {
                // @ts-ignore
                await post(`/event/${EVENT_ID}/register/delete`);
                showInlineAlert('success', 'Registration cancelled!');
                setTimeout(() => location.reload(), RELOAD_DELAY_MS);
            } catch (err) {
                // @ts-expect-error TS(2571): Object is of type 'unknown'.
                showInlineAlert('error', err.message);
            }
        }
    })
}

export function initDateRange() {
    const start = document.getElementById('startSpan');
    const end = document.getElementById('endSpan');
    if (!start || !end) return;

    const startDate = new Date(Date.parse(start.dataset.start!));
    const endDate = new Date(Date.parse(end.dataset.end!));

    start.textContent = startDate.toLocaleString(undefined, {
        dateStyle: "full",
    });
    end.textContent = endDate.toLocaleString(undefined, {
        dateStyle: "full",
    })
}

export function initRegistrationDateRange() {
    const start = document.getElementById('arrival');
    const end = document.getElementById('departure');
    if (!start || !end) return;

    const startDate = new Date(Date.parse(start.dataset.start!));
    const endDate = new Date(Date.parse(end.dataset.end!));

    start.textContent = startDate.toLocaleString(undefined, {
        dateStyle: "full",
    });
    end.textContent = endDate.toLocaleString(undefined, {
        dateStyle: "full",
    })
}

function serializeForm(form: HTMLFormElement) {
    const formData = new FormData(form);
    const payload: Record<string, any> = Object.fromEntries(formData as any);
    payload.registrations = formData.getAll('registrations');
    return payload;
}

export function initInvoiceAdmin() {
    const poolForm = document.getElementById('poolCreateForm');
    if (poolForm) {
        poolForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const payload = serializeForm(poolForm as HTMLFormElement);
                // Checkbox normalization
                const checkbox = poolForm.querySelector('#assignAllPools') as HTMLInputElement | null;
                if (checkbox) payload.assignAll = checkbox.checked ? 'on' : '';
                const defaultBox = poolForm.querySelector('#defaultPool') as HTMLInputElement | null;
                if (defaultBox) payload.isDefault = defaultBox.checked ? 'on' : '';
                await post((poolForm as HTMLElement).dataset.api!, payload);
                showInlineAlert('success', 'Pool created');
                setTimeout(() => location.reload(), RELOAD_DELAY_MS);
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

    document.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('invoice-approve')) {
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/approve`);
            showInlineAlert('success', 'Invoice approved');
            return setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        }
        if (target.classList.contains('invoice-decline')) {
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/decline`);
            showInlineAlert('info', 'Invoice declined');
            return setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        }
        if (target.classList.contains('invoice-close')) {
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.pool}/invoices/${target.dataset.id}/close`);
            showInlineAlert('success', 'Invoice closed');
            return setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        }
        if (target.classList.contains('pool-close')) {
            const poolRoot = target.closest('.invoice-pool');
            if (!poolRoot) return;
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.id}/close`);
            showInlineAlert('success', 'Pool closed with adjustments');
            return setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        }
        if (target.classList.contains('surcharge-remove')) {
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.pool}/surcharges/${target.dataset.id}/delete`);
            showInlineAlert('info', 'Surcharge removed');
            return setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        }
    });

    document.addEventListener('submit', async (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('pool-assignment')) {
            e.preventDefault();
            const api = (target as HTMLElement).getAttribute('data-api')!;
            const formData = new FormData(target as HTMLFormElement);
            const payload = Object.fromEntries(formData.entries());
            payload.registrations = formData.getAll('registrations');
            try {
                await post(api, payload);
                showInlineAlert('success', 'Assignments updated');
                setTimeout(() => location.reload(), RELOAD_DELAY_MS);
            } catch (err) {
                // @ts-expect-error
                showInlineAlert('error', err.message);
            }
        }
        if (target.classList.contains('surcharge-form')) {
            e.preventDefault();
            const api = (target as HTMLElement).getAttribute('data-api')!;
            const payload = Object.fromEntries(new FormData(target as HTMLFormElement).entries());
            try {
                await post(api, payload);
                showInlineAlert('success', 'Surcharge added');
                setTimeout(() => location.reload(), RELOAD_DELAY_MS);
            } catch (err) {
                // @ts-expect-error
                showInlineAlert('error', err.message);
            }
        }
    });

    document.addEventListener('change', (e) => {
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

    document.addEventListener('change', async (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('share-paid')) {
            const checked = (target as HTMLInputElement).checked;
            await post(`/event/${EVENT_ID}/invoice-pools/${target.dataset.pool}/shares/${target.dataset.id}/pay`, {isPaid: checked ? 'on' : ''});
            showInlineAlert('success', 'Share updated');
        }
    });
}

function initTakeoverModal() {
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

    document.addEventListener('click', (e) => {
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
        const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activePoolId) return;
        const selected = Array.from(beneficiaryList.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
        const beneficiaries = selected.filter((box) => box.checked).map((box) => box.value);
        const payload: Record<string, any> = {beneficiaries};
        if (activeMode === 'admin' && payerSelect) payload.payerId = payerSelect.value;
        const endpoint = activeMode === 'admin'
            ? `/event/${EVENT_ID}/invoice-pools/${activePoolId}/takeovers/manage`
            : `/event/${EVENT_ID}/invoice-pools/${activePoolId}/takeovers`;
        try {
            await post(endpoint, payload);
            showInlineAlert('success', 'Takeovers updated');
            setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        } catch (err) {
            // @ts-expect-error
            showInlineAlert('error', err.message);
        }
    });
}

export function initInvoiceSubmission() {
    const form = document.getElementById('invoiceSubmitForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const poolSelect = document.getElementById('invoicePool') as HTMLSelectElement | null;
        const poolId = poolSelect?.value;
        try {
            const formData = new FormData(form as HTMLFormElement);
            const endpoint = `/event/${EVENT_ID}/invoice-pools/${poolId}/submit`;
            await post(endpoint, formData);
            showInlineAlert('success', 'Invoice submitted');
            setTimeout(() => location.reload(), RELOAD_DELAY_MS);
        } catch (err) {
            // @ts-expect-error
            showInlineAlert('error', err.message);
        }
    });
}

export function init() {
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

    // @ts-expect-error TS(2339): Property 'PACK_LIST_ID' does not exist on type 'Wi... Remove this comment to see the full error message
    if (window.EVENT_ID) {
        initRegistration();
        initCancelRegistration();
        initUpdate();
    }
}

// Expose to global scope
window.Surveyor.init = init;
