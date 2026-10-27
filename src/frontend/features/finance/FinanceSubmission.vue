<script setup lang="ts">
import {proofFileAccept} from '../../../common/lib/fileMedia';
import {computed, onBeforeUnmount, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, useFrontend} from '../../app/context';
import {useCommand, useCommandReview} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeDecimal, protectFinanceNumberFromScroll} from './numbers';
import ActionButton from '../../components/ActionButton.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FileField from '../../components/FileField.vue';
import FormField from '../../components/FormField.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// This draft belongs to one admitted participant/Event. Its exact File stays
// mounted after rejection/uncertainty; only confirmed save or departure releases it.
const props = defineProps<{eventId: string; pools: components['schemas']['FinancePool'][]; refresh: () => Promise<void>; active: boolean}>();
const emit = defineEmits<{history: []}>();
const context = useFrontend();
const {messages} = context;
const api = useFinanceApi(context);
const id = useId();
const draft = reactive({poolId: '', amount: '', description: ''});
const proof = ref<File | null>(null);
const progress = ref<number | null>(null);
const uploaded = ref(false);
const slow = ref(false);
let slowTimer: ReturnType<typeof setTimeout> | undefined;
const eligible = computed(() => props.pools.filter(pool => pool.canSubmit));
const hasDraft = computed(() => !!draft.amount || !!draft.description || !!proof.value);
const command = useCommand(props.refresh, true, {dirty: () => !!draft.amount || !!draft.description || !!proof.value,
    unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});

/** History inspection is a fresh read and explicit human acknowledgement. No
 * absence/presence heuristic can prove which row an ambiguous creation saved. */
const {inspected, inspect: inspectHistory, acknowledge: acknowledgeHistory} = useCommandReview(command, () => props.refresh(), {
    eligible: () => historyAction.isAvailable(), release: releaseDraft, afterInspect: () => { emit('history'); },
});
const submitAction = useActionState({eligible: () => props.active && eligible.value.some(pool => pool.id === draft.poolId),
    blocked: () => command.action.disabled.value});
const historyAction = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
    pending: () => command.recovering.value});
const uploadMessage = computed(() => uploaded.value ? messages.value.t(slow.value
    ? 'finance.yourProofHasUploadedSavingIsTakingLongerThan' : 'finance.uploadCompleteSavingYourInvoicePleaseWaitForConfirmation')
    : messages.value.t(slow.value ? 'finance.yourUploadIsTakingLongerThanUsualKeepThis' : 'finance.uploadingYourInvoiceProofKeepThisPageOpenSubmit'));
watch(eligible, selectEligiblePool, {immediate: true});
watch([() => props.eventId, context.epoch, () => context.session.value?.context], releaseDraft);
onBeforeUnmount(() => clearTimeout(slowTimer));



/** Keep an applicable pool choice through saved reads, choosing another eligible
 * pool only when the former pool actually loses participant submission access. */
function selectEligiblePool(): void {
    // Other invoice fields remain a real draft even if fresh access closes a pool.
    if (!eligible.value.some(pool => pool.id === draft.poolId)) draft.poolId = eligible.value[0]?.id ?? '';
}
function releaseDraft(): void { draft.amount = ''; draft.description = ''; proof.value = null; inspected.value = false; }

/** Capture fields before pending locks. Transfer completion is progress only;
 * generated application confirmation alone releases the completed draft. */
async function submit(event: Event): Promise<void> {
    if (!submitAction.isAvailable()) return;
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity() || !proof.value) return;
    const poolId = draft.poolId;
    const input = {amount: financeDecimal(draft.amount), description: draft.description};
    const file = proof.value;
    progress.value = null; uploaded.value = false; slow.value = false; inspected.value = false;
    // Slow delivery changes explanation, never unlocks or repeats the command.
    slowTimer = setTimeout(() => {slow.value = true;}, 10000);
    const saved = await command.run(scope => api.submit(props.eventId, poolId, input, file, scope, updateProgress),
        true, true, {success: 'finance.invoiceSubmittedSuccessfullyItIsAwaitingOrganizerReview'});
    clearTimeout(slowTimer);
    if (saved) releaseDraft();
}
function updateProgress(loaded: number, total: number | null, complete = false): void {
    progress.value = complete ? 100 : total ? Math.min(100, Math.round(loaded / total * 100)) : null;
    uploaded.value = complete || total !== null && loaded >= total;
}
</script>

