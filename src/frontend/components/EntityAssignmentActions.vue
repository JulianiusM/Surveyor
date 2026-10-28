<script setup lang="ts">
import ActionButton from './ActionButton.vue';

// Features supply their authoritative method availability, membership/capacity
// projection and optional Everyone label. This shared owner withholds personal
// commands without changing readable occupancy or retaining identity/tokens.
defineProps<{available: boolean; assigned: boolean; full: boolean; disabled: boolean; pending?: boolean; everyone?: string;
    assignLabel: string; removeLabel: string; fullLabel: string}>();
const emit = defineEmits<{toggle: []}>();
</script>

<template>
    <template v-if="assigned">
        <ActionButton v-if="available" class="btn-sm" variant="outline-danger" :disabled="disabled" :pending="pending"
            @click="emit('toggle')">{{ removeLabel }}</ActionButton>
        <span v-if="full" class="badge bg-secondary ms-1">{{ fullLabel }}</span>
    </template>
    <span v-else-if="everyone" class="badge bg-info ms-1">{{ everyone }}</span>
    <ActionButton v-else-if="available && !full" class="btn-sm" variant="outline-success" :disabled="disabled" :pending="pending"
        @click="emit('toggle')">{{ assignLabel }}</ActionButton>
    <span v-else-if="full" class="badge bg-secondary">{{ fullLabel }}</span>
</template>
