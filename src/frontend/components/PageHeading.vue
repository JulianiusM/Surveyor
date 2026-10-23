<script setup lang="ts">
// One balanced heading layout serves entity and account pages. Callers supply
// admitted text, parent navigation and actions; this owner changes no authority.
defineProps<{title: string; icon?: string}>();
</script>

<template>
    <div class="pilot-page-heading p-3 gap-3">
        <div class="pilot-page-heading-parent"><slot name="parent" /></div>
        <h1 class="mb-0 text-center"><i v-if="icon" class="bi me-2" :class="icon" aria-hidden="true"></i>{{ title }}</h1>
        <div class="pilot-page-heading-actions d-flex align-items-center justify-content-end gap-2 flex-wrap"><slot name="actions" /></div>
    </div>
</template>

<style scoped>
/* Equal side tracks keep the title centered even with different action widths. */
.pilot-page-heading { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr); align-items: center; }
.pilot-page-heading > * { min-width: 0; }
.pilot-page-heading h1 { overflow-wrap: anywhere; }
@media (max-width: 767.98px) {
    .pilot-page-heading { grid-template-columns: minmax(0, 1fr); }
    .pilot-page-heading h1 { grid-row: 1; }
    .pilot-page-heading-parent:empty, .pilot-page-heading-actions:empty { display: none; }
    .pilot-page-heading-parent, .pilot-page-heading-actions { justify-self: center; }
}
</style>
