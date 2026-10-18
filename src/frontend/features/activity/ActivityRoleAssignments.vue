<script setup lang="ts">
import {computed, reactive} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useActivityApi} from './api';
import {activitySlotLabel} from './presentation';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';

// Organizer role placement uses assignment IDs already admitted for this slot.
// No profile picker or browser actor field can expand the participant set.
const props = defineProps<{planId: string; slot: components['schemas']['ActivitySlotView']; allRoles: components['schemas']['ActivityRole'][]; refresh(): Promise<void>}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const selected = reactive<Record<string, string>>(Object.fromEntries(props.slot.roles.map(role => [role.name, role.assignmentId ?? ''])));
const baseline = JSON.stringify(selected);
const command = useCommand(props.refresh, false, {dirty: () => JSON.stringify(selected) !== baseline, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => command.action.disabled.value || !props.slot.capabilities.manageAssignments);
function close(): void { if (command.mayLeave()) emit('close'); }
/** Keep native role descriptions as labels while submitting stable role names. */
function roleLabel(role: components['schemas']['ActivitySlotRole']): string {
    return props.allRoles.find(candidate => candidate.id === role.id)?.description || role.name;
}
/** Capture the visible role choices once and keep the draft until confirmation. */
async function save(): Promise<void> {
    if (blocked.value) return;
    // Empty choices mean unassigned roles, not removal of the slot membership.
    const assignments = props.slot.roles.map(role => ({role: role.name, assignmentId: selected[role.name] || null}));
    const result = await command.run(scope => api.saveRoleAssignments(props.planId, props.slot.id, {assignments}, scope), true, false,
        {presentation: 'inline', success: 'common.updated'});
    if (result) emit('close');
}
</script>

<template>
    <AppDialog
        :open="true"
        :title="messages.t('activity.manageRolesFor', {slot: activitySlotLabel(slot, messages.t)})"
        :fullscreen-on-small="false"
        :pending="command.pending.value || command.recovering.value"
        @close="close">
        <div id="slotRoleAdminModal">
            <p class="text-secondary small mb-3">{{ messages.t('activity.roleAdminHint') }}</p>
            <form id="slotRoleAdminForm" @submit.prevent="save">
                <div class="table-responsive">
                    <table class="table table-sm table-dark table-bordered mb-0">
                        <thead>
                            <tr>
                                <th class="w-25">{{ messages.t('activity.role') }}</th>
                                <th>{{ messages.t('activity.participant') }}</th>
                            </tr>
                        </thead>
                        <tbody id="slotRoleAdminBody">
                            <tr v-for="role in slot.roles" :key="role.id" :data-role-name="role.name">
                                <td class="align-middle">{{ roleLabel(role) }}</td>
                                <td>
                                    <select
                                        v-model="selected[role.name]"
                                        class="form-select form-select-sm text-bg-dark"
                                        :disabled="blocked"
                                        :aria-label="role.name"
                                        data-slot-role-admin-select
                                        :data-role-name="role.name">
                                        <option value="">{{ messages.t('activity.none') }}</option>
                                        <option v-for="person in slot.assignees" :key="person.assignmentId" :value="person.assignmentId">{{ person.name }}</option>
                                    </select>
                                </td>
                            </tr>
                            <tr v-if="!slot.roles.length">
                                <td colspan="2" class="text-center text-secondary pt-3">{{ messages.t('activity.noSlotRoles') }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </form>
            <CommandFeedback :feedback="command.feedback" />
        </div>
        <template #footer>
            <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="command.pending.value" @click="close">{{ messages.t('common.cancel') }}</button>
            <button
                id="slotRoleAdminSave"
                type="submit"
                form="slotRoleAdminForm"
                class="btn btn-sm btn-primary"
                :disabled="blocked || !slot.roles.length">
                <i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('activity.saveChanges') }}</button>
        </template>
    </AppDialog>
</template>
