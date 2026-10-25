<script setup lang="ts">
import type {FrontendActionState} from '../../types/FrontendUiTypes';
import {useFrontend} from '../app/context';
import ActionButton from './ActionButton.vue';

// The feature retains read admission, pending state, cooldown and recovery.
// Desktop uses the compact heading action; phones use the same complete button
// row as other actions. Hidden startup presentation retains this exact node.
defineProps<{state: FrontendActionState; showLabel?: boolean}>();
const emit = defineEmits<{refresh: []}>();
const {messages, hydrated} = useFrontend();
</script>

<template>
    <ActionButton v-show="hydrated" class="frontend-refresh-button btn-sm flex-shrink-0" variant="outline-secondary" :state="state"
        :aria-label="messages.t('common.refresh')" :title="messages.t('common.refresh')" @click="emit('refresh')">
        <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
        <span class="ms-1" :class="{'d-md-none': !showLabel}">{{ messages.t('common.refresh') }}</span>
    </ActionButton>
</template>

<style scoped>
/* Keep the compact button's normal hit area while its icon font is loading. */
.frontend-refresh-button { min-width: 1.9375rem; min-height: 1.9375rem; }
@media (max-width: 767.98px) {
    /* Bootstrap's normal button metrics apply even to a standalone Refresh.
       The existing action-row owner supplies its placement and spacing. */
    .frontend-refresh-button { width: 100%; --bs-btn-padding-y: .375rem; --bs-btn-padding-x: .75rem;
        --bs-btn-font-size: 1rem; --bs-btn-border-radius: var(--bs-border-radius); }
}
</style>
