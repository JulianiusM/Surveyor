<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {ActivitySlotDraft} from '../../../types/FrontendActivityTypes';
import type {FrontendListCreationSource} from '../../../types/FrontendListTypes';
import {usePilot} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {useActivityApi} from './api';
import {activityDateLabel, activityDayLabel, activityCreationWeeks} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import EntityListCreation from '../../components/EntityListCreation.vue';
import FormField from '../../components/FormField.vue';

// Root admission, file, event, access and confirmed navigation are shared. This
// feature owns only the dated slot draft, including hidden out-of-range days.
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const startDate = ref('');
const endDate = ref('');
const slots = ref<ActivitySlotDraft[]>([]);
const calendarStart = ref('');
const calendarEnd = ref('');
const weeks = computed(() => activityCreationWeeks(calendarStart.value, calendarEnd.value));
watch([startDate, endDate, context.locale], synchronizeDates, {flush: 'post'});

/** Preserve native one-day defaulting and invalid-range recovery. Date controls
 * own the submitted values; the last valid calendar keeps its mounted slot drafts. */
function synchronizeDates(): void {
    if (!startDate.value) return;
    if (!endDate.value) endDate.value = startDate.value;
    const invalid = endDate.value < startDate.value;
    if (typeof document !== 'undefined') {
        // The field keeps its native HTML validity hook without another value
        // mirror. This message is cleared as soon as the range becomes valid.
        const input = document.getElementById('endDate') as HTMLInputElement | null;
        input?.setCustomValidity(invalid ? messages.value.t('activity.endBeforeStart') : '');
    }
    if (invalid) return;
    calendarStart.value = startDate.value;
    calendarEnd.value = endDate.value;
}

/** Copy only creation values, never assignments, administrator grants or history. */
function initialize(copy?: components['schemas']['ActivityDuplicate']): void {
    startDate.value = copy?.startDate ?? '';
    endDate.value = copy?.endDate ?? '';
    slots.value = (copy?.slots ?? []).map(slot => ({...slot, description: slot.description ?? '',
        startTime: slot.startTime?.slice(0, 5) ?? '', endTime: slot.endTime?.slice(0, 5) ?? '', maxAssignees: String(slot.maxAssignees), roles: []}));
}
function reset(): void {
    startDate.value = '';
    endDate.value = '';
    calendarStart.value = '';
    calendarEnd.value = '';
    slots.value = [];
}
/** Select a day's existing draft objects without cloning their input models. */
function daySlots(day: string): ActivitySlotDraft[] {
    return slots.value.filter(slot => slot.day === day);
}
function addSlot(day: string): void {
    slots.value.push({id: crypto.randomUUID(), day, title: '', description: '', startTime: '', endTime: '', maxAssignees: '1', roles: []});
}
/** Removing one local creation row releases that row's unsaved input only. */
function removeSlot(id: string): void {
    slots.value = slots.value.filter(slot => slot.id !== id);
}

const source: FrontendListCreationSource<components['schemas']['ActivityDuplicate']> = {
    creationKey: activityKeys.creation, duplicateKey: activityKeys.duplicate, eventPicker: api.eventPicker,
    initialContext: context.bootstrap.activityCreateContext, initialSelectedEvent: context.bootstrap.activitySelectedEvent,
    initialDuplicate: context.bootstrap.activityDuplicate,
    createEntry: api.createEntry.bind(api), duplicate: api.duplicate.bind(api), initialize, reset,
    draft: () => ({startDate: startDate.value, endDate: endDate.value, slots: slots.value}),
    destination: result => '/frontend-pilot/activity/' + result.id,
    prepare(values, image) {
        // Native creation keeps removed-range inputs in memory, submitting only
        // the current date interval. Normalization happens at this one boundary.
        const positions = new Map<string, number>();
        const admittedSlots = slots.value.filter(slot => slot.day >= startDate.value && slot.day <= endDate.value);
        const input: components['schemas']['ActivityCreateInput'] = {...values, description: values.description ?? '',
            startDate: startDate.value, endDate: endDate.value, slots: admittedSlots.map(slot => {
                const position = positions.get(slot.day) ?? 0;
                positions.set(slot.day, position + 1);
                return {id: slot.id, day: slot.day, position, title: slot.title.trim(), description: slot.description.trim(),
                    startTime: slot.startTime ? slot.startTime + ':00' : null, endTime: slot.endTime ? slot.endTime + ':00' : null,
                    maxAssignees: Number.parseInt(slot.maxAssignees, 10)};
            })};
        return {operation: scope => api.createActivity(input, image, scope)};
    },
};
</script>

