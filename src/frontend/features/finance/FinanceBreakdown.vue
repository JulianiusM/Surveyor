<script setup lang="ts">
import {computed, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {evictQueryFamilies} from '../../app/queryCache';
import {isReadDenial} from '../../app/transport';
import {useEventSection} from '../event/useEventSection';
import {useFinanceApi} from './api';
import {financeMoney} from './presentation';
import FinanceCalculation from './FinanceCalculation.vue';
import AppDialog from '../../components/AppDialog.vue';
import ActionButton from '../../components/ActionButton.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// Selection contains the admitted row identity only. Every explanation is loaded
// from its own protected saved-data read when the shared dialog is opened.
const props = defineProps<{eventId: string; share: components['schemas']['FinanceShare']; admin: boolean}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages, locale} = context;
const api = useFinanceApi(context);
const key = computed(() => [...eventKeys.financeBreakdown(context.session.value?.context, props.eventId, props.share.poolId, props.share.id, props.admin), locale.value]);
// Mounting is the lazy boundary; an open read-only explanation retains the same
// healthy saved-data refresh cadence as the visible Event subsections.
const section = useEventSection(key, read, computed(() => true));
defineExpose({refresh: section.refresh});
watch(section.query.error, retireDeniedBreakdown, {flush: 'sync'});
/** A row denial retires localized aliases of that exact selected payer, without
 * revoking an independently admitted pool/other payer representation. */
function retireDeniedBreakdown(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    // Keep this observer so explicit recovery still renders the validated denial.
    void evictQueryFamilies(context.queryClient, [eventKeys.financeBreakdown(context.session.value?.context,
        props.eventId, props.share.poolId, props.share.id, props.admin)], 'all', key.value);
}
function read(scope: Parameters<typeof api.breakdown>[4], signal: AbortSignal) {
    return api.breakdown(props.eventId, props.share.poolId, props.share.id, props.admin, scope, signal);
}
async function refresh(): Promise<void> {
    try { await section.refresh(); } catch { /* The query retains its own retry notice. */ }
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog"
        open
        :title="messages.t('finance.poolDialogTitle', {title: messages.t('finance.shareBreakdown'), name: share.poolName})"
        @close="emit('close')"
    >
        <h3 class="fs-6">{{ admin ? share.payerName : share.poolName }}</h3>
        <LoadingSkeleton v-if="section.loading.value" variant="form" :rows="3" />
        <StatusNotice
            v-if="section.query.error.value"
            :read-error="section.query.error.value"
            kind="warning"
            :retry-at="section.retryAt.value"
            :last-updated-at="section.updatedAt.value"
            :action="{state: section.readAction, label: messages.t('common.refresh')}"
            @action="refresh"
        >
            {{ section.failure.value }}
        </StatusNotice>
        <template v-if="section.data.value">
            <p v-if="section.data.value.settledShareNotice" class="small text-warning">
                {{ section.data.value.settledShareNotice.description }}
            </p>
            <dl class="invoice-share-breakdown small mt-3 mb-3">
                <template v-for="component in section.data.value.components" :key="component.key">
                    <dt>{{ component.label }}</dt>
                    <dd>{{ financeMoney(component.amount, locale) }}</dd>
                </template>
                <dt>{{ messages.t('finance.paymentStatus') }}</dt>
                <dd>{{ section.data.value.statusLabel }}</dd>
            </dl>
            <details class="small mb-3">
                <summary class="text-info">{{ section.data.value.calculation.title }}</summary>
                <div class="mt-3">
                    <FinanceCalculation :calculation="section.data.value.calculation" :show-title="false" />
                </div>
            </details>
            <details v-if="section.data.value.notes.length" class="small">
                <summary class="text-info">{{ messages.t('finance.calculationNotes') }}</summary>
                <ul class="ps-3 mt-2 mb-0">
                    <li v-for="(note, index) in section.data.value.notes" :key="index" class="text-secondary">{{ note }}</li>
                </ul>
            </details>
        </template>
        <template #footer>
            <ActionButton variant="secondary" @click="emit('close')">{{ messages.t('common.close') }}</ActionButton>
        </template>
    </AppDialog>
</template>
