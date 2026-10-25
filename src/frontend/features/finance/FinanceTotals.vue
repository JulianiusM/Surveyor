<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import {useFrontend} from '../../app/context';
import {financeMoney} from './presentation';
import FinanceCalculation from './FinanceCalculation.vue';

// Only the organizer read supplies whole-pool aggregates. Personal readers never
// receive this component's figures through their narrower finance projection.
defineProps<{pool: components['schemas']['FinancePool']}>();
const {messages, locale} = useFrontend();
</script>

<template>
    <div v-if="pool.summary" class="pool-totals border border-secondary-subtle rounded-3 p-3 bg-black">
        <div class="row g-3">
            <div v-for="metric in pool.summary.primary" :key="metric.key" class="col-6 col-lg-3">
                <small class="text-secondary d-block">{{ metric.label }}</small>
                <strong class="fs-4">{{ financeMoney(metric.amount, locale) }}</strong>
            </div>
        </div>
        <details v-if="pool.summary.details.length || pool.summary.saved.length || pool.calculation" class="mt-3 small">
            <summary class="text-info">{{ messages.t('finance.calculationBreakdown') }}</summary>
            <template v-if="pool.summary.details.length">
                <h4 class="fs-6 mt-3 mb-2">{{ messages.t('finance.currentPoolCosts') }}</h4>
                <dl class="invoice-share-breakdown small mt-3 mb-0">
                    <template v-for="metric in pool.summary.details" :key="metric.key">
                        <dt>{{ metric.label }}</dt>
                        <dd>{{ financeMoney(metric.amount, locale) }}</dd>
                    </template>
                </dl>
            </template>
            <template v-if="pool.calculation">
                <h4 class="fs-6 mt-3 mb-2">{{ messages.t('finance.savedCalculationInputs') }}</h4>
                <FinanceCalculation :calculation="pool.calculation" :show-title="false" />
            </template>
            <template v-if="pool.summary.saved.length">
                <h4 class="fs-6 mt-3 mb-2">{{ messages.t('finance.savedSettlementTotals') }}</h4>
                <dl class="invoice-share-breakdown small mb-0">
                    <template v-for="metric in pool.summary.saved" :key="metric.key">
                        <dt>{{ metric.label }}</dt>
                        <dd>{{ financeMoney(metric.amount, locale) }}</dd>
                    </template>
                </dl>
            </template>
        </details>
        <details v-if="pool.exampleCalculation?.sections.length" class="mt-3 small">
            <summary class="text-info">{{ messages.t('finance.poolCalculationExample') }}</summary>
            <div class="mt-3">
                <FinanceCalculation :calculation="pool.exampleCalculation" :show-title="false" />
            </div>
        </details>
        <p v-if="pool.needsRecalculation" class="text-warning small mt-2 mb-0">
            {{ messages.t('finance.poolTotalsReflectSavedChangesPaymentsDueAndRefunds') }}
        </p>
    </div>
</template>
