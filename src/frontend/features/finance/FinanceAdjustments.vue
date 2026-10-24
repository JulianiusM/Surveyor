<script setup lang="ts">
import {computed, nextTick, reactive, ref, shallowRef, useId} from 'vue';
import type {components} from '../../../types/api/v1';
import type {FinanceAdjustmentRemovalReview} from '../../../types/FrontendFinanceReviewTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {useFinanceDraft} from './drafts';
import {financeDecimal, protectFinanceNumberFromScroll} from './numbers';
import {financeMoney} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';

// The additive adjustment draft and saved removal commands have independent
// receipts. A removal never submits or clears an unfinished adjustment.
const props = defineProps<{
    eventId: string;
    pool: components['schemas']['FinancePool'];
    participants: NonNullable<components['schemas']['FinanceView']['participants']>;
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages, locale} = context;
const api = useFinanceApi(context);
const id = useId();
const draft = reactive({registrationId: '', amount: '', note: '', subtractFromPool: true});
const inspected = ref(false);
// The same dialog temporarily reviews one saved-row command. Its additive form
// stays mounted, and the independent removal owner retains delivery/receipts.
const removalReview = shallowRef<FinanceAdjustmentRemovalReview | null>(null);
let removalOpener: HTMLElement | null = null;
const dirty = computed(() => !!draft.registrationId || !!draft.amount || !!draft.note || !draft.subtractFromPool);
const command = useCommand(props.refresh, true, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const removal = useCommand(props.refresh, false, {dirty: () => false, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
useFinanceDraft(() => props.pool.id, () => dirty.value || command.pending.value || command.uncertain.value || removal.pending.value || removal.uncertain.value);
const action = useActionState({eligible: () => props.active,
    blocked: () => command.action.disabled.value || removal.action.disabled.value || !!removalReview.value});
const removalAction = useActionState({eligible: ownsRemovalReview,
    blocked: () => command.action.disabled.value || removal.action.disabled.value, pending: () => removal.pending.value});
const eligible = computed(() => props.participants.filter(person => props.pool.assignAll || props.pool.assignments?.some(row => row.registrationId === person.id)));
function personName(registrationId: string): string {
    // Removed registrations keep their saved identity instead of borrowing a
    // different current participant's name for an old adjustment.
    return props.participants.find(person => person.id === registrationId)?.name ?? messages.value.t('finance.participant', {id: Number(registrationId)});
}
function reset(): void { Object.assign(draft, {registrationId: '', amount: '', note: '', subtractFromPool: true}); inspected.value = false; }
function discard(): void {
    if (!action.isAvailable()) return;
    reset();
    command.setInformation('finance.unsavedEditsDiscardedTheFormNowShowsItsSaved');
}

/** Save one signed amount through the existing operation, leaving every saved
 * share in place. Only confirmed creation releases these completed fields. */
async function save(event: Event): Promise<void> {
    if (!action.isAvailable() || !(event.target as HTMLFormElement).reportValidity()) return;
    // Zero is a valid native number-field value, but cannot create a surcharge
    // or rebate. Explain the rejection through the common feedback owner.
    if (Number(draft.amount) === 0) {
        command.setError('finance.enterAPositiveSurchargeOrANegativeRebateAmount');
        return;
    }
    const input = {registrationId: draft.registrationId, amount: financeDecimal(draft.amount), note: draft.note, subtractFromPool: draft.subtractFromPool};
    inspected.value = false;
    // A new row has no safe replay identity. Unknown delivery needs an admitted
    // list inspection and human acknowledgement before another creation.
    const saved = await command.run(scope => api.addAdjustment(props.eventId, props.pool.id, input, scope), true, true,
        {success: props.pool.status === 'CLOSED' ? 'finance.adjustmentSavedClosed' : 'finance.adjustmentSaved'});
    if (saved) reset();
}

/** Review a saved removal without submitting or replacing the additive form. */
function remove(adjustment: NonNullable<components['schemas']['FinancePool']['surcharges']>[number], event: Event): void {
    if (!action.isAvailable()) return;
    // Capture the operation's identity and visible aria description only. Saved
    // rows remain authoritative in props; no copied list or second draft is made.
    removalReview.value = {eventId: props.eventId, poolId: props.pool.id, adjustmentId: adjustment.id,
        name: personName(adjustment.registrationId), rebate: Number(adjustment.amount) < 0, scope: context.capture()};
    removalOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    void focusRemovalReview();
}

/** Resource/actor replacement cannot authorize this earlier captured operation. */
function ownsRemovalReview(): boolean {
    const selected = removalReview.value;
    return !!selected && props.open && props.active && selected.eventId === props.eventId
        && selected.poolId === props.pool.id && context.isCurrent(selected.scope);
}

/** Native confirmation starts on Cancel, within the existing dialog focus trap. */
async function focusRemovalReview(): Promise<void> {
    await nextTick();
    // Waiting for the visible stage must not focus a later actor's dialog.
    if (!ownsRemovalReview()) return;
    document.getElementById(`${id}-cancel-removal`)?.focus({preventScroll: true});
}

/** Cancel returns to the same connected control and preserves every lexical field. */
async function cancelRemoval(): Promise<void> {
    if (removal.pending.value || removal.recovering.value) return;
    // Local cancellation neither leaves the editor nor acknowledges an unknown
    // write. Its existing receipt keeps every command locked until saved review.
    const selected = removalReview.value;
    removalReview.value = null;
    await nextTick();
    // A disappeared row or retired actor has no valid focus target to restore.
    if (props.open && selected && context.isCurrent(selected.scope) && removalOpener?.isConnected)
        removalOpener.focus({preventScroll: true});
    removalOpener = null;
}

/** Dispatch the reviewed saved ID exactly once through its existing command. */
async function confirmRemoval(): Promise<void> {
    if (!removalAction.isAvailable() || !removalReview.value) return;
    const selected = removalReview.value;
    const saved = await removal.run(scope => api.removeAdjustment(selected.eventId, selected.poolId, selected.adjustmentId, scope),
        true, false, {success: 'finance.adjustmentRemovedClosedPoolsRequireRecalculation'});
    // Confirmation releases only this review. The additive form and the same
    // success/read-warning receipt survive a failed following saved-data read.
    if (saved && removalReview.value === selected) removalReview.value = null;
}
/** One deliberate saved-list read reconciles both independent receipts without
 * issuing a second request or replaying either financial command. */
async function refresh(): Promise<void> {
    if (!props.active || !command.recoveryAction.isAvailable() || !removal.recoveryAction.isAvailable()) return;
    // Both histories consume one admitted read. Start with the owner whose
    // outcome is unknown so its protected recovery spans the actual GET; a
    // healthy sibling's ordinary reconciliation supplies no pending lease.
    let reading: Promise<void> | undefined;
    function readSaved(): Promise<void> { return reading ??= props.refresh(); }
    if (removal.uncertain.value) {
        if (await removal.reconcileSafely(readSaved)) {
            removalReview.value = null;
            await command.reconcileSafely(readSaved);
        }
        return;
    }

    if (await command.reconcileSafely(readSaved)) {
        inspected.value = true;
        await removal.reconcileSafely(readSaved);
    }
}
/** Explicit saved-list review releases this uncertain additive input once. */
function acknowledge(): void {
    if (!inspected.value || command.recoveryAction.disabled.value || removal.recoveryAction.disabled.value) return;
    // No inferred row matching can prove which ambiguous creation persisted.
    command.acknowledge(); reset();
}
/** Pending work blocks dismissal; accepted departure releases only this draft. */
function close(): void {
    // Header, Escape and backdrop cancel only the current review stage. The
    // enclosing unfinished form still owns its later independent Close decision.
    if (removalReview.value) {
        void cancelRemoval();
        return;
    }
    if (!command.mayLeave() || !removal.mayLeave()) return;
    // Both independently owned receipts must finish or receive acknowledgement.
    command.acknowledge(); removal.acknowledge(); reset(); emit('close');
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open"
        :title="removalReview ? messages.t('finance.confirmInvoiceAction') : messages.t('finance.poolDialogTitle', {title: messages.t('finance.surchargesRebates'), name: pool.name})"
               :pending="command.pending.value || command.recovering.value || removal.pending.value || removal.recovering.value" @close="close">
        <template #feedback>
            <!-- Feedback instances remain mounted when the body changes review stage. -->
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="refresh">
                <template #uncertainActions>
                    <ActionButton v-if="inspected" variant="outline-warning"
                        :disabled="command.recoveryAction.disabled.value || removal.recoveryAction.disabled.value" @click="acknowledge">
                        {{ messages.t('finance.reviewedAdjustments') }}
                    </ActionButton>
                </template>
            </CommandFeedback>
            <CommandFeedback :feedback="removal.feedback" :part="removal.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback :feedback="removal.feedback" part="uncertain" :action="{state: removal.recoveryAction, label: messages.t('common.refresh')}" @action="refresh" />
        </template>
        <div v-if="removalReview" data-finance-removal-review>
            <p class="fw-semibold">{{ messages.t('finance.removeAdjustment') }}</p>
            <p>{{ messages.t('finance.removeFor', {kind: messages.t(removalReview.rebate ? 'finance.rebate' : 'finance.surcharge'), name: removalReview.name}) }}</p>
        </div>
        <!-- Hiding this stage retains the exact saved rows, draft fields and models. -->
        <div v-show="!removalReview">
            <p v-if="pool.status === 'CLOSED'" class="small text-warning">{{ messages.t('finance.saveYourChangesHereThenPreviewRecalculatePoolExisting') }}</p>
            <p class="small">{{ messages.t('finance.giveAParticipantAFixedSurchargePositiveAmountOr') }}</p>
            <ul v-if="pool.surcharges?.length" class="list-group list-group-flush mb-3">
                <li v-for="adjustment in pool.surcharges" :key="adjustment.id" :data-finance-adjustment="adjustment.id"
                    class="list-group-item bg-dark text-white d-flex justify-content-between align-items-start gap-2 px-0">
                    <div class="flex-grow-1">
                        <strong class="me-2">{{ personName(adjustment.registrationId) }}</strong>
                        <span class="badge" :class="Number(adjustment.amount) < 0 ? 'bg-success' : 'bg-secondary'">
                            {{ messages.t('finance.adjustmentSummary', {kind: messages.t(Number(adjustment.amount) < 0 ? 'finance.rebate' : 'finance.surcharge'), amount: financeMoney(adjustment.amount, locale)}) }}
                        </span>
                        <small class="d-block text-secondary mt-1">{{ messages.t(adjustment.subtractFromPool ? 'finance.redistributedWithinPool' : 'finance.additionalChargeCredit') }}</small>
                        <p class="small mb-0">{{ adjustment.note }}</p>
                    </div>
                    <ActionButton variant="outline-danger" class="btn-sm align-self-start" :state="action"
                                  :pending="removal.pending.value && removalReview?.adjustmentId === adjustment.id" :show-spinner="false"
                                  :aria-label="messages.t('finance.removeFor', {kind: messages.t(Number(adjustment.amount) < 0 ? 'finance.rebate' : 'finance.surcharge'), name: personName(adjustment.registrationId)})"
                                  @click="remove(adjustment, $event)">
                        {{ messages.t('finance.remove') }}
                    </ActionButton>
                </li>
            </ul>
            <p v-else class="small text-secondary">{{ messages.t('finance.noSurchargesOrRebatesAddedYet') }}</p>
            <h3 class="fs-6 mt-3">{{ messages.t('finance.addAnAdjustment') }}</h3>
            <form :id="`${id}-form`" data-finance-adjustments @submit.prevent="save" @wheel.capture.passive="protectFinanceNumberFromScroll">
                <fieldset class="border-0 p-0 m-0" :disabled="action.disabled.value">
                    <legend class="visually-hidden">{{ messages.t('finance.addSurchargeOrRebate') }}</legend>
                    <div class="row g-3">
                        <FormField :id="`${id}-participant`" class="col-sm-6" :label="messages.t('finance.participant5')">
                            <template #control>
                                <select :id="`${id}-participant`" v-model="draft.registrationId" class="form-select text-bg-dark" required>
                                    <option value="">{{ messages.t('finance.chooseParticipant') }}</option>
                                    <option v-if="draft.registrationId && !eligible.some(person => person.id === draft.registrationId)" :value="draft.registrationId" disabled>
                                        {{ personName(draft.registrationId) }}
                                    </option>
                                    <option v-for="person in eligible" :key="person.id" :value="person.id">{{ person.name }}</option>
                                </select>
                            </template>
                        </FormField>
                        <FormField :id="`${id}-amount`" v-model="draft.amount" :name="null" type="number" lexical-number
                            input-mode="decimal" step="0.01" class="col-sm-6" :label="messages.t('finance.amountNegativeForARebate')"
                            :placeholder="messages.t('finance.adjustmentAmountExample')"
                            :described-by="`${id}-help`" required :required-marker="false"
                            :pending="command.pending.value" />
                        <FormField :id="`${id}-note`" v-model="draft.note" class="col-12" :label="messages.t('finance.note')" required :required-marker="false" :max-length="4000"
                            :placeholder="messages.t('finance.explainTheSurchargeOrRebate')" :pending="command.pending.value" />
                        <div class="col-12">
                            <div class="form-check form-switch">
                                <input :id="`${id}-redistribute`" v-model="draft.subtractFromPool" class="form-check-input" type="checkbox" />
                                <label :for="`${id}-redistribute`" class="form-check-label">{{ messages.t('finance.redistributeWithinPool') }}</label>
                            </div>
                            <p :id="`${id}-help`" class="small text-secondary mt-2">{{ messages.t('finance.selectedASurchargeReducesTheSharedTotalARebate') }}</p>
                            <p v-if="draft.amount && Number(draft.amount) === 0" class="small text-warning">{{ messages.t('finance.enterAPositiveSurchargeOrANegativeRebateAmount') }}</p>
                        </div>
                    </div>
                </fieldset>
            </form>
        </div>
        <template v-if="!removalReview" #bodyActions>
            <ActionButton variant="outline-secondary" :state="action" @click="discard">{{ messages.t('finance.discardEdits') }}</ActionButton>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value || removal.pending.value || removal.recovering.value" @click="close">{{ messages.t('common.close') }}</ActionButton>
            <ActionButton :form="`${id}-form`" type="submit" :state="action"
                :pending="command.pending.value" :show-spinner="false"><i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('finance.addSurchargeOrRebate') }}</ActionButton>
        </template>
        <template v-if="removalReview" #footer>
            <ActionButton :id="`${id}-cancel-removal`" variant="secondary"
                :disabled="removal.pending.value || removal.recovering.value" @click="cancelRemoval">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton variant="warning" :state="removalAction" @click="confirmRemoval">{{ messages.t('finance.removeAdjustment') }}</ActionButton>
        </template>
    </AppDialog>
</template>
