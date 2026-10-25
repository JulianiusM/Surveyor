<script setup lang="ts">
import type {WeekDay, WeekInMonth} from '../../../types/SurveyTypes';
import {useFrontend} from '../../app/context';
import {weekdayMessages} from './presentation';

// Creation rows and the collaborative add form share the same recurring choices.
// Their parent owns the draft and removal lifecycle; this control never chooses
// dates, requests authority or persists an answer.
defineProps<{weekday: WeekDay; nthWeek: WeekInMonth; prefix: string; disabled?: boolean; creation?: boolean}>();
const emit = defineEmits<{'update:weekday': [value: WeekDay]; 'update:nthWeek': [value: WeekInMonth]}>();
const {messages} = useFrontend();
const weekdays: WeekDay[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const weeks: WeekInMonth[] = ['1', '2', '3', '4', 'LAST'];
</script>

<template>
    <component :is="creation ? 'td' : 'div'" :class="creation ? undefined : 'col-md-6'">
        <label v-if="!creation" class="form-label" :for="prefix + '-weekday'">
            {{ messages.t('survey.weekdayLabel') }}:
        </label>
        <select
            :id="prefix + '-weekday'"
            :name="creation ? prefix + '[weekday]' : 'weekday'"
            :value="weekday"
            class="form-select text-bg-dark"
            required
            :disabled="disabled"
            :aria-label="messages.t('survey.weekdayLabel')"
            @change="emit('update:weekday', ($event.target as HTMLSelectElement).value as WeekDay)"
        >
            <option v-for="day in weekdays" :key="day" :value="day">{{ messages.t(weekdayMessages[day]) }}</option>
        </select>
    </component>
    <component :is="creation ? 'td' : 'div'" :class="creation ? undefined : 'col-md-6'">
        <label v-if="!creation" class="form-label" :for="prefix + '-nth'">{{ messages.t('survey.dayInMonth') }}:</label>
        <select
            :id="prefix + '-nth'"
            :name="creation ? prefix + '[week]' : 'nthWeek'"
            :value="nthWeek"
            class="form-select text-bg-dark"
            required
            :disabled="disabled"
            :aria-label="messages.t(creation ? 'survey.weekOfMonth' : 'survey.dayInMonth')"
            @change="emit('update:nthWeek', ($event.target as HTMLSelectElement).value as WeekInMonth)"
        >
            <option v-for="week in weeks" :key="week" :value="week">{{ creation
                ? (week === 'LAST' ? messages.t('survey.last') : week)
                : week === 'LAST' ? messages.t('survey.lastDayInMonth') : messages.t('survey.nthDayInMonth', {nth: week}) }}</option>
        </select>
    </component>
</template>
