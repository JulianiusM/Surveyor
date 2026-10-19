<script setup lang="ts">
import {TranslationComponent as I18next} from 'i18next-vue';
import type {components} from '../../../types/api/v1';
import type {ActivityRecommendationDraftRow} from '../../../types/FrontendActivityRecommendationTypes';
import {usePilot} from '../../app/context';
import {activityDateLabel, activityDayLabel, activityWarningLabel} from './presentation';
import {recommendationPartners, recommendationWarnings} from './recommendationDraft';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// The schedule is presentation over an admitted server snapshot and local review.
// It owns neither commands nor authority; the containing workspace freezes editing.
const props = defineProps<{view: components['schemas']['ActivityView']; workspace: components['schemas']['ActivityRecommendations'];
    rows: ActivityRecommendationDraftRow[]; warnings: components['schemas']['ActivityRecommendationPreview']['warnings']; disabled: boolean}>();
const emit = defineEmits<{status: [row: ActivityRecommendationDraftRow, status: 'PENDING' | 'APPROVED' | 'REJECTED'];
    remove: [row: ActivityRecommendationDraftRow]; add: [slotId: string]; unassign: [slotId: string, profileId: string]}>();
const {messages} = usePilot();
const legend = [
    {label: 'confirmed', detail: 'existing', color: 'bg-success'}, {label: 'pending', detail: 'new', color: 'bg-warning'},
    {label: 'rejected', detail: 'declined', color: 'bg-danger'}, {label: 'reassignment', detail: 'moves', color: 'bg-info text-dark'},
] as const;
function isSwap(row: ActivityRecommendationDraftRow): boolean { return recommendationPartners(props.rows, row).length > 1; }
function rowClass(row: ActivityRecommendationDraftRow): string {
    return row.value.status === 'APPROVED' ? 'border-success' : row.value.status === 'REJECTED' ? 'border-danger' : 'border-warning';
}
/** Preserve native status priority while distinguishing moves and unassignments. */
function rowIcon(row: ActivityRecommendationDraftRow): string {
    // Rejection overrides the operation icon; other states retain its meaning.
    if (row.value.status === 'REJECTED') return 'bi-x-circle-fill text-danger';
    if (row.value.operation === 'REASSIGN') return 'bi-arrow-left-right text-info';
    if (row.value.operation === 'UNASSIGN') return 'bi-person-dash-fill text-danger';
    return row.value.status === 'APPROVED' ? 'bi-check-circle-fill text-success' : 'bi-clock-fill text-warning';
}
/** Describe the admitted operation without reconstructing private source information. */
function rowName(row: ActivityRecommendationDraftRow): string {
    // User names/source titles remain data inside catalog-owned complete labels.
    const name = row.value.profile?.name || messages.value.t('activity.recommendations.unknown');
    if (row.value.operation === 'ASSIGN') return name;
    if (row.value.operation === 'UNASSIGN') return messages.value.t('activity.recommendations.unassignName', {name});
    return messages.value.t(isSwap(row) ? 'activity.recommendations.swapName' : 'activity.recommendations.moveName',
        {name, source: row.value.sourceItem?.title || messages.value.t('activity.recommendations.anotherSlot')});
}
function statusLabel(status: string): string {
    return messages.value.t(status === 'APPROVED' ? 'activity.recommendations.approved'
        : status === 'REJECTED' ? 'activity.recommendations.rejected' : 'activity.recommendations.pending');
}
</script>

