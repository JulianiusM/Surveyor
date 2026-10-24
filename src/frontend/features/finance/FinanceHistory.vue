<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {financeDate, financeMoney, invoiceStatus, invoiceStatusClass} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import FinanceLedgerFooter from './FinanceLedgerFooter.vue';

type Invoice = components['schemas']['FinanceInvoice'];
// Both audiences receive their server-authorized records. Filters affect this
// display only; proof access and participant commands keep their own authority.
const props = defineProps<{invoices: Invoice[]; admin?: boolean; disabled?: boolean; readOnly?: boolean;
    refreshing?: boolean; closingInvoiceId?: string | null}>();
const emit = defineEmits<{retract: [invoice: Invoice]; closeInvoice: [invoice: Invoice]; refresh: [];
    review: [invoice: Invoice, action: 'approve' | 'decline' | 'revise' | 'reject' | 'close']}>();
const {messages, locale} = usePilot();
const id = useId();
const search = ref('');
const status = ref('');
const pageSize = ref(25);
const page = ref(0);
const statuses = ['NEW', 'APPROVED', 'REJECTED', 'CLOSED', 'RETRACTED'];
const filtered = computed(filteredInvoices);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const visible = computed(() => filtered.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value));
watch([search, status, pageSize], () => {page.value = 0;});
watch(pages, value => {page.value = Math.min(page.value, value - 1);});

/** Match saved original, corrected and attribution evidence without interpreting
 * its text as markup; newest invoice rows retain the native history ordering. */
function filteredInvoices(): Invoice[] {
    const needle = search.value.trim().toLocaleLowerCase();
    // Presentation searches all admitted records before paging, including audit
    // fields hidden inside a corrected row's secondary text.
    return props.invoices.filter(invoice => (!status.value || invoice.status === status.value)
        && (!needle || [invoice.id, invoice.poolName, invoice.participantName, invoice.participantEmail,
            invoice.organizerRecorded ? recorderName(invoice) : '',
            props.admin && invoice.participantName === null ? messages.value.t('finance.poolExpense') : '',
            invoice.amount, invoice.description, invoice.correctedAmount, invoice.correctedDescription,
            invoice.rejectionReason].join(' ').toLocaleLowerCase().includes(needle)))
        .sort((left, right) => (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0));
}
/** Retain the native recorder fallback even when a historic organizer's saved
 * name is absent; paid-by attribution remains a separate invoice field. */
function recorderName(invoice: Invoice): string {
    return invoice.recordedByName || messages.value.t('finance.organizer');
}
</script>

