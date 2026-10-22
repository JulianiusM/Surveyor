<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {evictQueryFamilies} from '../../app/queryCache';
import {isReadDenial} from '../../app/transport';
import {useCommand} from '../../composables/command';
import {useEventSection} from '../event/useEventSection';
import {useFinanceApi} from './api';
import {provideFinanceDrafts} from './drafts';
import {financeMoney} from './presentation';
import FinanceBreakdown from './FinanceBreakdown.vue';
import FinanceCoverage from './FinanceCoverage.vue';
import FinanceHistory from './FinanceHistory.vue';
import FinanceShares from './FinanceShares.vue';
import FinanceSubmission from './FinanceSubmission.vue';
import FinanceTotals from './FinanceTotals.vue';
import FinancePoolActions from './FinancePoolActions.vue';
import FinancePoolEditor from './FinancePoolEditor.vue';
import FinanceOrganizerInvoice from './FinanceOrganizerInvoice.vue';
import FinanceInvoiceReview from './FinanceInvoiceReview.vue';
import FinanceAssignments from './FinanceAssignments.vue';
import FinanceAdjustments from './FinanceAdjustments.vue';
import FinanceTakeovers from './FinanceTakeovers.vue';
import FinancePoolOutputs from './FinancePoolOutputs.vue';
import FinanceSettlement from './FinanceSettlement.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppAccordionButton from '../../components/AppAccordionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import EntityListToolbar from '../../components/EntityListToolbar.vue';

type Invoice = components['schemas']['FinanceInvoice'];
type Share = components['schemas']['FinanceShare'];
// Event admission enables this independent private projection. Participant and
// organizer reads never share a representation, even for an actor with both roles.
const props = defineProps<{eventId: string; admin: boolean; enabled: boolean}>();
const context = usePilot();
const {messages, locale} = context;
const api = useFinanceApi(context);
const hasPendingEdits = provideFinanceDrafts();
const id = useId();
const open = ref(props.admin);
const submissionOpen = ref(false);
const openPools = ref(new Set<string>());
const selectedShareId = ref<string | null>(null);
const breakdown = ref<{refresh: () => Promise<void>} | null>(null);
const retraction = ref<Invoice | null>(null);
const creating = ref(false);
const editor = ref<{poolId: string; kind: 'settings' | 'expense' | 'assignments' | 'adjustments' | 'takeovers'; payerId?: string} | null>(null);
const review = ref<{invoice: Invoice; action: 'approve' | 'decline' | 'revise' | 'reject' | 'close'} | null>(null);
const settlement = ref<Share | null>(null);
const settlementPending = ref(false);
const refreshVersion = ref(0);
const key = computed(() => [...eventKeys.finance(context.session.value?.context, props.eventId, props.admin), locale.value]);
const section = useEventSection(key, readFinance, computed(() => props.enabled), computed(() => open.value), retainLocaleSnapshot);
const selection = computed(() => section.data.value?.shares.find(share => share.id === selectedShareId.value) ?? null);
const command = useCommand(section.refresh, false, {dirty: () => false, unknownMessage: 'draft.leaveUnknown'});
const refreshAction = useActionState({eligible: () => section.readAction.isAvailable(),
    blocked: () => command.recoveryAction.disabled.value, pending: () => section.query.isFetching.value || command.recovering.value});
const available = useActionState({eligible: () => props.enabled && section.current.value,
    blocked: () => command.action.disabled.value});
watch([() => props.eventId, () => props.admin, context.epoch, () => context.session.value?.context], retireLocalState);
watch(section.denied, value => {if (value) retireLocalState();});
watch(section.query.error, retireDeniedFinance, {flush: 'sync'});
watch(section.data, retireMissingSelection);

function readFinance(scope: Parameters<typeof api.read>[2], signal: AbortSignal) {
    return api.read(props.eventId, props.admin, scope, signal);
}
/** Locale changes retain this audience's mounted draft from the same admitted
 * Query; actor, Event and intent changes must start a separate form lifetime. */
