<script setup lang="ts">
import type {PilotActionState} from '../../types/FrontendPilotUiTypes';
import ActionButton from './ActionButton.vue';

// A feature supplies its optional hint, read state and refresh operation. The
// toolbar owns their shared presentation, never read admission or reconciliation.
defineProps<{hint?: string; refreshLabel: string; state: PilotActionState}>();
const emit = defineEmits<{refresh: []}>();
</script>

<template>
    <!-- Lists retain their original hint row inside the scrolling container;
         Survey supplies no hint and keeps its end-aligned interstitial row.
         Both stay present before data arrives, without another layout wrapper. -->
    <div class="d-flex mb-1" :class="hint !== undefined ? 'justify-content-between align-items-center' : 'justify-content-end'">
        <small v-if="hint !== undefined" class="text-info fst-italic fw-light">{{ hint }}</small>
        <ActionButton class="btn-sm" :class="{'ms-auto': hint !== undefined}" variant="outline-secondary" :state="state"
            :aria-label="refreshLabel" :title="refreshLabel" @click="emit('refresh')"
            ><i class="bi bi-arrow-clockwise" aria-hidden="true"></i
        ></ActionButton>
    </div>
</template>
