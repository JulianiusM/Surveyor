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
import RefreshButton from '../../components/RefreshButton.vue';

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
// Retain only mounted disclosure nodes so an explicit History intent can reveal
// its existing ledger without copying query data or controlling ordinary clicks.
const invoiceHistories = new Map<string, HTMLDetailsElement>();
const selectedShareId = ref<string | null>(null);
const breakdown = ref<{refresh: () => Promise<void>} | null>(null);
const retraction = ref<Invoice | null>(null);
const creating = ref(false);
const editor = ref<{poolId: string; kind: 'settings' | 'expense' | 'assignments' | 'adjustments' | 'takeovers'; payerId?: string} | null>(null);
const review = ref<{invoice: Invoice; action: 'approve' | 'decline' | 'revise' | 'reject' | 'close'} | null>(null);
const settlement = ref<Share | null>(null);
const settlementPending = ref(false);
const refreshVersion = ref(0);
// One shared section read serves all ledgers. Retain only its initiating display
// key so a neighboring Refresh/Close button cannot claim the user's focus.
const refreshingControl = ref<string | null>(null);
const key = computed(() => [...eventKeys.finance(context.session.value?.context, props.eventId, props.admin), locale.value]);
const section = useEventSection(key, readFinance, computed(() => props.enabled), computed(() => props.admin || open.value), retainLocaleSnapshot);
const selection = computed(() => section.data.value?.shares.find(share => share.id === selectedShareId.value) ?? null);
const command = useCommand(section.refresh, false, {dirty: () => false, unknownMessage: 'draft.leaveUnknown'});
const refreshAction = useActionState({eligible: () => section.readAction.isAvailable(),
    blocked: () => command.recoveryAction.disabled.value || refreshingControl.value !== null,
    pending: () => refreshingControl.value === 'section'
        || (refreshingControl.value === null && (section.query.isFetching.value || command.recovering.value))});
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
    invoiceHistories.clear();
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
/** Select only this admitted pool's invoices for its editor and history. */
function invoicesForPool(poolId: string): Invoice[] {
    return section.data.value?.invoices.filter(invoice => invoice.poolId === poolId) ?? [];
}
/** Select this pool's admitted saved shares for context, ledger and outputs. */
function sharesForPool(poolId: string): Share[] {
    return section.data.value?.shares.filter(share => share.poolId === poolId) ?? [];
}
/** Use the shared saved-summary component presence rather than a balance guess. */
function hasPreviousSettlement(pool: components['schemas']['FinancePool']): boolean {
    // The domain summary retains this key when any saved payer has nonzero
    // rounded prior credit, including opposite credits whose total is zero.
    // That is the native share-column condition; its net amount is irrelevant.
    return pool.summary?.saved.some(metric => metric.key === 'paymentCreditAmount') ?? false;
}
/** Match the native history disclosure without adding another saved-data owner. */
function invoiceHistoryOpen(pool: components['schemas']['FinancePool']): boolean {
    // Closed pools prioritize saved shares unless an invoice still needs review.
    return pool.status !== 'CLOSED' || invoicesForPool(pool.id).some(invoice => invoice.status === 'NEW');
}
/** Describe the complete admitted invoice history before its ledger is opened. */
function invoiceHistoryCaption(poolId: string): string {
    const invoices = invoicesForPool(poolId);
    const awaitingReview = invoices.filter(invoice => invoice.status === 'NEW').length;
    // A pending review stays explicit even when the closed-pool ledger is folded.
    return awaitingReview
        ? messages.value.t('finance.invoiceCaptionAwaitingReview', {count: invoices.length, awaitingReview})
        : messages.value.t('finance.invoiceCaption', {count: invoices.length});
}
/** Retain actual disclosure refs only for the currently mounted pool surfaces. */
function rememberInvoiceHistory(poolId: string, element: unknown): void {
    // Vue releases each ref on removal; these nodes never outlive their ledger.
    if (element instanceof HTMLDetailsElement) invoiceHistories.set(poolId, element);
    else invoiceHistories.delete(poolId);
}
/** Confirmed expense and recovery inspection reveal their admitted saved ledger. */
function revealPoolHistory(poolId: string): void {
    openPools.value.add(poolId);
    // Open the same DOM disclosure; ordinary reads and clicks retain its choice.
    const disclosure = invoiceHistories.get(poolId);
    if (disclosure) disclosure.open = true;
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
/** Select an admitted invoice for the shared review's single frozen capture.
 * Saved query objects are replaced, never edited by these dialog fields. */
function beginReview(invoice: Invoice, action: 'approve' | 'decline' | 'revise' | 'reject' | 'close'): void {
    if (!props.admin || !available.isAvailable()) return;
    // Keep only the selected reference here. The mounted review freezes its
    // evidence/revision once and owns that capture through later saved reads.
    review.value = {invoice, action};
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
/** Open the shared native final gate for this admitted own-history invoice.
 * The review keeps its captured identity and owns the participant command. */
function closeInvoice(invoice: Invoice): void {
    if (!available.isAvailable() || props.admin || !invoice.canClose) return;
    // Opening or canceling the gate does not dispatch. The shared review owner
    // selects api.close and retains its own pending/unknown recovery lifetime.
    review.value = {invoice, action: 'close'};
}
/** Refresh saved ledgers for one deliberate initiating surface. Command recovery
 * and breakdown delivery finish before that surface releases its pending state. */
async function refresh(source = 'section'): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    // Keep only this display key; the existing read/command owners still capture
    // actor authority and distinguish confirmed saves from uncertain writes.
    refreshingControl.value = source;
    try {
        await command.reconcileSafely(readSavedLedgers);
    } finally { refreshingControl.value = null; }
}

/** One explicit section read updates every saved ledger without replaying its
 * commands. A visible breakdown participates; unselected rows remain lazy. */
async function readSavedLedgers(): Promise<void> {
    await section.refresh();
    // Explicit Refresh adopts current ledger ordering/status filters. Routine
    // command reads leave the action row in its original position.
    refreshVersion.value++;
    await breakdown.value?.refresh();
}
function revealHistory(): void { submissionOpen.value = true; }
</script>

<template>
    <section v-if="enabled" class="mb-3" :class="admin ? undefined : 'accordion accordion-dark'" data-finance-section>
        <div v-if="!retraction">
            <CommandFeedback
                :feedback="command.feedback"
                part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}"
                @action="refresh()"
            />
        </div>
        <div :class="admin ? 'card bg-dark text-white border-secondary-subtle' : 'accordion-item bg-dark text-white border-secondary-subtle'">
            <!-- Organizer management is a persistent card, as in the native
                 dashboard. Its existing creation/read owners share this header. -->
            <div v-if="admin" class="card-header py-2 d-flex flex-wrap align-items-center justify-content-between gap-2" data-finance-management-header>
                <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-receipt" aria-hidden="true"></i>
                    <span>{{ messages.t('finance.invoicePools') }}</span>
                </div>
                <div class="pilot-action-row justify-content-end">
                    <RefreshButton :state="refreshAction" @refresh="refresh()" />
                    <ActionButton variant="primary" class="btn-sm" :state="available" @click="creating = true">
                        <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('finance.createPool') }}
                    </ActionButton>
                </div>
            </div>
            <h2 v-else class="accordion-header pilot-accordion-heading d-flex align-items-center">
                <AppAccordionButton class="text-white" :expanded="open" :controls="`${id}-finance`" @click="open = !open">
                    <i class="bi bi-cash-coin me-2" aria-hidden="true"></i>
                    {{ messages.t('finance.invoicePoolsAndPayments') }}
                </AppAccordionButton>
                <RefreshButton class="mx-2" :state="refreshAction" @refresh="refresh()" />
            </h2>
            <div v-show="admin || open" :id="`${id}-finance`" :class="admin ? 'card-body' : 'accordion-collapse'">
                <div :class="admin ? undefined : 'accordion-body'">
                    <LoadingSkeleton v-if="section.loading.value" variant="table" :columns="4" :rows="3" />
                    <StatusNotice
                        v-if="section.query.error.value"
                        :read-error="section.query.error.value"
                        kind="warning"
                        :retry-at="section.retryAt.value"
                        :last-updated-at="section.updatedAt.value"
                        :action="{state: refreshAction, label: messages.t('common.refresh')}"
                        @action="refresh()"
                    >
                        {{ section.failure.value }}
                    </StatusNotice>
                    <template v-if="section.data.value">
                        <template v-if="admin">
                            <FinancePoolEditor
                                :event-id="eventId" :participants="section.data.value.participants ?? []" :pools="section.data.value.pools"
                                :open="creating" :active="available.available.value" :refresh="section.refresh"
                                @close="creating = false"
                            />
                            <p v-if="section.data.value.pools.length" class="text-secondary small mb-3">
                                {{ messages.t('finance.openAPoolToReviewInvoicesAndSettlementUse') }}
                            </p>
                            <p v-else class="text-secondary mb-0">{{ messages.t('finance.noInvoicePoolsCreatedYet') }}</p>
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
                                                        <span v-if="pool.needsRecalculation" class="badge bg-warning text-dark" data-finance-recalculation>
                                                            {{ messages.t('finance.recalculationRequired') }}
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
                                            <!-- This persistent saved-state warning is independent of
                                                 transient command receipts and their shared host. -->
                                            <StatusNotice v-if="pool.needsRecalculation" kind="warning">
                                                <strong>{{ messages.t('finance.recalculationRequired2') }}</strong>{{ messages.t('finance.savedChangesHaveNotBeenAppliedToTheShares') }}
                                            </StatusNotice>
                                            <FinancePoolActions :event-id="eventId" :pool="pool"
                                                                :active="available.available.value" :refresh="section.refresh"
                                                                @edit="kind => editPool(pool.id, kind)" />
                                            <!-- Each editor retains its own mounted
                                                 draft through sibling saves and reads. -->
                                            <FinancePoolEditor :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                               :open="editor?.poolId === pool.id && editor.kind === 'settings'"
                                                               :active="available.available.value" :refresh="section.refresh" @close="editor = null" />
                                            <FinanceOrganizerInvoice :event-id="eventId" :pool="pool" :participants="section.data.value.participants ?? []"
                                                                      :invoices="invoicesForPool(pool.id)"
                                                                     :open="editor?.poolId === pool.id && editor.kind === 'expense'"
                                                                     :active="available.available.value" :refresh="section.refresh"
                                                                      @history="revealPoolHistory(pool.id)" @close="editor = null" />
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
                                                    :needs-recalculation="pool.status !== 'CLOSED' && pool.needsRecalculation"
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
                                                    <StatusNotice v-if="pool.hasPendingTakeovers" kind="warning" data-pool-takeover-pending>
                                                        <strong class="d-block">{{ messages.t('finance.takeoverChangesPendingIndicator') }}</strong>
                                                        <small>{{ messages.t('finance.takeoverChangesPendingDescription') }}</small>
                                                    </StatusNotice>
                                                    <FinanceCoverage
                                                        :groups="pool.pendingCoverageGroups"
                                                        known
                                                        :needs-recalculation="pool.needsRecalculation"
                                                        editable :disabled="available.disabled.value"
                                                        @edit="payerId => editCoverage(pool.id, payerId)"
                                                        data-finance-coverage-kind="pending"
                                                    />
                                                </template>
                                            </section>
                                            <!-- Native details preserves the reader's open choice on
                                                 ordinary updates while keeping the ledger mounted. -->
                                            <details :ref="element => rememberInvoiceHistory(pool.id, element)" class="mt-3"
                                                     :open="invoiceHistoryOpen(pool)" data-finance-invoice-disclosure>
                                                <summary class="fw-semibold">{{ invoiceHistoryCaption(pool.id) }}</summary>
                                                <FinanceHistory
                                                    :invoices="invoicesForPool(pool.id)"
                                                    :event-id="eventId" :pool="pool" :refresh-saved="section.refresh"
                                                    admin
                                                    :disabled="refreshAction.disabled.value"
                                                    :refreshing="refreshingControl === 'history:' + pool.id"
                                                    @review="beginReview"
                                                    @refresh="refresh('history:' + pool.id)"
                                                />
                                            </details>
                                            <!-- Saved settlement context remains distinct from current
                                                 source costs and the calculation commands below it. -->
                                            <section v-if="pool.status === 'CLOSED'" class="mt-4" data-finance-settlement-context>
                                                <template v-if="sharesForPool(pool.id).length">
                                                    <h4 class="fs-6 mb-2">{{ messages.t('finance.sharesSettlement') }}</h4>
                                                    <p v-if="pool.needsRecalculation" class="text-warning small">
                                                        {{ messages.t('finance.recalculationRequiredTheseAreThePreviousCalculatedAmountsYou') }}
                                                    </p>
                                                    <p v-if="hasPreviousSettlement(pool)" class="text-secondary small">
                                                        {{ messages.t('finance.previouslySettledRecordsPaymentsReceivedPositiveOrRefundsPaid') }}
                                                    </p>
                                                </template>
                                                <p v-else class="text-secondary small">{{ messages.t('finance.noParticipantSharesWereGenerated') }}</p>
                                                <FinanceShares
                                                    :shares="sharesForPool(pool.id)"
                                                    admin
                                                    settlement
                                                    :pending-share-id="settlementPending ? settlement?.id : null"
                                                    :refresh-version="refreshVersion"
                                                    :refreshing="refreshingControl === 'shares:' + pool.id"
                                                    :disabled="available.disabled.value"
                                                    @inspect="inspect"
                                                    @settle="beginSettlement"
                                                    @refresh="refresh('shares:' + pool.id)"
                                                >
                                                    <!-- Downloads describe these saved shares, independently
                                                         of the update/calculation commands below them. -->
                                                    <template #actions>
                                                        <a class="btn btn-outline-light btn-sm"
                                                           :href="`/event/${eventId}/export/invoice-pools/${pool.id}/shares`"
                                                           :aria-label="messages.t('finance.exportNamedSharesPdfWithExample', {poolName: pool.name})" download>
                                                            <i class="bi bi-file-earmark-pdf me-1" aria-hidden="true"></i>{{ messages.t('finance.exportPdfWithExample') }}
                                                        </a>
                                                        <a class="btn btn-outline-light btn-sm"
                                                           :href="`/event/${eventId}/export/invoice-pools/${pool.id}/shares?example=false`"
                                                           :aria-label="messages.t('finance.exportNamedSharesPdfWithoutExample', {poolName: pool.name})" download>
                                                            <i class="bi bi-file-earmark-pdf me-1" aria-hidden="true"></i>{{ messages.t('finance.exportPdfWithoutExample') }}
                                                        </a>
                                                    </template>
                                                </FinanceShares>
                                            </section>
                                            <FinancePoolOutputs :event-id="eventId" :pool="pool" :active="available.available.value"
                                                                :shares="sharesForPool(pool.id)"
                                                                :refresh="section.refresh" :has-pending-edits="() => hasPendingEdits(pool.id)"
                                                                @saved="command.setNotice" />
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
                                                :refreshing="refreshingControl === 'history'"
                                                @retract="beginRetraction"
                                                @close-invoice="closeInvoice"
                                                @refresh="refresh('history')"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <section v-if="section.data.value.pools.some(pool => pool.canSubmit)" class="mt-4">
                                <h3 class="fs-6">{{ messages.t('finance.takeovers') }}</h3>
                                <p class="small text-secondary mb-2">{{ messages.t('finance.chooseWhoseShareYouWillCoverInEachPool') }}</p>
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
                                        <i class="bi bi-person-check me-1" aria-hidden="true"></i>
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
                                :refreshing="refreshingControl === 'shares'"
                                @inspect="inspect"
                                @refresh="refresh('shares')"
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
            :participant="!admin"
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
            :open="!!retraction"
            :title="messages.t('finance.retractInvoice')"
            :pending="command.pending.value || command.recovering.value"
            @close="closeRetraction"
        >
            <!-- One renderer keeps the same receipt and expiry as its host moves
                 between an open retraction dialog and the common page region. -->
            <template #feedback>
                <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
            </template>
            <CommandFeedback
                :feedback="command.feedback"
                part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}"
                @action="refresh()"
            />
            <template v-if="retraction">
                <p class="fw-semibold">
                    {{ messages.t('finance.countedInvoiceDetails', {invoiceId: retraction.id, amount: financeMoney(retraction.amount, locale)}) }}
                    —
                    {{ retraction.poolName }}
                </p>
                <p>{{ retraction.description }}</p>
                <p>{{ messages.t('finance.retractionWarning') }}</p>
            </template>
            <template #footer>
                <ActionButton
                    variant="secondary"
                    :disabled="command.pending.value || command.recovering.value"
                    @click="closeRetraction"
                >
                    {{ messages.t('common.cancel') }}
                </ActionButton>
                <ActionButton variant="danger" :state="available" :pending="command.pending.value" :show-spinner="false" @click="retract">{{ messages.t('finance.confirmRetraction') }}</ActionButton>
            </template>
        </AppDialog>
    </section>
</template>
