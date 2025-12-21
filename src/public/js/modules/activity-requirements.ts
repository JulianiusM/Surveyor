/**
 * Activity Requirements Panel Module
 * Handles the requirements configuration panel
 */

import {formatDateLabel, toDateTimeLocalValue, toISOStringOrNull} from "../core/formatting";
import {get, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {getAllRoles} from "./activity-roles";
import type {RequirementConfiguration, RequirementParticipantSummary} from './activity-types';

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
    const summaryBody = document.querySelector<HTMLElement>('#requirementSummaryBody');
    const summaryStats = document.querySelector<HTMLElement>('#requirementSummaryStats');
    const assignmentMode = panel.querySelector<HTMLSelectElement>('#assignmentMode');
    const generalRequired = panel.querySelector<HTMLInputElement>('#requiredShifts');
    const roundingMode = panel.querySelector<HTMLSelectElement>('#roundingMode');
    const bindingDeadline = panel.querySelector<HTMLInputElement>('#bindingDeadline');
    const allowOverfill = panel.querySelector<HTMLInputElement>('#allowOverfill');
    const allowArrivalEvening = panel.querySelector<HTMLInputElement>('#allowArrivalEvening');
    const allowDepartureMorning = panel.querySelector<HTMLInputElement>('#allowDepartureMorning');
    const baselineCalcBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-baseline-calc]');
    let overrideTargets: RequirementConfiguration['overrideTargets'] = [];
    type OverrideTarget = NonNullable<RequirementConfiguration['overrideTargets']>[number];

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

    const participantValue = (target?: OverrideTarget) => {
        if (!target) return '';
        if (target.userId) return `user:${target.userId}`;
        if (target.guestId) return `guest:${target.guestId}`;
        return target.key || '';
    };

    const findTargetForOverride = (override?: RequirementConfiguration['overrides'][number]) => {
        if (!overrideTargets) return undefined;
        return overrideTargets.find((target) => {
            if (override?.userId && target.userId) return target.userId === override.userId;
            if (override?.guestId && target.guestId) return target.guestId === override.guestId;
            return false;
        });
    };

    const describeAttendance = (target?: OverrideTarget) => {
        if (!target) return '';
        const arrival = target.arrivalDate ? formatDateLabel(target.arrivalDate) : '';
        const departure = target.departureDate ? formatDateLabel(target.departureDate) : '';
        if (arrival || departure) return `${arrival || 'start'} – ${departure || 'end'}`;
        return 'Full event attendance';
    };

    const updateParticipantHint = (select?: HTMLSelectElement | null, hint?: HTMLElement | null) => {
        if (!select || !hint) return;
        const option = select.selectedOptions[0];
        if (!select.value) {
            hint.classList.remove('text-warning');
            hint.classList.add('text-secondary');
            hint.textContent = 'Select a registered participant to override requirements.';
            return;
        }

        if (option?.dataset.invalid === 'true') {
            hint.classList.remove('text-secondary');
            hint.classList.add('text-warning');
            hint.textContent = 'Not registered for this event. Choose a different participant.';
            return;
        }

        const target = overrideTargets?.find((t) => participantValue(t) === select.value);
        const attendance = describeAttendance(target);
        hint.classList.remove('text-warning');
        hint.classList.add('text-secondary');
        const badge = target?.userId ? 'User' : 'Guest';
        hint.textContent = attendance ? `${badge} • ${attendance}` : badge;
    };

    const setOverrideControlsState = () => {
        if (!addOverrideBtn) return;
        addOverrideBtn.disabled = !overrideTargets || !overrideTargets.length;
        addOverrideBtn.title = addOverrideBtn.disabled
            ? 'Register participants for this event to enable overrides'
            : '';
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
            {label: 'Total', value: total, className: 'badge bg-secondary text-white me-1'},
            {label: 'Satisfied', value: ok, className: 'badge bg-success text-white me-1'},
            {label: 'Under-assigned', value: under, className: 'badge bg-warning text-dark me-1'},
            {label: 'Over-assigned', value: over, className: 'badge bg-danger text-white me-1'},
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
            badge.className = 'badge bg-secondary text-white';
            badge.textContent = `${entry.requiredShifts} required / ${entry.assignedShifts} assigned`;
            requiredCell.append(badge);

            const remainingCell = document.createElement('td');
            remainingCell.className = 'text-center';
            const remainingBadge = document.createElement('span');
            remainingBadge.className = entry.remainingShifts > 0
                ? 'badge bg-warning text-dark'
                : 'badge bg-success text-white';
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
            sourceBadge.className = 'badge bg-info text-white text-uppercase';
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
        row.className = 'row align-items-start override-row border border-secondary-subtle rounded p-2';
        if (override?.id) row.dataset.overrideId = String(override.id);

        const colTarget = document.createElement('div');
        colTarget.className = 'col-md-5 d-grid gap-1 m-auto';
        const targetLabel = document.createElement('label');
        targetLabel.className = 'form-label small mb-0';
        targetLabel.textContent = 'Participant';
        const participantSelect = document.createElement('select');
        participantSelect.className = 'form-select form-select-sm text-bg-dark';
        participantSelect.dataset.overrideTarget = 'participant';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = overrideTargets?.length
            ? 'Choose a participant'
            : 'No participants available';
        participantSelect.append(placeholder);

        const sortedTargets = [...(overrideTargets || [])].sort((a, b) => a.label.localeCompare(b.label));
        sortedTargets.forEach((target) => {
            const opt = document.createElement('option');
            opt.value = participantValue(target);
            const attendance = describeAttendance(target);
            opt.textContent = attendance ? `${target.label} — ${attendance}` : target.label;
            participantSelect.append(opt);
        });

        const overrideValue = override?.userId
            ? `user:${override.userId}`
            : override?.guestId
                ? `guest:${override.guestId}`
                : '';

        const matchedTarget = findTargetForOverride(override);
        if (matchedTarget) {
            participantSelect.value = participantValue(matchedTarget);
        } else if (overrideValue) {
            const missingOpt = document.createElement('option');
            missingOpt.value = overrideValue;
            missingOpt.dataset.invalid = 'true';
            missingOpt.textContent = override?.user?.name || override?.user?.username
                || override?.guest?.username
                || `Not registered (${overrideValue.replace(':', ' #')})`;
            participantSelect.append(missingOpt);
            participantSelect.value = overrideValue;
        } else if (participantSelect.querySelector('option:not([disabled])')) {
            participantSelect.value = participantSelect.querySelector<HTMLOptionElement>('option:not([disabled])')?.value || '';
        }

        if (!overrideTargets?.length) {
            participantSelect.disabled = true;
        }

        const targetHint = document.createElement('div');
        targetHint.className = 'form-text text-secondary small';
        updateParticipantHint(participantSelect, targetHint);
        participantSelect.addEventListener('change', () => updateParticipantHint(participantSelect, targetHint));

        colTarget.append(targetLabel, participantSelect, targetHint);

        const colRole = document.createElement('div');
        colRole.className = 'col-md-3 d-grid gap-1 m-auto';
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
        colReq.className = 'col-md-3 d-grid gap-1 m-auto';
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
        colRemove.className = 'col-md-1 d-flex align-items-end m-auto py-3';
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

        if (!overrideTargets?.length) {
            const empty = document.createElement('div');
            empty.className = 'text-secondary small';
            empty.dataset.emptyState = 'true';
            empty.textContent = 'No event participants are registered yet. Add participants to enable overrides.';
            overrideList.append(empty);
            if (!config.overrides.length) {
                return;
            }
        }

        if (overrideTargets?.length && !config.overrides.length) {
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

        overrideTargets = config.overrideTargets || [];
        setOverrideControlsState();

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

    const calculateBaselineRequirement = async () => {
        setAlert('Calculating baseline requirement…');
        try {
            const res = await get(`/api/activity/${planId}/requirements/baseline`);
            const baseline = Number(res.data?.baseline ?? NaN);

            if (!Number.isFinite(baseline)) {
                throw new Error('Unable to calculate baseline requirement');
            }

            if (generalRequired) generalRequired.value = String(baseline);
            setAlert(`Baseline requirement set to ${baseline}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to calculate baseline requirement';
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

    const collectOverrides = (): { overrides: RequirementConfiguration['overrides']; hasInvalid: boolean } => {
        if (!overrideList) return {overrides: [], hasInvalid: false};
        const entries: RequirementConfiguration['overrides'] = [];
        let hasInvalid = false;
        overrideList.querySelectorAll<HTMLElement>('.override-row').forEach((row) => {
            const participantSelect = row.querySelector<HTMLSelectElement>('[data-override-target="participant"]');
            const roleSelect = row.querySelector<HTMLSelectElement>('[data-override-target="role"]');
            const reqInput = row.querySelector<HTMLInputElement>('[data-override-target="required"]');

            const requiredShifts = Number(reqInput?.value ?? 0);
            const selection = participantSelect?.value ?? '';
            const selectedOption = participantSelect?.selectedOptions[0];
            if (!selection) return;
            if (selectedOption?.dataset.invalid === 'true') {
                hasInvalid = true;
                participantSelect?.classList.add('is-invalid');
                return;
            }
            participantSelect?.classList.remove('is-invalid');

            const [targetType, rawId] = selection.split(':');
            const participantId = Number(rawId);
            if (!targetType || Number.isNaN(participantId)) return;

            const entry: any = {
                roleId: roleSelect?.value ? Number(roleSelect.value) : null,
                requiredShifts: Number.isNaN(requiredShifts) ? 0 : requiredShifts,
            };

            if (row.dataset.overrideId) entry.id = Number(row.dataset.overrideId);

            if (targetType === 'guest') {
                entry.guestId = participantId;
            } else {
                entry.userId = participantId;
            }

            entries.push(entry);
        });
        return {overrides: entries, hasInvalid};
    };

    const saveRequirements = async () => {
        setAlert('Saving settings…');
        try {
            const {overrides, hasInvalid} = collectOverrides();
            if (hasInvalid) {
                setAlert('Update overrides to target registered participants only.', 'danger');
                showInlineAlert('error', 'Update overrides to target registered participants only.');
                return;
            }

            await post(`/api/activity/${planId}/requirements`, {
                assignmentMode: assignmentMode?.value,
                generalRequiredShifts: generalRequired?.value ? Number(generalRequired.value) : null,
                roundingMode: roundingMode?.value || null,
                bindingDeadline: toISOStringOrNull(bindingDeadline?.value || ''),
                allowOverfillAfterFull: allowOverfill?.checked ?? false,
                allowArrivalDayEvening: allowArrivalEvening?.checked ?? true,
                allowDepartureDayMorning: allowDepartureMorning?.checked ?? true,
                roleRequirements: collectRoleRequirements(),
                overrides,
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
        if (!overrideTargets?.length) return;
        if (overrideList && overrideList.querySelector('[data-empty-state]')) {
            overrideList.innerHTML = '';
        }
        buildOverrideRow();
    });
    reloadBtn?.addEventListener('click', () => void loadRequirements());
    saveBtn?.addEventListener('click', () => void saveRequirements());
    baselineCalcBtn?.addEventListener('click', () => void calculateBaselineRequirement());

    void loadRequirements();
}
