<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import {weekdayMessages} from './presentation';

// Personal and shared result tables use one recurring-column presentation.
// A month position describes a pattern rather than a calculated calendar date.
defineProps<{combinations: components['schemas']['SurveyCombination'][]}>();
const {messages} = usePilot();

function heading(combination: components['schemas']['SurveyCombination']): string {
    const weekday = messages.value.t(weekdayMessages[combination.weekday]);
    return combination.nthWeek === 'LAST' ? messages.value.t('survey.lastCombination', {weekday})
        : messages.value.t('survey.nthCombination', {nth: combination.nthWeek, weekday});
}
</script>

<template>
    <th v-for="combination in combinations" :key="combination.id" class="text-center">{{ heading(combination) }}</th>
</template>
