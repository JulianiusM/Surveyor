<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {FinanceHistoryProps} from '../../../types/FrontendFinanceReviewTypes';
import {useFrontend} from '../../app/context';
import {invoiceStatus, invoiceStatusClass} from './presentation';
import FormField from '../../components/FormField.vue';
import FinanceLedgerFooter from './FinanceLedgerFooter.vue';
import FinanceInvoiceRow from './FinanceInvoiceRow.vue';

type Invoice = components['schemas']['FinanceInvoice'];
// Both audiences receive their server-authorized records. Filters affect this
// display only; proof access and participant commands keep their own authority.
const props = defineProps<FinanceHistoryProps>();
const emit = defineEmits<{retract: [invoice: Invoice]; closeInvoice: [invoice: Invoice]; refresh: [];
    review: [invoice: Invoice, action: 'approve' | 'decline' | 'revise' | 'reject' | 'close']}>();
const context = useFrontend();
const {messages} = context;
const id = useId();
const search = ref('');
const status = ref('');
const pageSize = ref(25);
const page = ref(0);
const statuses = ['NEW', 'APPROVED', 'REJECTED', 'CLOSED', 'RETRACTED'];
const ordered = computed(orderedInvoices);
// Locale-only reads retain lexical input. Actor/source/audience retirement must
// remount the rows even if another actor's same-resource cache is already warm.
const rowSource = computed(() => [context.epoch.value, context.session.value?.context, props.eventId,
    props.pool?.id, !!props.admin, !!props.readOnly].join(':'));
const filtered = computed(filteredInvoices);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const visible = computed(() => filtered.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value));
watch([search, status, pageSize], () => {page.value = 0;});
watch(pages, value => {page.value = Math.min(page.value, value - 1);});

/** Match saved original, corrected and attribution evidence without interpreting
 * its text as markup; newest invoice rows retain the history ordering. */
function filteredInvoices(): Invoice[] {
    const needle = search.value.trim().toLocaleLowerCase();
    // Presentation searches all admitted records before paging, including audit
    // fields hidden inside a corrected row's secondary text.
    return ordered.value.filter(invoice => (!status.value || invoice.status === status.value)
        && (!needle || [invoice.id, invoice.poolName, invoice.participantName, invoice.participantEmail,
            invoice.organizerRecorded ? recorderName(invoice) : '',
            props.admin && invoice.participantName === null ? messages.value.t('finance.poolExpense') : '',
            invoice.amount, invoice.description, invoice.correctedAmount, invoice.correctedDescription,
            invoice.rejectionReason].join(' ').toLocaleLowerCase().includes(needle)));
}
/** Render the same newest-first complete set which filtering and paging admit. */
function orderedInvoices(): Invoice[] {
    // Copy the array for presentation; never reorder the admitted query value.
    return [...props.invoices].sort(newestInvoiceFirst);
}
function newestInvoiceFirst(left: Invoice, right: Invoice): number {
    return (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0);
}
/** Retain the recorder fallback even when a historic organizer's saved
 * name is absent; paid-by attribution remains a separate invoice field. */
function recorderName(invoice: Invoice): string {
    return invoice.recordedByName || messages.value.t('finance.organizer');
}
</script>

