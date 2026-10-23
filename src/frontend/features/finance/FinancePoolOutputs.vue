<script setup lang="ts">
import {ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import FinanceCalculationReview from './FinanceCalculationReview.vue';
import FinanceShares from './FinanceShares.vue';
import FinanceTotals from './FinanceTotals.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';

// Financial review, deliberate mail delivery and local rollback have distinct
// dialogs. Ordinary PDF links retain the existing authorized saved-ledger owner.
const props = defineProps<{eventId: string; pool: components['schemas']['FinancePool']; active: boolean;
    shares: components['schemas']['FinanceShare'][];
    hasPendingEdits: () => boolean; refresh: () => Promise<void>}>();
const emit = defineEmits<{saved: [notice: PilotPlainMessageKey]}>();
const context = usePilot();
const {messages} = context;
const api = useFinanceApi(context);
const selected = ref<'calculation' | 'notify' | 'rollback' | null>(null);
const completed = ref(false);
const inspected = ref(false);
const notificationCount = ref<number | null>(null);
const command = useCommand(props.refresh, true, {dirty: () => false, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const action = useActionState({eligible: () => props.active, blocked: () => command.action.disabled.value});
const submitAction = useActionState({eligible: () => props.active && !completed.value,
    blocked: () => command.action.disabled.value, pending: () => command.pending.value});

/** Opening deliberately starts a new output intent. A still-unknown request
 * cannot be replaced by another dialog or silently sent a second time. */
function open(kind: NonNullable<typeof selected.value>): void {
    if (!action.isAvailable()) return;
    command.acknowledge(); completed.value = false; inspected.value = false; notificationCount.value = null;
    selected.value = kind;
}
function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    selected.value = null;
}

/** Request existing saved-share emails or restore the calculated pool inputs
 * exactly once. Neither operation calculates or records a transfer. */
async function submit(): Promise<void> {
    if (!submitAction.isAvailable() || !selected.value || selected.value === 'calculation') return;
    const rollback = selected.value === 'rollback';
    if (rollback && !props.pool.canRollback) return;
    inspected.value = false;
    // Each operation keeps its legacy revision and notification behavior. A
    // rollback result can remain stale because invoices/attendance are external.
    if (rollback) {
        const result = await command.run(scope => api.rollback(props.eventId, props.pool.id, scope), true, true, {success: null});
        if (!result) return;
        completed.value = true;
        if (command.outcome.value?.refresh !== 'failed') command.setNotice(result.needsRecalculation
            ? 'finance.poolSettingsRestoredANewCalculationIsStillRequired' : 'finance.poolChangesRolledBackExistingSharesAndPaymentsHave');
    } else {
        const result = await command.run(scope => api.notify(props.eventId, props.pool.id, scope), true, true,
            {success: 'finance.settlementEmailsRequested2'});
        if (!result) return;
        notificationCount.value = result.count; completed.value = true;
    }
}

/** Inspect saved state before acknowledging uncertain mail/rollback delivery.
 * Reading cannot establish SMTP delivery or replay either operation. */
async function inspectSaved(): Promise<void> {
    if (props.active && await command.reconcileSafely(props.refresh)) inspected.value = true;
}
function acknowledge(): void {
    if (!inspected.value || command.pending.value || command.recovering.value) return;
    command.acknowledge(); selected.value = null;
}
function calculationSaved(notice: PilotPlainMessageKey): void {emit('saved', notice);}
</script>

<template>
    <div class="border-top border-secondary-subtle mt-4 pt-3" data-finance-pool-outputs>
        <strong>{{ messages.t(pool.status === 'CLOSED' ? 'finance.updateTheCalculatedShares' : 'finance.readyToCalculateShares') }}</strong>
        <p class="text-secondary small">{{ messages.t(pool.status === 'CLOSED' ? 'finance.previewTheUpdatedSharesAndCarryRecordedPaymentsForward' : 'finance.reviewInvoicesAttendanceAndSavedAllocationSettingsBeforeClosing') }}</p>
        <div class="d-flex flex-wrap gap-2">
            <ActionButton variant="warning" class="btn-sm" :state="action" @click="open('calculation')">{{ messages.t(pool.status === 'CLOSED' ? 'finance.recalculatePool' : 'finance.previewCalculation') }}</ActionButton>
            <ActionButton v-if="pool.status === 'CLOSED'" variant="outline-info" class="btn-sm" :state="action" @click="open('notify')">{{ messages.t('finance.sendSettlementEmails') }}</ActionButton>
            <template v-if="pool.status === 'CLOSED' && pool.needsRecalculation">
                <ActionButton variant="outline-light" class="btn-sm" :disabled="action.disabled.value || !pool.canRollback" @click="open('rollback')">{{ messages.t('finance.rollBackPoolChanges') }}</ActionButton>
                <small v-if="!pool.canRollback" class="text-secondary">{{ messages.t('finance.rollbackBecomesAvailableAfterThisPoolSNextSuccessful') }}</small>
            </template>
        </div>
        <FinanceCalculationReview v-if="selected === 'calculation'" :event-id="eventId" :pool="pool" open :active="active"
                                  :saved-shares="shares" :has-pending-edits="hasPendingEdits" :refresh="refresh" @close="selected = null" @saved="calculationSaved" />
        <AppDialog v-if="selected === 'notify' || selected === 'rollback'" open standard content-class="text-white finance-dialog"
                   :title="messages.t(selected === 'notify' ? 'finance.sendSettlementEmails' : 'finance.rollBackPoolChanges')" :subtitle="pool.name"
                   :pending="command.pending.value || command.recovering.value" @close="close">
            <div :data-finance-pool-output="selected">
                <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'">
                    <template #notice><p v-if="notificationCount !== null" class="mb-0 mt-1">{{ messages.t('finance.settlementEmailDeliveryRequestedForPayerS', {count: notificationCount}) }}</p></template>
                </CommandFeedback>
                <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="inspectSaved">
                    <template #uncertain>
                        <!-- Acknowledgement is local review; the saved-data read
                             blocks it without claiming pending focus for it. -->
                        <ActionButton v-if="inspected" variant="outline-warning" class="mt-2"
                            :disabled="command.recoveryAction.disabled.value" @click="acknowledge">{{ messages.t('finance.reviewedSavedShares') }}</ActionButton>
                    </template>
                </CommandFeedback>
                <section v-if="inspected && command.uncertain.value" class="border border-secondary rounded p-3 mb-3" data-finance-output-inspection>
                    <h3 class="fs-6">{{ messages.t('finance.savedSettlementTotals') }}</h3>
                    <p v-if="pool.needsRecalculation" class="text-warning small">{{ messages.t('finance.recalculationRequired') }}</p>
                    <FinanceTotals :pool="pool" />
                    <FinanceShares v-if="shares.length" :shares="shares" admin read-only
                        :refreshing="command.recovering.value" @refresh="inspectSaved" />
                    <p v-else class="text-secondary small mb-0">{{ messages.t('finance.noParticipantSharesWereGenerated') }}</p>
                </section>
                <template v-if="selected === 'notify'">
                    <p>{{ messages.t('finance.sendEachPayerTheirSavedCalculatedSharePreviousSettlements') }}</p>
                    <p v-if="pool.needsRecalculation" class="text-warning small">{{ messages.t('finance.theseEmailsDescribeThePreviousCalculationSavedPoolChanges') }}</p>
                    <p class="text-secondary small">{{ messages.t('finance.onlyPayersWithAnEmailAddressReceiveAMessage') }}</p>
                </template>
                <template v-else>
                    <p>{{ messages.t('finance.restoreThePoolSettingsParticipantAssignmentsFactorsExemptionsSurcharges') }}</p>
                    <p class="fw-semibold">{{ messages.t('finance.currentShareRowsAndAllRecordedPaymentsAreKept') }}</p>
                    <p class="text-secondary small">{{ messages.t('finance.changesToEventAttendanceRegistrationsOrInvoicesAreNot') }}</p>
                </template>
            </div>
            <template #footer>
                <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t(completed ? 'common.close' : 'common.cancel') }}</ActionButton>
                <ActionButton v-if="!completed" :variant="selected === 'notify' ? 'info' : 'warning'" :state="submitAction" @click="submit">{{ messages.t(selected === 'notify' ? 'finance.sendSettlementEmails' : 'finance.restoreLastCalculatedSettings') }}</ActionButton>
            </template>
        </AppDialog>
    </div>
</template>