function retainLocaleSnapshot(previousKey: readonly unknown[], currentKey: readonly unknown[]): boolean {
    // Only the final locale segment may differ. No data crosses a source/actor
    // boundary, and the shared read owner separately checks cache registration.
    return previousKey.length === currentKey.length
        && previousKey.slice(0, -1).every((part, index) => part === currentKey[index]);
}
/** One finance denial retires every cached locale of this private audience,
 * while preserving the producing observer's explicit error/recovery surface. */
function retireDeniedFinance(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    // Localized aliases cannot restore an earlier grant after a language switch.
    void evictQueryFamilies(context.queryClient,
        [eventKeys.finance(context.session.value?.context, props.eventId, props.admin)], 'all', key.value);
}
/** Release private read selections at source/actor retirement. Normal saved-data
 * refresh preserves disclosure state and the independently owned invoice draft. */
function retireLocalState(): void {
    selectedShareId.value = null; retraction.value = null; openPools.value = new Set();
    submissionOpen.value = false;
    creating.value = false; editor.value = null; review.value = null;
    settlement.value = null; settlementPending.value = false;
}
/** Fresh authority removes dialogs whose original saved row is no longer
 * admitted; surviving read-only selections follow the current projection. */
function retireMissingSelection(): void {
    // A retraction review deliberately keeps its captured values/revision until
    // its source loses eligibility, rather than adopting a newer reviewed draft.
    if (selectedShareId.value && !selection.value) selectedShareId.value = null;
    if (retraction.value && !section.data.value?.invoices.some(invoice => invoice.id === retraction.value?.id && invoice.canRetract)) retraction.value = null;
}
function togglePool(poolId: string): void {
    const next = new Set(openPools.value);
    if (next.has(poolId)) next.delete(poolId); else next.add(poolId);
    openPools.value = next;
}
function inspect(share: Share): void { if (available.isAvailable()) selectedShareId.value = share.id; }
/** Capture the organizer's signed saved row before opening confirmation.
 * Revalidation can update current facts without replacing the reviewed intent. */
function beginSettlement(share: Share): void {
    if (!props.admin || !available.isAvailable() || settlementPending.value || Number(share.amount) === 0) return;
    // The organizer projection requires its independent management grant. The
    // command repeats authorization on the server against the captured share ID.
    settlement.value = {...share};
}
function closeSettlement(): void {settlement.value = null; settlementPending.value = false;}
function beginRetraction(invoice: Invoice): void {
    if (available.isAvailable() && !props.admin && invoice.canRetract) retraction.value = {...invoice};
}
/** Capture the original invoice and revision. Background reads may update the
 * ledger but cannot silently substitute new values into a review in progress. */
function beginReview(invoice: Invoice, action: 'approve' | 'decline' | 'revise' | 'reject' | 'close'): void {
    if (!props.admin || !available.isAvailable()) return;
    // The review component repeats its current eligibility checks; only this
    // copy owns the human-reviewed values until dismissal or confirmation.
    review.value = {invoice: {...invoice}, action};
}
function editPool(poolId: string, kind: 'settings' | 'expense' | 'assignments' | 'adjustments' | 'takeovers'): void {
    if (props.admin && available.isAvailable()) editor.value = {poolId, kind};
}
function editCoverage(poolId: string, payerId: string): void {
    if (props.admin && available.isAvailable()) editor.value = {poolId, kind: 'takeovers', payerId};
}
function closeRetraction(): void { if (!command.pending.value && !command.recovering.value) retraction.value = null; }

/** Retract the reviewed original participant submission with its captured pool
 * revision; a subsequent saved read never substitutes a different invoice. */
async function retract(): Promise<void> {
    const invoice = retraction.value;
    if (!invoice || !available.isAvailable() || props.admin) return;
    // Preserve the native review's identity/revision until the operation settles.
    const result = await command.run(scope => api.retract(props.eventId, invoice.poolId, invoice.id, invoice.revision, scope),
        true, false, {success: 'finance.invoiceRetracted'});
    if (result) retraction.value = null;
}
/** Close only an accepted attributed invoice. The controller preserves its cost,
 * retained proof and independent participant settlement status. */
