/**
 * Activity plan view functionality
 * Handles slot management, assignments, inline editing, and owner operations
 */

import {setCurrentNavLocation} from './core/navigation';
import {get, post} from './core/http';
import {showInlineAlert} from './shared/alerts';
import {startInlineEdit, startInlineEditArea} from './shared/inline-edit';
import {initCardReorder} from './shared/drag-drop';
import {initAssignmentRemoval} from './shared/list-actions';
import {getSelectValues} from './core/form-utils';
import {reloadAfterDelay} from './shared/ui-helpers';
import {loadPerms, requireEntityPerm, requireItemPerm} from './core/permissions';

interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: {focus?: boolean}) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

declare global {
    interface Window {
        ACT_PLAN_ID?: string;
        Surveyor: Record<string, any>;
    }
}

interface RoleSummary {
    id: number;
    name: string;
    description?: string | null;
}

type WarningType = "outside_attendance" | "arrival_day" | "departure_day" | "overlap" | "over_capacity";

interface AssignmentWarning {
    type: WarningType;
    conflicts?: string[];
}

interface WarningModal {
    confirm(warnings: AssignmentWarning[], slotId: string): Promise<boolean>;
}

interface RequirementConfiguration {
    plan: {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
    };
    roleRequirements: {roleId: number; requiredShifts: number}[];
    overrides: {
        id?: number;
        roleId?: number | null;
        role?: RoleSummary | null;
        userId?: number | null;
        user?: {username: string} | null;
        guestId?: number | null;
        guest?: {username: string} | null;
        requiredShifts: number;
    }[];
    participants?: RequirementParticipantSummary[];
}

interface RecommendationRow {
    id?: string;
    slot: {id: string; title: string; day?: string; startTime?: string | null; endTime?: string | null};
    user?: {id: number; username: string} | null;
    guest?: {id: number; username: string} | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
}

interface RecommendationWarning {
    recommendation: {slotId: string; userId?: number | null; guestId?: number | null};
    warnings: AssignmentWarning[];
}

interface RequirementParticipantSummary {
    participantKey: string;
    name?: string | null;
    requiredShifts: number;
    assignedShifts: number;
    remainingShifts: number;
    source: 'none' | 'general' | 'role' | 'override';
    attendance?: {arrivalDate?: string | null; departureDate?: string | null};
}

interface RecommendationSlotOption {
    id: string;
    title: string;
    day?: string;
    startTime?: string | null;
    endTime?: string | null;
}

interface RecommendationParticipantOption {
    key: string;
    label: string;
    userId?: number | null;
    guestId?: number | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
}

function formatTimeLabel(time?: string | null): string {
    if (!time) return "";
    return time.slice(0, 5);
}

