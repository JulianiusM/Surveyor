<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {FrontendPlainMessageKey} from '../../../types/FrontendUiTypes';
import {useActionState, useFrontend} from '../../app/context';
import {ApiFailure} from '../../app/transport';
import {useCommand, useCommandReview} from '../../composables/command';
import {useReadRetry} from '../../composables/feedback';
import {useFinanceApi} from './api';
import {financeMoney} from './presentation';
import FinanceCalculation from './FinanceCalculation.vue';
import FinanceShares from './FinanceShares.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';

// One dialog owns one reviewed saved-input revision. Background finance reads
// update the underlying pool but never replace this human-reviewed snapshot.
const props = defineProps<{eventId: string; pool: components['schemas']['FinancePool']; open: boolean;
    savedShares: components['schemas']['FinanceShare'][];
    active: boolean; hasPendingEdits: () => boolean; refresh: () => Promise<void>}>();
const emit = defineEmits<{close: []; saved: [notice: FrontendPlainMessageKey]}>();
const context = useFrontend();
const {messages, locale} = context;
const api = useFinanceApi(context);
const id = useId();
const preview = shallowRef<components['schemas']['FinancePreview'] | null>(null);
const previewing = ref(false);
const valid = ref(false);
const completed = ref(false);

const sendEmails = ref(props.pool.settings?.sendCalculationEmails ?? true);
const recalculate = props.pool.status === 'CLOSED';
const readFailure = shallowRef<Error | null>(null);
const retry = useReadRetry(() => readFailure.value);
const command = useCommand(props.refresh, true, {dirty: () => false, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const {inspected, inspect: inspectSaved, acknowledge} = useCommandReview(command, () => props.refresh(), {
    eligible: () => props.active, release: () => { emit('close'); },
});
const readAction = useActionState({eligible: () => props.active && context.mayRead() && retry.value && !completed.value,
    blocked: () => command.action.disabled.value, pending: () => previewing.value});
const applyAction = useActionState({eligible: () => props.active && valid.value && !!preview.value && !completed.value,
    blocked: () => previewing.value || command.action.disabled.value, pending: () => command.pending.value});
const reconciliation = computed(() => preview.value ? [
    {key: 'roundingDifference', label: messages.value.t('finance.roundingDifference2'), amount: preview.value.totals.roundingDifference},
    {key: 'invoiceCreditAmount', label: messages.value.t('finance.invoiceCredit'), amount: preview.value.totals.invoiceCreditAmount},
    {key: 'paymentCreditAmount', label: messages.value.t('finance.previous'), amount: preview.value.totals.paymentCreditAmount},
].filter(metric => Number(metric.amount) !== 0) : []);
let sequence = 0;
let abort: AbortController | undefined;
let mounted = true;
watch(() => props.open, opened => {if (opened) void loadPreview(); else retirePreview();}, {immediate: true});
watch([() => props.active, context.epoch, () => context.session.value?.context, locale], retirePreview);
onBeforeUnmount(() => {mounted = false; retirePreview();});



/** Retire only this review's read authority. It cannot cancel an admitted
 * calculation command or turn its unknown delivery into a safe retry. */
function retirePreview(): void {
    sequence++; abort?.abort(); abort = undefined;
    previewing.value = false; valid.value = false; preview.value = null;
}

/** Obtain a fresh, validated saved-input review, fenced by dialog generation,
 * actor, locale and admission. Loading never calculates or sends mail. */
async function loadPreview(): Promise<void> {
    if (!readAction.isAvailable() || !props.open) return;
    retirePreview();
    if (props.hasPendingEdits()) {
        command.setError('finance.saveOrDiscardPendingEditsThenRefreshThisPreview');
        return;
    }
    // A new explicit read is the only way to acquire a new apply revision.
    const request = ++sequence;
    const scope = context.capture();
    const controller = new AbortController();
    abort = controller; previewing.value = true; readFailure.value = null;
    command.setError(null);
    try {
        const value = await api.preview(props.eventId, props.pool.id, scope, controller.signal);
        if (!mounted || request !== sequence || controller.signal.aborted || !props.open
            || !props.active || !context.isCurrent(scope, true)) return;
        // Recheck siblings changed during the GET; those edits were never part
        // of the saved calculation and cannot authorize its confirmation.
        preview.value = value;
        valid.value = !props.hasPendingEdits();
        if (!valid.value) command.setError('finance.saveOrDiscardPendingEditsThenRefreshThisPreview');
        else command.setInformation('finance.previewReadyReviewEachPayerBeforeApplyingThisCalculation');
    } catch (failure) {
        if (!mounted || request !== sequence || controller.signal.aborted || !context.isCurrent(scope, true)) return;
        readFailure.value = failure instanceof Error ? failure : new Error('Preview unavailable');
        command.setError(failure instanceof ApiFailure ? failure : 'finance.unableToLoadTheCalculationPreview', 'durable');
    } finally {
        if (request === sequence) previewing.value = false;
    }
}

/** Apply the displayed snapshot once. Every attempt consumes its authority;
 * rejection requires another deliberate preview, uncertainty requires review. */
async function apply(): Promise<void> {
    if (!applyAction.isAvailable() || !preview.value) return;
    if (props.hasPendingEdits()) {
        valid.value = false;
        command.setError('finance.saveOrDiscardYourPendingEditsAndRefreshThe');
        return;
    }
    const input = {expectedRevision: preview.value.revision, sendEmails: sendEmails.value};
    const notice: FrontendPlainMessageKey = recalculate
        ? input.sendEmails ? 'finance.poolRecalculatedWithEmails' : 'finance.poolRecalculatedWithoutEmails'
        : input.sendEmails ? 'finance.poolClosedWithEmails' : 'finance.poolClosedWithoutEmails';
    // Capture both revision and mail choice before disabling the controls. The
    // backend alone owns arithmetic, lock-time checks and carried transfers.
    valid.value = false; inspected.value = false;
    const result = await command.run(scope => api.calculate(props.eventId, props.pool.id, input, recalculate, scope), true, true, {success: notice});
    if (!result) return;
    completed.value = true;
    if (command.outcome.value?.refresh !== 'failed') {emit('saved', notice); emit('close');}
}

/** Fresh saved data can explain unknown delivery without reissuing calculation
 * or silently changing the revision which the organizer originally reviewed. */


function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    retirePreview(); emit('close');
}
</script>

<template>
    <AppDialog :open="open" :title="messages.t('finance.poolDialogTitle', {title: messages.t('finance.calculationPreview'), name: pool.name})"
               content-class="text-white finance-dialog" :pending="command.pending.value || command.recovering.value" @close="close">
        <div data-finance-calculation-preview>
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                             :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="inspectSaved">
                <template #uncertainActions>
                    <!-- Acknowledgement is local review. A sibling saved-data
                         read blocks it without giving it a pending focus claim. -->
                    <ActionButton v-if="inspected" variant="outline-warning"
                        :disabled="command.recoveryAction.disabled.value" @click="acknowledge">
                        {{ messages.t('finance.reviewedSavedShares') }}
                    </ActionButton>
                </template>
            </CommandFeedback>
            <p class="small">{{ messages.t('finance.reviewTheSavedAllocationSettingsAndEveryPayerS') }}</p>
            <p v-if="recalculate" class="small text-info">{{ messages.t('finance.recordedPaymentsAndRefundsAreCarriedForwardSomeoneWho') }}</p>
            <section v-if="inspected && command.uncertain.value" class="border border-secondary rounded p-3 mb-3" data-finance-calculation-inspection>
                <h3 class="fs-6">{{ messages.t('finance.savedSettlementTotals') }}</h3>
                <p>{{ messages.t(pool.status === 'CLOSED' ? 'finance.closed' : pool.status === 'OPEN' ? 'finance.openForInvoices' : 'finance.organizerInvoicesOnly') }}</p>
                <p v-if="pool.needsRecalculation" class="text-warning small">{{ messages.t('finance.recalculationRequired') }}</p>
                <FinanceShares v-if="savedShares.length" :shares="savedShares" admin read-only
                    :refreshing="command.recovering.value" @refresh="inspectSaved" />
                <p v-else class="text-secondary small mb-0">{{ messages.t('finance.noParticipantSharesWereGenerated') }}</p>
            </section>
            <LoadingSkeleton v-if="previewing" variant="table" :columns="4" :rows="3" />
            <template v-if="preview">
                <div class="pool-preview-summary row g-3 mb-3">
                    <div class="col-6"><small class="text-secondary d-block">{{ messages.t('finance.paymentsDue') }}</small><strong class="fs-4">{{ financeMoney(preview.totals.outstandingAmount, locale) }}</strong></div>
                    <div class="col-6"><small class="text-secondary d-block">{{ messages.t('finance.refundsDue') }}</small><strong class="fs-4">{{ financeMoney(Number(preview.totals.creditAmount) ? `-${preview.totals.creditAmount}` : '0', locale) }}</strong></div>
                </div>
                <!-- Numerical context and the optional anonymous worked example
                     have separate disclosures, as in the saved pool display. -->
                <details v-if="reconciliation.length || preview.calculation.sections.length" class="small mb-3" data-finance-preview-breakdown>
                    <summary class="text-info">{{ messages.t('finance.calculationBreakdown') }}</summary>
                    <dl v-if="reconciliation.length" class="invoice-share-breakdown mt-3 mb-0">
                        <template v-for="metric in reconciliation" :key="metric.key"><dt>{{ metric.label }}</dt><dd>{{ financeMoney(metric.amount, locale) }}</dd></template>
                    </dl>
                    <FinanceCalculation v-if="preview.calculation.sections.length" :calculation="preview.calculation" :show-title="false" />
                </details>
                <details v-if="preview.exampleCalculation.sections.length" class="small mb-3" data-finance-preview-example>
                    <summary class="text-info">{{ messages.t('finance.poolCalculationExample') }}</summary>
                    <div class="mt-3"><FinanceCalculation :calculation="preview.exampleCalculation" :show-title="false" /></div>
                </details>
                <div class="pool-preview-frame mb-3"><div class="table-responsive pool-preview-table">
                    <table class="table table-dark table-sm align-middle mb-0">
                        <caption class="visually-hidden">{{ messages.t('finance.previewOfTheNextCalculationIncludingPreviousSettlement') }}</caption>
                        <thead><tr><th scope="col" class="text-break">{{ messages.t('finance.payer') }}</th><th v-for="column in preview.columns" :key="column.key" scope="col" class="text-break">{{ column.label }}</th></tr></thead>
                        <tbody><tr v-for="share in preview.shares" :key="share.registrationId" :data-finance-preview-payer="share.registrationId">
                            <td :data-label="messages.t('finance.payer')"><strong>{{ share.payerName }}</strong>
                                <details v-if="share.notes.length" class="small mt-1"><summary>{{ messages.t('finance.calculationDetails') }}</summary><ul class="text-secondary ps-3 mb-0"><li v-for="(note, index) in share.notes" :key="index">{{ note }}</li></ul></details>
                            </td>
                            <td v-for="column in preview.columns" :key="column.key" :data-label="column.label" :class="{'fw-semibold': column.key === 'shareAmount'}">
                                {{ financeMoney(share[column.key], locale) }}
                                <small v-if="column.key === 'shareAmount'" class="d-block text-info fw-normal">{{ share.statusLabel }}</small>
                            </td>
                        </tr></tbody>
                    </table>
                </div></div>
                <p v-if="preview.columns.some(column => column.key === 'paymentCreditAmount')" class="text-secondary small">{{ messages.t('finance.positiveSettlementCreditsArePaymentsAlreadyReceivedNegativeCredits') }}</p>
            </template>
            <div class="form-check form-switch mt-3">
                <input :id="`${id}-emails`" v-model="sendEmails" class="form-check-input" type="checkbox" name="sendEmails" :disabled="command.action.disabled.value || completed" />
                <label class="form-check-label" :for="`${id}-emails`">{{ messages.t('finance.emailParticipantsAfterThisCalculation') }}</label>
            </div>
            <p class="text-secondary small mt-2">{{ messages.t('finance.thisChoiceAppliesToThisCalculationChangeTheDefault') }}</p>
            <p v-if="!recalculate" class="text-secondary small">{{ messages.t('finance.confirmingClosesThisPoolToNewInvoiceSubmissions') }}</p>
        </div>
        <template #bodyActions>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t(completed ? 'common.close' : 'common.cancel') }}</ActionButton>
            <ActionButton v-if="!completed" variant="outline-light" :state="readAction" @click="loadPreview">{{ messages.t('finance.refreshPreview') }}</ActionButton>
            <ActionButton v-if="!completed" variant="warning" :state="applyAction" @click="apply">{{ messages.t(recalculate ? 'finance.applyRecalculation' : 'finance.closePoolCalculate') }}</ActionButton>
        </template>
    </AppDialog>
</template>
