<script setup lang="ts">
import {computed} from 'vue';
import type {CommandFeedbackProps} from '../../types/FrontendFeedbackTypes';
import {usePilot} from '../app/context';
import StatusNotice from './StatusNotice.vue';
import ActionButton from './ActionButton.vue';

// Features choose native placement and supply any operation-specific review text.
// The command owner retains every receipt, outcome, draft and recovery operation.
// An absent inline override must defer to the receipt. Vue's implicit Boolean
// false would otherwise silently replace that operation-specific presentation.
const props = withDefaults(defineProps<CommandFeedbackProps>(), {
    part: 'all', unknownMessage: 'state.unknownOutcome', inline: undefined, disabled: false,
});
const emit = defineEmits<{action: [source: MouseEvent]; reviewCreation: [source: MouseEvent]}>();
const {messages} = usePilot();
// Metadata's inline alerts belong to their local Properties host. An explicit
// null preserves that boundary while other callers use their captured invoker.
const target = computed(() => props.target === undefined ? props.feedback.feedbackTarget.value : props.target);
</script>

<template>
    <!-- Separate instances can present error and notice at their original native
         locations. Sharing the same refs preserves expiry, renewal and dismissal. -->
    <StatusNotice v-if="(part === 'all' || part === 'error') && feedback.error.value"
        :inline="inline ?? feedback.errorPresentation.value === 'inline'" :target="target"
        :kind="errorKind ?? feedback.feedbackKind.value" :disabled="disabled" :no-margin="noMargin"
        :transient="feedback.transientError.value" :renewal="feedback.errorRenewal.value"
        @dismiss="feedback.dismissError">{{ feedback.error.value }}</StatusNotice>
    <StatusNotice v-if="(part === 'all' || part === 'notice') && feedback.notice.value"
        :inline="inline ?? feedback.noticeInline.value" :target="target" :disabled="disabled"
        :kind="feedback.noticeKind.value" :transient="feedback.transientNotice.value" :no-margin="noMargin"
        :notice="feedback.notice.value" :renewal="feedback.noticeRenewal.value"
        :last-updated-at="noticeLastUpdatedAt" :retry-at="noticeRetryAt" :read-error="noticeReadError"
        @dismiss="feedback.dismissNotice">{{ messages.t(feedback.notice.value) }}<slot name="notice" />
        <!-- Matching list/Survey creation uncertainty remains inside the same
             durable notice. Feature flags/action state own eligibility; paragraph
             spacing and wording stay explicit, and custom notice slots still work. -->
        <template v-if="feedback.uncertain.value && creationReview?.required">
            <p :class="creationReview.paragraphClass">{{ messages.t(creationReview.message) }}</p>
            <ActionButton variant="outline-warning" :state="creationReview.state" @click="emit('reviewCreation', $event)">
                {{ messages.t('draft.review') }}
            </ActionButton>
        </template>
    </StatusNotice>
    <!-- Some native forms present uncertainty independently of ordinary notices.
         This condition is retained command status, not a second error/receipt. -->
    <StatusNotice v-if="part === 'uncertain' && feedback.uncertain.value" kind="warning" :no-margin="noMargin"
        :action="action" @action="emit('action', $event)">{{ messages.t(unknownMessage) }}<slot name="uncertain" /></StatusNotice>
</template>
