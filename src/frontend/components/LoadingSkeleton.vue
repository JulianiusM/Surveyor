<script setup lang="ts">
import {computed} from 'vue';
import type {PilotLoadingSkeleton} from '../../types/FrontendPilotUiTypes';
import {usePilot} from '../app/context';

const props = withDefaults(
    defineProps<PilotLoadingSkeleton & {
        label?: string;
        page?: boolean;
        decorative?: boolean;
        fieldWidths?: readonly number[];
    }>(),
    {variant: 'lines', rows: 3, columns: 5, page: false, decorative: false},
);
const {messages} = usePilot();
// Rows describe decorative repetition, never an authoritative record/field count.
// Keep malformed optional values from producing an empty or infinite Vue range.
const count = computed(() => Number.isFinite(props.rows) ? Math.max(1, Math.floor(props.rows)) : 3);
const columnCount = computed(() => Number.isFinite(props.columns) ? Math.max(1, Math.floor(props.columns)) : 5);
const fields = computed(fieldLayout);
const footerLayout = computed(footerWidth);

/** These are layout spans only. No feature labels, values, required state or
 * control authority enter the renderer. Creation families mirror their existing
 * Bootstrap columns; identity/profile forms use the same half-width primitive. */
function fieldLayout(): readonly number[] {
    if (props.fieldWidths) return props.fieldWidths;
    if (props.variant === 'list-create' || props.variant === 'packing-create') return [12, 12, 12, 12];
    if (props.variant === 'event-create') return [12, 6, 6, 8, 4, 8, 4, 12, 12];
    if (props.variant === 'guest') return Array(count.value).fill(8);
    if (['identity', 'login', 'profile'].includes(props.variant)) return Array(count.value).fill(6);
    if (props.variant === 'workflow') return [6];
    return Array(count.value).fill(12);
}

/** Match existing submit-row widths without giving decorative blocks actions. */
function footerWidth(): NonNullable<PilotLoadingSkeleton['footer']> {
    if (props.footer) return props.footer;
    if (props.variant === 'guest') return 'two-thirds';
    if (props.variant === 'profile' || props.variant === 'workflow') return 'full';
    if (props.variant === 'identity' || props.variant === 'login') return 'half';
    return 'compact';
}
</script>

