<script setup lang="ts">
withDefaults(defineProps<{pending?: boolean; disabled?: boolean; variant?: string; type?: 'button' | 'submit'}>(),
    {pending: false, disabled: false, variant: 'primary', type: 'button'});
</script>

<template>
    <button :type="type" class="btn" :class="`btn-${variant}`" :disabled="disabled || pending" :aria-busy="pending">
        <span v-if="pending" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <slot />
    </button>
</template>