async function closeInvoice(invoice: Invoice): Promise<void> {
    if (!available.isAvailable() || props.admin || !invoice.canClose) return;
    const subject = messages.value.t('finance.invoiceNumber', {id: invoice.id});
    const question = messages.value.t('finance.confirmCloseInvoice', {
        amount: financeMoney(invoice.correctedAmount ?? invoice.amount, locale.value),
    });
    if (!window.confirm(`${subject}\n${question}`)) return;
    // Capture this admitted row before the asynchronous request and saved refresh.
    await command.run(scope => api.close(props.eventId, invoice.poolId, invoice.id, scope),
        true, false, {success: 'finance.invoiceClosed'});
}
async function refresh(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    await command.reconcileSafely(async () => {
        await section.refresh();
        // Explicit Refresh adopts current ledger ordering/status filters.
        // Routine command reads leave the action row in its original position.
        refreshVersion.value++;
        // A displayed saved explanation participates in this section's explicit
        // refresh, while collapsed/unselected rows stay genuinely lazy.
        await breakdown.value?.refresh();
    });
}
function revealHistory(): void { submissionOpen.value = true; }
</script>

<template>
    <section v-if="enabled" class="accordion accordion-dark mb-3" data-finance-section>
        <div v-if="!retraction">
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback
                :feedback="command.feedback"
                part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}"
                @action="refresh"
            />
        </div>
        <div class="accordion-item bg-dark text-white border-secondary-subtle">
            <h2 class="accordion-header">
                <AppAccordionButton class="text-white" :expanded="open" :controls="`${id}-finance`" @click="open = !open">
                    <i class="bi bi-cash-coin me-2" aria-hidden="true"></i>
                    {{ messages.t('finance.invoicePoolsAndPayments') }}
                </AppAccordionButton>
            </h2>
            <div v-show="open" :id="`${id}-finance`" class="accordion-collapse">
                <div class="accordion-body">
                    <EntityListToolbar :refresh-label="messages.t('common.refresh')" :state="refreshAction" @refresh="refresh" />
                    <LoadingSkeleton v-if="section.loading.value" variant="table" :columns="4" :rows="3" />
                    <StatusNotice
                        v-if="section.query.error.value"
                        kind="warning"
                        :retry-at="section.retryAt.value"
                        :last-updated-at="section.updatedAt.value"
                        :action="{state: refreshAction, label: messages.t('common.refresh')}"
                        @action="refresh"
                    >
                        {{ section.failure.value }}
                    </StatusNotice>
                    <template v-if="section.data.value">
                        <template v-if="admin">
                            <div class="d-flex flex-wrap gap-2 mb-3">
                                <ActionButton variant="primary" class="btn-sm" :state="available" @click="creating = true">{{ messages.t('finance.createPool') }}</ActionButton>
                            </div>
                            <FinancePoolEditor
                                :event-id="eventId" :participants="section.data.value.participants ?? []" :pools="section.data.value.pools"
                                :open="creating" :active="available.available.value" :refresh="section.refresh"
                                @close="creating = false"
                            />
                            <p v-if="!section.data.value.pools.length" class="text-secondary">{{ messages.t('finance.emptyPools') }}</p>
                            <div class="accordion accordion-dark">
                                <section
                                    v-for="pool in section.data.value.pools"
                                    :key="pool.id"
                                    class="accordion-item bg-dark text-white border-secondary-subtle invoice-pool"
                                    :data-finance-pool="pool.id"
                                >
                                    <h3 class="accordion-header">
                                        <AppAccordionButton
                                            class="text-white"
                                            :expanded="openPools.has(pool.id)"
                                            :controls="`${id}-pool-${pool.id}`"
                                            @click="togglePool(pool.id)"
                                        >
                                            <span
                                                class="pool-header-summary d-flex align-items-center w-100 justify-content-between flex-wrap gap-3"
                                            >
                                                <span class="d-flex flex-column flex-grow-1">
                                                    <span class="d-flex align-items-center flex-wrap gap-2">
                                                        <strong>{{ pool.name }}</strong>
                                                        <span v-if="pool.isDefault" class="badge bg-primary text-dark">
                                                            {{ messages.t('finance.default') }}
                                                        </span>
                                                        <span
                                                            v-if="pool.hasPendingTakeovers"
                                                            class="badge bg-warning text-dark"
                                                        >
                                                            {{ messages.t('finance.takeoverChangesPendingIndicator') }}
                                                        </span>
                                                    </span>
                                                    <small class="text-secondary">
                                                        {{ pool.description || messages.t('finance.sharedEventCosts') }}
                                                    </small>
                                                    <small v-if="pool.needsRecalculation" class="text-warning">
                                                        {{ messages.t('finance.recalculationRequired') }}
                                                    </small>
                                                </span>
                                                <span class="d-flex flex-wrap align-items-center gap-3 me-2">
                                                    <span
                                                        v-for="metric in pool.summary?.primary.filter(metric => ['totalAmount', 'outstandingAmount', 'creditAmount'].includes(metric.key))"
                                                        :key="metric.key"
                                                        class="text-end"
                                                    >
                                                        <small class="text-secondary d-block">{{ metric.label }}</small>
                                                        <strong>{{ financeMoney(metric.amount, locale) }}</strong>
                                                    </span>
                                                    <span class="badge bg-info text-dark">
                                                        {{ messages.t(pool.status === 'OPEN' ? 'finance.openForInvoices' : pool.status === 'ORGANIZER_ONLY' ? 'finance.organizerInvoicesOnly' : 'finance.closed') }}
                                                    </span>
                                                </span>
                                            </span>
                                        </AppAccordionButton>
                                    </h3>
                                    <div
                                        v-show="openPools.has(pool.id)"
                                        :id="`${id}-pool-${pool.id}`"
                                        class="accordion-collapse"
                                    >
                                        <div class="accordion-body">
                                            <FinancePoolActions :event-id="eventId" :pool="pool"
                                                                :active="available.available.value" :refresh="section.refresh"
                                                                @edit="kind => editPool(pool.id, kind)" />
                                            <!-- Each editor retains its own mounted
                                                 draft through sibling saves and reads. -->
                                            <FinancePoolEditor :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                               :open="editor?.poolId === pool.id && editor.kind === 'settings'"
                                                               :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                            <FinanceOrganizerInvoice :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                                     :invoices="section.data.value.invoices.filter(invoice => invoice.poolId === pool.id)"
                                                                     :open="editor?.poolId === pool.id && editor.kind === 'expense'"
                                                                     :active="available.available.value" :refresh="section.refresh"
                                                                     @history="openPools.add(pool.id)" @close="editor = null" />
                                            <FinanceAssignments :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                                :open="editor?.poolId === pool.id && editor.kind === 'assignments'"
                                                                :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                            <FinanceAdjustments :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                                :open="editor?.poolId === pool.id && editor.kind === 'adjustments'"
                                                                :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                            <FinanceTakeovers :event-id="eventId" :pool="pool" :registration-id="section.data.value.registrationId" admin
                                                              :initial-payer-id="editor?.poolId === pool.id ? editor.payerId : undefined"
                                                              :open="editor?.poolId === pool.id && editor.kind === 'takeovers'"
                                                              :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                            <FinanceTotals :pool="pool" />
                                            <section
                                                class="border border-secondary-subtle rounded-3 p-3 mt-3"
                                                data-finance-pool-coverage
                                            >
                                                <h4 class="fs-6 mb-2">{{ messages.t('finance.takeovers') }}</h4>
                                                <FinanceCoverage
                                                    :groups="pool.coverageGroups"
                                                    :known="pool.coverageKnown"
                                                    :editable="pool.status !== 'CLOSED'" :disabled="available.disabled.value"
                                                    @edit="payerId => editCoverage(pool.id, payerId)"
                                                    data-finance-coverage-kind="applied"
                                                />
                                                <template
                                                    v-if="pool.status === 'CLOSED' && (!pool.coverageKnown || pool.hasPendingTakeovers)"
                                                >
                                                    <h4 class="fs-6 mt-3 mb-2">
                                                        {{ messages.t(pool.coverageKnown ? 'finance.pendingTakeoverChanges' : 'finance.takeoversForNextCalculation') }}
                                                    </h4>
                                                    <p v-if="pool.hasPendingTakeovers" class="text-warning small">
                                                        {{ messages.t('finance.takeoverChangesPendingDescription') }}
                                                    </p>
                                                    <FinanceCoverage
                                                        :groups="pool.pendingCoverageGroups"
                                                        known
                                                        editable :disabled="available.disabled.value"
                                                        @edit="payerId => editCoverage(pool.id, payerId)"
                                                        data-finance-coverage-kind="pending"
                                                    />
                                                </template>
                                            </section>
                                            <FinanceHistory
                                                :invoices="section.data.value.invoices.filter(invoice => invoice.poolId === pool.id)"
                                                admin
                                                :disabled="refreshAction.disabled.value"
                                                @review="beginReview"
                                                @refresh="refresh"
                                            />
                                            <FinanceShares
                                                v-if="pool.status === 'CLOSED'"
                                                :shares="section.data.value.shares.filter(share => share.poolId === pool.id)"
                                                admin
                                                settlement
                                                :pending-share-id="settlementPending ? settlement?.id : null"
                                                :refresh-version="refreshVersion"
                                                :disabled="available.disabled.value"
                                                @inspect="inspect"
                                                @settle="beginSettlement"
                                                @refresh="refresh"
                                            />
                                            <FinancePoolOutputs :event-id="eventId" :pool="pool" :active="available.available.value"
                                                                :shares="section.data.value.shares.filter(share => share.poolId === pool.id)"
                                                                :refresh="section.refresh" :has-pending-edits="() => hasPendingEdits(pool.id)"
                                                                @saved="command.setNotice" />
                                            <div
                                                v-if="pool.status === 'CLOSED' && section.data.value.shares.some(share => share.poolId === pool.id)"
                                                class="d-flex flex-wrap gap-2 mt-3"
                                            >
                                                <a
                                                    class="btn btn-outline-light btn-sm"
                                                    :href="`/event/${eventId}/export/invoice-pools/${pool.id}/shares`"
                                                    download
                                                >
                                                    {{ messages.t('finance.exportPdfWithExample') }}
                                                </a>
                                                <a
                                                    class="btn btn-outline-light btn-sm"
                                                    :href="`/event/${eventId}/export/invoice-pools/${pool.id}/shares?example=false`"
                                                    download
                                                >
                                                    {{ messages.t('finance.exportPdfWithoutExample') }}
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </template>
                        <template v-else>
                            <div class="accordion accordion-dark">
                                <div class="accordion-item bg-dark text-white border-secondary-subtle">
                                    <h3 class="accordion-header">
                                        <AppAccordionButton
                                            class="text-white"
                                            :expanded="submissionOpen"
                                            :controls="`${id}-submission`"
                                            @click="submissionOpen = !submissionOpen"
                                        >
                                            <i class="bi bi-receipt me-2" aria-hidden="true"></i>
                                            {{ messages.t('finance.submitAnInvoiceHistory') }}
                                        </AppAccordionButton>
                                    </h3>
                                    <div v-show="submissionOpen" :id="`${id}-submission`" class="accordion-collapse">
                                        <div class="accordion-body">
                                            <FinanceSubmission
                                                :event-id="eventId"
                                                :pools="section.data.value.pools"
                                                :refresh="section.refresh"
                                                :active="available.available.value"
                                                @history="revealHistory"
                                            />
                                            <FinanceHistory
                                                :invoices="section.data.value.invoices"
                                                :disabled="available.disabled.value"
                                                @retract="beginRetraction"
                                                @close-invoice="closeInvoice"
                                                @refresh="refresh"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <section v-if="section.data.value.pools.some(pool => pool.canSubmit)" class="mt-4">
                                <h3 class="fs-6">{{ messages.t('finance.takeovers') }}</h3>
                                <article
                                    v-for="pool in section.data.value.pools.filter(pool => pool.canSubmit)"
                                    :key="pool.id"
                                    class="border border-secondary-subtle rounded-3 p-3 mb-2"
                                    :data-finance-participant-pool="pool.id"
                                >
                                    <h4 class="fs-6 mb-1">{{ pool.name }}</h4>
                                    <p class="small text-secondary">
                                        {{ pool.assignAll ? messages.t('finance.allParticipantsCovered') : messages.t('finance.participantsCovered', {count: pool.assignedCount}) }}
                                    </p>
                                    <FinanceCoverage
                                        :groups="pool.coverageGroups"
                                        :known="pool.coverageKnown"
                                        :registration-id="section.data.value.registrationId"
                                    />
                                    <ActionButton
                                        variant="outline-light" class="btn-sm mt-2" :state="available"
                                        @click="editor = {poolId: pool.id, kind: 'takeovers'}"
                                    >
                                        {{ messages.t('finance.manageTakeovers2') }}
                                    </ActionButton>
                                    <FinanceTakeovers :event-id="eventId" :pool="pool" :registration-id="section.data.value.registrationId" :admin="false"
                                                      :open="editor?.poolId === pool.id && editor.kind === 'takeovers'"
                                                      :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                </article>
                            </section>
                            <FinanceShares
                                :shares="section.data.value.shares"
                                :pools="section.data.value.pools"
                                :disabled="available.disabled.value"
                                :refresh-version="refreshVersion"
                                @inspect="inspect"
                                @refresh="refresh"
                            />
                        </template>
                    </template>
                </div>
            </div>
        </div>
        <FinanceInvoiceReview
            v-if="review && section.data.value?.pools.some(pool => pool.id === review?.invoice.poolId)"
            :event-id="eventId" :invoice="review.invoice" :action="review.action"
            :current-invoice="section.data.value!.invoices.find(invoice => invoice.id === review!.invoice.id)"
            :pool="section.data.value!.pools.find(pool => pool.id === review!.invoice.poolId)!"
            open :active="available.available.value" :refresh="section.refresh" @close="review = null"
            @saved="command.setNotice"
        />
        <FinanceBreakdown
            v-if="selection && section.data.value"
            ref="breakdown"
            :key="selection.id"
            :event-id="eventId"
            :share="selection"
            :admin="admin"
            @close="selectedShareId = null"
        />
        <FinanceSettlement v-if="settlement && section.data.value" :key="settlement.id" :event-id="eventId" :share="settlement"
                           :current-share="section.data.value.shares.find(share => share.id === settlement?.id)" open
                           :active="available.available.value" :refresh="section.refresh" @close="closeSettlement"
                           @pending="settlementPending = $event" @saved="command.setNotice" />
        <AppDialog content-class="text-white finance-dialog"
            v-if="retraction"
            open
            :title="messages.t('finance.retractInvoice')"
            :pending="command.pending.value || command.recovering.value"
            standard
            @close="closeRetraction"
        >
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback
                :feedback="command.feedback"
                part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}"
                @action="refresh"
            />
            <p class="fw-semibold">
                {{ messages.t('finance.countedInvoiceDetails', {invoiceId: retraction.id, amount: financeMoney(retraction.amount, locale)}) }}
                —
                {{ retraction.poolName }}
            </p>
            <p>{{ retraction.description }}</p>
            <p>{{ messages.t('finance.retractionWarning') }}</p>
            <template #footer>
                <ActionButton
                    variant="secondary"
                    :disabled="command.pending.value || command.recovering.value"
                    @click="closeRetraction"
                >
                    {{ messages.t('common.cancel') }}
                </ActionButton>
                <ActionButton variant="danger" :state="available" @click="retract">{{ messages.t('finance.confirmRetraction') }}</ActionButton>
            </template>
        </AppDialog>
    </section>
</template>
