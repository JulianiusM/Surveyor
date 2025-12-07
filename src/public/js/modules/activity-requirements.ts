/**
 * Activity Requirements Panel Module
 * Handles the requirements configuration panel
 */

import {get, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {reloadAfterDelay} from '../shared/ui-helpers';
import {requireEntityPerm} from '../core/permissions';
import type {RoleSummary, RequirementParticipantSummary, RequirementConfiguration} from './activity-types';

function toDateTimeLocalValue(date?: string | Date | null): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return '';

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toISOStringOrNull(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Initialize the requirements panel
 */
export function initRequirementPanel(planId: string): void {
    
    const panel = document.getElementById('requirementPanel');
    if (!panel) return;

    const roleList = panel.querySelector<HTMLElement>('#roleRequirementList');
    const overrideList = panel.querySelector<HTMLElement>('#overrideList');
    const alertBox = panel.querySelector<HTMLElement>('[data-requirements-alert]');
    const addOverrideBtn = panel.querySelector<HTMLButtonElement>('[data-add-override]');
    const reloadBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-refresh]');
    const saveBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-save]');
    const summaryBody = panel.querySelector<HTMLElement>('#requirementSummaryBody');
    const summaryStats = panel.querySelector<HTMLElement>('#requirementSummaryStats');
    const assignmentMode = panel.querySelector<HTMLSelectElement>('#assignmentMode');
    const generalRequired = panel.querySelector<HTMLInputElement>('#requiredShifts');
    const roundingMode = panel.querySelector<HTMLSelectElement>('#roundingMode');
    const bindingDeadline = panel.querySelector<HTMLInputElement>('#bindingDeadline');
    const allowOverfill = panel.querySelector<HTMLInputElement>('#allowOverfill');
    const allowArrivalEvening = panel.querySelector<HTMLInputElement>('#allowArrivalEvening');
    const allowDepartureMorning = panel.querySelector<HTMLInputElement>('#allowDepartureMorning');

    const setAlert = (message?: string, variant: 'info' | 'danger' = 'info') => {
        if (!alertBox) return;
        const target = alertBox.querySelector('span') || alertBox;
        if (!message) {
            alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        alertBox.classList.remove('d-none', 'alert-danger', 'alert-info');
        alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        target.textContent = message;
    };

    const updateRequirementSummaryStats = (summary: RequirementParticipantSummary[] = []) => {
        if (!summaryStats) return;
        summaryStats.innerHTML = '';

        if (!summary.length) {
            const span = document.createElement('span');
            span.className = 'text-secondary';
            span.textContent = 'No participants yet.';
            summaryStats.append(span);
            return;
        }

        let ok = 0;
        let under = 0;
        let over = 0;
        summary.forEach((entry) => {
            if (entry.remainingShifts > 0) {
                under += 1;
            } else if (entry.remainingShifts < 0) {
                over += 1;
            } else {
                ok += 1;
            }
        });

        const total = summary.length;

        const pieces: { label: string; value: number; className: string }[] = [
            {label: 'Total', value: total, className: 'badge bg-secondary-subtle text-secondary-emphasis me-1'},
            {label: 'Satisfied', value: ok, className: 'badge bg-success-subtle text-success-emphasis me-1'},
            {label: 'Under-assigned', value: under, className: 'badge bg-warning-subtle text-warning-emphasis me-1'},
            {label: 'Over-assigned', value: over, className: 'badge bg-danger-subtle text-danger-emphasis me-1'},
        ];

        pieces.forEach(({label, value, className}) => {
            const span = document.createElement('span');
            span.className = className;
            span.textContent = `${label}: ${value}`;
            summaryStats.append(span);
        });
    };

    const renderRequirementSummary = (summary: RequirementParticipantSummary[] = []) => {
        if (!summaryBody) return;
        summaryBody.innerHTML = '';
        updateRequirementSummaryStats(summary);

        if (!summary.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.className = 'text-center text-secondary pt-3';
            cell.textContent = 'No participants yet.';
            row.append(cell);
            summaryBody.append(row);
            return;
        }

        summary.forEach((entry) => {
            const row = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.textContent = entry.name || entry.participantKey;

            const requiredCell = document.createElement('td');
            requiredCell.className = 'text-center';
            const badge = document.createElement('span');
            badge.className = 'badge bg-secondary-subtle text-secondary-emphasis';
            badge.textContent = `${entry.requiredShifts} required / ${entry.assignedShifts} assigned`;
            requiredCell.append(badge);

            const remainingCell = document.createElement('td');
            remainingCell.className = 'text-center';
            const remainingBadge = document.createElement('span');
            remainingBadge.className = entry.remainingShifts > 0
                ? 'badge bg-warning-subtle text-warning-emphasis'
                : 'badge bg-success-subtle text-success-emphasis';
            remainingBadge.textContent = `${entry.remainingShifts} remaining`;
            remainingCell.append(remainingBadge);

            const attendanceCell = document.createElement('td');
            attendanceCell.className = 'text-center small';
            const arrival = entry.attendance?.arrivalDate ? formatDateLabel(entry.attendance.arrivalDate) : '';
            const departure = entry.attendance?.departureDate ? formatDateLabel(entry.attendance.departureDate) : '';
            attendanceCell.textContent = arrival || departure
                ? `${arrival || 'start'} – ${departure || 'end'}`
                : '—';

            const sourceCell = document.createElement('td');
            sourceCell.className = 'text-center';
            const sourceBadge = document.createElement('span');
            sourceBadge.className = 'badge bg-info-subtle text-info-emphasis text-uppercase';
            sourceBadge.textContent = entry.source;
            sourceCell.append(sourceBadge);

            row.append(nameCell, requiredCell, remainingCell, attendanceCell, sourceCell);
            summaryBody.append(row);
        });
    };

    const buildRoleRequirementInputs = (config: RequirementConfiguration) => {
        if (!roleList) return;
        roleList.innerHTML = '';

        const defaults = new Map<number, number>();
        config.roleRequirements.forEach((req) => defaults.set(req.roleId, req.requiredShifts));

        getAllRoles().forEach((role) => {
            const wrap = document.createElement('div');
            wrap.className = 'col-md-3 d-grid gap-1';

            const label = document.createElement('label');
            label.className = 'form-label small mb-0';
            label.textContent = role.name;

            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.className = 'form-control form-control-sm text-bg-dark';
            input.placeholder = '0';
            input.dataset.roleId = String(role.id);
            const defaultValue = defaults.get(role.id);
            input.value = typeof defaultValue === 'number' ? String(defaultValue) : '';

            wrap.append(label, input);
            roleList.appendChild(wrap);
        });
    };

    const buildOverrideRow = (override?: RequirementConfiguration['overrides'][number]) => {
        if (!overrideList) return;
        const row = document.createElement('div');
        row.className = 'row g-2 align-items-center override-row';
        if (override?.id) row.dataset.overrideId = String(override.id);

        const colTarget = document.createElement('div');
        colTarget.className = 'col-md-3 d-grid gap-1';
        const targetLabel = document.createElement('label');
        targetLabel.className = 'form-label small mb-0';
        targetLabel.textContent = 'Participant type';
        const targetSelect = document.createElement('select');
        targetSelect.className = 'form-select form-select-sm text-bg-dark';
        targetSelect.dataset.overrideTarget = 'type';
        targetSelect.innerHTML = '<option value="user">User</option><option value="guest">Guest</option>';
        if (override?.guestId) targetSelect.value = 'guest';

        const targetId = document.createElement('input');
        targetId.type = 'number';
        targetId.min = '1';
        targetId.className = 'form-control form-control-sm text-bg-dark';
        targetId.dataset.overrideTarget = 'id';
        targetId.placeholder = 'User/Guest ID';
        targetId.value = override?.userId?.toString() || override?.guestId?.toString() || '';

        if (override?.user?.username || override?.guest?.username) {
            const hint = document.createElement('small');
            hint.className = 'text-secondary';
            hint.textContent = `Current: ${override.user?.username || override.guest?.username}`;
            colTarget.append(targetLabel, targetSelect, targetId, hint);
        } else {
            colTarget.append(targetLabel, targetSelect, targetId);
        }

        const colRole = document.createElement('div');
        colRole.className = 'col-md-4 d-grid gap-1';
        const roleLabel = document.createElement('label');
        roleLabel.className = 'form-label small mb-0';
        roleLabel.textContent = 'Role (optional)';
        const roleSelect = document.createElement('select');
        roleSelect.className = 'form-select form-select-sm text-bg-dark';
        roleSelect.dataset.overrideTarget = 'role';
        roleSelect.innerHTML = '<option value="">Any role</option>' +
            getAllRoles().map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
        if (override?.roleId) roleSelect.value = String(override.roleId);

        colRole.append(roleLabel, roleSelect);

        const colReq = document.createElement('div');
        colReq.className = 'col-md-3 d-grid gap-1';
        const reqLabel = document.createElement('label');
        reqLabel.className = 'form-label small mb-0';
        reqLabel.textContent = 'Required shifts';
        const reqInput = document.createElement('input');
        reqInput.type = 'number';
        reqInput.min = '0';
        reqInput.className = 'form-control form-control-sm text-bg-dark';
        reqInput.dataset.overrideTarget = 'required';
        reqInput.value = override?.requiredShifts != null ? String(override.requiredShifts) : '0';
        colReq.append(reqLabel, reqInput);

        const colRemove = document.createElement('div');
        colRemove.className = 'col-md-2 d-flex align-items-end';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-danger w-100';
        removeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        removeBtn.addEventListener('click', () => row.remove());
        colRemove.append(removeBtn);

        row.append(colTarget, colRole, colReq, colRemove);
        overrideList.appendChild(row);
    };

    const renderOverrides = (config: RequirementConfiguration) => {
        if (!overrideList) return;
        overrideList.innerHTML = '';
        if (!config.overrides.length) {
            const empty = document.createElement('div');
            empty.className = 'text-secondary small';
            empty.dataset.emptyState = 'true';
            empty.textContent = 'No overrides configured';
            overrideList.append(empty);
            return;
        }

        config.overrides.forEach((ovr) => buildOverrideRow(ovr));
    };

    const populateForm = (config: RequirementConfiguration) => {
        if (assignmentMode) assignmentMode.value = config.plan.assignmentMode || 'FREE';
        if (generalRequired) {
            const value = config.plan.generalRequiredShifts;
            generalRequired.value = value === null || value === undefined ? '' : String(value);
        }
        if (roundingMode) roundingMode.value = config.plan.roundingMode || '';
        if (bindingDeadline) bindingDeadline.value = toDateTimeLocalValue(config.plan.bindingDeadline ?? null);
        if (allowOverfill) allowOverfill.checked = Boolean(config.plan.allowOverfillAfterFull);
        if (allowArrivalEvening) allowArrivalEvening.checked = Boolean(config.plan.allowArrivalDayEvening ?? true);
        if (allowDepartureMorning) allowDepartureMorning.checked = Boolean(config.plan.allowDepartureDayMorning ?? true);

        buildRoleRequirementInputs(config);
        renderOverrides(config);
        renderRequirementSummary(config.participants || []);
    };

    const loadRequirements = async () => {
        setAlert('Loading requirements…');
        try {
            const res = await get(`/api/activity/${planId}/requirements`);
            populateForm(res.data as RequirementConfiguration);
            setAlert('Requirements loaded');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load requirements';
            setAlert(message, 'danger');
        }
    };

    const collectRoleRequirements = (): { roleId: number; requiredShifts: number }[] => {
        if (!roleList) return [];
        return Array.from(roleList.querySelectorAll<HTMLInputElement>('input[data-role-id]'))
            .map((input) => {
                const value = input.value.trim();
                if (value === '') return null;
                const num = Number(value);
                if (Number.isNaN(num) || num < 0) return null;
                return {roleId: Number(input.dataset.roleId), requiredShifts: num};
            })
            .filter((v): v is { roleId: number; requiredShifts: number } => Boolean(v));
    };

    const collectOverrides = (): RequirementConfiguration['overrides'] => {
        if (!overrideList) return [];
        const entries: RequirementConfiguration['overrides'] = [];
        overrideList.querySelectorAll<HTMLElement>('.override-row').forEach((row) => {
            const typeSelect = row.querySelector<HTMLSelectElement>('[data-override-target="type"]');
            const idInput = row.querySelector<HTMLInputElement>('[data-override-target="id"]');
            const roleSelect = row.querySelector<HTMLSelectElement>('[data-override-target="role"]');
            const reqInput = row.querySelector<HTMLInputElement>('[data-override-target="required"]');

            const requiredShifts = Number(reqInput?.value ?? 0);
            const idVal = idInput?.value.trim();
            if (!typeSelect || !idVal) return;

            const entry: any = {
                roleId: roleSelect?.value ? Number(roleSelect.value) : null,
                requiredShifts: Number.isNaN(requiredShifts) ? 0 : requiredShifts,
            };

            if (row.dataset.overrideId) entry.id = Number(row.dataset.overrideId);

            if (typeSelect.value === 'guest') {
                entry.guestId = Number(idVal);
            } else {
                entry.userId = Number(idVal);
            }

            entries.push(entry);
        });
        return entries;
    };

    const saveRequirements = async () => {
        setAlert('Saving settings…');
        try {
            await post(`/api/activity/${planId}/requirements`, {
                assignmentMode: assignmentMode?.value,
                generalRequiredShifts: generalRequired?.value ? Number(generalRequired.value) : null,
                roundingMode: roundingMode?.value || null,
                bindingDeadline: toISOStringOrNull(bindingDeadline?.value || ''),
                allowOverfillAfterFull: allowOverfill?.checked ?? false,
                allowArrivalDayEvening: allowArrivalEvening?.checked ?? true,
                allowDepartureDayMorning: allowDepartureMorning?.checked ?? true,
                roleRequirements: collectRoleRequirements(),
                overrides: collectOverrides(),
            });

            showInlineAlert('success', 'Requirement settings saved');
            await loadRequirements();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save requirements';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    addOverrideBtn?.addEventListener('click', () => {
        if (overrideList && overrideList.querySelector('[data-empty-state]')) {
            overrideList.innerHTML = '';
        }
        buildOverrideRow();
    });
    reloadBtn?.addEventListener('click', () => void loadRequirements());
    saveBtn?.addEventListener('click', () => void saveRequirements());

    void loadRequirements();
}

/**
 * Initialize drag-and-drop for slots
 */
function initDnD(): void {
    

    try {
        requireEntityPerm('ITEM_EDIT', 'reorder slots');
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Reordering is not allowed.';
        showInlineAlert('error', message);
        return;
    }

    initCardReorder({
        containerClass: 'slot-container',
        cardClass: 'slot',
        apiUrl: `/api/activity/${planId}/slot/reorder`,
        getOrderData: (container) => {
            return [...container.querySelectorAll<HTMLElement>('.slot')]
                .map((el, i) => ({slotId: el.dataset.slotid, pos: i}));
        },
    });
}

