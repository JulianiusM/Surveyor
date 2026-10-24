<script setup lang="ts">
import type {PilotPageHeadingProps} from '../../types/FrontendPilotUiTypes';

// One balanced heading layout serves entity and account pages. Callers supply
// admitted text, parent navigation and actions; this owner changes no authority.
withDefaults(defineProps<PilotPageHeadingProps>(), {separateActions: false, fillActionRow: false});
</script>

<template>
    <div class="pilot-page-heading p-3 gap-3" :class="{'pilot-page-heading-separated': separateActions,
        'pilot-page-heading-fill-actions': fillActionRow}">
        <div class="pilot-page-heading-parent"><slot name="parent" /></div>
        <h1 class="mb-0 text-center"><i v-if="icon" class="bi me-2" :class="icon" aria-hidden="true"></i>{{ title }}</h1>
        <div class="pilot-page-heading-actions d-flex align-items-center justify-content-end gap-2 flex-wrap"><slot name="actions" /></div>
    </div>
</template>

<style scoped>
/* Compact account headings reserve intrinsic control width rather than a fixed
   share of the title. Event administration uses native full title/action rows. */
.pilot-page-heading { display: grid; grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr); align-items: center; }
.pilot-page-heading > * { min-width: 0; }
.pilot-page-heading h1 { grid-column: 2; grid-row: 1; overflow-wrap: anywhere; }
.pilot-page-heading-parent { grid-column: 1; grid-row: 1; }
.pilot-page-heading-actions { grid-column: 3; grid-row: 1; }
.pilot-page-heading-parent:empty, .pilot-page-heading-actions:empty { display: none; }
.pilot-page-heading-separated { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.pilot-page-heading-separated h1 { grid-column: 1 / -1; }
.pilot-page-heading-separated .pilot-page-heading-parent { grid-row: 2; }
.pilot-page-heading-separated .pilot-page-heading-actions { grid-column: 2; grid-row: 2; }
.pilot-page-heading-separated .pilot-page-heading-parent:empty ~ .pilot-page-heading-actions { grid-column: 1 / -1; }
@media (max-width: 767.98px) {
    .pilot-page-heading { grid-template-columns: minmax(0, 1fr); }
    .pilot-page-heading h1 { grid-column: 1 / -1; }
    .pilot-page-heading .pilot-page-heading-parent, .pilot-page-heading .pilot-page-heading-actions { grid-column: 1; grid-row: auto; justify-self: center; }
    .pilot-page-heading-fill-actions .pilot-page-heading-parent, .pilot-page-heading-fill-actions .pilot-page-heading-actions { justify-self: stretch; }
}
</style>
