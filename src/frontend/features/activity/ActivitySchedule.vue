<script setup lang="ts">
import {computed, ref} from 'vue';
import {TranslationComponent as I18next} from 'i18next-vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {useListReorder} from '../../composables/listReorder';
import {activityDateLabel, activityDayLabel} from './presentation';
import InlineCell from '../../components/InlineCell.vue';

// The schedule owns only its All/My/Open view and a captured drag gesture.
// Commands, current authority and feature drafts remain with the containing page.
const props = defineProps<{view: components['schemas']['ActivityView']; disabled?: boolean;
    patch(slot: components['schemas']['ActivitySlotView'], field: 'title' | 'description' | 'maxAssignees', value: string, token: string): Promise<boolean>;
    reorder(order: components['schemas']['ActivityOrderInput']['order'], token: string): Promise<unknown>}>();
const emit = defineEmits<{edit: [slot: components['schemas']['ActivitySlotView']]; add: [day: string]; remove: [slot: components['schemas']['ActivitySlotView']];
    assign: [slot: components['schemas']['ActivitySlotView'], assigned: boolean, role?: string]; removeAssignment: [id: string]; roles: [slot: components['schemas']['ActivitySlotView']]; editing: [active: boolean]; denied: [source?: Event]}>();
const context = usePilot();
const {messages} = context;
const filter = ref('all');
const draggedDay = ref('');
const editing = ref(0);
const editingDescriptions = ref(new Set<string>());
const weeks = computed(() => props.view.weeks);
/** Keep the server's native time/position order within each date before filtering. */
function daySlots(day: string): components['schemas']['ActivitySlotView'][] {
    return props.view.slots.filter(slot => slot.day === day);
}
function shown(slot: components['schemas']['ActivitySlotView']): boolean {
    return filter.value === 'all' || filter.value === 'mine' && slot.selfAssigned || filter.value === 'open' && !full(slot);
}
function full(slot: components['schemas']['ActivitySlotView']): boolean { return slot.assignedCount >= (slot.maxAssignees ?? 0); }
function mayJoin(slot: components['schemas']['ActivitySlotView']): boolean { return props.view.canSelfAssign && (props.view.allowOverfillAfterFull || !full(slot)); }
/** Native role add-ons prefer the shared role description as their visible label. */
function roleLabel(role: components['schemas']['ActivitySlotRole']): string {
    return props.view.allRoles.find(candidate => candidate.id === role.id)?.description || role.name;
}
/** The native pencil is admitted by metadata/description editing. Title and
 * capacity-only grants retain their independent inline controls. */
function canEdit(slot: components['schemas']['ActivitySlotView']): boolean {
    return slot.capabilities.editMeta || slot.capabilities.editDescription;
}
function editChanged(active: boolean): void { editing.value += active ? 1 : -1; emit('editing', active); }
/** Keep a mounted description editor through remote empty text. This flag holds
 * no value/token: InlineCell remains the only draft and conflict-review owner. */
function descriptionEditingChanged(id: string, active: boolean): void {
    if (active) editingDescriptions.value.add(id);
    else editingDescriptions.value.delete(id);
    editChanged(active);
}
const drag = useListReorder({available: () => props.view.capabilities.reorderSlots && !props.disabled && !editing.value,
    ids: () => daySlots(draggedDay.value).map(slot => slot.id), token: () => props.view.orderToken,
    submit: (ids, token) => props.reorder(ids.map((slotId, position) => ({slotId, position})), token)});
function begin(slot: components['schemas']['ActivitySlotView'], event: DragEvent): void { draggedDay.value = slot.day; drag.begin(slot.id, event); }
function drop(slot: components['schemas']['ActivitySlotView'], event: DragEvent): void {
    if (slot.day === draggedDay.value) void drag.drop(slot.id, event);
    else drag.reset();
}
</script>

