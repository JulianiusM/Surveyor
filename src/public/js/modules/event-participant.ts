/**
 * Event participants management module
 * Handles participant list display, filtering, and operations
 */

import type {ParticipantRow} from "../../../types/EventTypes";
import {qs, qsAll} from '../core/dom';
import {del, get, patch} from '../core/http';
import {formatDate} from '../core/formatting';
import {createDietaryChip, hideSpinner, showSpinner} from '../shared/ui-helpers';
import {showInlineAlert} from '../shared/alerts';
import {populateDateRangeModal, submitDateRangeModal} from '../shared/date-range-modal';

/**
 * Render dietary totals as colored badges
 * @param root Root element
 * @param sel Selector for totals container
 * @param totals Dietary choice totals
 */
function renderTotals(root: HTMLElement, sel: string, totals: Record<string, number>): void {
    const box = qs<HTMLElement>(sel, root)!;
    const chips = Object.keys(totals)
        .filter(k => (totals[k] || 0) > 0)
        .map(k => {
            let txtClass = "text-white";
            let brdClass = "border-primary-subtile";
            if (k === "ALLERGIES") {
                txtClass = "text-danger";
                brdClass = "border-danger-subtle";
            }
            return `<span class="badge text-bg-dark border ${brdClass} me-1"><span class="${txtClass}">${k}:</span> ${totals[k]}</span>`;
        })
        .join(' ');
    box.innerHTML = chips || '<span class="text-secondary">Totals: —</span>';
}

/**
 * Render participant rows in the table
 * @param root Root element
 * @param data Participant data including rows and totals
 */
function renderRows(root: HTMLElement, data: any): void {
    const tb = qs<HTMLTableSectionElement>('tbody.js-rows', root)!;
    const cnt = qs<HTMLElement>('.js-count', root)!;
    tb.innerHTML = '';

    const rows: ParticipantRow[] = data.participants;
    if (!rows?.length) {
        const tr = document.createElement('tr');
        tr.className = 'js-empty';
        tr.innerHTML = `<td colspan="5"><div class="text-secondary small">No participants yet.</div></td>`;
        tb.appendChild(tr);
        cnt.textContent = '0';
        renderTotals(root, '.js-totals', {});
        renderTotals(root, '.js-date-totals', {});
        return;
    }

    const canDelete = root.dataset.canDelete === '1';

    rows.forEach(p => {
        const tr = document.createElement('tr');
        const dietary = (p.dietaryChoices || []).map(d => d.choice);
        const allergiesText = (p.dietaryChoices || []).filter(d => d.choice === "ALLERGIES")
            .map(d => d.additionalInfo)
            .join("; ");

        tr.dataset.id = String(p.id);
        tr.dataset.kind = p.userId ? "user" : "guest";
        tr.dataset.name = p.name.toLowerCase();
        tr.dataset.email = (p.email || '').toLowerCase();
        tr.dataset.dietary = dietary.join(',').toLowerCase();
        tr.dataset.arrival = p.arrivalDate;
        tr.dataset.departure = p.departureDate;

        const emailCell = p.email ? `<span class="d-none d-md-inline">${p.email}</span>` : '<span class="text-secondary d-none d-md-inline">—</span>';

        const dietBadges = dietary.map(createDietaryChip).join('') || '<span class="text-secondary">—</span>';

        const hasAll = dietary.includes("ALLERGIES") && !!allergiesText;
        const allergyBtn = hasAll
            ? `<button type="button" class="btn btn-sm btn-outline-warning btn-show-allergies" data-text="${encodeURIComponent(allergiesText || '')}">
           <i class="bi bi-exclamation-triangle"></i> Details
         </button>`
            : '';

        const editBtn = root.dataset.canUpdate === '1'
            ? `<button type="button" class="btn btn-outline-info btn-edit-dates">
           <i class="bi bi-calendar2-week"></i> Edit dates
         </button>`
            : '';

        const delBtn = canDelete
            ? `<button type="button" class="btn btn-outline-danger btn-delete-reg">
           <i class="bi bi-trash"></i> Delete
         </button>`
            : '';

        tr.innerHTML = `
      <td>
        <div class="fw-semibold">${p.name}</div>
        <div class="small text-secondary d-md-none">${p.email || ''}</div>
      </td>
      <td class="d-none d-md-table-cell">${emailCell}</td>
      <td>
        <div>${formatDate(p.arrivalDate)} → ${formatDate(p.departureDate)}</div>
      </td>
      <td>${dietBadges}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm" role="group">
          ${allergyBtn}
          ${editBtn}
          ${p.email ? `<button type="button" class="btn btn-outline-light btn-copy-email" data-email="${p.email}"><i class="bi bi-clipboard"></i> Copy email</button>` : ''}
          ${delBtn}
        </div>
      </td>
    `;
        tb.appendChild(tr);
    });

    cnt.textContent = String(rows.length);
    renderTotals(root, '.js-totals', data.totals);
    renderTotals(root, '.js-date-totals', data.dateTotals);
}

/**
 * Filter participant rows based on search query
 * @param root Root element
 * @param q Search query
 */
