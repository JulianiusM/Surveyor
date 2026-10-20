<script setup lang="ts">
import type {components} from '../../../types/api/v1';

// The existing presenter supplies every saved value, label and equation. This
// escaped renderer is shared by pool examples and personal payer explanations.
withDefaults(defineProps<{calculation: components['schemas']['FinanceCalculation']; showTitle?: boolean}>(), {showTitle: true});
</script>

<template>
    <div class="invoice-calculation" data-calculation-display>
        <h6 v-if="showTitle" class="mb-2">{{ calculation.title }}</h6>
        <p v-if="calculation.description" class="small text-secondary mb-3">{{ calculation.description }}</p>
        <section
            v-for="section in calculation.sections"
            :key="section.key"
            class="invoice-calculation-section mt-3"
            :data-calculation-section="section.key"
        >
            <h6 class="mb-2">{{ section.title }}</h6>
            <p v-if="section.description" class="small text-secondary mb-2">{{ section.description }}</p>
            <ul v-if="section.items?.length" class="small text-secondary ps-3 mb-2">
                <li v-for="(item, index) in section.items" :key="index">{{ item }}</li>
            </ul>
            <dl v-if="section.metrics?.length" class="invoice-share-breakdown small mb-2">
                <template v-for="(metric, index) in section.metrics" :key="index">
                    <dt>{{ metric.label }}</dt>
                    <dd>{{ metric.value }}</dd>
                </template>
            </dl>
            <template v-if="section.formula">
                <div
                    class="invoice-calculation-formula d-flex flex-wrap align-items-end gap-2 p-3 border border-secondary-subtle rounded-3 bg-black"
                    role="group"
                    :aria-label="section.formula.result.label"
                >
                    <template v-for="(term, index) in section.formula.terms" :key="index">
                        <span v-if="term.operator" class="invoice-calculation-operator align-self-center">{{ term.operator }}</span>
                        <div class="invoice-calculation-term d-flex flex-column">
                            <strong>{{ term.value.startsWith('-') ? `(${term.value})` : term.value }}</strong>
                            <small class="text-secondary">{{ term.label }}</small>
                        </div>
                    </template>
                    <span class="invoice-calculation-operator align-self-center">=</span>
                    <div class="invoice-calculation-term invoice-calculation-result d-flex flex-column">
                        <strong class="text-info">{{ section.formula.result.value }}</strong>
                        <small class="text-secondary">{{ section.formula.result.label }}</small>
                    </div>
                </div>
                <p v-if="section.formula.note" class="small text-secondary mt-2 mb-0">{{ section.formula.note }}</p>
            </template>
        </section>
    </div>
</template>
