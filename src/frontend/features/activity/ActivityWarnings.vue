<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import {activityWarningLabel} from './presentation';

// Warnings are already permission-redacted by the server. Render user content
// as text and never look up hidden sibling plans/slots from an identifier.
const props = defineProps<{open: boolean; title: string; warnings: components['schemas']['ActivityWarning'][]; slots: components['schemas']['ActivitySlotView'][]; pending?: boolean; blocked?: boolean; confirmDisabled?: boolean; confirmLabel?: string}>();
const emit = defineEmits<{close: []; confirm: []}>();
const {messages} = usePilot();
function description(warning: components['schemas']['ActivityWarning']): string {
    return activityWarningLabel(warning, props.slots, messages.value.t);
}
</script>

<template>
    <AppDialog
        :open="open"
        :title="messages.t('activity.assignmentWarnings')"
        title-icon="bi-exclamation-triangle"
        close-class=""
        standard
        :fullscreen-on-small="false"
        :pending="pending"
        @close="emit('close')">
        <div id="assignmentWarningModal">
            <p class="small text-secondary mb-2">{{ messages.t('activity.reviewWarnings') }}</p>
            <strong id="assignmentWarningSlot" class="d-block mb-2">{{ title }}</strong>
            <ul id="assignmentWarningList" class="list-group list-group-flush">
                <li
                    v-for="(warning, index) in warnings"
                    :key="index"
                    class="list-group-item text-bg-dark d-flex align-items-start gap-2">
                    <i class="bi bi-exclamation-triangle text-warning" aria-hidden="true"></i>
                    <span>{{ description(warning) }}</span>
                </li>
            </ul>
            <p v-if="blocked" class="small text-danger mt-2 mb-0">{{ messages.t('activity.warningBlocked') }}</p>
        </div>
        <template #footer>
            <ActionButton
                id="assignmentWarningCancel"
                type="button"
                variant="outline-secondary"
                :disabled="pending"
                @click="emit('close')">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton
                id="assignmentWarningConfirm"
                type="button"
                variant="warning"
                :pending="pending" :show-spinner="false"
                :disabled="pending || blocked || confirmDisabled"
                @click="emit('confirm')">{{ confirmLabel ?? messages.t('activity.continueAnyway') }}</ActionButton>
        </template>
    </AppDialog>
</template>
