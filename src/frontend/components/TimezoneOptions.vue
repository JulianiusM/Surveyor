<script setup lang="ts">
import {computed} from 'vue';
import {usePilot} from '../app/context';

// Inline and standalone picker hosts render the same native search/chip/list
// controls. The picker retains presentation search and the feature owns its zone.
const props = defineProps<{id: string; search: string; zones: string[]; common: string[]; selected: string;
    label: (zone: string) => string; disabled?: boolean}>();
const emit = defineEmits<{'update:search': [value: string]; choose: [zone: string]}>();
const {messages} = usePilot();
const matches = computed(() => props.zones.filter(zone => zone.toLowerCase().includes(props.search.trim().toLowerCase())));
const displayed = computed(() => matches.value.slice(0, 200));
</script>

<template>
    <label class="form-label small" :for="id + '-search'">{{ messages.t('timezone.search') }}</label>
    <div class="input-group mb-2"><span class="input-group-text text-bg-dark"><i class="bi bi-search" aria-hidden="true"></i></span>
        <input :id="id + '-search'" :value="search" class="form-control text-bg-dark" type="search" autocomplete="off" inputmode="search"
            :placeholder="messages.t('timezone.placeholder')" :disabled="disabled" @keydown.enter.prevent
            @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
    </div>
    <details class="mb-2"><summary class="small">{{ messages.t('timezone.common') }}</summary><div class="d-flex flex-wrap gap-1 mt-2">
        <button v-for="zone in common" :key="zone" type="button" class="btn btn-sm btn-outline-light" :disabled="disabled"
            :aria-pressed="zone === selected" @click="emit('choose', zone)">{{ label(zone) }}</button>
    </div></details>
    <ul class="list-group list-group-flush text-bg-dark overflow-auto" style="max-height: 15rem">
        <li v-for="zone in displayed" :key="zone" class="list-group-item text-bg-dark"><button type="button"
            class="btn btn-outline-light text-start w-100" :disabled="disabled" :aria-pressed="zone === selected"
            @click="emit('choose', zone)">{{ label(zone) }}</button></li>
        <li v-if="!matches.length" class="list-group-item text-bg-dark">{{ messages.t('timezone.noMatches') }}</li>
    </ul>
    <p class="small text-secondary mt-2 mb-0" aria-live="polite">{{ matches.length > displayed.length
        ? messages.t('timezone.truncated', {shown: displayed.length, count: matches.length}) : messages.t('timezone.count', {count: displayed.length}) }}</p>
</template>