<template>
    <span class="pilot-skeleton" :data-loading-skeleton="variant" :data-skeleton-page="page || undefined"
        :data-skeleton-decoration="decorative || undefined">
        <!-- Phrasing wrappers also fit compact badges/paragraphs without the HTML parser
             relocating them before hydration. Shared CSS owns the block/grid geometry. -->
        <!-- Announce the loading region once. Placeholder geometry has no authority,
             focus targets or accessible field/table semantics of its own. -->
        <span v-if="!decorative" class="visually-hidden" role="status">{{ label ?? messages.t('common.loading') }}</span>
        <span class="pilot-skeleton-shapes" :class="[{'pilot-skeleton-animated': !decorative,
            'card bg-dark text-white mb-3': page}, 'pilot-skeleton-' + variant]" aria-hidden="true">
            <!-- Whole-page admission has no real header yet. Scoped data placeholders
                 live inside the feature's existing card and never duplicate it. -->
            <span v-if="page" class="card-header pilot-skeleton-page-header">
                <span class="pilot-skeleton-bar pilot-skeleton-heading" />
            </span>
            <span class="pilot-skeleton-content" :class="{'card-body': page}">
                <template v-if="variant === 'table'">
                    <!-- List columns retain native horizontal clipping. Only callers
                         whose real table deliberately hides a column opt into the
                         same Bootstrap breakpoint; no authority is inferred here. -->
                    <span class="pilot-skeleton-table-viewport">
                        <span class="pilot-skeleton-table-grid" :data-skeleton-columns="columnCount"
                            :data-skeleton-hide-column="hideColumnOnMobile"
                            :style="{'--pilot-skeleton-columns': columnCount,
                                '--pilot-skeleton-mobile-columns': hideColumnOnMobile ? columnCount - 1 : columnCount}">
                            <span class="pilot-skeleton-table-heading">
                                <span v-for="column in columnCount" :key="column" class="pilot-skeleton-bar"
                                    :class="{'d-none d-md-block': column === hideColumnOnMobile}" />
                            </span>
                            <span v-for="row in count" :key="row" class="pilot-skeleton-table-row">
                                <span v-for="column in columnCount" :key="column" class="pilot-skeleton-bar"
                                    :class="{'d-none d-md-block': column === hideColumnOnMobile}" />
                            </span>
                        </span>
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
                <template v-else-if="variant === 'overview'">
                    <!-- The two collection panels are structural, not a claim about
                         actor membership, available collections or record counts. -->
                    <span v-for="panel in 2" :key="panel" class="pilot-skeleton-collection">
                        <span class="pilot-skeleton-introduction">
                            <span class="pilot-skeleton-bar pilot-skeleton-heading" />
                            <span class="pilot-skeleton-bar" />
                        </span>
                        <span class="card bg-dark text-white border-secondary">
                            <span class="card-header"><span class="pilot-skeleton-bar pilot-skeleton-heading" /></span>
                            <span class="card-body pilot-skeleton-content">
                                <span class="pilot-skeleton-toolbar">
                                    <span class="pilot-skeleton-bar pilot-skeleton-control" />
                                    <span class="pilot-skeleton-bar pilot-skeleton-control" />
                                </span>
                                <LoadingSkeleton variant="cards" :rows="4" decorative />
                            </span>
                        </span>
                    </span>
                </template>
                <template v-else-if="variant === 'list-detail'">
                    <LoadingSkeleton :rows="2" decorative />
                    <span class="pilot-skeleton-counters">
                        <span class="pilot-skeleton-bar" /><span class="pilot-skeleton-bar" />
                    </span>
                    <LoadingSkeleton variant="table" :rows="count" :columns="columnCount" decorative />
                    <span class="card bg-dark text-white border-secondary">
                        <span class="card-header"><span class="pilot-skeleton-bar pilot-skeleton-heading" /></span>
                        <LoadingSkeleton class="card-body" variant="form" :field-widths="[4, 4, 2, 2]" decorative />
                    </span>
                </template>
                <template v-else-if="variant === 'event' || variant === 'event-admin'">
                    <span class="card bg-dark border-secondary-subtle p-3 pilot-skeleton-summary">
                        <LoadingSkeleton :rows="4" decorative />
                        <LoadingSkeleton :rows="3" decorative />
                    </span>
                    <LoadingSkeleton v-if="variant === 'event'" variant="form" :field-widths="[6, 6, 12]" decorative />
                    <span v-else class="pilot-skeleton-toolbar">
                        <span class="pilot-skeleton-bar pilot-skeleton-control" />
                        <span class="pilot-skeleton-bar pilot-skeleton-control" />
                    </span>
                    <LoadingSkeleton variant="table" :rows="3" :columns="4" decorative />
                </template>
                <template v-else-if="variant === 'roster'">
                    <span v-for="row in count" :key="row" class="pilot-skeleton-roster-row">
                        <span class="pilot-skeleton-bar" /><span class="pilot-skeleton-bar pilot-skeleton-control" />
                    </span>
                </template>
                <template v-else-if="variant === 'form' || variant === 'list-create' || variant === 'packing-create' || variant === 'event-create'
                    || variant === 'identity' || variant === 'login' || variant === 'profile' || variant === 'workflow' || variant === 'guest'">
                    <LoadingSkeleton v-if="variant === 'identity' || variant === 'login' || variant === 'profile' || variant === 'workflow' || variant === 'guest'"
                        class="pilot-skeleton-introduction" :rows="variant === 'guest' || variant === 'workflow' ? 3 : 2" decorative />
                    <span v-if="variant === 'guest'" class="pilot-skeleton-toolbar pilot-skeleton-choices">
                        <span class="pilot-skeleton-bar pilot-skeleton-control" /><span class="pilot-skeleton-bar pilot-skeleton-control" />
                    </span>
                    <span class="row g-3 justify-content-center">
                        <span v-for="(width, index) in fields" :key="index" class="col-12 pilot-skeleton-field" :class="'col-md-' + width">
                            <span class="pilot-skeleton-bar pilot-skeleton-label" />
                            <span class="pilot-skeleton-bar pilot-skeleton-control"
                                :class="{'pilot-skeleton-textarea': ((variant === 'list-create' || variant === 'packing-create') && index === 1)
                                    || (variant === 'event-create' && index === 7)}" />
                        </span>
                    </span>
                    <!-- Packing alone owns editable initial items. Drivers reuses the
                         preceding creation fields without inventing that feature. -->
                    <LoadingSkeleton v-if="variant === 'packing-create'" variant="table" :rows="2" :columns="4" decorative />
                    <span v-if="variant !== 'form'" class="pilot-skeleton-form-footer"
                        :class="'pilot-skeleton-form-footer-' + footerLayout">
                        <span class="pilot-skeleton-bar pilot-skeleton-control" />
                    </span>
                    <span v-if="variant === 'login'" class="pilot-skeleton-recovery">
                        <span class="pilot-skeleton-introduction">
                            <span class="pilot-skeleton-bar pilot-skeleton-heading" />
                            <span class="pilot-skeleton-bar" />
                        </span>
                        <LoadingSkeleton variant="form" :field-widths="[6, 6]" decorative />
                    </span>
                </template>
                <template v-else>
                    <span v-for="row in count" :key="row" class="pilot-skeleton-bar" />
                </template>
            </span>
        </span>
    </span>
</template>