<template>
    <section class="invoice-ledger border border-secondary-subtle rounded-3 bg-black p-3 mt-3" data-finance-history>
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
                    class="mb-0"
                    label-class="visually-hidden"
                    control-class="form-control-sm invoice-ledger-search"
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
                    <tr v-for="invoice in visible" :key="invoice.id" :data-finance-invoice="invoice.id">
                        <td :data-label="messages.t('finance.invoice2')">
                            <strong>{{ messages.t('finance.invoiceReference', {id: invoice.id}) }}</strong>
                            <small class="text-secondary d-block">
                                {{ admin ? messages.t(invoice.organizerRecorded ? 'finance.recordedDate' : 'finance.submittedDate', {date: financeDate(invoice.createdAt, locale)}) : financeDate(invoice.createdAt, locale) }}
                            </small>
                            <small v-if="invoice.organizerRecorded" class="text-secondary d-block">
                                {{ messages.t('finance.recordedBy', {participantName: recorderName(invoice)}) }}
                            </small>
                        </td>
                        <td :data-label="messages.t(admin ? 'finance.participantSource' : 'finance.pool')">
                            <strong v-if="admin" class="d-block">{{ invoice.participantName ?? messages.t('finance.poolExpense') }}</strong>
                            <template v-else>{{ invoice.poolName }}</template>
                            <small v-if="admin && invoice.participantEmail" class="text-secondary">{{ invoice.participantEmail }}</small>
                        </td>
                        <td :data-label="messages.t(admin ? 'finance.submittedDetails' : 'finance.amount')">
                            <template v-if="admin">
                                <strong class="d-block">{{ financeMoney(invoice.amount, locale) }}</strong>
                                <small class="text-secondary invoice-description">
                                    {{ invoice.description || messages.t('finance.noDescription') }}
                                </small>
                            </template>
                            <template v-else>
                                <strong class="d-block">{{ financeMoney(invoice.correctedAmount ?? invoice.amount, locale) }}</strong>
                                <small v-if="invoice.correctedAmount !== null" class="text-secondary">
                                    {{ messages.t('finance.original2', {fmtMoney: financeMoney(invoice.amount, locale)}) }}
                                </small>
                            </template>
                        </td>
                        <td
                            class="invoice-cell-wide"
                            :data-label="messages.t(admin ? 'finance.organizerReview' : 'finance.description')"
                        >
                            <template v-if="admin">
                                <strong v-if="invoice.correctedAmount !== null" class="d-block">
                                    {{ financeMoney(invoice.correctedAmount, locale) }}
                                </strong>
                                <small v-if="invoice.correctedDescription !== null" class="d-block invoice-description">
                                    {{ invoice.correctedDescription }}
                                </small>
                                <span
                                    v-if="invoice.correctedAmount === null && invoice.correctedDescription === null"
                                    class="text-secondary small"
                                >
                                    {{ messages.t('finance.noCorrections') }}
                                </span>
                            </template>
                            <template v-else>
                                <span class="d-block invoice-description">
                                    {{ (invoice.correctedDescription ?? invoice.description) || messages.t('finance.noDescription') }}
                                </span>
                                <small
                                    v-if="invoice.correctedDescription !== null && invoice.description"
                                    class="text-secondary d-block"
                                >
                                    {{ messages.t('finance.originalDescription', {description: invoice.description}) }}
                                </small>
                            </template>
                        </td>
                        <td :data-label="messages.t('finance.status')">
                            <span class="badge" :class="invoiceStatusClass(invoice.status)">{{ invoiceStatus(invoice.status, messages) }}</span>
                            <small v-if="invoice.rejectionReason" class="text-danger-emphasis d-block mt-2">
                                {{ messages.t('finance.reason') }}
                                {{ invoice.rejectionReason }}
                            </small>
                        </td>
                        <td :data-label="messages.t('finance.proof')">
                            <a
                                v-if="invoice.proofUrl"
                                class="text-info"
                                :href="invoice.proofUrl"
                                :title="invoice.proofOriginalName || messages.t('finance.invoiceProof')"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {{ messages.t('finance.viewProof') }}
                            </a>
                            <span v-else class="text-secondary">
                                {{ messages.t(invoice.organizerRecorded && !invoice.proofOriginalName ? 'finance.noProofAttached' : 'finance.proofExpired') }}
                            </span>
                        </td>
                        <td v-if="admin && !readOnly" class="invoice-cell-actions" :data-label="messages.t('finance.actions')">
                            <!-- The admitted organizer projection supplies these
                                 review states; the server independently checks
                                 every method and child identity on submission. -->
                            <div class="pilot-action-row gap-1">
                                <template v-if="invoice.status === 'NEW'">
                                    <ActionButton variant="success" class="btn-sm" :disabled="disabled" @click="emit('review', invoice, 'approve')">{{ messages.t('finance.accept') }}</ActionButton>
                                    <ActionButton variant="outline-danger" class="btn-sm" :disabled="disabled" @click="emit('review', invoice, 'decline')">{{ messages.t('finance.reject') }}</ActionButton>
                                </template>
                                <template v-else-if="invoice.status === 'APPROVED' || invoice.status === 'CLOSED'">
                                    <ActionButton variant="outline-light" class="btn-sm" :disabled="disabled" @click="emit('review', invoice, 'revise')">{{ messages.t('finance.correct') }}</ActionButton>
                                    <ActionButton variant="outline-danger" class="btn-sm" :disabled="disabled" @click="emit('review', invoice, 'reject')">{{ messages.t('finance.rejectFromPool') }}</ActionButton>
                                    <ActionButton v-if="invoice.status === 'APPROVED'" variant="outline-light" class="btn-sm" :disabled="disabled" @click="emit('review', invoice, 'close')">{{ messages.t('common.close') }}</ActionButton>
                                </template>
                                <span v-else class="text-secondary small">{{ messages.t('finance.noActions') }}</span>
                            </div>
                        </td>
                        <td v-else-if="!readOnly" class="invoice-cell-actions" :data-label="messages.t('finance.actions')">
                            <ActionButton
                                v-if="invoice.canRetract"
                                variant="outline-danger"
                                class="btn-sm"
                                :disabled="disabled"
                                @click="emit('retract', invoice)"
                            >
                                {{ messages.t('finance.retract') }}
                            </ActionButton>
                            <ActionButton
                                v-else-if="invoice.canClose"
                                :pending="closingInvoiceId === invoice.id" :show-spinner="false"
                                variant="outline-success"
                                class="btn-sm"
                                :disabled="disabled"
                                @click="emit('closeInvoice', invoice)"
                            >
                                {{ messages.t('common.close') }}
                            </ActionButton>
                            <span v-else class="text-secondary small">{{ messages.t('finance.noActions') }}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="!visible.length" class="text-secondary small py-3 text-center mb-0">
            {{ messages.t(invoices.length ? 'finance.noInvoicesMatchTheseFilters' : 'finance.noInvoicesYet') }}
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
</template>
