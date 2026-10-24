<script setup lang="ts">
import {usePilot} from '../../app/context';
import ActionButton from '../../components/ActionButton.vue';

// Matching histories and share ledgers retain their own filtering/paging state.
// This common footer renders only the supplied visible range and local actions.
withDefaults(defineProps<{page: number; size: number; total: number; pages: number;
    invoices?: boolean; coverage?: boolean; refreshable?: boolean; refreshNeeded?: boolean; disabled?: boolean; pending?: boolean}>(), {refreshable: true});
const emit = defineEmits<{previous: []; next: []; refresh: []}>();
const {messages} = usePilot();
</script>

<template>
    <div class="pilot-action-row justify-content-between mt-3">
        <small class="text-secondary" role="status">
            {{ messages.t('finance.pageSummary', {
            start: total ? page * size + 1 : 0, end: Math.min((page + 1) * size, total), total,
        }) }}
        </small>
        <ActionButton
            v-if="refreshable"
            :variant="refreshNeeded ? 'warning' : 'outline-light'"
            class="btn-sm"
            :pending="pending" :show-spinner="false"
            :disabled="disabled"
            data-finance-ledger-refresh
            @click="emit('refresh')"
        >
            {{ messages.t('finance.refreshList') }}
        </ActionButton>
        <div
            class="btn-group btn-group-sm"
            role="group"
            :aria-label="messages.t(coverage ? 'finance.takeoverPages' : invoices ? 'finance.invoicePages' : 'finance.sharePages')"
        >
            <ActionButton variant="outline-light" :disabled="disabled || page === 0" @click="emit('previous')">
                {{ messages.t('finance.previous2') }}
            </ActionButton>
            <ActionButton variant="outline-light" :disabled="disabled || page + 1 >= pages" @click="emit('next')">
                {{ messages.t('finance.next') }}
            </ActionButton>
        </div>
    </div>
</template>
