<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {financeMoney} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import FinanceLedgerFooter from './FinanceLedgerFooter.vue';

type Share = components['schemas']['FinanceShare'];
// Organizer payer rows and personal pool rows share saved signed balances,
// display filters and paging. The server supplies status/caption/coverage facts.
const props = defineProps<{shares: Share[]; admin?: boolean; disabled?: boolean;
    pools?: Pick<components['schemas']['FinancePool'], 'id' | 'description'>[]}>();
const emit = defineEmits<{inspect: [share: Share]; refresh: []}>();
const {messages, locale} = usePilot();
const id = useId();
const search = ref('');
const status = ref('');
const sort = ref('name');
const size = ref(25);
const page = ref(0);
const poolDescriptions = computed(() => new Map((props.pools ?? []).map(pool => [pool.id, pool.description ?? ''])));
const filtered = computed(filteredShares);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const visible = computed(() => filtered.value.slice(page.value * size.value, (page.value + 1) * size.value));
watch([search, status, sort, size], () => {page.value = 0;});
watch(pages, value => {page.value = Math.min(page.value, value - 1);});

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
        <h3 class="fs-6 mb-3">
            {{ messages.t(admin ? 'finance.calculatedShares' : 'finance.yourPoolShares') }}
            <span v-if="admin" class="badge bg-secondary ms-2" data-finance-payer-count>{{ messages.t('finance.payersCount', {count: shares.length}) }}</span>
        </h3>
        <p v-if="admin" class="text-secondary small">{{ messages.t('finance.statusDescribesPayer') }}</p>
        <div class="share-ledger-controls d-flex flex-wrap gap-2 mb-3">
            <FormField
                :id="`${id}-search`"
                v-model="search"
                type="search"
                class="mb-0"
                label-class="visually-hidden"
                control-class="form-control-sm"
                :label="messages.t('finance.searchShares')"
                :placeholder="messages.t(admin ? 'finance.searchPayersOrCalculationNotes' : 'finance.searchPoolsOrCalculationNotes')"
            />
            <label class="visually-hidden" :for="`${id}-status`">{{ messages.t('finance.filterShareStatus') }}</label>
            <select :id="`${id}-status`" v-model="status" class="form-select form-select-sm text-bg-dark">
                <option value="">{{ messages.t('finance.allStatuses') }}</option>
                <option v-for="value in ['due', 'refund', 'settled']" :key="value" :value="value">{{ statusLabel(value) }}</option>
            </select>
            <label class="visually-hidden" :for="`${id}-sort`">{{ messages.t(admin ? 'finance.sortShares' : 'finance.sortPools') }}</label>
            <select :id="`${id}-sort`" v-model="sort" class="form-select form-select-sm text-bg-dark">
                <option value="name">{{ messages.t(admin ? 'finance.payerAZ' : 'finance.poolAZ') }}</option>
                <option value="amount-desc">{{ messages.t('finance.amountHighToLow') }}</option>
                <option value="amount-asc">{{ messages.t('finance.amountLowToHigh') }}</option>
            </select>
            <label class="visually-hidden" :for="`${id}-size`">{{ messages.t('finance.sharesPerPage') }}</label>
            <select :id="`${id}-size`" v-model="size" class="form-select form-select-sm text-bg-dark">
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
                        <th scope="col">{{ messages.t('finance.calculationDetails') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="share in visible" :key="share.id" :data-finance-share="share.id">
                        <td :data-label="messages.t(admin ? 'finance.payer' : 'finance.pool')">
                            <strong class="d-block">{{ admin ? share.payerName : share.poolName }}</strong>
                            <small v-if="share.needsRecalculation" class="text-warning d-block">
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
                        <td :data-label="messages.t('finance.calculationDetails')">
                            <ActionButton
                                variant="outline-light"
                                class="btn-sm"
                                :disabled="disabled"
                                :aria-label="admin ? messages.t('finance.viewBreakdownFor', {payerName: share.payerName}) : messages.t('finance.viewBreakdownForPool', {poolName: share.poolName})"
                                @click="emit('inspect', share)"
                            >
                                <i class="bi bi-calculator me-1" aria-hidden="true"></i>
                                {{ messages.t('finance.viewBreakdown') }}
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
            :disabled="disabled"
            @previous="page--"
            @next="page++"
            @refresh="emit('refresh')"
        />
    </section>
</template>