<template>
    <!-- A genuinely empty admitted history has the audience-specific
         message alone. Keep its ledger mounted so fresh snapshots retain the
         same filter controls and local input, including filtered-empty views. -->
    <section v-show="invoices.length > 0" class="invoice-ledger border border-secondary-subtle rounded-3 bg-black p-3 mt-3" data-finance-history>
        <div class="invoice-ledger-toolbar d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div class="d-flex flex-wrap align-items-center gap-2">
                <h3 class="fs-6 mb-0">{{ messages.t(admin ? 'finance.invoiceAdministration' : 'finance.yourInvoiceHistory') }}</h3>
                <span class="badge bg-secondary">{{ messages.t('finance.total', {length: invoices.length}) }}</span>
                <template v-for="state in statuses" :key="state">
                    <span
                        v-if="invoices.some(invoice => invoice.status === state)"
                        class="badge"
                        :class="invoiceStatusClass(state)"
                    >
                        {{ invoices.filter(invoice => invoice.status === state).length }}
                        {{ invoiceStatus(state, messages) }}
                    </span>
                </template>
            </div>
            <div class="invoice-ledger-controls d-flex flex-wrap gap-2">
                <FormField
                    :id="`${id}-search`"
                    v-model="search"
                    type="search"
                    class="mb-0 finance-filter-search invoice-ledger-search"
                    label-class="visually-hidden"
                    control-class="form-control-sm"
                    :label="messages.t('finance.searchInvoices')"
                    :placeholder="messages.t('finance.searchInvoices')"
                />
                <label class="visually-hidden" :for="`${id}-status`">{{ messages.t('finance.filterInvoiceStatus') }}</label>
                <select :id="`${id}-status`" v-model="status" class="form-select form-select-sm text-bg-dark">
                    <option value="">{{ messages.t('finance.allStatuses') }}</option>
                    <option v-for="state in statuses" :key="state" :value="state">{{ invoiceStatus(state, messages) }}</option>
                </select>
                <label class="visually-hidden" :for="`${id}-size`">{{ messages.t('finance.invoicesPerPage') }}</label>
                <select :id="`${id}-size`" v-model="pageSize" class="form-select form-select-sm text-bg-dark">
                    <option v-for="size in [25, 50, 100]" :key="size" :value="size">
                        {{ messages.t('finance.pageSizeOption', {count: size}) }}
                    </option>
                </select>
            </div>
        </div>
        <div class="table-responsive invoice-ledger-table">
            <table class="table table-dark table-hover align-middle mb-0">
                <thead>
                    <tr>
                        <th>{{ messages.t('finance.invoice2') }}</th>
                        <th>{{ messages.t(admin ? 'finance.participantSource' : 'finance.pool') }}</th>
                        <th>{{ messages.t(admin ? 'finance.submittedDetails' : 'finance.amount') }}</th>
                        <th>{{ messages.t(admin ? 'finance.organizerReview' : 'finance.description') }}</th>
                        <th>{{ messages.t('finance.status') }}</th>
                        <th>{{ messages.t('finance.proof') }}</th>
                        <th v-if="!readOnly">{{ messages.t('finance.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <!-- Every admitted row keeps one lifetime through filters,
                         paging and saved status updates. No private row survives
                         removal from the admitted source/audience. -->
                    <FinanceInvoiceRow v-for="invoice in ordered" :key="`${rowSource}:${invoice.id}`"
                        :invoice="invoice" :visible="visible.includes(invoice)" :recorder-name="recorderName(invoice)"
                        :admin="admin" :read-only="readOnly" :disabled="disabled"
                        :event-id="eventId" :pool="pool" :refresh-saved="refreshSaved"
                        @retract="emit('retract', $event)" @close-invoice="emit('closeInvoice', $event)"
                        @review="(row, action) => emit('review', row, action)" />
                </tbody>
            </table>
        </div>
        <p v-if="!visible.length" class="text-secondary small py-3 text-center mb-0">
            {{ messages.t('finance.noInvoicesMatchTheseFilters') }}
        </p>
        <FinanceLedgerFooter
            class="invoice-ledger-footer"
            :page="page"
            :size="pageSize"
            :total="filtered.length"
            :pages="pages"
            :disabled="disabled"
            invoices
            :pending="refreshing"
            @previous="page--"
            @next="page++"
            @refresh="emit('refresh')"
        />
    </section>
    <p v-if="!invoices.length" class="text-secondary mb-0" :class="admin ? 'mt-3' : 'small'" data-finance-history-empty>
        {{ messages.t(admin ? 'finance.noInvoicesYet' : 'finance.youHaveNotSubmittedAnyInvoicesYet') }}
    </p>
</template>
