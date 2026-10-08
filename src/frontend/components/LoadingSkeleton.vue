<script setup lang="ts">
import {computed} from 'vue';
import {usePilot} from '../app/context';

const props = withDefaults(
    defineProps<{
        variant?: 'lines' | 'form' | 'table' | 'cards' | 'article';
        rows?: number;
        label?: string;
    }>(),
    {variant: 'lines', rows: 3},
);
const {messages} = usePilot();
// Rows describe decorative repetition, never an authoritative record/field count.
// Keep malformed optional values from producing an empty or infinite Vue range.
const count = computed(() => Number.isFinite(props.rows) ? Math.max(1, Math.floor(props.rows)) : 3);
</script>

<template>
    <span class="pilot-skeleton" :data-loading-skeleton="variant">
        <!-- Phrasing wrappers also fit compact badges/paragraphs without the HTML parser
             relocating them before hydration. Shared CSS owns the block/grid geometry. -->
        <!-- Announce the loading region once. Placeholder geometry has no authority,
             focus targets or accessible field/table semantics of its own. -->
        <span class="visually-hidden" role="status">{{ label ?? messages.t('common.loading') }}</span>
        <span class="pilot-skeleton-shapes" :class="'pilot-skeleton-' + variant" aria-hidden="true">
            <template v-if="variant === 'form'">
                <span v-for="row in count" :key="row" class="pilot-skeleton-field">
                    <span class="pilot-skeleton-bar pilot-skeleton-label" />
                    <span class="pilot-skeleton-bar pilot-skeleton-control" />
                </span>
            </template>
            <template v-else-if="variant === 'table'">
                <span class="pilot-skeleton-table-heading">
                    <span v-for="column in 5" :key="column" class="pilot-skeleton-bar" />
                </span>
                <span v-for="row in count" :key="row" class="pilot-skeleton-table-row">
                    <span v-for="column in 5" :key="column" class="pilot-skeleton-bar" />
                </span>
            </template>
            <template v-else-if="variant === 'cards'">
                <!-- Reuse the native OverviewItems Bootstrap utilities so the
                     responsive columns and gutters have one presentation owner. -->
                <span class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">
                    <span v-for="row in count" :key="row" class="col">
                        <span class="card bg-dark border-secondary p-3 h-100">
                            <span class="pilot-skeleton-bar pilot-skeleton-heading" />
                            <span class="pilot-skeleton-bar" />
                            <span class="pilot-skeleton-bar pilot-skeleton-short" />
                        </span>
                    </span>
                </span>
            </template>
            <template v-else-if="variant === 'article'">
                <span class="pilot-skeleton-bar pilot-skeleton-heading" />
                <span v-for="row in count" :key="row" class="pilot-skeleton-paragraph">
                    <span class="pilot-skeleton-bar" />
                    <span class="pilot-skeleton-bar" />
                    <span class="pilot-skeleton-bar pilot-skeleton-short" />
                </span>
            </template>
            <template v-else>
                <span v-for="row in count" :key="row" class="pilot-skeleton-bar" />
            </template>
        </span>
    </span>
</template>
