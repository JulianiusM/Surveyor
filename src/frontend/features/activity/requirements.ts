import type {components} from '../../../types/api/v1';
import type {ActivityRequirementConfiguration, ActivityRequirementCoverage, ActivityRequirementDraft} from '../../../types/FrontendActivityRequirementTypes';
import type {Translator} from '../../../types/LocalizationTypes';
import {applyRounding, calculateRequirementAnalysis, countInclusiveDays} from '../../../common/activity/requirements';
import type {RequirementAnalysisInput} from '../../../types/ActivityRequirementTypes';

/** Copy the local-minute editor projection; timestamps remain ISO on the wire. */
function localDeadline(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Initialize editable rows once from admitted settings. Explicit zero values
 * outrank proportional defaults, and absent participant targets retain their IDs. */
export function createRequirementDraft(config: ActivityRequirementConfiguration): ActivityRequirementDraft {
    const days = countInclusiveDays(config.plan.startDate, config.plan.endDate);
    const stays = new Map(config.stayRequirements.map(row => [row.stayDays, row.requiredShifts]));
    const roles = new Map(config.roleRequirements.map(row => [row.roleId, row.requiredShifts]));
    // Saved duration rows take precedence. Only absent rows inherit the configured
    // rounded proportional suggestion; this does not persist a calculation.
    return {
        assignmentMode: config.plan.assignmentMode,
        generalRequiredShifts: config.plan.generalRequiredShifts == null ? '' : String(config.plan.generalRequiredShifts),
        roundingMode: config.plan.roundingMode ?? '', bindingDeadline: localDeadline(config.plan.bindingDeadline),
        allowOverfillAfterFull: config.plan.allowOverfillAfterFull, allowExternalAssignees: config.plan.allowExternalAssignees,
        allowArrivalDayEvening: config.plan.allowArrivalDayEvening, allowDepartureDayMorning: config.plan.allowDepartureDayMorning,
        roles: config.allRoles.map(role => ({roleId: role.id, value: roles.has(role.id) ? String(roles.get(role.id)) : ''})),
        stays: Array.from({length: days}, (_, offset) => {
            const stayDays = offset + 1;
            const saved = stays.get(stayDays);
            const value = saved ?? (config.plan.generalRequiredShifts == null ? null
                : applyRounding(config.plan.generalRequiredShifts * stayDays / days, config.plan.roundingMode ?? 'CEIL'));
            return {stayDays, value: value == null ? '' : String(value)};
        }),
        overrides: config.overrides.map((row, key) => ({key, id: row.id, profileId: row.profileId ?? '', profileName: row.profileName,
            roleId: row.roleId == null ? '' : String(row.roleId), value: String(row.requiredShifts)})),
        removedOverrideIds: [],
    };
}

/** Submit the omission/null/zero meanings from lexical controls. Invalid
 * values remain subject to generated validation and the existing controller. */
export function requirementInput(draft: ActivityRequirementDraft): components['schemas']['ActivityRequirementsInput'] {
    const deadline = draft.bindingDeadline ? new Date(draft.bindingDeadline) : null;
    // Empty role rows are absent, while empty override counts retain zero.
    // Negative/NaN role rows are omitted exactly as in the collector.
    return {
        assignmentMode: draft.assignmentMode, generalRequiredShifts: draft.generalRequiredShifts.trim() ? Number(draft.generalRequiredShifts) : null,
        roundingMode: draft.roundingMode || null, bindingDeadline: deadline && Number.isFinite(deadline.getTime()) ? deadline.toISOString() : null,
        allowOverfillAfterFull: draft.allowOverfillAfterFull, allowExternalAssignees: draft.allowExternalAssignees,
        allowArrivalDayEvening: draft.allowArrivalDayEvening, allowDepartureDayMorning: draft.allowDepartureDayMorning,
        roleRequirements: draft.roles.filter(row => row.value.trim() !== '' && Number(row.value) >= 0)
            .map(row => ({roleId: row.roleId, requiredShifts: Number(row.value)})),
        stayRequirements: draft.stays.filter(row => row.value.trim() !== '')
            .map(row => ({stayDays: row.stayDays, requiredShifts: Number(row.value)})),
        overrides: draft.overrides.filter(row => !!row.profileId).map(row => ({...(row.id == null ? {} : {id: row.id}),
            profileId: row.profileId, roleId: row.roleId || null, requiredShifts: Number(row.value) || 0})),
        ...(draft.removedOverrideIds.length ? {removedOverrideIds: [...draft.removedOverrideIds]} : {}),
    };
}

/** Adapt one admitted wire projection and lexical draft to the existing numeric
 * domain contract, shared by ordinary coverage and the explicit Calculate action. */
export function requirementAnalysisInput(config: ActivityRequirementConfiguration, draft: ActivityRequirementDraft) {
    const input = requirementInput(draft);
    // Wire data and drafts keep canonical string identities. Convert only at
    // this shared domain-engine boundary: Analyze and Calculate must see the
    // same numeric role membership and override ordering as the engine.
    return {plan: {...config.plan, ...input},
        participants: config.calculationContext.participants.map(person => ({...person, roleIds: person.roleIds.map(Number)})),
        roleRequirements: input.roleRequirements.map(row => ({...row, roleId: Number(row.roleId)})),
        overrides: input.overrides.map(row => ({...row, id: row.id == null ? undefined : Number(row.id),
            roleId: row.roleId == null ? null : Number(row.roleId)})),
        stayRequirements: input.stayRequirements,
        slots: config.calculationContext.slots.map(slot => ({...slot,
            roles: slot.roles.map(role => ({...role, roleId: Number(role.roleId)}))})),
        assignedShiftCounts: config.calculationContext.assignedShiftCounts} satisfies RequirementAnalysisInput;
}

/** Recompute unsaved targets with the existing engine and its one explicit
 * argument adapter. Cached wire identities never become another domain model. */
export function analyzeRequirementDraft(config: ActivityRequirementConfiguration, draft: ActivityRequirementDraft) {
    const analysis = calculateRequirementAnalysis(requirementAnalysisInput(config, draft));
    const saved = new Map(config.participants.map(person => [person.participantKey, person]));
    // Keep absent raw names distinguishable from user text. The shared participant
    // renderer localizes its generic fallback without deriving a name from an ID.
    return {...analysis, participants: analysis.participants.map(person => ({...person, name: person.name ?? '', nameIsFallback: !person.name,
        count: person.assignedShifts, roleIds: (person.roleIds ?? []).map(String), roles: saved.get(person.participantKey)?.roles ?? [],
        attendance: person.attendance ? {arrivalDate: person.attendance.arrivalDate ?? null, departureDate: person.attendance.departureDate ?? null} : null,
        assignmentMode: draft.assignmentMode}))};
}

/** Preserve the distinction between a hard cap and permitted overfill.
 * Coverage models demand only; it neither assigns roles nor proves feasibility. */
export function requirementCoverage(config: ReturnType<typeof analyzeRequirementDraft>['capacitySummary'], draft: ActivityRequirementDraft,
    t: Translator): ActivityRequirementCoverage {
    let status: ActivityRequirementCoverage;
    const difference = config.requiredSlots - config.availableSlots;
    const amount = Math.abs(difference);
    // Incomplete duration configuration and role quota conflicts override totals,
    // because an apparently exact count cannot make either configuration valid.
    if (draft.assignmentMode !== 'REQUIRED') status = {state: 'inactive', variant: 'secondary', icon: 'bi-sliders',
        title: t('activity.requirements.freeCoverage'), detail: t('activity.requirements.freeCoverageDetail')};
    else if (!config.configurationComplete) status = {state: 'conflict', variant: 'danger', icon: 'bi-exclamation-octagon-fill',
        title: t('activity.requirements.invalidCoverage'), detail: t('activity.requirements.invalidCoverageDetail')};
    else if (difference === 0) status = {state: 'exact', variant: 'success', icon: 'bi-check-circle-fill',
        title: t('activity.requirements.exactCoverage'), detail: t('activity.requirements.exactCoverageDetail')};
    else if (draft.allowOverfillAfterFull && difference > 0) status = {state: 'acceptable', variant: 'warning', icon: 'bi-arrow-up-circle-fill',
        title: t('activity.requirements.aboveCapacity', {amount}), detail: t(amount === 1 ? 'activity.requirements.overfillDetailOne' : 'activity.requirements.overfillDetailMany')};
    else if (draft.allowOverfillAfterFull) status = {state: 'conflict', variant: 'danger', icon: 'bi-exclamation-octagon-fill',
        title: t('activity.requirements.shortCapacity', {amount}), detail: t('activity.requirements.shortCapacityDetail', {count: amount})};
    else if (difference > 0) status = {state: 'conflict', variant: 'danger', icon: 'bi-exclamation-octagon-fill',
        title: t('activity.requirements.exceededCapacity', {amount}), detail: t('activity.requirements.exceededCapacityDetail', {count: amount})};
    else status = {state: 'acceptable', variant: 'warning', icon: 'bi-arrow-down-circle-fill',
        title: t('activity.requirements.belowCapacity', {amount}), detail: t('activity.requirements.belowCapacityDetail', {count: amount})};
    if (config.hypotheticalRoleCoverage?.roleCapacityConflicts.length) return {state: 'conflict', variant: 'danger', icon: 'bi-exclamation-octagon-fill',
        title: t('activity.requirements.roleCapacity'), detail: t('activity.requirements.roleCapacityDetail')};
    return status;
}
