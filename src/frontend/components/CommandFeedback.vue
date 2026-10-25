<script setup lang="ts">
import type {CommandFeedbackProps} from '../../types/FrontendFeedbackTypes';
import {useFrontend} from '../app/context';
import StatusNotice from './StatusNotice.vue';
import ActionButton from './ActionButton.vue';

// Features supply operation-specific review text.
// The command owner retains every receipt, outcome, draft and recovery operation.
withDefaults(defineProps<CommandFeedbackProps>(), {
    part: 'all', unknownMessage: 'state.unknownOutcome', disabled: false,
});
const emit = defineEmits<{action: [source: MouseEvent]; reviewCreation: [source: MouseEvent]}>();
const {messages} = useFrontend();
</script>

<template>
    <!-- One nearest page/dialog host presents each command outcome. Uncertainty
         combines its safe diagnostic with the honest result and review controls;
         the command retains expiry, renewal, recovery and dismissal ownership. -->
    <StatusNotice v-if="(part === 'all' || part === 'error') && feedback.error.value && !feedback.uncertain.value"
        placement="notification"
        :kind="errorKind ?? feedback.feedbackKind.value" :disabled="disabled" :no-margin="noMargin"
        :read-error="feedback.errorReadError.value"
        :action="feedback.errorReadError.value ? {state: feedback.readRecoveryAction, label: messages.t('common.retry')} : undefined"
        @action="feedback.reconcileRead"
        :transient="feedback.transientError.value" :renewal="feedback.errorRenewal.value"
        @dismiss="feedback.dismissError">{{ feedback.error.value }}</StatusNotice>
    <StatusNotice v-if="(part === 'all' || part === 'notice') && feedback.notice.value"
        placement="notification" :disabled="disabled"
        :kind="feedback.noticeKind.value" :transient="feedback.transientNotice.value" :no-margin="noMargin"
        :notice="feedback.notice.value" :renewal="feedback.noticeRenewal.value"
        :last-updated-at="noticeLastUpdatedAt" :retry-at="noticeRetryAt" :read-error="feedback.noticeReadError.value ?? noticeReadError"
        :action="feedback.noticeReadError.value ? {state: feedback.readRecoveryAction, label: messages.t('common.retry')} : undefined"
        @action="feedback.reconcileRead"
        @dismiss="feedback.dismissNotice">
        <p v-if="feedback.uncertain.value && feedback.error.value" class="mb-2">{{ feedback.error.value }}</p>
        {{ messages.t(feedback.notice.value) }}<slot name="notice" />
        <!-- Matching list/Survey creation uncertainty remains inside the same
             durable notice. Feature flags/action state own eligibility; paragraph
             spacing and wording stay explicit, and custom notice slots still work. -->
        <template v-if="feedback.uncertain.value && creationReview?.required">
            <p :class="creationReview.paragraphClass">{{ messages.t(creationReview.message) }}</p>
        </template>
        <template v-if="feedback.uncertain.value && creationReview?.required" #actions>
            <ActionButton variant="outline-warning" :state="creationReview.state" @click="emit('reviewCreation', $event)">
                {{ messages.t('draft.review') }}
            </ActionButton>
        </template>
    </StatusNotice>
    <!-- Split consumers customize uncertainty without producing a second error
         box for the same receipt. Safe reason and recovery remain together. -->
    <StatusNotice v-if="part === 'uncertain' && feedback.uncertain.value" kind="warning" :no-margin="noMargin"
        placement="notification" :action="action" @action="emit('action', $event)">
        <p v-if="feedback.error.value" class="mb-2">{{ feedback.error.value }}</p>
        {{ messages.t(unknownMessage) }}<slot name="uncertain" />
        <template v-if="$slots.uncertainActions" #actions><slot name="uncertainActions" /></template>
    </StatusNotice>
</template>
