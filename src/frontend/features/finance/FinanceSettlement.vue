<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeMoney, financeSettlementMessages} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';

// One organizer review captures the intended signed saved balance. Current read
// changes remain visible only in deliberate recovery, never inside that capture.
const props = defineProps<{
    eventId: string;
    share: components['schemas']['FinanceShare'];
    currentShare?: components['schemas']['FinanceShare'];
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []; saved: [notice: PilotPlainMessageKey]; pending: [pending: boolean]}>();
const context = usePilot();
const {messages, locale} = context;
const api = useFinanceApi(context);
const reviewed = ref({...props.share});
const inspected = ref(false);
const completed = ref(false);
const wording = computed(() => financeSettlementMessages(reviewed.value));
const command = useCommand(props.refresh, true, {dirty: () => false,
    unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const action = useActionState({eligible: () => props.active && !completed.value && Number(reviewed.value.amount) !== 0,
    blocked: () => command.action.disabled.value, pending: () => command.pending.value});
const recovery = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
    pending: () => command.recovering.value});
const busy = computed(() => command.pending.value || command.recovering.value);
watch(busy, pending => emit('pending', pending));
watch([() => props.eventId, () => props.share.id], resetSelection);

/** A different admitted row starts another review. Same-row reads retain the
 * exact original amount and operation until this review is explicitly retired. */
function resetSelection(): void {
    // The parent releases this component on actor or audience retirement.
    reviewed.value = {...props.share}; inspected.value = false; completed.value = false;
}
function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    emit('close');
}

/** Dispatch the captured full payment/refund marker exactly once. Recalculation
 * pending does not prevent settling the saved amount; the server owns admission. */
async function confirm(): Promise<void> {
    if (!action.isAvailable()) return;
    const share = reviewed.value;
    const input = {isPaid: !share.isPaid};
    const notice = wording.value.notice;
    inspected.value = false;
    // This desired-state update has no revision or financial calculation input.
    // Unknown delivery stays locked until explicit inspection and acknowledgement.
    const result = await command.run(scope => api.settlement(props.eventId, share.poolId, share.id, input, scope),
        true, true, {success: notice});
    if (!result) return;

    // A confirmed write remains complete even if the following saved read fails.
    // Keep its warning in the mounted dialog instead of offering the write again.
    completed.value = true;
    if (command.outcome.value?.refresh !== 'failed') {
        emit('saved', notice);
        emit('close');
    }
}

/** Read saved settlement status without resending the command. An unchanged
 * status cannot prove whether the request was rejected or never arrived. */
async function inspectSaved(): Promise<void> {
    if (!recovery.isAvailable()) return;
    // Keep the captured review locked while exposing current authoritative facts.
    if (await command.reconcileSafely(props.refresh)) inspected.value = true;
}
function acknowledge(): void {
    if (!inspected.value || busy.value) return;
    command.acknowledge();
    emit('close');
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open" :title="messages.t(wording.action)"
        :subtitle="reviewed.poolName" :pending="busy" standard @close="close">
        <!-- Feedback uses the shared dialog host, outside the keyed ledger rows.
             Inspecting an unknown result never upgrades its original capture. -->
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain"
            :action="{state: recovery, label: messages.t('common.refresh')}" @action="inspectSaved">
            <template #uncertainActions>
                <!-- Acknowledgement is local review; a further saved-data read
                     blocks it without giving it a pending focus claim. -->
                <ActionButton v-if="inspected" variant="outline-warning" :disabled="recovery.disabled.value" @click="acknowledge">
                    {{ messages.t('finance.reviewedSavedShares') }}
                </ActionButton>
            </template>
        </CommandFeedback>
        <div data-finance-settlement>
            <p class="fw-semibold">{{ reviewed.payerName }}</p>
            <p>{{ messages.t(wording.confirmation, {amount: financeMoney(reviewed.amount, locale)}) }}</p>
            <div v-if="inspected && command.uncertain.value" class="border border-secondary rounded p-3" data-finance-settlement-inspection>
                <template v-if="currentShare">
                    <p class="mb-1">{{ currentShare.payerName }} — {{ currentShare.poolName }}</p>
                    <strong>{{ financeMoney(currentShare.amount, locale) }}</strong>
                    <span class="d-block">{{ currentShare.statusLabel }}</span>
                </template>
                <p v-else class="mb-0">{{ messages.t('common.empty') }}</p>
            </div>
        </div>
        <template #footer>
            <ActionButton variant="secondary" :disabled="busy" @click="close">
                {{ messages.t(completed ? 'common.close' : 'common.cancel') }}
            </ActionButton>
            <ActionButton v-if="!completed" :state="action" @click="confirm" data-finance-confirm-settlement>
                {{ messages.t(wording.action) }}
            </ActionButton>
        </template>
    </AppDialog>
</template>
