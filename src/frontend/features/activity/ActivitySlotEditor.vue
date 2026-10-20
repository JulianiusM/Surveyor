<script setup lang="ts">
import {computed, nextTick, reactive, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {ActivitySlotDraft} from '../../../types/FrontendActivityTypes';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useActivityApi} from './api';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import FormField from '../../components/FormField.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// Mount one editor per deliberate opening. Polling changes current capabilities,
// never the captured values, role selection or comparison baseline behind them.
const props = defineProps<{planId: string; day: string; slot?: components['schemas']['ActivitySlotView'];
    allRoles: components['schemas']['ActivityRole'][]; roleCreationAdmission: boolean; disabled?: boolean; refresh(): Promise<void>}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const draft = reactive<ActivitySlotDraft>({id: props.slot?.id ?? '', day: props.day, title: props.slot?.title ?? '',
    description: props.slot?.description ?? '', startTime: props.slot?.startTime?.slice(0, 5) ?? '',
    endTime: props.slot?.endTime?.slice(0, 5) ?? '', maxAssignees: String(props.slot?.maxAssignees ?? 1), roles: props.slot?.roles.map(role => role.id) ?? []});
const baseline = JSON.stringify(draft);
// Native edit metadata describes the opening timebox; changing controls does
// not rewrite this context label. New-slot metadata initially contains only day.
const openingTimeRange = props.slot ? [draft.startTime, draft.endTime].filter(Boolean).join(' – ') : '';
const token = ref(props.slot?.editToken ?? '');
const search = ref('');
const capabilities = computed(() => props.slot?.capabilities ?? {editTitle: !draft.id, editDescription: !draft.id,
    editMeta: !draft.id, editCapacity: !draft.id, editRoles: !draft.id});
// The opening field set belongs to this editor visit. A later grant loss must
// retain its entered values instead of hiding them and saving a partial subset.
const openingCapabilities = {...capabilities.value};
const editableCapabilities = ['editTitle', 'editDescription', 'editMeta', 'editCapacity', 'editRoles'] as const;
const permissionLost = computed(() => Boolean(draft.id)
    && editableCapabilities.some(field => openingCapabilities[field] && !capabilities.value[field]));
const initialFocus = computed(() => capabilities.value.editTitle ? '#slotEditorTitleInput' : capabilities.value.editMeta ? '#slotEditorStartTime'
    : capabilities.value.editCapacity ? '#slotEditorCapacity' : capabilities.value.editDescription ? '#slotEditorDescription' : '#slotEditorRoleInput');
