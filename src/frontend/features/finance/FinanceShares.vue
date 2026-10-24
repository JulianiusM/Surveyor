<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {financeMoney, financeSettlementMessages} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import FinanceLedgerFooter from './FinanceLedgerFooter.vue';

type Share = components['schemas']['FinanceShare'];
// Organizer payer rows and personal pool rows share saved signed balances,
// display filters and paging. The server supplies status/caption/coverage facts.
const props = defineProps<{shares: Share[]; admin?: boolean; disabled?: boolean; readOnly?: boolean;
    settlement?: boolean; pendingShareId?: string | null; refreshVersion?: number; refreshing?: boolean;
    pools?: Pick<components['schemas']['FinancePool'], 'id' | 'description'>[]}>();
const emit = defineEmits<{inspect: [share: Share]; settle: [share: Share]; refresh: []}>();
const {messages, locale} = usePilot();
const id = useId();
const search = ref('');
const status = ref('');
const sort = ref('name');
const size = ref(25);
const page = ref(0);
const refreshNeeded = ref(false);
const refreshNotice = ref(0);
const poolDescriptions = computed(() => new Map((props.pools ?? []).map(pool => [pool.id, pool.description ?? ''])));
// Only display identities are retained. Every rendered amount/status still comes
// directly from the current admitted read, without a second server-data store.
const selectedIds = ref(filteredShares().map(share => share.id));
const currentShares = computed(() => new Map(props.shares.map(share => [share.id, share])));
const filtered = computed(() => selectedIds.value.flatMap(id => {
    const share = currentShares.value.get(id);
    return share ? [share] : [];
}));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const visible = computed(() => filtered.value.slice(page.value * size.value, (page.value + 1) * size.value));
watch([search, status, sort, size, locale], resetDisplay);
watch(() => props.refreshVersion, applyDisplay);
watch(() => props.shares.map(share => share.id).join(','), resetDisplay);
watch(() => props.shares.map(share => `${share.id}:${share.status}`).join(','), markChangedFilter);
watch(pages, value => {page.value = Math.min(page.value, value - 1);});

/** Apply current filters only for explicit controls or a replacement saved share
 * set. A confirmed settlement updates live text without removing its action row. */
function applyDisplay(): void {
    // Store display order alone; financial values remain owned by the read.
    selectedIds.value = filteredShares().map(share => share.id);
    refreshNeeded.value = false;
}
function resetDisplay(): void {page.value = 0; applyDisplay();}
function markChangedFilter(): void {if (status.value) refreshNeeded.value = true;}
function changePage(difference: number): void {page.value += difference; applyDisplay();}

/** Refresh list acknowledges even an unchanged result and reapplies deferred
 * status filtering. Its saved read remains owned by the parent section. */
function refreshDisplay(): void {
    if (props.disabled || props.pendingShareId) return;
    // Preserve the current page and focus; no command or implicit retry is sent.
    applyDisplay();
    refreshNotice.value++;
    emit('refresh');
}

/** A row action is available only through its organizer's explicit grant. The
 * reviewed component captures the signed share before any asynchronous write. */
function settle(share: Share): void {
    if (!props.admin || props.readOnly || !props.settlement || props.disabled || props.pendingShareId || Number(share.amount) === 0) return;
    // The parent owns the dialog lifetime; personal ledgers never emit commands.
    emit('settle', share);
}

/** Search only the admitted saved rows; sort by their existing balance without
 * deriving allocations or changing the complete totals/export accounting. */
function filteredShares(): Share[] {
    const needle = search.value.trim().toLocaleLowerCase();
    // Clone via filter before sorting so display state cannot mutate the query.
    return props.shares.filter(share => (!status.value || share.status === status.value)
        && (!needle || shareSearchText(share).toLocaleLowerCase().includes(needle)))
        .sort(compareShares);
}
/** Native amount ordering uses the displayed name as its stable tie-breaker;
 * case differences alone do not reorder otherwise equivalent names. */
function compareShares(left: Share, right: Share): number {
    const difference = Number(left.amount) - Number(right.amount);
    // Sort balances only when they differ, then retain the native name rule for
    // both equal balances and the explicit alphabetical ordering option.
    if (difference && sort.value === 'amount-desc') return -difference;
    if (difference && sort.value === 'amount-asc') return difference;
    return (props.admin ? left.payerName : left.poolName).localeCompare(
        props.admin ? right.payerName : right.poolName, locale.value, {sensitivity: 'base'});
}
/** Preserve each native ledger's searchable saved context without broadening
 * the rows or recalculating accounting from another participant's data. */
