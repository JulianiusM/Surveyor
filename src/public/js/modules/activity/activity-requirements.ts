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
 * Activity Requirements Panel Module
 * Handles the requirements configuration panel
 */

import {formatDateLabel, toDateTimeLocalValue, toISOStringOrNull} from "../../core/formatting";
import {get, post} from '../../core/http';
import {showInlineAlert} from '../../shared/alerts';
import {renderParticipantStatus} from './activity-participants';
import {getAllRoles} from "./activity-roles";
import type {RequirementConfiguration, RequirementParticipantSummary} from './activity-types';
import {
    applyRounding,
    calculateBaselineRequirementForPlan,
    calculateRequirementAnalysis,
    countInclusiveDays,
    hasValidRequirementValues,
    type ParticipantAttendance,
    type RequirementAnalysisResult,
} from '../../../../modules/activity/requirements.js';

export interface RequirementDraft {
    assignmentMode: 'FREE' | 'REQUIRED';
    generalRequiredShifts: number | null;
    roundingMode: RequirementConfiguration['plan']['roundingMode'];
    allowOverfillAfterFull: boolean;
    roleRequirements: RequirementConfiguration['roleRequirements'];
    stayRequirements: RequirementConfiguration['stayRequirements'];
    overrides: RequirementConfiguration['overrides'];
}

export interface RequirementCoverageStatus {
    state: 'inactive' | 'exact' | 'acceptable' | 'conflict';
    variant: 'secondary' | 'success' | 'warning' | 'danger';
    icon: string;
    title: string;
    detail: string;
}

const normalizeShiftCount = (value: number | null | undefined): number => {
    if (value == null || !Number.isFinite(value)) return 0;
    return Math.max(Math.trunc(value), 0);
};

function participantInputs(config: RequirementConfiguration): ParticipantAttendance[] {
    if (config.calculationContext) return config.calculationContext.participants;
    return (config.participants ?? []).map((participant) => ({
        profileId: participant.participantKey.startsWith('profile:')
            ? participant.participantKey.slice('profile:'.length)
            : null,
        arrivalDate: participant.attendance?.arrivalDate,
        departureDate: participant.attendance?.departureDate,
        roleIds: participant.roleIds ?? [],
        name: participant.name,
    }));
}

export function calculateLiveRequirementAnalysis(
    config: RequirementConfiguration,
    draft: RequirementDraft,
): RequirementAnalysisResult {
    const assignedShiftCounts = config.calculationContext?.assignedShiftCounts
        ?? Object.fromEntries((config.participants ?? []).map((participant) => [participant.participantKey, participant.assignedShifts]));
    const analysis = calculateRequirementAnalysis({
        plan: {
            assignmentMode: draft.assignmentMode,
            generalRequiredShifts: draft.generalRequiredShifts,
            roundingMode: draft.roundingMode,
            startDate: config.plan.startDate,
            endDate: config.plan.endDate,
        },
        participants: participantInputs(config),
        roleRequirements: draft.roleRequirements,
        overrides: draft.overrides,
        stayRequirements: draft.stayRequirements,
        slots: config.calculationContext?.slots ?? [],
        assignedShiftCounts,
    });
    const savedParticipants = new Map((config.participants ?? []).map((participant) => [participant.participantKey, participant]));
    return {
        ...analysis,
        participants: analysis.participants.map((participant) => ({
            ...participant,
            roles: savedParticipants.get(participant.participantKey)?.roles ?? [],
            assignmentMode: draft.assignmentMode,
        })),
    };
}

export function calculateLiveRequirementSummary(
    config: RequirementConfiguration,
    draft: RequirementDraft,
): RequirementParticipantSummary[] {
    return calculateLiveRequirementAnalysis(config, draft).participants;
}