function describeSlot(slotId: string): string {
    const slotEl = document.querySelector<HTMLElement>(`.slot[data-slotid="${slotId}"]`);
    if (!slotEl) return `slot ${slotId}`;

    const title = slotEl.querySelector<HTMLElement>('[data-edit="title"]')?.textContent?.trim();
    const day = slotEl.dataset.day
        || slotEl.closest<HTMLElement>('.slot-container')?.dataset.date
        || '';
    const start = formatTimeLabel(slotEl.dataset.start || null);
    const end = formatTimeLabel(slotEl.dataset.end || null);

    const timePart = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${title || 'Slot'}${day ? ` on ${day}` : ''}${timePart}`;
}

function formatSlotLabel(slot: RecommendationRow['slot']): string {
    const day = slot.day ? ` on ${slot.day}` : '';
    const start = formatTimeLabel(slot.startTime || null);
    const end = formatTimeLabel(slot.endTime || null);
    const time = start || end ? ` (${start || '–'}-${end || '–'})` : '';
    return `${slot.title || 'Slot'}${day}${time}`;
}

function describeWarning(warning: AssignmentWarning): string {
    switch (warning.type) {
    case "outside_attendance":
        return "This slot is outside your attendance window.";
    case "arrival_day":
        return "This slot is on your arrival day.";
    case "departure_day":
        return "This slot is on your departure day.";
    case "over_capacity":
        return "This slot is already full.";
    case "overlap": {
        const conflicts = (warning.conflicts || []).map(describeSlot);
        const detail = conflicts.length ? `: ${conflicts.join(', ')}` : '';
        return `This slot overlaps with another assignment${detail}`;
    }
    default:
        return "Assignment warning detected.";
    }
}

function formatDateLabel(date?: string | null): string {
    if (!date) return '';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function getAllRoles(): RoleSummary[] {
    return (window.Surveyor?.allRoles || []) as RoleSummary[];
}

function toDateTimeLocalValue(date?: string | Date | null): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d?.getTime?.())) return '';

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toISOStringOrNull(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildWarningModal(): WarningModal {
    const modalEl = document.getElementById('assignmentWarningModal');
    const list = document.getElementById('assignmentWarningList');
    const titleEl = document.getElementById('assignmentWarningSlot');
    const confirmBtn = document.getElementById('assignmentWarningConfirm') as HTMLButtonElement | null;
    const cancelBtn = document.getElementById('assignmentWarningCancel') as HTMLButtonElement | null;

    const modal = modalEl && typeof bootstrap !== 'undefined'
        ? new bootstrap.Modal(modalEl, {focus: true})
        : null;

    async function confirm(warnings: AssignmentWarning[], slotId: string): Promise<boolean> {
        if (!warnings.length) return true;
        if (!modal || !modalEl || !list || !confirmBtn || !cancelBtn) {
            const proceed = window.confirm(
                `Warnings detected for this assignment. Proceed?\n${warnings.map(describeWarning).join('\n')}`,
            );
            return Promise.resolve(proceed);
        }

        const title = describeSlot(slotId);
        if (titleEl) titleEl.textContent = title;

        list.innerHTML = '';
        warnings.forEach((warning) => {
            const li = document.createElement('li');
            li.className = 'list-group-item text-bg-dark d-flex align-items-start gap-2';
            li.innerHTML = `<i class="bi bi-exclamation-triangle text-warning"></i><span>${describeWarning(warning)}</span>`;
            list.appendChild(li);
        });

        return await new Promise((resolve) => {
            let settled = false;

            function cleanup(result: boolean) {
                if (settled) return;
                settled = true;
                confirmBtn.disabled = false;
                modal.hide();
                resolve(result);
            }

            const onHidden = () => cleanup(false);
            modalEl.addEventListener('hidden.bs.modal', onHidden, {once: true});

            confirmBtn.onclick = async () => {
                confirmBtn.disabled = true;
                cleanup(true);
            };

            cancelBtn.onclick = () => cleanup(false);
            modal.show();
        });
    }

    return {confirm};
}

/**
 * Get the activity plan ID from the window object
 */
function getActivityPlanId(): string {
    return window.ACT_PLAN_ID ?? '';
}

/**
 * Initialize assign/unassign slot functionality
 */
function initAssign(warningModal: WarningModal): void {
    const planId = getActivityPlanId();

    async function fetchWarnings(slotId: string): Promise<AssignmentWarning[]> {
        try {
            const res = await post(`/api/activity/${planId}/slot/${slotId}/warnings`, {});
            return res?.data?.warnings || [];
        } catch {
            return [];
        }
    }

    document.addEventListener('click', async (e: Event) => {
        const btn = (e.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
        if (!btn) return;

        const card = btn.closest('.slot') as HTMLElement | null;
        const slotId = card?.dataset.slotid;
        if (!slotId) return;

        const act = btn.dataset.action;
        const role = btn.dataset.role;

        const performUpdate = async () => {
            await post(`/api/activity/${planId}/${act}`, {slotId, role});
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(120);
        };

        try {
            if (act === 'assign') {
                const warnings = await fetchWarnings(slotId);
                const proceed = await warningModal.confirm(warnings, slotId);
                if (!proceed) return;
            }

            await performUpdate();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update slot assignment.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize select2 for role selection
 */
function initSelectBox(): void {
    const planId = getActivityPlanId();

    $('.multiSelect').select2({
        placeholder: 'Add Roles',
        width: '100%',
        //@ts-ignore
        selectionCssClass: 'text-bg-dark',
        dropdownCssClass: 'text-bg-dark',
    });

    document.addEventListener('click', async (e: Event) => {
        const btn = (e.target as Element | null)?.closest('[data-addRoles]');
        if (!btn) return;

        const div = btn.closest('.role-assignment');
        if (!div) return;

        const sel = div.querySelector('select');
        if (!sel) return;

        const slot = sel.dataset.id;
        const vals = getSelectValues(sel);

        try {
            requireItemPerm(slot || '', 'EDIT_META', 'manage slot roles', 'ITEM_EDIT');
            await post(`/api/activity/${planId}/slot/${slot}/addRole`, {roles: vals});
            showInlineAlert('success', 'Updated');
            reloadAfterDelay(120);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to update roles for this slot.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize inline editing for slots and plan description
 */
function initInlineEdit(): void {
    const planId = getActivityPlanId();

    document.addEventListener('dblclick', (e: Event) => {
        const target = e.target as Element;
        if (!target) return;

        const desc = target.closest<HTMLElement>('[data-edit="planDescription"]');
        if (desc) return startInlineEditArea(desc, `/api/activity/${planId}/description`, {
            scope: 'entity',
            key: 'EDIT_DESC',
            action: 'edit activity descriptions'
        });

        const card = target.closest('.slot');
        if (!card || target.closest('button')) return;

        /* choose editable span */
        let span = target.closest<HTMLElement>('[data-edit]');

        if (!span && target.closest('.badge'))
            span = card.querySelector('[data-edit="maxAssignees"]');

        if (!span && target.closest('small'))
            span = card.querySelector('[data-edit="description"]');
        if (!span)
            span = card.querySelector('[data-edit="title"]');

        if (span) startInlineEdit(span, `/api/activity/${planId}/slot`);
    });
}

/**
 * Initialize slot deletion
 */
function initDelete(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', async (e: Event) => {
        const target = e.target as Element;
        if (!target) return;

        const btn = target.closest('[data-delete-slot]');
        if (!btn) return;
        if (!confirm('Delete this slot?')) return;

        const id = (btn as HTMLElement).dataset.slotid;
        try {
            requireItemPerm(id || '', 'ITEM_DELETE', 'delete slots', 'ITEM_DELETE');
            await post(`/api/activity/${planId}/slot/${id}/delete`, {});
            showInlineAlert('success', 'Deleted');
            reloadAfterDelay(100);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to delete slot.';
            showInlineAlert('error', message);
        }
    });
}

/**
 * Initialize add slot functionality
 */
function initAddSlot(): void {
    const planId = getActivityPlanId();

    document.addEventListener('click', (e: Event) => {
        const btn: HTMLButtonElement | undefined | null = (e.target as HTMLButtonElement | null)?.closest('[data-add-slot]');
        if (!btn) return;

        // hide button, replace by small inline form
        const dateISO = btn.dataset.date;
        const cell = btn.parentElement;
        if (!cell) return;
        btn.remove();

        const wrap = document.createElement('div');
        wrap.className = 'd-grid gap-1';

        const title = document.createElement('input');
        title.className = 'form-control form-control-sm text-bg-dark';
        title.placeholder = 'Title';
        title.required = true;

        const desc = document.createElement('input');
        desc.className = 'form-control form-control-sm text-bg-dark';
        desc.placeholder = 'Description';

        const startTime = document.createElement('input');
        startTime.type = 'time';
        startTime.className = 'form-control form-control-sm text-bg-dark';
        startTime.placeholder = 'Start';

        const endTime = document.createElement('input');
        endTime.type = 'time';
        endTime.className = 'form-control form-control-sm text-bg-dark';
        endTime.placeholder = 'End';

        const max = document.createElement('input');
        max.type = 'number';
        max.min = '1';
        max.value = '1';
        max.className = 'form-control form-control-sm text-bg-dark';

        const save = document.createElement('button');
        save.className = 'btn btn-sm btn-success mt-1';
        save.textContent = 'Add';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-sm btn-outline-secondary mt-1';
        cancel.textContent = '×';

        wrap.append(title, desc, startTime, endTime, max, save, cancel);
        cell.appendChild(wrap);

        cancel.onclick = () => {
            wrap.remove();
            cell.appendChild(btn);
        };

        save.onclick = async () => {
            try {
                requireEntityPerm('ITEM_ADD', 'add slots');
                const startVal = startTime.value ? `${startTime.value}:00` : null;
                const endVal = endTime.value ? `${endTime.value}:00` : null;
                await post(`/api/activity/${planId}/slot/add`, {
                    date: dateISO,
                    title: title.value.trim(),
                    description: desc.value.trim(),
                    startTime: startVal,
                    endTime: endVal,
                    maxAssignees: max.value,
                });
                showInlineAlert('success', 'Added');
                reloadAfterDelay(100);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unable to add the slot.';
                showInlineAlert('error', message);
            }
        };
    });
}

function initRequirementPanel(): void {
    const planId = getActivityPlanId();
    const panel = document.getElementById('requirementPanel');
    if (!panel || !planId) return;

    const roleList = panel.querySelector<HTMLElement>('#roleRequirementList');
    const overrideList = panel.querySelector<HTMLElement>('#overrideList');
    const alertBox = panel.querySelector<HTMLElement>('[data-requirements-alert]');
    const addOverrideBtn = panel.querySelector<HTMLButtonElement>('[data-add-override]');
    const reloadBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-refresh]');
    const saveBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-save]');
    const summaryBody = panel.querySelector<HTMLElement>('#requirementSummaryBody');
    const assignmentMode = panel.querySelector<HTMLSelectElement>('#assignmentMode');
    const generalRequired = panel.querySelector<HTMLInputElement>('#requiredShifts');
    const roundingMode = panel.querySelector<HTMLSelectElement>('#roundingMode');
    const bindingDeadline = panel.querySelector<HTMLInputElement>('#bindingDeadline');
    const allowOverfill = panel.querySelector<HTMLInputElement>('#allowOverfill');

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

    const renderRequirementSummary = (summary: RequirementParticipantSummary[] = []) => {
        if (!summaryBody) return;
        summaryBody.innerHTML = '';

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

        buildRoleRequirementInputs(config);
        renderOverrides(config);
        renderRequirementSummary(config.participants || []);
    };

    const loadRequirements = async () => {
        setAlert('Loading requirements…');
        try {
            const res = await get(`/api/activity/${planId}/requirements`);
            populateForm(res as RequirementConfiguration);
            setAlert('Requirements loaded');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load requirements';
            setAlert(message, 'danger');
        }
    };

    const collectRoleRequirements = (): {roleId: number; requiredShifts: number}[] => {
        if (!roleList) return [];
        return Array.from(roleList.querySelectorAll<HTMLInputElement>('input[data-role-id]'))
            .map((input) => {
                const value = input.value.trim();
                if (value === '') return null;
                const num = Number(value);
                if (Number.isNaN(num) || num < 0) return null;
                return {roleId: Number(input.dataset.roleId), requiredShifts: num};
            })
            .filter((v): v is {roleId: number; requiredShifts: number} => Boolean(v));
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
    const planId = getActivityPlanId();

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
        apiUrl: `/activity/${planId}/slot/reorder`,
        getOrderData: (container) => {
            return [...container.querySelectorAll<HTMLElement>('.slot')]
                .map((el, i) => ({slotId: el.dataset.slotid, pos: i}));
        },
    });
}

function initRecommendationPanel(): void {
    const planId = getActivityPlanId();
    const panel = document.getElementById('recommendationPanel');
    const rows = panel?.querySelector<HTMLElement>('#recommendationRows');
    const alertBox = panel?.querySelector<HTMLElement>('[data-recommendations-alert]');
    const refreshBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-refresh]');
    const autoBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-auto]');
    const saveBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-save]');
    const applyBtn = panel?.querySelector<HTMLButtonElement>('[data-recommendations-apply]');

    if (!planId || !panel || !rows) return;

    let warnings: RecommendationWarning[] = [];

    const setAlert = (message?: string, variant: 'info' | 'danger' = 'info') => {
        if (!alertBox) return;
        const target = alertBox.querySelector('span') || alertBox;
        if (!message) {
            alertBox.classList.add('d-none');
            target.textContent = '';
            return;
        }

        alertBox.classList.remove('d-none', 'alert-info', 'alert-danger');
        alertBox.classList.add(variant === 'danger' ? 'alert-danger' : 'alert-info');
        target.textContent = message;
    };

    const warningKey = (slotId: string, userId?: number | null, guestId?: number | null) => {
        if (userId) return `${slotId}:u${userId}`;
        if (guestId) return `${slotId}:g${guestId}`;
        return `${slotId}:unknown`;
    };

    const buildWarningMap = () => {
        const map = new Map<string, AssignmentWarning[]>();
        warnings.forEach((entry) => {
            const key = warningKey(entry.recommendation.slotId, entry.recommendation.userId, entry.recommendation.guestId);
            map.set(key, entry.warnings);
        });
        return map;
    };

    let slotOptions: RecommendationSlotOption[] = [];
    let participantOptions: RecommendationParticipantOption[] = [];

    const formatParticipantLabel = (option: RecommendationParticipantOption) => {
        const arrival = formatDateLabel(option.arrivalDate ?? null);
        const departure = formatDateLabel(option.departureDate ?? null);
        const attendance = arrival || departure ? ` (${arrival || 'start'} – ${departure || 'end'})` : '';
        return `${option.label}${attendance}`;
    };

    const participantValue = (option: RecommendationParticipantOption) =>
        option.userId ? `user:${option.userId}` : `guest:${option.guestId}`;

    const setParticipantDataset = (row: HTMLElement, value: string) => {
        delete row.dataset.userId;
        delete row.dataset.guestId;
        if (value.startsWith('user:')) {
            row.dataset.userId = value.replace('user:', '');
        } else if (value.startsWith('guest:')) {
            row.dataset.guestId = value.replace('guest:', '');
        }
    };

    const currentRecKey = (row: HTMLElement) => warningKey(
        row.dataset.slotId || '',
        row.dataset.userId ? Number(row.dataset.userId) : null,
        row.dataset.guestId ? Number(row.dataset.guestId) : null,
    );

    const markDirty = (row: HTMLElement) => {
        row.dataset.dirty = 'true';
        row.classList.add('table-warning');
    };

    const renderWarningCell = (row: HTMLElement, warningMap: Map<string, AssignmentWarning[]>) => {
        const warningCell = row.querySelector<HTMLElement>('td[data-warning]');
        if (!warningCell) return;
        warningCell.innerHTML = '';

        const warningList = warningMap.get(row.dataset.recKey || '');
        if (warningList && warningList.length) {
            const list = document.createElement('ul');
            list.className = 'mb-0 small ps-3';
            warningList.forEach((warn) => {
                const li = document.createElement('li');
                li.textContent = describeWarning(warn);
                list.append(li);
            });
            warningCell.append(list);
            return;
        }

        const span = document.createElement('span');
        span.className = 'small';
        if (row.dataset.dirty === 'true') {
            span.classList.add('text-secondary');
            span.textContent = 'Save to refresh warnings';
        } else {
            span.classList.add('text-success');
            span.textContent = 'No warnings';
        }
        warningCell.append(span);
    };

    const renderRecommendations = (data: RecommendationRow[]) => {
        rows.innerHTML = '';
        const warningMap = buildWarningMap();

        if (!data.length) {
            const empty = document.createElement('tr');
            empty.dataset.emptyState = 'true';
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.className = 'text-center text-secondary pt-3';
            cell.textContent = 'No recommendations yet.';
            empty.append(cell);
            rows.append(empty);
            return;
        }

        data.forEach((rec) => {
            const row = document.createElement('tr');
            row.dataset.slotId = rec.slot.id;
            if (rec.user?.id) row.dataset.userId = String(rec.user.id);
            if (rec.guest?.id) row.dataset.guestId = String(rec.guest.id);
            row.dataset.recKey = warningKey(rec.slot.id, rec.user?.id, rec.guest?.id);
            delete row.dataset.dirty;
            row.classList.remove('table-warning');

            const slotCell = document.createElement('td');
            const slotSelect = document.createElement('select');
            slotSelect.className = 'form-select form-select-sm text-bg-dark';
            const slotList = [...slotOptions];
            if (!slotList.some((opt) => opt.id === rec.slot.id)) slotList.push(rec.slot);
            slotList.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt.id;
                option.textContent = formatSlotLabel(opt);
                slotSelect.append(option);
            });
            slotSelect.value = rec.slot.id;
            slotSelect.addEventListener('change', () => {
                row.dataset.slotId = slotSelect.value;
                row.dataset.recKey = currentRecKey(row);
                markDirty(row);
                renderWarningCell(row, warningMap);
            });
            slotCell.append(slotSelect);

            const participantCell = document.createElement('td');
            const participantSelect = document.createElement('select');
            participantSelect.className = 'form-select form-select-sm text-bg-dark';
            const participantList = [...participantOptions];
            const selectedValue = rec.user?.id ? `user:${rec.user.id}` : rec.guest?.id ? `guest:${rec.guest.id}` : '';
            if (selectedValue && !participantList.some((opt) => participantValue(opt) === selectedValue)) {
                participantList.push({
                    key: selectedValue,
                    label: rec.user?.username || rec.guest?.username || selectedValue,
                    userId: rec.user?.id ?? null,
                    guestId: rec.guest?.id ?? null,
                });
            }

            participantList.forEach((opt) => {
                const option = document.createElement('option');
                option.value = participantValue(opt);
                option.textContent = formatParticipantLabel(opt);
                participantSelect.append(option);
            });
            participantSelect.value = selectedValue;
            if (!participantSelect.value && participantList.length) {
                participantSelect.value = participantValue(participantList[0]);
            }
            if (participantSelect.value) {
                setParticipantDataset(row, participantSelect.value);
                row.dataset.recKey = currentRecKey(row);
            }
            participantSelect.addEventListener('change', () => {
                setParticipantDataset(row, participantSelect.value);
                row.dataset.recKey = currentRecKey(row);
                markDirty(row);
                renderWarningCell(row, warningMap);
            });
            participantCell.append(participantSelect);

            const statusCell = document.createElement('td');
            const statusSelect = document.createElement('select');
            statusSelect.className = 'form-select form-select-sm text-bg-dark';
            statusSelect.dataset.recStatus = 'true';
            ['PENDING', 'APPROVED', 'REJECTED', 'APPLIED'].forEach((status) => {
                const opt = document.createElement('option');
                opt.value = status;
                opt.textContent = status;
                statusSelect.append(opt);
            });
            statusSelect.value = rec.status;
            if (rec.status === 'APPLIED') statusSelect.disabled = true;
            statusSelect.addEventListener('change', () => markDirty(row));
            statusCell.append(statusSelect);

            const warningCell = document.createElement('td');
            warningCell.dataset.warning = 'true';
            renderWarningCell(row, warningMap);

            row.append(slotCell, participantCell, statusCell, warningCell);
            rows.append(row);
        });
    };

    const loadRecommendations = async () => {
        setAlert('Loading recommendations…');
        try {
            const res = await get(`/api/activity/${planId}/recommendations`);
            warnings = (res?.warnings || []) as RecommendationWarning[];
            slotOptions = (res?.slots || []) as RecommendationSlotOption[];
            participantOptions = (res?.participants || []) as RecommendationParticipantOption[];
            renderRecommendations((res?.recommendations || []) as RecommendationRow[]);
            setAlert(warnings.length ? 'Warnings detected in proposed assignments' : 'Recommendations loaded');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const collectRecommendationPayload = () => {
        return Array.from(rows.querySelectorAll<HTMLElement>('tr[data-slot-id]')).map((row) => {
            const status = row.querySelector<HTMLSelectElement>('[data-rec-status]');
            return {
                slotId: row.dataset.slotId!,
                userId: row.dataset.userId ? Number(row.dataset.userId) : null,
                guestId: row.dataset.guestId ? Number(row.dataset.guestId) : null,
                status: status?.value,
            };
        });
    };

    const saveRecommendations = async () => {
        setAlert('Saving recommendations…');
        try {
            await post(`/api/activity/${planId}/recommendations`, {recommendations: collectRecommendationPayload()});
            showInlineAlert('success', 'Recommendations saved');
            await loadRecommendations();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const autoGenerate = async () => {
        setAlert('Generating recommendations…');
        try {
            await post(`/api/activity/${planId}/recommendations/auto`, {});
            showInlineAlert('success', 'Recommendations generated');
            await loadRecommendations();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to auto-generate recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    const applyRecommendations = async () => {
        setAlert('Applying approved recommendations…');
        try {
            const res = await post(`/api/activity/${planId}/recommendations/apply`, {});
            warnings = (res?.warnings || []) as RecommendationWarning[];
            showInlineAlert('success', res?.message || 'Recommendations applied');
            await loadRecommendations();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to apply recommendations';
            setAlert(message, 'danger');
            showInlineAlert('error', message);
        }
    };

    refreshBtn?.addEventListener('click', () => void loadRecommendations());
    autoBtn?.addEventListener('click', () => void autoGenerate());
    saveBtn?.addEventListener('click', () => void saveRecommendations());
    applyBtn?.addEventListener('click', () => void applyRecommendations());

    void loadRecommendations();
}

/**
 * Initialize date display formatting
 */
function initDates(): void {
    document.querySelectorAll('th[data-date]').forEach(el => {
        const th = el as HTMLElement;
        const dateValue = th.dataset.date;
        if (!dateValue) return;
        const [y, m, day] = dateValue.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1, day));

        const dayEl = th.querySelector('.day');
        if (dayEl) {
            dayEl.textContent = d.toLocaleDateString(undefined, {weekday: 'short'});
        }

        const dateEl = th.querySelector('.date');
        if (dateEl) {
            dateEl.textContent = d.toLocaleDateString();
        }
    });
}

/**
 * Initialize all activity plan functionality
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initDates();
    initSelectBox();

    const planId = getActivityPlanId();
    if (planId) {
        const warningModal = buildWarningModal();
        initAssign(warningModal);
        initInlineEdit();
        initDelete();
        initAddSlot();
        initDnD();
        initRequirementPanel();
        initRecommendationPanel();

        initAssignmentRemoval({
            baseUrl: `/activity/${planId}`,
        });
    }
}

// Expose to global scope
window.Surveyor.init = init;