function shareSearchText(share: Share): string {
    // Organizer search includes applied covered names; personal search includes
    // its admitted pool description. Both retain saved calculation notes.
    const terms = props.admin ? [share.payerName, ...share.coveredNames]
        : [share.poolName, poolDescriptions.value.get(share.poolId) ?? ''];
    return [...terms, ...share.notes].join(' ');
}
function statusLabel(status: string): string {
    return status === 'due' ? messages.value.t('finance.due') : status === 'refund'
        ? messages.value.t('finance.refund') : messages.value.t('finance.settledFilter');
}
</script>

<template>
    <section
        v-if="shares.length"
        class="share-ledger border border-secondary-subtle rounded-3 p-3 mt-3"
        data-finance-shares
    >
        <!-- The parent supplies only admitted actions for these saved rows;
             this shared heading owns their responsive association with the ledger. -->
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3" data-finance-shares-heading>
            <h3 class="fs-6 mb-0">
                {{ messages.t(admin ? 'finance.calculatedShares' : 'finance.yourPoolShares') }}
                <span v-if="admin" class="badge bg-secondary ms-2" data-finance-payer-count>{{ messages.t('finance.payersCount', {count: shares.length}) }}</span>
            </h3>
            <div v-if="$slots.actions" class="pilot-action-row"><slot name="actions" /></div>
        </div>
        <p v-if="admin" class="text-secondary small">{{ messages.t('finance.statusDescribesPayer') }}</p>
        <StatusNotice v-if="refreshNotice" placement="notification" transient :renewal="refreshNotice" @dismiss="refreshNotice = 0">
            {{ messages.t('finance.theCurrentFiltersAndOrderingHaveBeenApplied') }}
        </StatusNotice>
        <div class="share-ledger-controls d-flex flex-wrap gap-2 mb-3">
            <FormField
                :id="`${id}-search`"
                v-model="search"
                type="search"
                class="mb-0 finance-filter-search"
                label-class="visually-hidden"
                control-class="form-control-sm"
                :label="messages.t('finance.searchShares')"
                :placeholder="messages.t(admin ? 'finance.searchPayersOrCalculationNotes' : 'finance.searchPoolsOrCalculationNotes')"
                :disabled="disabled || !!pendingShareId"
            />
            <label class="visually-hidden" :for="`${id}-status`">{{ messages.t('finance.filterShareStatus') }}</label>
            <select :id="`${id}-status`" v-model="status" class="form-select form-select-sm text-bg-dark" :disabled="disabled || !!pendingShareId">
                <option value="">{{ messages.t('finance.allStatuses') }}</option>
                <option v-for="value in ['due', 'refund', 'settled']" :key="value" :value="value">{{ statusLabel(value) }}</option>
            </select>
            <label class="visually-hidden" :for="`${id}-sort`">{{ messages.t(admin ? 'finance.sortShares' : 'finance.sortPools') }}</label>
            <select :id="`${id}-sort`" v-model="sort" class="form-select form-select-sm text-bg-dark" :disabled="disabled || !!pendingShareId">
                <option value="name">{{ messages.t(admin ? 'finance.payerAZ' : 'finance.poolAZ') }}</option>
                <option value="amount-desc">{{ messages.t('finance.amountHighToLow') }}</option>
                <option value="amount-asc">{{ messages.t('finance.amountLowToHigh') }}</option>
            </select>
            <label class="visually-hidden" :for="`${id}-size`">{{ messages.t('finance.sharesPerPage') }}</label>
            <select :id="`${id}-size`" v-model="size" class="form-select form-select-sm text-bg-dark" :disabled="disabled || !!pendingShareId">
                <option v-for="value in [25, 50, 100]" :key="value" :value="value">
                    {{ messages.t('finance.pageSizeOption', {count: value}) }}
                </option>
            </select>
        </div>
        <div class="table-responsive share-ledger-table">
            <table class="table table-dark table-hover align-middle mb-0">
                <caption v-if="admin" class="visually-hidden">{{ messages.t('finance.calculatedPayerSharesAndSettlementStatus') }}</caption>
                <thead>
                    <tr>
                        <th scope="col">{{ messages.t(admin ? 'finance.payer' : 'finance.pool') }}</th>
                        <th scope="col">{{ messages.t('finance.original') }}</th>
                        <th scope="col">{{ messages.t('finance.status') }}</th>
                        <th v-if="!readOnly" scope="col">{{ messages.t('finance.calculationDetails') }}</th>
                        <th v-if="admin && settlement && !readOnly" scope="col">{{ messages.t('finance.settlement') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="share in visible" :key="share.id" :data-finance-share="share.id">
                        <td :data-label="messages.t(admin ? 'finance.payer' : 'finance.pool')">
                            <strong class="d-block">{{ admin ? share.payerName : share.poolName }}</strong>
                            <!-- Organizer context warns once for the saved pool;
                                 personal ledgers retain their per-pool stale label. -->
                            <small v-if="!admin && share.needsRecalculation" class="text-warning d-block">
                                {{ messages.t('finance.recalculationRequired') }}
                            </small>
                            <small v-if="admin" class="text-secondary">
                                {{ !share.coverageKnown ? messages.t('finance.coverageInSavedNotes') : share.coveredNames.length ? share.coveredNames.join(', ') : messages.t('finance.ownShare') }}
                            </small>
                        </td>
                        <td :data-label="messages.t('finance.original')">
                            <strong class="fs-5">{{ financeMoney(share.amount, locale) }}</strong>
                            <small class="d-block text-secondary">{{ share.caption }}</small>
                        </td>
                        <td :data-label="messages.t('finance.status')">
                            <span
                                class="badge"
                                :class="share.status === 'settled' ? 'bg-success' : share.status === 'refund' ? 'bg-info text-dark' : 'bg-warning text-dark'"
                            >
                                {{ share.statusLabel }}
                            </span>
                            <small v-if="share.settledShareNotice" class="text-warning d-block mt-1">
                                {{ share.settledShareNotice.label }}
                            </small>
                        </td>
                        <td v-if="!readOnly" :data-label="messages.t('finance.calculationDetails')">
                            <ActionButton
                                variant="outline-light"
                                class="btn-sm"
                                :disabled="disabled || !!pendingShareId"
                                :aria-label="admin ? messages.t('finance.viewBreakdownFor', {payerName: share.payerName}) : messages.t('finance.viewBreakdownForPool', {poolName: share.poolName})"
                                @click="emit('inspect', share)"
                            >
                                <i class="bi bi-calculator me-1" aria-hidden="true"></i>
                                {{ messages.t('finance.viewBreakdown') }}
                            </ActionButton>
                        </td>
                        <td v-if="admin && settlement && !readOnly" :data-label="messages.t('finance.settlement')"
                            :class="Number(share.amount) === 0 ? 'd-none d-lg-table-cell' : undefined">
                            <!-- Stable keyed rows retain their compact control while
                                 the shared dialog command owns pending and recovery. -->
                            <ActionButton v-if="Number(share.amount) !== 0" variant="outline-light" class="btn-sm"
                                :disabled="disabled || !!pendingShareId"
                                :aria-label="`${messages.t(financeSettlementMessages(share).action)} · ${share.payerName}`"
                                :data-finance-settle="share.id" :aria-busy="pendingShareId === share.id" @click="settle(share)">
                                <span class="d-inline-block me-1" style="width: 1em" aria-hidden="true">
                                    <span v-if="pendingShareId === share.id" class="spinner-border spinner-border-sm" style="width: .875em; height: .875em" data-finance-settlement-pending></span>
                                    <i v-else class="bi" :class="share.isPaid ? 'bi-arrow-counterclockwise' : 'bi-check2-circle'"></i>
                                </span>
                                {{ messages.t(financeSettlementMessages(share).action) }}
                            </ActionButton>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="!visible.length" class="text-secondary small mb-0 py-3 text-center">{{ messages.t('finance.noSharesMatchTheseFilters') }}</p>
        <FinanceLedgerFooter
            :page="page"
            :size="size"
            :total="filtered.length"
            :pages="pages"
            :disabled="disabled || !!pendingShareId"
            :refresh-needed="refreshNeeded"
            :pending="refreshing"
            @previous="changePage(-1)"
            @next="changePage(1)"
            @refresh="refreshDisplay"
        />
    </section>
</template>
