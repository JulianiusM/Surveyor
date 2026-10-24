<script setup lang="ts">
import {useActionState, usePilot} from '../../app/context';
import type {components} from '../../../types/api/v1';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';

// Submission access is its own save boundary. Opening an allocation editor
// never submits its sibling settings, invoice or membership drafts.
const props = defineProps<{eventId: string; pool: components['schemas']['FinancePool']; active: boolean; refresh: () => Promise<void>}>();
const emit = defineEmits<{edit: [kind: 'settings' | 'expense' | 'assignments' | 'adjustments' | 'takeovers']}>();
const context = usePilot();
const {messages} = context;
const api = useFinanceApi(context);
const command = useCommand(props.refresh, false, {dirty: () => false, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const action = useActionState({eligible: () => props.active, blocked: () => command.action.disabled.value});

/** Confirm the current uncalculated pool and capture its revision before
 * changing participant submission access through the existing operation. */
async function changeSubmissionState(): Promise<void> {
    if (!action.isAvailable() || props.pool.status === 'CLOSED') return;
    const status = props.pool.status === 'OPEN' ? 'ORGANIZER_ONLY' as const : 'OPEN' as const;
    const expectedRevision = props.pool.revision;
    // This confirmation concerns access only. It does not calculate, reopen a
    // financially closed pool, or apply any unsaved allocation fields.
    const question = messages.value.t(status === 'OPEN' ? 'finance.confirmOpenParticipantInvoices' : 'finance.confirmCloseParticipantInvoices');
    if (!window.confirm(`${props.pool.name}\n${question}`)) return;
    await command.run(scope => api.submissionState(props.eventId, props.pool.id, {status, expectedRevision}, scope),
        true, false, {success: status === 'OPEN' ? 'finance.participantInvoicesOpened' : 'finance.participantInvoicesClosed'});
}

/** A fresh read resolves this command's uncertainty without repeating its write. */
async function refresh(): Promise<void> {
    if (!props.active || !command.recoveryAction.isAvailable()) return;
    await command.reconcileSafely(props.refresh);
}
</script>

<template>
    <div class="mb-3" data-finance-pool-actions>
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain"
                         :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="refresh" />
        <div class="pilot-action-row">
            <ActionButton variant="primary" class="btn-sm" :state="action" @click="emit('edit', 'expense')">
                <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('finance.addInvoiceAmount') }}
            </ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'settings')">{{ messages.t('finance.poolSettings') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'assignments')">{{ messages.t('finance.participantsFactors') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'adjustments')">{{ messages.t('finance.surchargesRebates') }}</ActionButton>
            <ActionButton variant="outline-light" class="btn-sm" :state="action" @click="emit('edit', 'takeovers')">{{ messages.t('finance.manageTakeovers2') }}</ActionButton>
            <ActionButton v-if="pool.status !== 'CLOSED'" variant="outline-light" class="btn-sm" :state="action"
                :pending="command.pending.value" :show-spinner="false" @click="changeSubmissionState">
                {{ messages.t(pool.status === 'OPEN' ? 'finance.closeParticipantInvoices' : 'finance.openParticipantInvoices') }}
            </ActionButton>
        </div>
        <p v-if="pool.status === 'ORGANIZER_ONLY'" class="small text-secondary">{{ messages.t('finance.organizerOnlyPoolHelp') }}</p>
    </div>
</template>