<template>
    <template v-if="view.requirementProgress">
        <div
            id="my-requirement-progress"
            class="status-notice d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"
            :class="view.requirementProgress.requiredShifts === 0 ? 'alert-info' : view.requirementProgress.complete ? 'alert-success' : 'alert-warning'">
            <span>
                <i
                    class="bi me-2"
                    :class="view.requirementProgress.requiredShifts === 0 ? 'bi-info-circle' : view.requirementProgress.complete ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'"
                    aria-hidden="true"></i>
                <i18next
                    :translation="view.requirementProgress.requiredShifts === 0 ? messages.t('activity.progressFree', {count: view.requirementProgress.assignedShifts})
                    : view.requirementProgress.complete ? messages.t('activity.progressComplete', {assigned: view.requirementProgress.assignedShifts, required: view.requirementProgress.requiredShifts})
                    : messages.t('activity.progressIncomplete', {assigned: view.requirementProgress.assignedShifts, required: view.requirementProgress.requiredShifts, remaining: view.requirementProgress.remainingShifts})">
                    <template #[`assigned-${view.requirementProgress.assignedShifts}`]>
                        <strong class="mx-1">{{ view.requirementProgress.assignedShifts }}</strong>
                    </template>
                    <template #done>
                        <strong>{{ messages.t('activity.progressDone') }}</strong>
                    </template>
                    <template #[`assigned-${view.requirementProgress.assignedShifts}-${view.requirementProgress.requiredShifts}`]>
                        <strong class="mx-1">{{ messages.t('activity.progressAssignedRequired', {assigned: view.requirementProgress.assignedShifts, required: view.requirementProgress.requiredShifts}) }}</strong>
                    </template>
                    <template #[`remaining-${view.requirementProgress.remainingShifts}`]>
                        <strong class="ms-1">{{ messages.t('activity.progressTakeMore', {remaining: view.requirementProgress.remainingShifts}) }}</strong>
                    </template>
                </i18next>
            </span>
            <small class="d-none d-md-inline">{{ messages.t('activity.progressHint') }}</small>
        </div>
    </template>
    <div v-if="!view.canSelfAssign" class="status-notice alert-info py-2 px-3 mb-3">
        <i class="bi bi-info-circle me-2" aria-hidden="true"></i>{{ messages.t('activity.registrationHint') }}</div>
    <div id="schedule-filter-bar" class="d-flex flex-wrap justify-content-between align-items-center mb-3">
        <div class="btn-group btn-group-sm" role="group" :aria-label="messages.t('activity.slotFilters')">
            <button
                v-for="option in (['all', 'mine', 'open'] as const)"
                :key="option"
                type="button"
                class="btn btn-outline-light"
                :class="{active: filter === option}"
                :data-slot-filter="option"
                @click="filter = option">{{ messages.t(option === 'all' ? 'activity.allSlots' : option === 'mine' ? 'activity.mySlots' : 'activity.openSlots') }}</button>
        </div>
        <small class="text-secondary mb-0">{{ messages.t('activity.filterHint') }}</small>
        <div v-if="view.capabilities.exportSchedule" class="d-flex align-items-center gap-2 mt-2 mt-sm-0">
            <a class="btn btn-outline-light btn-sm" :href="'/activity/' + view.id + '/export/schedule'" target="_blank">
                <i class="bi bi-printer me-1" aria-hidden="true"></i>{{ messages.t('activity.exportSchedule') }}</a>
        </div>
    </div>
    <div class="d-flex justify-content-between align-items-center mb-3">
        <span class="fs-6 fw-semibold">
            <i class="bi bi-people-fill me-1" aria-hidden="true"></i>{{ messages.t('activity.participantsLabel') }}<span class="badge bg-light text-dark ms-1">{{ view.counters.participants }}</span>
        </span>
        <!-- Preserve the native grouped-record length badge and text adjacency.
        Its blank total is a comparator defect, not P5 redesign authority. -->
        <span class="fs-6 fw-semibold">
            <i class="bi bi-card-checklist me-1" aria-hidden="true"></i>{{ messages.t('activity.slots') }}<span class="badge bg-light text-dark ms-1"></span>
            <span class="badge bg-secondary text-white ms-1">
                <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>{{ messages.t('activity.counterOpen', {count: view.counters.open}) }}</span>
            <span class="badge bg-danger text-white ms-1">
                <i class="bi bi-slash-circle me-1" aria-hidden="true"></i>{{ messages.t('activity.counterEmpty', {count: view.counters.empty}) }}</span>
        </span>
    </div>
    <template v-for="week in weeks" :key="week.start">
        <h4 class="mt-4 mb-2">{{ messages.t('activity.weekOf', {date: week.start}) }}</h4>
        <div class="table-responsive">
            <small v-if="view.capabilities.reorderSlots" class="text-info fst-italic fw-light">{{ messages.t('activity.editHint') }}</small>
            <table class="table table-dark table-bordered activity-table">
                <thead>
                    <tr>
                        <th v-for="day in week.days" :key="day" class="text-center small" :data-date="day">
                            <span class="day">{{ activityDayLabel(day, context.locale.value) }}</span>
                            <br />
                            <span class="date">{{ activityDateLabel(day, context.locale.value) }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td v-for="day in week.days" :key="day">
                            <div class="slot-container" :data-date="day">
                                <!-- Bootstrap's d-grid is important; native d-none must own
                                hiding rather than an inline display style that loses. -->
                                <div
                                    v-for="slot in daySlots(day)"
                                    :key="slot.id"
                                    class="slot border rounded p-2 mb-2 d-grid gap-1 draggable"
                                    :class="{'d-none': !shown(slot)}"
                                    :data-slotid="slot.id"
                                    :data-itemid="slot.id"
                                    :data-day="slot.day"
                                    :data-my="slot.selfAssigned ? '1' : undefined"
                                    :data-open="!full(slot) ? '1' : undefined"
                                    :draggable="view.capabilities.reorderSlots && !disabled && !editing"
                                    @dragstart="begin(slot, $event)"
                                    @dragend="drag.reset"
                                    @dragover.prevent
                                    @drop="drop(slot, $event)">
                                    <div class="d-flex justify-content-between align-items-start mb-0">
                                        <i v-if="view.capabilities.reorderSlots" class="bi bi-grip-vertical text-bg-dark me-2" aria-hidden="true"></i>
                                        <div class="d-flex flex-column flex-grow-1 me-2">
                                            <InlineCell
                                                tag="span"
                                                class="fw-bold text-start"
                                                :value="slot.title"
                                                :token="slot.editToken"
                                                :editable="true"
                                                :write-admission="slot.capabilities.inlineMetadataAdmission"
                                                :disabled="disabled"
                                                :label="messages.t('packing.title')"
                                                :save="(value, token) => patch(slot, 'title', value, token)"
                                                @editing="editChanged"
                                                @denied="emit('denied', $event)"
                                            />
                                            <small v-if="slot.startTime || slot.endTime" class="text-info d-flex align-items-center gap-1" data-time-range>
                                                <i class="bi bi-clock-history" aria-hidden="true"></i>
                                                <span>{{ slot.startTime?.slice(0, 5) || '??' }} – {{ slot.endTime?.slice(0, 5) || '??' }}</span>
                                            </small>
                                        </div>
                                        <div class="d-flex align-items-center gap-2">
                                            <span
                                                class="rounded-circle flex-shrink-0"
                                                :class="slot.assignedCount > (slot.maxAssignees ?? 0) ? 'bg-danger' : !slot.assignedCount && (slot.maxAssignees ?? 0) > 0 ? 'bg-warning' : 'bg-success'"
                                                style="width:.7rem;height:.7rem;display:inline-block"
                                                :title="messages.t(slot.assignedCount > (slot.maxAssignees ?? 0) ? 'activity.overbooked' : !slot.assignedCount ? 'activity.emptyAssignment' : 'activity.ok')">
                                            </span>
                                            <button
                                                v-if="canEdit(slot)"
                                                type="button"
                                                class="btn btn-sm btn-outline-light"
                                                data-slot-edit
                                                :disabled="disabled"
                                                :aria-label="messages.t('activity.editSlot')"
                                                @click="emit('edit', slot)">
                                                <i class="bi bi-pencil" aria-hidden="true"></i>
                                            </button>
                                            <button
                                                v-if="slot.capabilities.remove"
                                                type="button"
                                                class="btn btn-sm btn-outline-danger"
                                                data-delete-slot
                                                :data-slotid="slot.id"
                                                :disabled="disabled"
                                                :aria-label="messages.t('packing.deleteItem')"
                                                @click="emit('remove', slot)">
                                                <i class="bi bi-trash" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <hr class="m-0" />
                                    <InlineCell
                                        v-if="slot.description || editingDescriptions.has(slot.id)"
                                        tag="small"
                                        class="d-block text-bg-dark"
                                        :value="slot.description"
                                        :token="slot.editToken"
                                        :editable="slot.capabilities.editDescription"
                                        :disabled="disabled"
                                        :label="messages.t('packing.description')"
                                        :save="(value, token) => patch(slot, 'description', value, token)"
                                        @editing="descriptionEditingChanged(slot.id, $event)"
                                        @denied="emit('denied', $event)"
                                    />
                                    <div v-if="slot.roles.length" class="mt-1">
                                        <div
                                            v-for="role in slot.roles"
                                            :key="role.id"
                                            class="role-assignment d-flex align-items-center gap-2 mt-1"
                                            :data-role-name="role.name"
                                            :data-assignment-id="role.assignmentId">
                                            <!-- Occupancy remains visible without an assignee identity.
                                            A redacted ID never turns an occupied role into Take. -->
                                            <i class="bi bi-person-badge" aria-hidden="true"></i>
                                            <span class="flex-grow-1">{{ role.assignedQty > 0 ? roleLabel(role) + ': ' + (role.assigneeName ?? messages.t('activity.privateAssignee')) : messages.t('activity.noRoleAssignee', {role: roleLabel(role)}) }}</span>
                                            <button
                                                v-if="role.self"
                                                type="button"
                                                class="btn btn-sm btn-outline-warning"
                                                data-action="leave-role"
                                                :data-role="role.name"
                                                :disabled="disabled"
                                                @click="emit('assign', slot, false, role.name)">{{ messages.t('activity.leave') }}</button>
                                            <button
                                                v-else-if="!role.assignedQty && view.canSelfAssign && (slot.selfAssigned || mayJoin(slot))"
                                                type="button"
                                                class="btn btn-sm btn-outline-primary"
                                                data-action="take-role"
                                                :data-role="role.name"
                                                :disabled="disabled"
                                                @click="emit('assign', slot, true, role.name)">{{ messages.t('activity.take') }}</button>
                                        </div>
                                        <button
                                            v-if="slot.capabilities.manageAssignments"
                                            type="button"
                                            class="btn btn-sm btn-outline-light mt-1 w-100"
                                            data-slot-role-admin
                                            :data-slotid="slot.id"
                                            :disabled="disabled"
                                            @click="emit('roles', slot)">
                                            <i class="bi bi-people-fill me-1" aria-hidden="true"></i>{{ messages.t('activity.manageRoles') }}</button>
                                    </div>
                                    <div class="mt-2">
                                        <div class="d-flex justify-content-between align-items-center mb-1">
                                            <span class="badge bg-secondary w-100 text-center">
                                                <span data-count>{{ slot.assignedCount }}</span> /&nbsp;<InlineCell
                                                    tag="span"
                                                    data-max
                                                    :value="slot.maxAssignees"
                                                    :token="slot.editToken"
                                                    :editable="true"
                                                    :write-admission="slot.capabilities.inlineMetadataAdmission"
                                                    :disabled="disabled"
                                                    :label="messages.t('packing.capacity')"
                                                    numeric
                                                    :save="(value, token) => patch(slot, 'maxAssignees', value, token)"
                                                    @editing="editChanged"
                                                    @denied="emit('denied', $event)"
                                                />
                                            </span>
                                        </div>
                                        <ul v-if="slot.assignees.length" class="list-unstyled mb-0">
                                            <li v-for="person in slot.assignees" :key="person.assignmentId" class="d-flex align-items-center gap-1">
                                                <i class="bi bi-person-fill" aria-hidden="true"></i>
                                                <span class="flex-grow-1">{{ person.name }}</span>
                                                <button
                                                    v-if="slot.capabilities.manageAssignments"
                                                    type="button"
                                                    class="btn btn-sm btn-outline-danger ms-1"
                                                    data-owner-remove
                                                    :data-assignid="person.assignmentId"
                                                    :disabled="disabled"
                                                    :aria-label="messages.t('packing.removeAssignment')"
                                                    @click="emit('removeAssignment', person.assignmentId)">×</button>
                                            </li>
                                        </ul>
                                    </div>
                                    <div class="d-flex gap-2 mt-2">
                                        <button
                                            v-if="slot.selfAssigned"
                                            type="button"
                                            class="btn btn-sm btn-outline-danger flex-grow-1"
                                            data-action="unassign"
                                            :disabled="disabled"
                                            @click="emit('assign', slot, false)">{{ messages.t('activity.leave') }}</button>
                                        <button
                                            v-else-if="mayJoin(slot)"
                                            type="button"
                                            class="btn btn-sm flex-grow-1"
                                            :class="full(slot) ? 'btn-outline-warning' : 'btn-outline-success'"
                                            data-action="assign"
                                            :disabled="disabled"
                                            :title="full(slot) ? messages.t('activity.fullHint') : undefined"
                                            @click="emit('assign', slot, true)">
                                            <i v-if="full(slot)" class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>{{ messages.t(full(slot) ? 'activity.fullJoin' : 'activity.join') }}</button>
                                        <span v-else class="badge bg-secondary flex-grow-1 text-center">{{ messages.t(view.canSelfAssign ? 'packing.full' : 'activity.registrationRequired') }}</span>
                                    </div>
                                </div>
                                <span v-if="!daySlots(day).length" class="badge w-100 text-center">
                                    <i class="bi bi-info-circle me-2" aria-hidden="true"></i>{{ messages.t('activity.noSlots') }}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
                <tfoot v-if="view.capabilities.addSlot">
                    <tr>
                        <td v-for="day in week.days" :key="day" class="text-center">
                            <button type="button" class="btn btn-sm btn-outline-info w-100" data-add-slot :data-date="day" :disabled="disabled" @click="emit('add', day)">{{ messages.t('activity.addSlot') }}</button>
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </template>
</template>