export function evaluateRequirementCoverage(
    availableSlots: number,
    requiredSlots: number,
    allowOverfill: boolean,
    assignmentMode: 'FREE' | 'REQUIRED',
): RequirementCoverageStatus {
    const slotTarget = normalizeShiftCount(availableSlots);
    const requirementTotal = normalizeShiftCount(requiredSlots);
    const deviation = requirementTotal - slotTarget;

    if (assignmentMode !== 'REQUIRED') {
        return {
            state: 'inactive',
            variant: 'secondary',
            icon: 'bi-sliders',
            title: 'Free assignment mode',
            detail: 'No coverage constraint applies until Required mode is selected.',
        };
    }

    if (deviation === 0) {
        return {
            state: 'exact',
            variant: 'success',
            icon: 'bi-check-circle-fill',
            title: 'Exact coverage',
            detail: 'Participant requirements match the slot target exactly.',
        };
    }

    const amount = Math.abs(deviation);
    const units = amount === 1 ? 'assignment' : 'assignments';

    if (allowOverfill && deviation > 0) {
        return {
            state: 'acceptable',
            variant: 'warning',
            icon: 'bi-arrow-up-circle-fill',
            title: `Above slot capacity by ${amount}`,
            detail: `Overfill allows these ${units}; exact coverage remains the goal.`,
        };
    }

    if (allowOverfill) {
        return {
            state: 'conflict',
            variant: 'danger',
            icon: 'bi-exclamation-octagon-fill',
            title: `Short of slot capacity by ${amount}`,
            detail: `Increase participant requirements by ${amount} ${units} to cover every slot.`,
        };
    }

    if (deviation > 0) {
        return {
            state: 'conflict',
            variant: 'danger',
            icon: 'bi-exclamation-octagon-fill',
            title: `Hard slot capacity exceeded by ${amount}`,
            detail: `Reduce participant requirements by ${amount} ${units} to stay within capacity.`,
        };
    }

    return {
        state: 'acceptable',
        variant: 'warning',
        icon: 'bi-arrow-down-circle-fill',
        title: `Below hard slot capacity by ${amount}`,
        detail: `${amount} ${amount === 1 ? 'slot remains' : 'slots remain'} uncovered; exact coverage remains the goal.`,
    };
}

function countInclusivePlanDays(startDate: string, endDate: string): number {
    return countInclusiveDays(startDate, endDate);
}

/**
 * Initialize the requirements panel
 */
