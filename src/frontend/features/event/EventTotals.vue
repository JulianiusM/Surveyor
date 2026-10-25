<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import {useFrontend} from '../../app/context';
import {eventDietaryLabel} from './presentation';

// Date totals and dietary totals share the badge layout. The controller
// supplies all counts; this presentation owner only omits zero-count badges.
const props = defineProps<{entries: components['schemas']['EventParticipants']['totals']; dates?: boolean}>();
const {messages} = useFrontend();
const entries = computed(() => props.entries.filter(entry => entry.count > 0));
</script>

<template>
    <!-- Counts remain server-owned. Date keys are civil dates; only dietary keys
         are localized, with the allergy/comment attention colors. -->
    <template v-for="entry in entries" :key="entry.key">
        <span class="badge text-bg-dark border me-1"
            :class="entry.key === 'ALLERGIES' ? 'border-danger-subtle' : entry.key === 'COMMENT' ? 'border-warning-subtle' : 'border-primary-subtile'">
            <span :class="entry.key === 'ALLERGIES' ? 'text-danger' : entry.key === 'COMMENT' ? 'text-warning' : 'text-white'">{{ dates ? entry.key : eventDietaryLabel(messages, entry.key) }}:</span> {{ entry.count }}
        </span>{{ ' ' }}
    </template>

    <span v-if="!entries.length" class="text-secondary">{{ messages.t('event.organizer.totalsEmpty') }}</span>
</template>
