<script setup lang="ts">
import ActionButton from './ActionButton.vue';

// Features supply their membership/capacity projection and optional
// Everyone label. No driver/participant identity or command token is retained.
defineProps<{assigned: boolean; full: boolean; disabled: boolean; pending?: boolean; everyone?: string;
    assignLabel: string; removeLabel: string; fullLabel: string}>();
const emit = defineEmits<{toggle: []}>();
</script>

<template>
    <template v-if="assigned">
        <ActionButton class="btn-sm" variant="outline-danger" :disabled="disabled" :pending="pending" :show-spinner="false"
            @click="emit('toggle')">{{ removeLabel }}</ActionButton>
        <span v-if="full" class="badge bg-secondary ms-1">{{ fullLabel }}</span>
    </template>
    <span v-else-if="everyone" class="badge bg-info ms-1">{{ everyone }}</span>
    <ActionButton v-else-if="!full" class="btn-sm" variant="outline-success" :disabled="disabled" :pending="pending" :show-spinner="false"
        @click="emit('toggle')">{{ assignLabel }}</ActionButton>
    <span v-else class="badge bg-secondary">{{ fullLabel }}</span>
</template>
