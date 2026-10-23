<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useActivityApi} from './api';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import InlineCell from '../../components/InlineCell.vue';
import FormField from '../../components/FormField.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// Shared text is plan data. Its dialog draft survives refreshes independently
// from schedule filters, and only a confirmed save releases its entered values.
const props = defineProps<{planId: string; fields: components['schemas']['ActivityTextField'][]; manage: boolean; disabled?: boolean; refresh(): Promise<void>}>();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const open = ref(false);
const id = ref<string | null>(null);
const title = ref('');
const text = ref('');
const baseline = ref('');
const editToken = ref('');
// Removal identifies only its initiating saved-row control. Dialog/inline saves
// retain their existing command lifetime and never borrow a delete focus claim.
const removingId = ref<string | null>(null);
const inlineEditors = ref<Record<string, InstanceType<typeof InlineCell> | null>>({});
const current = computed(() => props.fields.find(field => field.id === id.value));
const maySave = computed(() => id.value ? !!current.value?.capabilities.edit : props.manage);
const dirty = computed(() => open.value && JSON.stringify([title.value, text.value]) !== baseline.value);
const conflict = computed(() => !!id.value && !!current.value && current.value.editToken !== editToken.value);
const command = useCommand(props.refresh, false, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => props.disabled || command.action.disabled.value);

function edit(field?: components['schemas']['ActivityTextField']): void {
    if (blocked.value || (field ? !field.capabilities.edit : !props.manage)) return;
    // Native view-only editors enter the existing textarea directly; managers
    // get the title/text dialog. Both paths use the shared inline draft owner.
    if (field && !field.capabilities.editTitle) {
        void inlineEditors.value[field.id]?.begin();
        return;
    }
    id.value = field?.id ?? null;
    title.value = field?.title ?? '';
    text.value = field?.text ?? '';
    editToken.value = field?.editToken ?? '';
    baseline.value = JSON.stringify([title.value, text.value]);
    open.value = true;
}
function close(): void { if (command.mayLeave()) open.value = false; }

/** Submit the admitted title grant independently from the shared text grant. */
async function save(): Promise<void> {
    if (blocked.value || !maySave.value || conflict.value) return;
    const patch = {text: text.value, ...(id.value && !current.value?.capabilities.editTitle ? {} : {title: title.value})};
    // Existing fields and new fields use distinct generated operations. A lost
    // creation receipt requires explicit collection review, never automatic replay.
    const result = id.value
        ? await command.run(scope => api.updateTextField(props.planId, id.value!, patch, editToken.value, scope), true, false,
            {success: 'common.updated'})
        : await command.run(scope => api.addTextField(props.planId, {title: title.value, text: text.value}, scope), true, true,
            {success: 'activity.textCreated'});
    if (result) open.value = false;
}
/** Delete only the deliberately confirmed admitted shared field. */
async function remove(field: components['schemas']['ActivityTextField']): Promise<void> {
    if (blocked.value || !field.capabilities.delete || !window.confirm(messages.value.t('activity.deleteTextField'))) return;
    removingId.value = field.id;
    try {
        await command.run(scope => api.deleteTextField(props.planId, field.id, field.editToken, scope), true, false,
            {success: 'common.removed'});
    } finally { removingId.value = null; }
}
/** Reuse the same sparse shared-text operation for double-click and view-only pencil. */
async function inline(field: components['schemas']['ActivityTextField'], value: string, token: string): Promise<boolean> {
    return !!await command.run(scope => api.updateTextField(props.planId, field.id, {text: value}, token, scope), true, false,
        {success: 'common.updated'});
}
async function reviewUnknown(): Promise<void> {
    if (await command.reconcileSafely() && window.confirm(messages.value.t('activity.confirmUnknownReviewed'))) command.acknowledge();
}
</script>