const conflict = computed(() => !!draft.id && (!props.slot || props.slot.editToken !== token.value));
const command = useCommand(props.refresh, false, {dirty: () => JSON.stringify(draft) !== baseline, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => props.disabled || command.action.disabled.value || permissionLost.value);
const suggestions = computed(() => search.value.trim() ? props.allRoles.filter(role => !draft.roles.includes(role.id)
    && (role.title + ' ' + (role.description ?? '')).toLowerCase().includes(search.value.trim().toLowerCase())).slice(0, 10) : []);
function close(): void { if (command.mayLeave()) emit('close'); }
/** Selecting a known plan role changes only this slot's unsaved role set. */
function chooseRole(id: string): void {
    if (blocked.value) return;
    draft.roles.push(id);
    search.value = '';
}
/** Removing a chip does not delete the shared plan role or persist a slot edit. */
function removeRole(id: string): void {
    draft.roles = draft.roles.filter(role => role !== id);
}
/** Resolve labels from the admitted catalog while preserving stored selected IDs. */
function roleTitle(id: string): string {
    return props.allRoles.find(role => role.id === id)?.title ?? String(id);
}

/** Create a plan role through its own existing operation, then select the fresh
 * projection. A missing receipt cannot trigger automatic creation or retry. */
async function createRole(): Promise<void> {
    const name = search.value.trim();
    if (!name || blocked.value || !capabilities.value.editRoles) return;
    const existing = props.allRoles.find(role => role.title.toLowerCase() === name.toLowerCase());
    if (existing) return chooseRole(existing.id);
    if (!props.roleCreationAdmission) {
        command.setError('activity.roleCreationDenied', 'transient');
        return;
    }
    const result = await command.run(scope => api.createRole(props.planId, name, scope), true, true,
        {success: 'common.added'});
    // Read delivery supplies the persisted ID. Success without that projection
    // stays visibly saved; it never invents a role ID from the search label.
    await nextTick();
    const created = props.allRoles.find(role => role.title.toLowerCase() === name.toLowerCase());
    if (result && created) chooseRole(created.id);
}

/** Submit only fields currently admitted to this editor. Each native operation
 * still owns validation, capacity and role relationships on the server. */
async function save(): Promise<void> {
    if (blocked.value || conflict.value) return;
    const allow = openingCapabilities;
    const startTime = draft.startTime ? draft.startTime + ':00' : null;
    const endTime = draft.endTime ? draft.endTime + ':00' : null;
    // Sparse updates cannot turn hidden/read-only controls into unintended writes.
    const patch: components['schemas']['ActivitySlotPatch'] = {
        ...(allow.editTitle ? {title: draft.title.trim()} : {}), ...(allow.editDescription ? {description: draft.description.trim()} : {}),
        ...(allow.editMeta ? {startTime, endTime} : {}), ...(allow.editCapacity ? {maxAssignees: draft.maxAssignees} : {}),
        ...(allow.editRoles ? {roles: [...draft.roles]} : {}),
    };
    const result = draft.id
        ? await command.run(scope => api.updateSlot(props.planId, draft.id, patch, token.value, scope), true, false,
            {success: 'common.updated'})
        : await command.run(scope => api.addSlot(props.planId, {day: draft.day, title: draft.title.trim(), description: draft.description.trim(),
            startTime, endTime, maxAssignees: Number(draft.maxAssignees) || 1, roles: [...draft.roles]}, scope), true, true,
            {success: 'common.added'});
    if (result) emit('close');
}
async function reviewUnknown(): Promise<void> {
    if (await command.reconcileSafely() && window.confirm(messages.value.t('activity.confirmUnknownReviewed'))) command.acknowledge();
}
</script>

<template>
    <AppDialog
        :open="true"
        :title="messages.t(draft.id ? 'activity.editSlot' : 'activity.createSlot')"
        standard
        :fullscreen-on-small="false"
        :pending="command.pending.value || command.recovering.value"
        :initial-focus="initialFocus"
        @close="close">
        <form id="slotEditorForm" @submit.prevent="save">
            <FormField
                v-if="openingCapabilities.editTitle"
                id="slotEditorTitleInput"
                :name="null"
                v-model="draft.title"
                class="mb-3"
                :label="messages.t('packing.title')"
                label-class=""
                required
                :required-marker="false"
                :disabled="blocked"
                control-class="form-control-sm"
            />
            <div v-if="openingCapabilities.editMeta" class="row g-3">
                <FormField
                    id="slotEditorStartTime"
                    :name="null"
                    v-model="draft.startTime"
                    class="col-md-6"
                    type="time"
                    :label="messages.t('activity.startTime')"
                    label-class=""
                    :disabled="blocked"
                    control-class="form-control-sm"
                />
                <FormField
                    id="slotEditorEndTime"
                    :name="null"
                    v-model="draft.endTime"
                    class="col-md-6"
                    type="time"
                    :label="messages.t('activity.endTime')"
                    label-class=""
                    :disabled="blocked"
                    control-class="form-control-sm"
                />
            </div>
            <FormField
                v-if="openingCapabilities.editCapacity"
                id="slotEditorCapacity"
                :name="null"
                v-model="draft.maxAssignees"
                class="mb-3"
                type="number"
                lexical-number
                :min="1"
                :label="messages.t('activity.maxParticipants')"
                label-class=""
                :disabled="blocked"
                control-class="form-control-sm"
            />
            <FormField
                v-if="openingCapabilities.editDescription"
                id="slotEditorDescription"
                :name="null"
                v-model="draft.description"
                class="mb-3"
                multiline
                :rows="3"
                :label="messages.t('packing.description')"
                label-class=""
                :disabled="blocked"
                control-class="form-control-sm"
            />
            <div v-if="openingCapabilities.editRoles" class="mb-3">
                <label class="form-label" for="slotEditorRoleInput">{{ messages.t('activity.slotRoles') }}</label>
                <div id="slotEditorRoleChips" class="border rounded p-2 minh-38">
                    <span v-if="!draft.roles.length" class="text-secondary small">{{ messages.t('activity.noRolesAssigned') }}</span>
                    <span
                        v-for="id in draft.roles"
                        :key="id"
                        class="badge text-bg-secondary me-1 mb-1 d-inline-flex align-items-center gap-1">{{ roleTitle(id) }}
                        <ActionButton
                            type="button"
                            class="btn-sm px-1 py-0" variant="outline-light"
                            :disabled="blocked"
                            :title="messages.t('activity.removeRole')"
                            @click="removeRole(id)">
                            <i class="bi bi-x" aria-hidden="true"></i>
                        </ActionButton>
                    </span>
                </div>
                <div class="input-group input-group-sm mt-2">
                    <span class="input-group-text">
                        <i class="bi bi-search" aria-hidden="true"></i>
                    </span>
                    <input
                        id="slotEditorRoleInput"
                        v-model="search"
                        class="form-control form-control-sm text-bg-dark"
                        :placeholder="messages.t('activity.roleSearch')"
                        :disabled="blocked"
                        autocomplete="off"
                        @keydown.enter.prevent="suggestions[0] ? chooseRole(suggestions[0].id) : createRole()"
                        @keydown.esc.stop.prevent="search = ''"
                    />
                </div>
                <!-- Native suggestions remain clickable through blur and close only
                after an explicit selection, cleared search or editor dismissal. -->
                <div v-if="search.trim()" id="slotEditorRoleSuggestions" class="list-group mt-1">
                    <button
                        v-for="role in suggestions"
                        :key="role.id"
                        type="button"
                        class="list-group-item list-group-item-action d-flex align-items-center justify-content-between text-bg-dark"
                        :disabled="blocked"
                        @click="chooseRole(role.id)">{{ messages.t('activity.addRole', {name: role.title}) }}<i class="bi bi-plus-circle" aria-hidden="true"></i>
                    </button>
                    <button
                        v-if="!suggestions.length"
                        type="button"
                        class="list-group-item list-group-item-action d-flex align-items-center justify-content-between text-bg-dark"
                        :disabled="blocked"
                        @click="createRole">{{ messages.t('activity.createRole', {name: search.trim()}) }}<i class="bi bi-magic" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            <div class="small text-secondary">
                <span id="slotEditorMeta">{{ messages.t('activity.day', {date: day, time: openingTimeRange ? ` (${openingTimeRange})` : ''}) }}</span>
            </div>
            <StatusNotice v-if="permissionLost" kind="warning">{{ messages.t('common.notAllowed') }}</StatusNotice>
            <StatusNotice v-if="conflict" kind="warning">
                <p>{{ messages.t('draft.readConflict') }}</p>
                <p v-if="slot">{{ slot.title }}<br />{{ slot.description }}<br />{{ slot.startTime }} – {{ slot.endTime }}<br />{{ slot.maxAssignees }}</p>
                <ActionButton
                    v-if="slot"
                    type="button"
                    class="btn-sm" variant="outline-warning"
                    :disabled="blocked"
                    @click="token = slot.editToken">{{ messages.t('draft.review') }}</ActionButton>
            </StatusNotice>
            <CommandFeedback
                :feedback="command.feedback"
                :creation-review="{required: command.reviewRequired.value, message: 'activity.reviewUnknownItem', state: command.recoveryAction}"
                @review-creation="reviewUnknown"
            />
        </form>
        <template #footer>
            <ActionButton type="button" class="btn-sm" variant="outline-secondary" :disabled="command.pending.value" @click="close">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton
                id="slotEditorSave"
                type="submit"
                form="slotEditorForm"
                class="btn-sm" variant="primary"
                :disabled="blocked || conflict">{{ messages.t('common.save') }}</ActionButton>
        </template>
    </AppDialog>
</template>