function filterRows(root: HTMLElement, q: string): void {
    const needle = q.trim().toLowerCase();
    const rows = qsAll<HTMLTableRowElement>('tbody.js-rows > tr', root).filter(r => !r.classList.contains('js-empty'));
    if (!needle) {
        rows.forEach(r => r.classList.remove('d-none'));
        return;
    }
    rows.forEach(r => {
        const match =
            (r.dataset.name || '').includes(needle) ||
            (r.dataset.email || '').includes(needle) ||
            (r.dataset.dietary || '').includes(needle);
        r.classList.toggle('d-none', !match);
    });
}

/**
 * Refresh the participant list from the API
 * @param root Root element
 */
async function refreshList(root: HTMLElement): Promise<void> {
    try {
        const rows = await get(root.dataset.apiList!);
        renderRows(root, rows.data);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to refresh participant list.';
        showInlineAlert('error', message);
    }
}

/**
 * Delete a participant registration
 * @param root Root element
 * @param tr Table row element
 */
async function deleteRegistration(root: HTMLElement, tr: HTMLTableRowElement): Promise<void> {
    const api = root.dataset.apiDelete!;
    const regId = tr.dataset.id!;
    if (!api) return;
    if (!confirm('Delete this registration? This cannot be undone.')) return;

    const btn = tr.querySelector('.btn-delete-reg') as HTMLButtonElement | null;
    if (btn) showSpinner(btn);
    try {
        await del(`${api}/${encodeURIComponent(regId)}`);
        await refreshList(root);
        showInlineAlert('success', 'Registration deleted');
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Delete failed.';
        showInlineAlert('error', message);
    } finally {
        if (btn) hideSpinner(btn);
    }
}

function openDateModal(root: HTMLElement, tr: HTMLTableRowElement): void {
    const modal = root.querySelector<HTMLElement>('.js-date-modal');
    const form = root.querySelector<HTMLFormElement>('.js-date-form');
    if (!modal || !form) return;

    populateDateRangeModal({
        modal,
        form,
        bounds: {min: root.dataset.startDate, max: root.dataset.endDate},
        alertContainer: root.querySelector<HTMLElement>('#liveAlerts') || undefined,
    }, {
        arrivalDate: tr.dataset.arrival || '',
        departureDate: tr.dataset.departure || '',
        registrationId: tr.dataset.id || '',
    });
}

async function submitDateUpdate(root: HTMLElement, form: HTMLFormElement): Promise<void> {
    const api = root.dataset.apiUpdate;
    const modal = root.querySelector<HTMLElement>('.js-date-modal');
    if (!api || !modal) return;

    await submitDateRangeModal({
        modal,
        form,
        bounds: {min: root.dataset.startDate, max: root.dataset.endDate},
        alertContainer: root.querySelector<HTMLElement>('#liveAlerts') || undefined,
    }, async (payload) => {
        await patch(`${api}/${encodeURIComponent(payload.registrationId)}`, payload);
        await refreshList(root);
    }, {
        successMessage: 'Attendance dates updated',
    });
}

/**
 * Initialize event participants module
 * Sets up list rendering, filtering, and participant operations
 */
export function initEventParticipants(): void {
    const roots = qsAll<HTMLElement>('.event-participants');
    roots.forEach(refreshList);

    document.addEventListener('input', (ev) => {
        const t = ev.target as Element | null;
        if (!t) return;
        const filter = t.closest<HTMLInputElement>('.js-filter');
        if (filter) {
            const root = filter.closest('.event-participants') as HTMLElement;
            filterRows(root, filter.value);
        }
    });

    document.addEventListener('click', (ev) => {
        const t = ev.target as Element | null;
        if (!t) return;

        const btnCopy = t.closest<HTMLButtonElement>('.btn-copy-email');
        if (btnCopy) {
            ev.preventDefault();
            const email = btnCopy.dataset.email || '';
            if (email) navigator.clipboard?.writeText(email).catch(() => {
            });
            return;
        }

        const btnAll = t.closest<HTMLButtonElement>('.btn-show-allergies');
        if (btnAll) {
            ev.preventDefault();
            const modal = btnAll.closest('.event-participants')!.querySelector('.modal') as HTMLElement;
            const pre = modal.querySelector('.js-allergy-text') as HTMLElement;
            pre.textContent = decodeURIComponent(btnAll.dataset.text || '');
            // bootstrap show if present
            (window as any).bootstrap?.Modal.getOrCreateInstance(modal)?.show();
            return;
        }

        const btnEdit = t.closest<HTMLButtonElement>('.btn-edit-dates');
        if (btnEdit) {
            ev.preventDefault();
            const root = btnEdit.closest('.event-participants') as HTMLElement;
            const tr = btnEdit.closest('tr') as HTMLTableRowElement;
            openDateModal(root, tr);
            return;
        }

        const btnDel = t.closest<HTMLButtonElement>('.btn-delete-reg');
        if (btnDel) {
            ev.preventDefault();
            const root = btnDel.closest('.event-participants') as HTMLElement;
            const tr = btnDel.closest('tr') as HTMLTableRowElement;
            deleteRegistration(root, tr);
            return;
        }
    });

    document.addEventListener('submit', (ev) => {
        const form = ev.target as HTMLFormElement | null;
        if (!form?.classList.contains('js-date-form')) return;
        ev.preventDefault();
        const root = form.closest('.event-participants') as HTMLElement | null;
        if (root) void submitDateUpdate(root, form);
    });
}
