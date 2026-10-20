<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {activityDateLabel, activityParticipantName} from './presentation';
import ActionButton from '../../components/ActionButton.vue';

// Search/filter are local presentation only. The server has already admitted
// every participant field, requirement target, role and attendance window.
const props = withDefaults(defineProps<{participants: components['schemas']['ActivityParticipant'][]; assignmentMode: 'FREE' | 'REQUIRED';
    id?: string; heading?: boolean; localizeAttendance?: boolean}>(),
{id: 'participant-status-overview', heading: true, localizeAttendance: false});
const {messages} = usePilot();
const search = ref('');
const filter = ref('all');
const filters: {value: string; label: PilotPlainMessageKey; color: string}[] = [
    {value: 'all', label: 'common.all', color: 'light'}, {value: 'assigned', label: 'activity.assigned', color: 'light'},
    {value: 'unassigned', label: 'activity.unassigned', color: 'light'}, {value: 'unstarted', label: 'activity.notStarted', color: 'danger'},
    {value: 'needs-more', label: 'activity.needsSlots', color: 'warning'}, {value: 'complete', label: 'activity.complete', color: 'success'},
    {value: 'no-requirement', label: 'activity.noMinimum', color: 'info'},
];
function state(person: components['schemas']['ActivityParticipant']): string {
    return person.requiredShifts <= 0 ? 'no-requirement' : person.remainingShifts <= 0 ? 'complete'
        : person.assignedShifts <= 0 ? 'unstarted' : 'needs-more';
}
/** Summaries use the full admitted collection, independently of local filters. */
function countState(value: string): number {
    return props.participants.filter(person => state(person) === value).length;
}
const assigned = computed(() => props.participants.filter(person => person.assignedShifts > 0).length);
// Requirement provenance is a machine value. Its label belongs to the same
// catalog as the surrounding progress in both saved and unsaved consumers.
const sourceLabels = {
    general: 'activity.requirementSource.general', role: 'activity.requirementSource.role', override: 'activity.requirementSource.override',
    none: 'activity.noMinimum', unconfigured: 'activity.missingDurationRule',
} as const;
/** The older participant DTO admits strings; unknown provenance must not become
 * an untranslated UI label or an object-property lookup outside this map. */
function sourceLabel(source: string): string {
    return messages.value.t(Object.hasOwn(sourceLabels, source) ? sourceLabels[source as keyof typeof sourceLabels] : 'activity.requirement');
}
const visible = computed(() => props.participants.filter(person => {
    // Names remain unmodified data; normalization affects matching only.
    if (!activityParticipantName(person.name, messages.value.t, person.nameIsFallback ?? !person.name).toLowerCase()
        .includes(search.value.trim().toLowerCase())) return false;
    return filter.value === 'all' || filter.value === 'assigned' && person.assignedShifts > 0
        || filter.value === 'unassigned' && person.assignedShifts === 0 || state(person) === filter.value;
}));
/** Saved participant overviews keep their native ISO dates; the live Rules
 * coverage consumer opts into the native browser date-label presentation. */
function attendance(person: components['schemas']['ActivityParticipant']): string {
    if (!person.attendance?.arrivalDate && !person.attendance?.departureDate) return messages.value.t('activity.fullPlan');
    // Presentation never changes the admitted civil dates or attendance count.
    // Both native paths retain the same missing-boundary wording.
    const arrival = person.attendance?.arrivalDate;
    const departure = person.attendance?.departureDate;
    return (arrival ? props.localizeAttendance ? activityDateLabel(arrival, messages.value.locale) : arrival
        : messages.value.t('activity.attendanceStart')) + ' – '
        + (departure ? props.localizeAttendance ? activityDateLabel(departure, messages.value.locale) : departure
            : messages.value.t('activity.attendanceEnd'));
}
</script>