<template>
    <div data-finance-submission>
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback
            :feedback="command.feedback"
            part="uncertain"
            unknown-message="finance.weCouldNotConfirmWhetherYourInvoiceWasSaved"
            :action="{state: historyAction, label: messages.t('finance.checkInvoiceHistory')}"
            @action="inspectHistory"
        >
            <template #uncertainActions>
                <!-- Reviewing saved history is local acknowledgement. A further
                     history read blocks it without making it another read action. -->
                <ActionButton v-if="inspected" variant="outline-warning" :disabled="historyAction.disabled.value" @click="acknowledgeHistory">
                    {{ messages.t('finance.reviewedHistory') }}
                </ActionButton>
            </template>
        </CommandFeedback>
        <!-- Keep the chooser mounted even when eligible pools disappear during
             the upload; its command may still be awaiting a final response. -->
        <StatusNotice v-if="!eligible.length" kind="info">
            <i class="bi bi-info-circle me-2" aria-hidden="true"></i>{{ messages.t('finance.noOpenPoolsForSubmissionsRightNow') }}
        </StatusNotice>
        <form
            v-show="eligible.length || hasDraft || command.pending.value || command.uncertain.value"
            @submit.prevent="submit"
            @wheel.capture.passive="protectFinanceNumberFromScroll"
            enctype="multipart/form-data"
        >
            <fieldset
                class="border-0 p-0 m-0"
                :disabled="command.action.disabled.value || !active || !eligible.length"
                :aria-busy="command.pending.value"
            >
                <legend class="visually-hidden">{{ messages.t('finance.invoiceDetailsAndProof') }}</legend>
                <div class="row g-2">
                    <FormField :id="`${id}-pool`" class="col-md-4" :label="messages.t('finance.choosePool')">
                        <template #control>
                            <select
                                :id="`${id}-pool`"
                                v-model="draft.poolId"
                                name="poolId"
                                class="form-select text-bg-dark"
                                required
                            >
                                <option v-for="pool in eligible" :key="pool.id" :value="pool.id">{{ pool.name }}</option>
                            </select>
                        </template>
                    </FormField>
                    <!-- Shared lexical number controls preserve the visible amount through blur. -->
                    <FormField :id="`${id}-amount`" v-model="draft.amount" name="amount" type="number" lexical-number
                        input-mode="decimal" min="0.01" step="0.01" class="col-md-4" :label="messages.t('finance.amount')"
                        required :required-marker="false"
                        :pending="command.pending.value" />
                    <FormField
                        :id="`${id}-description`"
                        v-model="draft.description"
                        name="description"
                        class="col-md-4"
                        :label="messages.t('finance.description')"
                        :pending="command.pending.value" />
                    <FileField
                        :id="`${id}-proof`"
                        name="proof"
                        class="col-12"
                        :label="messages.t('finance.proofImageOrPDF')"
                        :selected-file="proof"
                        :accept="proofFileAccept"
                        required
                        @choose="proof = $event"
                    />
                </div>
            </fieldset>
            <div v-if="command.pending.value" class="mt-3" role="status" aria-live="polite">
                <p>{{ uploadMessage }}</p>
                <div
                    class="progress mb-2"
                    role="progressbar"
                    :aria-label="messages.t('finance.invoiceUploadProgress')"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="progress ?? undefined"
                >
                    <div
                        class="progress-bar progress-bar-striped progress-bar-animated"
                        :style="{width: `${progress ?? 100}%`}"
                    >
                        {{ progress === null ? '' : `${progress}%` }}
                    </div>
                </div>
            </div>
            <div class="frontend-action-row justify-content-end mt-2">
                <ActionButton type="submit" :state="submitAction" :pending="command.pending.value">
                    <i class="bi bi-cloud-upload me-1" aria-hidden="true"></i>
                    {{ messages.t(command.pending.value ? 'finance.submitting' : command.uncertain.value ? 'finance.submissionUnconfirmed' : 'finance.submitInvoice') }}
                </ActionButton>
            </div>
        </form>
    </div>
</template>
