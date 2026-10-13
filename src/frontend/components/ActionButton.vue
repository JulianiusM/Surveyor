<script setup lang="ts">
import {useClientInitialization} from '../app/context';

withDefaults(defineProps<{pending?: boolean; disabled?: boolean; variant?: string; type?: 'button' | 'submit'}>(),
    {pending: false, disabled: false, variant: 'primary', type: 'button'});
// Render actual disabled controls until their JS handlers have initialized. HTML
// navigation and Help GET submission retain their own ordinary anchors/buttons.
const initialized = useClientInitialization();
</script>

<template>
    <button :type="type" class="btn" :class="`btn-${variant}`" :disabled="disabled || pending || !initialized" :aria-busy="pending">
        <span v-if="pending" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <slot />
    </button>
</template>
