<script setup lang="ts">
import type {PilotActionState} from '../../types/FrontendPilotUiTypes';
import {usePilot} from '../app/context';
import ActionButton from './ActionButton.vue';

// The feature retains read admission, pending state, cooldown and recovery.
// This compact action fits the owning heading or existing section controls.
defineProps<{state: PilotActionState; showLabel?: boolean}>();
const emit = defineEmits<{refresh: []}>();
const {messages} = usePilot();
</script>

<template>
    <ActionButton class="pilot-refresh-button btn-sm flex-shrink-0" variant="outline-secondary" :state="state"
        :aria-label="messages.t('common.refresh')" :title="messages.t('common.refresh')" @click="emit('refresh')">
        <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        <span v-if="showLabel" class="ms-1">{{ messages.t('common.refresh') }}</span>
    </ActionButton>
</template>

<style scoped>
/* Keep the compact button's normal hit area while its icon font is loading. */
.pilot-refresh-button { min-width: 1.9375rem; min-height: 1.9375rem; }
</style>
