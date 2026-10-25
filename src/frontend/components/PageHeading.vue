<script setup lang="ts">
import type {FrontendPageHeadingProps} from '../../types/FrontendUiTypes';

// One balanced heading layout serves entity and account pages. Callers supply
// admitted text, parent navigation and actions; this owner changes no authority.
defineProps<FrontendPageHeadingProps>();
</script>

<template>
    <div class="frontend-page-heading p-3 gap-3">
        <div class="frontend-page-heading-parent"><slot name="parent" /></div>
        <h1 class="mb-0 text-center"><i v-if="icon" class="bi me-2" :class="icon" aria-hidden="true"></i>{{ title }}</h1>
        <div class="frontend-page-heading-actions frontend-action-row justify-content-end gap-2"><slot name="actions" /></div>
    </div>
</template>

<style scoped>
/* Intrinsic control tracks center short titles and give longer titles the
   remaining room. Every desktop caller keeps its independent actions beside it. */
.frontend-page-heading { display: grid; grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr); align-items: center; }
.frontend-page-heading > * { min-width: 0; }
.frontend-page-heading h1 { grid-column: 2; grid-row: 1; overflow-wrap: anywhere; }
.frontend-page-heading-parent { grid-column: 1; grid-row: 1; }
.frontend-page-heading-actions { grid-column: 3; grid-row: 1; }
.frontend-page-heading-parent:empty, .frontend-page-heading-actions:empty { display: none; }
@media (max-width: 767.98px) {
    .frontend-page-heading { grid-template-columns: minmax(0, 1fr); }
    .frontend-page-heading h1 { grid-column: 1 / -1; }
    .frontend-page-heading .frontend-page-heading-parent, .frontend-page-heading .frontend-page-heading-actions { grid-column: 1; grid-row: auto; justify-self: stretch; }
}
</style>