<template>
    <div id="recommendationScheduleView">
        <h5 class="mb-3"><i class="bi bi-calendar-plus me-2" aria-hidden="true"></i>{{ messages.t('activity.recommendations.scheduleTitle') }}</h5>
        <p class="small text-secondary mb-3">
            <I18next :translation="messages.t('activity.recommendations.scheduleHint')">
                <template #add><span class="badge bg-info">{{ messages.t('activity.recommendations.addShort') }}</span></template>
            </I18next>
        </p>
        <div class="d-flex gap-3 mb-3 flex-wrap">
            <div v-for="item in legend" :key="item.label" class="d-flex align-items-center gap-2">
                <span class="badge" :class="item.color">{{ messages.t(`activity.recommendations.${item.label}`) }}</span>
                <span class="small text-secondary">{{ messages.t(`activity.recommendations.${item.detail}`) }}</span>
            </div>
        </div>
        <!-- Reuse the server's native calendar grouping. Slots and commitments
        are safe projections; no sibling discovery is performed in the browser. -->
        <template v-for="week in view.weeks" :key="week.start">
            <h5 class="mt-4 mb-2">{{ messages.t('activity.weekOf', {date: week.start}) }}</h5>
            <div class="table-responsive">
                <table class="table table-dark table-bordered activity-table" data-recommendations-schedule>
                    <thead>
                        <tr>
                            <th v-for="day in week.days" :key="day" class="text-center small" :data-date="day">
                            <span class="day">{{ activityDayLabel(day, messages.locale) }}</span><br /><span class="date">{{ activityDateLabel(day, messages.locale) }}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td v-for="day in week.days" :key="day">
                                <div class="slot-container" :data-date="day">
                                    <div
                                        v-for="slot in view.slots.filter(slot => slot.day === day)"
                                        :key="slot.id"
                                        class="slot border rounded p-2 mb-2 d-grid gap-1"
                                        :data-slot-id="slot.id"
                                        :data-day="slot.day">
                                        <div class="d-flex justify-content-between align-items-start mb-1">
                                            <div class="d-flex flex-column flex-grow-1">
                                                <span class="fw-bold">{{ slot.title }}</span>
                                                <small v-if="slot.startTime || slot.endTime" class="text-info d-flex align-items-center gap-1">
                                                    <i class="bi bi-clock-history" aria-hidden="true"></i><span>{{ slot.startTime?.slice(0, 5) || '??' }} – {{ slot.endTime?.slice(0, 5) || '??' }}</span>
                                                </small>
                                            </div>
                                            <div class="d-flex align-items-center gap-2">
                                                <small class="text-secondary"><span class="badge bg-secondary" :data-slot-capacity="slot.id">{{ slot.maxAssignees }}</span> {{ messages.t('activity.recommendations.max') }}</small>
                                            </div>
                                        </div>
                                        <hr class="m-0" />
                                        <div :data-slot-existing="slot.id">
                                            <div
                                                v-for="assignment in workspace.existingAssignments.filter(item => item.item.id === slot.id)"
                                                :key="assignment.profile.id"
                                                class="d-flex align-items-center gap-2 mb-1 p-1 border border-success rounded">
                                                <i class="bi bi-person-check-fill text-success" aria-hidden="true"></i>
                                                <span class="flex-grow-1 small">{{ assignment.profile.name }}</span>
                                                <span class="badge bg-success text-white small">{{ messages.t('activity.recommendations.confirmed') }}</span>
                                                <ActionButton
                                                    type="button"
                                                    class="btn-xs" variant="outline-danger"
                                                    data-unassign-recommendation
                                                    :data-slot-id="slot.id"
                                                    :data-profile-id="assignment.profile.id"
                                                    :disabled="disabled"
                                                    :title="messages.t('activity.recommendations.stageUnassign')"
                                                    :aria-label="messages.t('activity.recommendations.unassignFor', {name: assignment.profile.name})"
                                                    @click="emit('unassign', slot.id, assignment.profile.id)"><i class="bi bi-person-dash" aria-hidden="true"></i></ActionButton>
                                            </div>
                                        </div>
                                        <div :data-slot-recommendations="slot.id">
                                            <div
                                                v-for="row in rows.filter(row => row.value.item.id === slot.id)"
                                                :key="row.key"
                                                class="d-flex flex-wrap align-items-center gap-2 mb-1 p-1 border rounded"
                                                :class="rowClass(row)"
                                                :data-rec-id="row.value.id ?? ''"
                                                :data-slot-id="slot.id"
                                                :data-profile-id="row.value.profile?.id">
                                                <i class="bi" :class="rowIcon(row)" aria-hidden="true"></i><span class="flex-grow-1 small">{{ rowName(row) }}</span>
                                                <span
                                                    v-if="row.value.operation !== 'ASSIGN'"
                                                    class="badge small"
                                                    :class="row.value.operation === 'REASSIGN' ? 'bg-info text-dark' : 'bg-danger text-white'">{{ messages.t(row.value.operation === 'UNASSIGN' ? 'activity.recommendations.unassignBadge' : isSwap(row) ? 'activity.recommendations.swapBadge' : 'activity.recommendations.moveBadge') }}</span>
                                                <span
                                                    class="badge small"
                                                    :class="row.value.status === 'APPROVED' ? 'bg-success text-white' : row.value.status === 'REJECTED' ? 'bg-danger text-white' : 'bg-warning text-dark'">{{ statusLabel(row.value.status) }}</span>
                                                <ActionButton
                                                    v-if="row.value.status !== 'APPROVED'"
                                                    type="button"
                                                    class="btn-xs"
                                                    :variant="row.value.status === 'PENDING' ? 'success' : 'outline-success'"
                                                    :disabled="disabled"
                                                    :title="messages.t('activity.recommendations.approve')"
                                                    :aria-label="messages.t('activity.recommendations.approve')"
                                                    @click="emit('status', row, 'APPROVED')"><i class="bi bi-check" aria-hidden="true"></i></ActionButton>
                                                <ActionButton
                                                    v-if="row.value.status === 'PENDING'"
                                                    type="button"
                                                    class="btn-xs" variant="danger"
                                                    :disabled="disabled"
                                                    :title="messages.t('activity.recommendations.reject')"
                                                    :aria-label="messages.t('activity.recommendations.reject')"
                                                    @click="emit('status', row, 'REJECTED')"><i class="bi bi-x" aria-hidden="true"></i></ActionButton>
                                                <ActionButton
                                                    v-else
                                                    type="button"
                                                    class="btn-xs" variant="outline-secondary"
                                                    :disabled="disabled"
                                                    :title="messages.t('activity.recommendations.revert')"
                                                    :aria-label="messages.t('activity.recommendations.revert')"
                                                    @click="emit('status', row, 'PENDING')"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></ActionButton>
                                                <ActionButton
                                                    v-if="row.value.manual"
                                                    type="button"
                                                    class="btn-xs" variant="outline-danger"
                                                    :disabled="disabled"
                                                    :title="messages.t(row.value.operation === 'UNASSIGN' ? 'activity.recommendations.cancelUnassign' : 'activity.recommendations.remove')"
                                                    :aria-label="messages.t(row.value.operation === 'UNASSIGN' ? 'activity.recommendations.cancelUnassignFor' : 'activity.recommendations.removeFor', {name: row.value.profile.name})"
                                                    @click="emit('remove', row)"><i class="bi bi-trash" aria-hidden="true"></i></ActionButton>
                                                <StatusNotice
                                                    v-if="recommendationWarnings(row.value, warnings).length"
                                                    kind="warning"
                                                    class="small w-100"
                                                    no-margin
                                                    data-recommendation-warnings>
                                                    <div
                                                        v-for="(warning, index) in recommendationWarnings(row.value, warnings)"
                                                        :key="index">{{ activityWarningLabel(warning, view.slots, messages.t) }}</div>
                                                </StatusNotice>
                                            </div>
                                        </div>
                                        <ActionButton
                                            type="button"
                                            class="btn-sm w-100 mt-2" variant="outline-info"
                                            data-add-recommendation
                                            :data-slot-id="slot.id"
                                            :disabled="disabled"
                                            @click="emit('add', slot.id)"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.add') }}</ActionButton>
                                    </div>
                                    <span
                                        v-if="!view.slots.some(slot => slot.day === day)"
                                        class="badge w-100 text-center"><i class="bi bi-info-circle me-2" aria-hidden="true"></i>{{ messages.t('activity.noSlots') }}</span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>
