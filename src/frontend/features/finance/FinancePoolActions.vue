<script setup lang="ts">
import {shallowRef} from 'vue';
import {useActionState, useFrontend} from '../../app/context';
import type {components} from '../../../types/api/v1';
import type {FinanceSubmissionAccessReview} from '../../../types/FrontendFinanceReviewTypes';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';

// Submission access is its own save boundary. Opening an allocation editor
// never submits its sibling settings, invoice or membership drafts.
const props = defineProps<{eventId: string; pool: components['schemas']['FinancePool']; active: boolean; refresh: () => Promise<void>}>();
const emit = defineEmits<{edit: [kind: 'settings' | 'expense' | 'assignments' | 'adjustments' | 'takeovers']}>();
const context = useFrontend();
const {messages} = context;
const api = useFinanceApi(context);
const command = useCommand(props.refresh, false, {dirty: () => false, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const review = shallowRef<FinanceSubmissionAccessReview | null>(null);
const action = useActionState({eligible: () => props.active, blocked: () => command.action.disabled.value || !!review.value});
const confirmation = useActionState({eligible: ownsReview, blocked: () => command.action.disabled.value,
    pending: () => command.pending.value});

/** Open the review without writing. Capture only this operation's intent;
 * the existing command still owns its delivery, feedback and reconciliation. */
function changeSubmissionState(): void {
    if (!action.isAvailable() || props.pool.status === 'CLOSED') return;
    // Same-resource reads may replace props while the dialog remains open; they
    // cannot turn the reviewed operation into its opposite or renew its revision.
    review.value = {eventId: props.eventId, poolId: props.pool.id, poolName: props.pool.name,
        status: props.pool.status === 'OPEN' ? 'ORGANIZER_ONLY' : 'OPEN',
        expectedRevision: props.pool.revision, scope: context.capture()};
}

/** A captured review cannot authorize a different resource or replacement actor. */
function ownsReview(): boolean {
    const selected = review.value;
    return !!selected && props.active && props.pool.status !== 'CLOSED'
        && selected.eventId === props.eventId && selected.poolId === props.pool.id
        && context.isCurrent(selected.scope);
}

/** Only the explicit warning action dispatches the captured revision once. */
async function confirmSubmissionState(): Promise<void> {
    if (!confirmation.isAvailable() || !review.value) return;
    const selected = review.value;
    const saved = await command.run(scope => api.submissionState(selected.eventId, selected.poolId,
        {status: selected.status, expectedRevision: selected.expectedRevision}, scope), true, false,
        {success: selected.status === 'OPEN' ? 'finance.participantInvoicesOpened' : 'finance.participantInvoicesClosed'});
    // A confirmed write stays saved even when the follow-up read failed. The
    // same feedback instances move to the page host when this review closes.
    if (saved && review.value === selected) review.value = null;
}

/** Dismiss only presentation; an unknown command remains locked on the page. */
function closeReview(): void {
    if (command.pending.value || command.recovering.value) return;
    // Closing a local review does not acknowledge delivery or permit replay.
    review.value = null;
}

/** A fresh read resolves this command's uncertainty without repeating its write. */
async function refresh(): Promise<void> {
    if (!props.active || !command.recoveryAction.isAvailable()) return;
    // A reviewed desired-state result releases the local gate, without retrying.
    const wasUncertain = command.uncertain.value;
    if (await command.reconcileSafely(props.refresh) && wasUncertain) review.value = null;
}
</script>

<template>
    <div class="mb-3" data-finance-pool-actions>
        <div class="frontend-action-row">
            <ActionButton variant="primary" class="btn-sm" :state="action" @click="emit('edit', 'expense')">
                <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('finance.addInvoiceAmount') }}
            </ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'settings')">{{ messages.t('finance.poolSettings') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'assignments')">{{ messages.t('finance.participantsFactors') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'adjustments')">{{ messages.t('finance.surchargesRebates') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'takeovers')">{{ messages.t('finance.manageTakeovers2') }}</ActionButton>
            <ActionButton v-if="pool.status !== 'CLOSED'" variant="outline-light" class="btn-sm" :state="action"
                :pending="command.pending.value" @click="changeSubmissionState">
                {{ messages.t(pool.status === 'OPEN' ? 'finance.closeParticipantInvoices' : 'finance.openParticipantInvoices') }}
            </ActionButton>
        </div>
        <p v-if="pool.status === 'ORGANIZER_ONLY'" class="small text-secondary">{{ messages.t('finance.organizerOnlyPoolHelp') }}</p>
        <AppDialog :open="!!review" :title="messages.t('finance.confirmInvoiceAction')"
            initial-focus="[data-finance-cancel-submission]" content-class="text-white finance-dialog"
            :pending="command.pending.value || command.recovering.value" @close="closeReview">
            <p class="fw-semibold">{{ review?.poolName }}</p>
            <p>{{ messages.t(review?.status === 'OPEN' ? 'finance.confirmOpenParticipantInvoices' : 'finance.confirmCloseParticipantInvoices') }}</p>
            <template #feedback>
                <!-- These receipt owners remain mounted across review open/close. -->
                <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
                <CommandFeedback :feedback="command.feedback" part="uncertain"
                    :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="refresh" />
            </template>
            <template #footer>
                <ActionButton data-finance-cancel-submission variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="closeReview">{{ messages.t('common.cancel') }}</ActionButton>
                <ActionButton variant="warning" :state="confirmation" @click="confirmSubmissionState">
                    {{ messages.t(review?.status === 'OPEN' ? 'finance.openParticipantInvoices' : 'finance.closeParticipantInvoices') }}
                </ActionButton>
            </template>
        </AppDialog>
    </div>
</template>
