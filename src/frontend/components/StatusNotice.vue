<script setup lang="ts">
withDefaults(defineProps<{kind?: 'info' | 'warning' | 'danger' | 'success'; noMargin?: boolean; marginBottom?: 0 | 3 | 4}>(), {kind: 'info', noMargin: false, marginBottom: 3});
</script>

<template>
    <div class="status-notice" :class="[`alert-${kind}`, `mb-${noMargin ? 0 : marginBottom}`]" :role="kind === 'danger' ? 'alert' : 'status'">
        <slot />
    </div>
</template>