<template>
    <section
        :id="id"
        class="participant-status-component"
        data-participant-status
        :data-assignment-mode="assignmentMode">
        <!-- The Rules coverage step supplies its own native heading. Both views
        retain one participant/filter presentation and their independent search. -->
        <h4 v-if="heading" class="mb-2">{{ messages.t('activity.participants') }}</h4>
        <p v-if="heading" class="small text-secondary mb-3">{{ messages.t('activity.participantDescription') }}</p>
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2 participant-status-toolbar">
            <div class="d-flex flex-wrap gap-2 align-items-center participant-status-controls">
                <div class="input-group input-group-sm participant-status-search">
                    <span class="input-group-text">
                        <i class="bi bi-search" aria-hidden="true"></i>
                    </span>
                    <input
                        v-model="search"
                        type="search"
                        class="form-control form-control-sm text-bg-dark"
                        :aria-label="messages.t('activity.participantSearch')"
                        :placeholder="messages.t('activity.participantSearch')"
                        autocomplete="off"
                        data-participant-search
                    />
                </div>
                <div
                    class="d-flex flex-wrap gap-1 participant-status-filters"
                    role="group"
                    :aria-label="messages.t('activity.participantFilters')">
                    <ActionButton
                        v-for="option in filters"
                        :key="option.value"
                        type="button"
                        :variant="'outline-' + option.color"
                        :class="{active: filter === option.value}"
                        :data-participant-filter="option.value"
                        @click="filter = option.value">{{ messages.t(option.label) }}</ActionButton>
                </div>
            </div>
            <div class="d-flex flex-wrap gap-1 participant-status-stats" data-participant-summary-stats>
                <span class="badge bg-light text-dark">{{ messages.t('activity.countTotal', {count: participants.length}) }}</span>
                <template v-if="assignmentMode === 'REQUIRED'">
                    <span class="badge bg-danger text-white">{{ messages.t('activity.countNotStarted', {count: countState('unstarted')}) }}</span>
                    <span class="badge bg-warning text-dark">{{ messages.t('activity.countNeedsSlots', {count: countState('needs-more')}) }}</span>
                    <span class="badge bg-success text-white">{{ messages.t('activity.countComplete', {count: countState('complete')}) }}</span>
                    <span v-if="countState('no-requirement')" class="badge bg-secondary text-white border border-light-subtle">{{ messages.t('activity.countNoMinimum', {count: countState('no-requirement')}) }}</span>
                </template>
                <template v-else>
                    <span class="badge bg-success text-white">{{ messages.t('activity.countAssigned', {count: assigned}) }}</span>
                    <span class="badge bg-secondary text-white border border-light-subtle">{{ messages.t('activity.countUnassigned', {count: participants.length - assigned}) }}</span>
                    <span class="badge bg-info text-white">{{ messages.t('activity.freeModeHint') }}</span>
                </template>
            </div>
        </div>
        <div class="participant-status-list border border-secondary-subtle rounded">
            <div class="participant-status-header">
                <span>{{ messages.t('activity.participant') }}</span>
                <span>{{ messages.t('activity.assignments') }}</span>
                <span>{{ messages.t('activity.requirement') }}</span>
                <span>{{ messages.t('activity.attendance') }}</span>
                <span>{{ messages.t('activity.roles') }}</span>
            </div>
            <div class="participant-status-body" data-participant-status-body>
                <div
                    v-for="person in visible"
                    :key="person.participantKey"
                    class="participant-status-row"
                    data-participant-row
                    :data-participant-name="person.name"
                    :data-participant-key="person.participantKey"
                    :data-participant-state="state(person)">
                    <div class="participant-status-cell participant-status-person">
                        <span class="participant-status-label">{{ messages.t('activity.participant') }}</span>
                        <strong>{{ activityParticipantName(person.name, messages.t, person.nameIsFallback ?? !person.name) }}</strong>
                    </div>
                    <div class="participant-status-cell">
                        <span class="participant-status-label">{{ messages.t('activity.assignments') }}</span>
                        <div class="d-flex flex-wrap align-items-center gap-1">
                            <span
                                class="badge"
                                :class="person.assignedShifts > 0 ? 'bg-success text-white' : state(person) === 'unstarted' ? 'bg-danger text-white' : 'bg-secondary text-white border border-light-subtle'">{{ messages.t('activity.slotCount', {count: person.assignedShifts}) }}</span>
                            <small :class="state(person) === 'unstarted' ? 'text-danger' : 'text-secondary'">{{ messages.t(person.assignedShifts > 0 ? 'activity.assigned' : state(person) === 'unstarted' ? 'activity.notStarted' : 'activity.notAssigned') }}</small>
                        </div>
                    </div>
                    <div class="participant-status-cell">
                        <span class="participant-status-label">{{ messages.t('activity.requirement') }}</span>
                        <div
                            v-if="person.assignmentMode === 'REQUIRED' || person.requiredShifts > 0"
                            class="d-flex flex-wrap align-items-center gap-1">
                            <span v-if="person.source === 'unconfigured'" class="badge bg-danger text-white">{{ messages.t('activity.missingDurationRule') }}</span>
                            <template v-else>
                                <span class="badge bg-light text-dark">{{ messages.t('activity.countRequired', {count: person.requiredShifts}) }}</span>
                                <span
                                    class="badge"
                                    :class="person.remainingShifts > 0 ? state(person) === 'unstarted' ? 'bg-danger text-white' : 'bg-warning text-dark' : 'bg-success text-white'">{{ person.remainingShifts > 0 ? messages.t('activity.countRemaining', {count: person.remainingShifts}) : messages.t('activity.complete') }}</span>
                                <span v-if="person.source !== 'none'" class="badge bg-info text-white text-uppercase">{{ sourceLabel(person.source) }}</span>
                            </template>
                        </div>
                        <div v-else class="d-flex flex-wrap align-items-center gap-1">
                            <span class="badge bg-secondary text-white">{{ messages.t('activity.noMinimum') }}</span>
                            <small class="text-secondary">{{ messages.t('activity.freeMode') }}</small>
                        </div>
                    </div>
                    <div class="participant-status-cell">
                        <span class="participant-status-label">{{ messages.t('activity.attendance') }}</span>
                        <span class="small d-block">{{ attendance(person) }}</span>
                        <small class="text-secondary">{{ messages.t('activity.dayCount', {count: person.attendanceDays}) }}</small>
                    </div>
                    <div class="participant-status-cell">
                        <span class="participant-status-label">{{ messages.t('activity.roles') }}</span>
                        <span
                            v-for="role in person.roles.filter(role => role !== 'default')"
                            :key="role"
                            class="badge bg-info text-white me-1 mb-1">{{ role }}</span>
                        <span v-if="!person.roles.some(role => role !== 'default')" class="text-secondary small">{{ messages.t('activity.noRoles') }}</span>
                    </div>
                </div>
                <div v-if="!visible.length" class="participant-status-empty text-center text-secondary p-3">{{ messages.t(participants.length ? 'activity.noParticipantMatches' : 'activity.noParticipants') }}</div>
            </div>
        </div>
    </section>
</template>