<template>
    <EntityListCreation
        icon="bi-calendar-plus"
        heading="activity.create"
        document-title="activity.createDocumentTitle"
        header-label="activity.headerOptional"
        not-found="activity.notFound"
        created="activity.created"
        leave-unknown="activity.leaveUnknown"
        creation-unknown="activity.creationUnknown"
        :source="source"
        submit-label="activity.createPlan"
        full-width-submit
        resource-param="planId"
        description-name="description"
        header-name="headerImg">
        <template #root-fields="{title, updateTitle, disabled}">
            <!-- The shared fieldset contains the row's negative gutter margin.
            Keep native form-relative top spacing without moving other consumers. -->
            <div class="row g-3 mb-3 mt-0">
                <FormField
                    id="title"
                    class="col-md-6"
                    :model-value="title"
                    :label="messages.t('packing.title')"
                    label-icon="bi-tag"
                    label-class=""
                    required
                    :disabled="disabled"
                    @update:model-value="updateTitle"
                />
                <FormField
                    id="startDate"
                    label-for="start"
                    v-model="startDate"
                    class="col-md-3"
                    type="date"
                    :label="messages.t('event.startDateLabel')"
                    label-icon="bi-calendar-event"
                    label-class=""
                    required
                    :disabled="disabled"
                />
                <FormField
                    id="endDate"
                    label-for="end"
                    v-model="endDate"
                    class="col-md-3"
                    type="date"
                    :label="messages.t('event.endDateLabel')"
                    label-icon="bi-calendar-range"
                    label-class=""
                    required
                    :disabled="disabled"
                />
            </div>
        </template>
        <template #default="{disabled}">
            <hr />
            <div id="slotArea">
                <div v-for="week in weeks" :key="week[0]" class="table-responsive mb-4">
                    <table class="table table-dark table-bordered align-middle activity-table">
                        <thead>
                            <tr>
                                <th v-for="day in week" :key="day" class="text-center small">{{ activityDayLabel(day, context.locale.value) }}<br />{{ activityDateLabel(day, context.locale.value) }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td v-for="day in week" :key="day">
                                    <div class="slot-container">
                                        <span v-if="!daySlots(day).length" class="badge d-block w-100 text-center mb-2">
                                            <i class="bi bi-info-circle me-2" aria-hidden="true"></i> {{ messages.t('activity.noSlots') }}</span>
                                        <!-- Initial native slot controls intentionally have placeholders
                                        and no added labels (IMP-017); model and DOM stay one draft. -->
                                        <div
                                            v-for="slot in daySlots(day)"
                                            :key="slot.id"
                                            class="d-grid gap-1 mb-2 slot border border-secondary-subtle rounded p-2"
                                            :data-slot-date="day"
                                            :data-slot-id="slot.id">
                                            <input
                                                v-model="slot.title"
                                                class="form-control form-control-sm text-bg-dark"
                                                :placeholder="messages.t('packing.title')"
                                                required
                                                :disabled="disabled"
                                            />
                                            <input
                                                v-model="slot.description"
                                                class="form-control form-control-sm text-bg-dark"
                                                :placeholder="messages.t('packing.description')"
                                                :disabled="disabled"
                                            />
                                            <input
                                                v-model="slot.startTime"
                                                type="time"
                                                class="form-control form-control-sm text-bg-dark"
                                                :placeholder="messages.t('activity.startTime')"
                                                :disabled="disabled"
                                            />
                                            <input
                                                v-model="slot.endTime"
                                                type="time"
                                                class="form-control form-control-sm text-bg-dark"
                                                :placeholder="messages.t('activity.endTime')"
                                                :disabled="disabled"
                                            />
                                            <input
                                                :value="slot.maxAssignees"
                                                type="number"
                                                min="1"
                                                class="form-control form-control-sm text-bg-dark"
                                                :disabled="disabled"
                                                @input="slot.maxAssignees = ($event.target as HTMLInputElement).value"
                                            />
                                            <ActionButton
                                                type="button"
                                                class="btn-sm align-self-end" variant="outline-danger"
                                                :disabled="disabled"
                                                @click="removeSlot(slot.id)">
                                                <i class="bi bi-x-lg" aria-hidden="true"></i>
                                            </ActionButton>
                                        </div>
                                    </div>
                                    <ActionButton
                                        type="button"
                                        class="btn-sm w-100 add-slot" variant="outline-info"
                                        :disabled="disabled"
                                        @click="addSlot(day)">{{ messages.t('activity.addSlot') }}</ActionButton>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
    </EntityListCreation>
</template>