export function initRequirementPanel(planId: string): void {

    const panel = document.getElementById('requirementPanel');
    if (!panel) return;

    const roleList = panel.querySelector<HTMLElement>('#roleRequirementList');
    const stayRequirementList = panel.querySelector<HTMLElement>('#stayRequirementList');
    const overrideList = panel.querySelector<HTMLElement>('#overrideList');
    const alertBox = panel.querySelector<HTMLElement>('[data-requirements-alert]');
    const addOverrideBtn = panel.querySelector<HTMLButtonElement>('[data-add-override]');
    const reloadBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-refresh]');
    const saveButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-requirements-save]'));
    const participantStatus = document.querySelector<HTMLElement>('#requirement-participant-status');
    const coverageStatus = panel.querySelector<HTMLElement>('#requirementCoverageStatus');
    const assignmentMode = panel.querySelector<HTMLSelectElement>('#assignmentMode');
    const generalRequired = panel.querySelector<HTMLInputElement>('#requiredShifts');
    const roundingMode = panel.querySelector<HTMLSelectElement>('#roundingMode');
    const bindingDeadline = panel.querySelector<HTMLInputElement>('#bindingDeadline');
    const allowOverfill = panel.querySelector<HTMLInputElement>('#allowOverfill');
    const allowExternalAssignees = panel.querySelector<HTMLInputElement>('#allowExternalAssignees');
    const allowArrivalEvening = panel.querySelector<HTMLInputElement>('#allowArrivalEvening');
    const allowDepartureMorning = panel.querySelector<HTMLInputElement>('#allowDepartureMorning');
    const baselineCalcBtn = panel.querySelector<HTMLButtonElement>('[data-requirements-baseline-calc]');
    let overrideTargets: RequirementConfiguration['overrideTargets'] = [];
    let loadedConfig: RequirementConfiguration | undefined;
    let refreshLivePreview: () => void = () => undefined;
    let requirementsDirty = false;
    type OverrideTarget = NonNullable<RequirementConfiguration['overrideTargets']>[number];

    const setAlert = (message?: string, variant: 'info' | 'warning' | 'danger' = 'info') => {
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

    const setRequirementsDirty = (dirty: boolean) => {
        requirementsDirty = dirty;
        saveButtons.forEach((button) => {
            button.disabled = !dirty;
            button.title = dirty ? 'Save requirement settings' : 'Requirement settings are saved';
        });

        const badge = panel.querySelector<HTMLElement>('[data-requirements-dirty]');
        if (badge) {
            badge.className = dirty ? 'badge bg-warning text-dark' : 'badge bg-light text-dark';
            badge.textContent = dirty ? 'Unsaved changes' : 'Saved';
        }
    };

    const participantValue = (target?: OverrideTarget) => {
        if (!target) return '';
        if (target.profileId) return `profile:${target.profileId}`;
        return target.key || '';
    };

    const findTargetForOverride = (override?: RequirementConfiguration['overrides'][number]) => {
        if (!overrideTargets) return undefined;
        return overrideTargets.find((target) => {
            if (override?.profileId && target.profileId) return target.profileId === override.profileId;
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
        select.title = option?.textContent?.trim() ?? '';
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
        hint.textContent = attendance ? `${attendance}` : '';
    };

    const setOverrideControlsState = () => {
        if (!addOverrideBtn) return;
        addOverrideBtn.disabled = !overrideTargets || !overrideTargets.length;
        addOverrideBtn.title = addOverrideBtn.disabled
            ? 'Register participants for this event to enable overrides'
            : '';
    };

    const renderCoverageStatus = (
        capacity: NonNullable<RequirementConfiguration['capacitySummary']>,
        draft: RequirementDraft,
    ) => {
        if (!coverageStatus) return;
        const status = evaluateRequirementCoverage(
            capacity.availableSlots,
            capacity.requiredSlots,
            draft.allowOverfillAfterFull,
            draft.assignmentMode,
        );
        if (draft.assignmentMode === 'REQUIRED' && capacity.configurationComplete === false) {
            status.state = 'conflict';
            status.variant = 'danger';
            status.icon = 'bi-exclamation-octagon-fill';
            status.title = 'Invalid or incomplete requirements';
            status.detail = 'Enter one non-negative integer requirement for every stay duration and correct invalid role or override values.';
        }
        if ((capacity.hypotheticalRoleCoverage?.roleCapacityConflicts.length ?? 0) > 0) {
            status.state = 'conflict';
            status.variant = 'danger';
            status.icon = 'bi-exclamation-octagon-fill';
            status.title = 'Role quotas exceed slot capacity';
            status.detail = 'Reduce the configured role quantities or increase the affected slot capacity.';
        }
        const title = coverageStatus.querySelector<HTMLElement>('[data-coverage-title]');
        const detail = coverageStatus.querySelector<HTMLElement>('[data-coverage-detail]');
        const icon = coverageStatus.querySelector<HTMLElement>('[data-coverage-icon]');
        const counts = coverageStatus.querySelector<HTMLElement>('[data-coverage-counts]');

        coverageStatus.classList.remove('alert-secondary', 'alert-success', 'alert-warning', 'alert-danger');
        coverageStatus.classList.add(`alert-${status.variant}`);
        coverageStatus.dataset.coverageState = status.state;
        if (title) title.textContent = status.title;
        if (detail) detail.textContent = status.detail;
        if (icon) icon.className = `bi ${status.icon} mt-1`;
        if (counts) {
            counts.innerHTML = '';
            const previewBadge = document.createElement('span');
            previewBadge.dataset.requirementsDirty = 'true';
            previewBadge.className = requirementsDirty ? 'badge bg-warning text-dark' : 'badge bg-light text-dark';
            previewBadge.textContent = requirementsDirty ? 'Unsaved changes' : 'Saved';
            const slotBadge = document.createElement('span');
            slotBadge.className = 'badge bg-dark text-white';
            slotBadge.textContent = `Slot capacity: ${capacity.availableSlots}`;
            const requirementBadge = document.createElement('span');
            requirementBadge.className = 'badge bg-dark text-white';
            requirementBadge.textContent = `Required shifts: ${capacity.requiredSlots}`;
            counts.append(previewBadge, slotBadge, requirementBadge);
            const roleCoverage = capacity.hypotheticalRoleCoverage;
            if (roleCoverage && roleCoverage.openRoleCount > 0) {
                const roleBadge = document.createElement('span');
                roleBadge.className = roleCoverage.unfilledRoleCount > 0
                    ? 'badge bg-danger text-white'
                    : 'badge bg-info text-dark';
                roleBadge.textContent = roleCoverage.unfilledRoleCount > 0
                    ? `Open roles unfillable: ${roleCoverage.unfilledRoleCount}`
                    : `Open roles modeled: ${roleCoverage.filledRoleCount}`;
                counts.append(roleBadge);
            }
        }
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
            label.textContent = role.title;

            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.className = 'form-control form-control-sm text-bg-dark';
            input.placeholder = '0';
            input.dataset.roleId = String(role.id);
            const defaultValue = defaults.get(role.id);
            input.value = typeof defaultValue === 'number' ? String(defaultValue) : '';

            wrap.append(label, input);
            roleList.appendChild(wrap);
        });
    };

    const buildStayRequirementInputs = (
        plan: RequirementConfiguration['plan'],
        requirements: RequirementConfiguration['stayRequirements'],
    ) => {
        if (!stayRequirementList) return;
        stayRequirementList.innerHTML = '';

        const planDays = countInclusivePlanDays(plan.startDate, plan.endDate);
        const configured = new Map(requirements.map((requirement) => [requirement.stayDays, requirement.requiredShifts]));

        for (let stayDays = 1; stayDays <= planDays; stayDays += 1) {
            const wrap = document.createElement('div');
            wrap.className = 'stay-requirement-item d-grid gap-1';

            const label = document.createElement('label');
            label.className = 'form-label small mb-0 text-nowrap';
            label.htmlFor = `stayRequirement-${stayDays}`;
            label.textContent = `${stayDays} ${stayDays === 1 ? 'day' : 'days'}`;

            const input = document.createElement('input');
            input.id = `stayRequirement-${stayDays}`;
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.className = 'form-control form-control-sm text-bg-dark';
            input.dataset.stayDays = String(stayDays);
            input.setAttribute('aria-label', `Required shifts for a ${stayDays}-day stay`);

            const savedValue = configured.get(stayDays);
            if (savedValue != null) {
                input.value = String(savedValue);
            } else if (plan.generalRequiredShifts != null && planDays > 0) {
                input.value = String(applyRounding(
                    plan.generalRequiredShifts * (stayDays / planDays),
                    plan.roundingMode ?? 'CEIL',
                ));
            }

            wrap.append(label, input);
            stayRequirementList.append(wrap);
        }

        if (planDays === 0) {
            const empty = document.createElement('span');
            empty.className = 'text-secondary small';
            empty.textContent = 'No valid stay durations are available.';
            stayRequirementList.append(empty);
        }
    };

    const populateStayRequirementValues = (requirements: RequirementConfiguration['stayRequirements']) => {
        if (!stayRequirementList) return;
        const values = new Map(requirements.map((requirement) => [requirement.stayDays, requirement.requiredShifts]));
        stayRequirementList.querySelectorAll<HTMLInputElement>('input[data-stay-days]').forEach((input) => {
            const value = values.get(Number(input.dataset.stayDays));
            input.value = value == null ? '' : String(value);
        });
    };

    const buildOverrideRow = (override?: RequirementConfiguration['overrides'][number]) => {
        if (!overrideList) return;
        const row = document.createElement('div');
        row.className = 'row g-2 align-items-end override-row border border-secondary-subtle rounded p-2 mx-0';
        if (override?.id) row.dataset.overrideId = String(override.id);

        const colTarget = document.createElement('div');
        colTarget.className = 'col-12 col-lg-7 d-grid gap-1';
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

        const overrideValue = override?.profileId ? `profile:${override.profile}` : '';

        const matchedTarget = findTargetForOverride(override);
        if (matchedTarget) {
            participantSelect.value = participantValue(matchedTarget);
        } else if (overrideValue) {
            const missingOpt = document.createElement('option');
            missingOpt.value = overrideValue;
            missingOpt.dataset.invalid = 'true';
            missingOpt.textContent = override?.profile?.name || `Not registered (${overrideValue.replace(':', ' #')})`;
            participantSelect.append(missingOpt);
            participantSelect.value = overrideValue;
        } else if (participantSelect.querySelector('option:not([disabled])')) {
            participantSelect.value = participantSelect.querySelector<HTMLOptionElement>('option:not([disabled])')?.value || '';
        }

        if (!overrideTargets?.length) {
            participantSelect.disabled = true;
        }

        const targetHint = document.createElement('div');
        targetHint.className = 'form-text text-secondary small override-attendance-hint mt-1';
        updateParticipantHint(participantSelect, targetHint);
        participantSelect.addEventListener('change', () => updateParticipantHint(participantSelect, targetHint));

        colTarget.append(targetLabel, participantSelect, targetHint);

        const colRole = document.createElement('div');
        colRole.className = 'col-6 col-lg-2 d-grid gap-1';
        const roleLabel = document.createElement('label');
        roleLabel.className = 'form-label small mb-0';
        roleLabel.textContent = 'Role (optional)';
        const roleSelect = document.createElement('select');
        roleSelect.className = 'form-select form-select-sm text-bg-dark';
        roleSelect.dataset.overrideTarget = 'role';
        roleSelect.innerHTML = '<option value="">Any role</option>' +
            getAllRoles().map((r) => `<option value="${r.id}">${r.title}</option>`).join('');
        if (override?.roleId) roleSelect.value = String(override.roleId);

        colRole.append(roleLabel, roleSelect);

        const colReq = document.createElement('div');
        colReq.className = 'col-5 col-lg-2 d-grid gap-1';
        const reqLabel = document.createElement('label');
        reqLabel.className = 'form-label small mb-0';
        reqLabel.textContent = 'Required shifts';
        const reqInput = document.createElement('input');
        reqInput.type = 'number';
        reqInput.min = '0';
        reqInput.step = '1';
        reqInput.className = 'form-control form-control-sm text-bg-dark';
        reqInput.dataset.overrideTarget = 'required';
        reqInput.value = override?.requiredShifts != null ? String(override.requiredShifts) : '0';
        colReq.append(reqLabel, reqInput);

        const colRemove = document.createElement('div');
        colRemove.className = 'col-1 col-lg-1 d-grid';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-danger w-100';
        removeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        removeBtn.addEventListener('click', () => {
            row.remove();
            setRequirementsDirty(true);
            refreshLivePreview();
        });
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
        loadedConfig = config;
        if (assignmentMode) assignmentMode.value = config.plan.assignmentMode || 'FREE';
        if (generalRequired) {
            const value = config.plan.generalRequiredShifts;
            generalRequired.value = value === null || value === undefined ? '' : String(value);
        }
        if (roundingMode) roundingMode.value = config.plan.roundingMode || '';
        if (bindingDeadline) bindingDeadline.value = toDateTimeLocalValue(config.plan.bindingDeadline ?? null);
        if (allowOverfill) allowOverfill.checked = Boolean(config.plan.allowOverfillAfterFull);
        if (allowExternalAssignees) allowExternalAssignees.checked = Boolean(config.plan.allowExternalAssignees);
        if (allowArrivalEvening) allowArrivalEvening.checked = Boolean(config.plan.allowArrivalDayEvening ?? true);
        if (allowDepartureMorning) allowDepartureMorning.checked = Boolean(config.plan.allowDepartureDayMorning ?? true);

        overrideTargets = config.overrideTargets || [];
        setOverrideControlsState();

        buildRoleRequirementInputs(config);
        buildStayRequirementInputs(config.plan, config.stayRequirements || []);
        renderOverrides(config);
        setRequirementsDirty(false);
        refreshLivePreview();
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
            if (!loadedConfig?.calculationContext) throw new Error('Requirement calculation context is unavailable');
            const draft = collectDraft();
            if (!hasValidRequirementValues(draft.roleRequirements, draft.overrides, [])) {
                throw new Error('Correct invalid role or participant override values before calculating the baseline');
            }
            const result = calculateBaselineRequirementForPlan({
                plan: {
                    startDate: loadedConfig.plan.startDate,
                    endDate: loadedConfig.plan.endDate,
                    roundingMode: draft.roundingMode,
                },
                slots: loadedConfig.calculationContext.slots,
                participants: loadedConfig.calculationContext.participants,
                roleRequirements: draft.roleRequirements,
                overrides: draft.overrides,
            });
            const baseline = result.baseline;

            if (generalRequired) generalRequired.value = String(baseline);
            populateStayRequirementValues(result.stayRequirements);
            setRequirementsDirty(true);
            refreshLivePreview();
            const difference = result.projectedDifference;
            const projection = difference === 0
                ? 'The rounded duration table reaches exact capacity.'
                : `The closest integer baseline differs from capacity by ${Math.abs(difference)} shift${Math.abs(difference) === 1 ? '' : 's'}.`;
            const diagnostic = result.diagnostics.reason === 'fixed-requirements-fill-capacity'
                ? ' Fixed role and personal requirements already consume the available capacity.'
                : result.diagnostics.reason === 'no-stay-based-participants'
                    ? ' No participant remains whose requirement can be changed by the stay-duration baseline.'
                    : '';
            setAlert(
                `Baseline requirement set to ${baseline}; stay durations populated. ${projection}${diagnostic}`,
                result.diagnostics.exact && !result.diagnostics.reason ? 'info' : 'warning',
            );
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

    const collectStayRequirements = (): RequirementConfiguration['stayRequirements'] => {
        if (!stayRequirementList) return [];
        return Array.from(stayRequirementList.querySelectorAll<HTMLInputElement>('input[data-stay-days]'))
            .map((input) => {
                if (input.value.trim() === '') return null;
                return {
                    stayDays: Number(input.dataset.stayDays),
                    requiredShifts: Number(input.value),
                };
            })
            .filter((requirement): requirement is RequirementConfiguration['stayRequirements'][number] => requirement != null);
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
            const participantId = rawId;
            if (!targetType || !participantId) return;

            const entry: any = {
                roleId: roleSelect?.value ? Number(roleSelect.value) : null,
                requiredShifts: Number.isNaN(requiredShifts) ? 0 : requiredShifts,
            };

            if (row.dataset.overrideId) entry.id = Number(row.dataset.overrideId);

            if (targetType === 'profile') {
                entry.profileId = participantId;
            }

            entries.push(entry);
        });
        return {overrides: entries, hasInvalid};
    };

    const collectDraft = (): RequirementDraft => ({
        assignmentMode: assignmentMode?.value === 'REQUIRED' ? 'REQUIRED' : 'FREE',
        generalRequiredShifts: generalRequired?.value.trim()
            ? Number(generalRequired.value)
            : null,
        roundingMode: (roundingMode?.value || null) as RequirementDraft['roundingMode'],
        allowOverfillAfterFull: allowOverfill?.checked ?? false,
        roleRequirements: collectRoleRequirements(),
        stayRequirements: collectStayRequirements(),
        overrides: collectOverrides().overrides,
    });

    refreshLivePreview = () => {
        if (!loadedConfig) return;
        const draft = collectDraft();
        document.querySelectorAll<HTMLButtonElement>('[data-recommendations-auto]').forEach((button) => {
            button.disabled = draft.assignmentMode === 'FREE';
            button.title = button.disabled
                ? 'Automatic recommendations are disabled in free assignment mode'
                : '';
        });
        const analysis = calculateLiveRequirementAnalysis(loadedConfig, draft);
        const summary = analysis.participants;
        const capacity = analysis.capacitySummary;

        renderCoverageStatus(capacity, draft);
        if (participantStatus) {
            renderParticipantStatus(participantStatus, summary, draft.assignmentMode);
        }
    };

    const saveRequirements = async () => {
        setAlert('Saving settings…');
        saveButtons.forEach((button) => button.disabled = true);
        try {
            const {overrides, hasInvalid} = collectOverrides();
            if (hasInvalid) {
                setRequirementsDirty(true);
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
                allowExternalAssignees: allowExternalAssignees?.checked ?? false,
                allowArrivalDayEvening: allowArrivalEvening?.checked ?? true,
                allowDepartureDayMorning: allowDepartureMorning?.checked ?? true,
                roleRequirements: collectRoleRequirements(),
                stayRequirements: collectStayRequirements(),
                overrides,
            });

            setRequirementsDirty(false);
            showInlineAlert('success', 'Requirement settings saved');
            await loadRequirements();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save requirements';
            setRequirementsDirty(true);
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
        setRequirementsDirty(true);
        refreshLivePreview();
    });
    const handleRequirementChange = () => {
        setRequirementsDirty(true);
        refreshLivePreview();
    };
    panel.addEventListener('input', handleRequirementChange);
    panel.addEventListener('change', handleRequirementChange);
    reloadBtn?.addEventListener('click', () => {
        if (requirementsDirty && !window.confirm('Discard your unsaved requirement changes?')) return;
        void loadRequirements();
    });
    saveButtons.forEach((button) => button.addEventListener('click', () => void saveRequirements()));
    baselineCalcBtn?.addEventListener('click', () => void calculateBaselineRequirement());

    window.addEventListener('beforeunload', (event) => {
        if (!requirementsDirty) return;
        event.preventDefault();
        event.returnValue = '';
    });

    setRequirementsDirty(false);
    void loadRequirements();
}