<template>
    <section>
        <div class="d-flex justify-content-between align-items-center mt-3">
            <h5 class="mb-3">
                <i class="bi bi-journal-text me-2" aria-hidden="true"></i>{{ messages.t('activity.sharedTextFields') }}</h5>
            <ActionButton
                v-if="manage"
                id="addTextFieldBtn"
                type="button"
                class="btn-sm" variant="outline-primary"
                :disabled="blocked"
                @click="edit()">
                <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ messages.t('activity.addTextField') }}</ActionButton>
        </div>
        <CommandFeedback :feedback="command.feedback" />
        <p v-if="!fields.length" class="text-secondary small mt-2 mb-3">{{ messages.t('activity.noTextFields') }}</p>
        <div v-for="field in fields" :key="field.id" class="card text-bg-dark border border-secondary-subtle mb-3">
            <div class="card-header d-flex justify-content-between align-items-center">
                <strong class="mb-0">{{ field.title }}</strong>
                <div class="d-flex gap-2">
                    <ActionButton
                        v-if="field.capabilities.delete"
                        type="button"
                        class="btn-sm text-field-delete" variant="outline-danger"
                        :pending="command.pending.value && removingId === field.id" :show-spinner="false"
                        :data-text-field-id="field.id"
                        :disabled="blocked"
                        :aria-label="messages.t('packing.deleteItem')"
                        @click="remove(field)">
                        <i class="bi bi-trash" aria-hidden="true"></i>
                    </ActionButton>
                    <ActionButton
                        v-if="field.capabilities.edit"
                        type="button"
                        class="btn-sm text-field-edit" variant="outline-secondary"
                        :data-text-field-id="field.id"
                        :disabled="blocked"
                        :aria-label="messages.t('activity.editTextField')"
                        @click="edit(field)">
                        <i class="bi bi-pencil" aria-hidden="true"></i>
                    </ActionButton>
                </div>
            </div>
            <div class="card-body pt-2 pb-3">
                <small class="text-info fst-italic fw-light">{{ messages.t('activity.doubleClickEdit') }}</small>
                <InlineCell
                    :ref="element => inlineEditors[field.id] = element as InstanceType<typeof InlineCell>"
                    tag="p"
                    class="text-field-content mb-0 border border-secondary rounded p-2"
                    style="cursor:pointer;white-space:pre-line"
                    :value="field.text"
                    :token="field.editToken"
                    :editable="field.capabilities.edit"
                    :disabled="blocked"
                    :label="messages.t('activity.text')"
                    multiline
                    :max-length="16000"
                    :save="(value, token) => inline(field, value, token)">
                    <template v-if="field.text">{{ field.text }}</template>
                    <em v-else class="text-secondary">{{ messages.t('activity.emptyText') }}</em>
                </InlineCell>
            </div>
        </div>
        <AppDialog
            :open="open"
            :title="messages.t(id ? 'activity.editTextField' : 'activity.addTextField')"
            standard
            :fullscreen-on-small="false"
            :pending="command.pending.value || command.recovering.value"
            @close="close">
            <form id="textFieldForm" @submit.prevent="save">
                <FormField
                    id="textFieldTitle"
                    name="title"
                    v-model="title"
                    class="mb-3"
                    :label="messages.t('packing.title')"
                    label-class=""
                    required
                    :required-marker="false"
                    :max-length="255"
                    :read-only="!!id && !current?.capabilities.editTitle"
                    :disabled="blocked"
                    control-class="form-control-sm"
                    :pending="command.pending.value && !removingId" />
                <FormField
                    id="textFieldText"
                    name="text"
                    v-model="text"
                    :label="messages.t('activity.text')"
                    label-class=""
                    multiline
                    :rows="6"
                    :max-length="16000"
                    :disabled="blocked"
                    :pending="command.pending.value && !removingId" />
                <StatusNotice v-if="conflict" kind="warning">
                    <p>{{ messages.t('draft.readConflict') }}</p>
                    <p>{{ current?.title }}<br />{{ current?.text }}</p>
                    <ActionButton
                        type="button"
                        class="btn-sm" variant="outline-warning"
                        :disabled="blocked"
                        @click="editToken = current?.editToken ?? ''">{{ messages.t('draft.review') }}</ActionButton>
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
                    type="submit"
                    form="textFieldForm"
                    class="btn-sm" variant="primary"
                    :pending="command.pending.value && !removingId" :show-spinner="false"
                    :disabled="blocked || !maySave || conflict">
                    <i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('common.save') }}</ActionButton>
            </template>
        </AppDialog>
    </section>
</template>
