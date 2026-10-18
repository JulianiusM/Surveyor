<script setup lang="ts">
import type {EntityEventEditorProps} from '../../types/FrontendEntitySettingsTypes';
import {usePilot} from '../app/context';
import ActionButton from './ActionButton.vue';
import EventPicker from './EventPicker.vue';
import StatusNotice from './StatusNotice.vue';

// Relationship policy, confirmation, original/token capture and command recovery
// stay in the feature. The repeated native form receives their explicit state.
defineProps<EntityEventEditorProps>();
const emit = defineEmits<{'update:modelValue': [value: string | null]; review: []; save: [source: Event]}>();
const {messages} = usePilot();

/** Forward a deliberate picker choice without replacing the feature's original baseline. */
function chooseEvent(value: string | null): void {
    emit('update:modelValue', value);
}
</script>

<template>
    <h3 class="fs-5">{{ title }}</h3>
    <div data-command-feedback aria-live="polite"></div>
    <form @submit.prevent="emit('save', $event)">
        <EventPicker :model-value="modelValue" :source="source" :current="current"
            :prefix="prefix" inline :active="active" :disabled="disabled" @update:model-value="chooseEvent" />
        <p class="form-text">{{ hint }}</p>
        <p v-if="extraHint" class="form-text">{{ extraHint }}</p>
        <!-- Original/local/current values stay distinct until the feature explicitly reviews. -->
        <StatusNotice v-if="conflict" kind="warning"
            ><p>{{ messages.t('draft.readConflict') }}</p>
            <dl>
                <dt>{{ messages.t('draft.original') }}</dt>
                <dd>{{ original || messages.t('eventPicker.noEvent') }}</dd>
                <dt>{{ messages.t('draft.mine') }}</dt>
                <dd>{{ modelValue || messages.t('eventPicker.noEvent') }}</dd>
                <dt>{{ messages.t('draft.current') }}</dt>
                <dd>{{ current?.title || current?.id || messages.t('eventPicker.noEvent') }}</dd>
            </dl>
            <ActionButton variant="outline-warning" :disabled="disabled" @click="emit('review')">{{
                messages.t('draft.review')
            }}</ActionButton></StatusNotice
        >
        <ActionButton type="submit" :disabled="disabled || conflict">{{ submitLabel }}</ActionButton>
    </form>
</template>
