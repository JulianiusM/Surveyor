<script setup lang="ts">
import {computed} from 'vue';
import type {FrontendLoadingSkeleton} from '../../types/FrontendUiTypes';
import {useFrontend} from '../app/context';

const props = withDefaults(
    defineProps<FrontendLoadingSkeleton & {
        label?: string;
        page?: boolean;
        decorative?: boolean;
        fieldWidths?: readonly number[];
    }>(),
    {variant: 'lines', rows: 3, columns: 5, page: false, decorative: false,
        // Keep absence distinct from an explicit layout override; Vue otherwise
        // casts an omitted Boolean prop to false before the family fallback.
        balancedHeader: undefined, headerActions: undefined},
);
const {messages} = useFrontend();
// Rows describe decorative repetition, never an authoritative record/field count.
// Keep malformed optional values from producing an empty or infinite Vue range.
const count = computed(() => Number.isFinite(props.rows) ? Math.max(1, Math.floor(props.rows)) : 3);
const columnCount = computed(() => Number.isFinite(props.columns) ? Math.max(1, Math.floor(props.columns)) : 5);
const fields = computed(fieldLayout);
const footerLayout = computed(footerWidth);
// Detail families always expose a heading read action. Profile routes declare
// their different header/action layouts explicitly in the same route metadata.
const detailHeader = computed(() => ['list-detail', 'activity', 'survey', 'event', 'event-admin'].includes(props.variant));
const balancedHeader = computed(() => props.balancedHeader ?? detailHeader.value);
const headerActions = computed(() => props.headerActions ?? detailHeader.value);

/** These are layout spans only. No feature labels, values, required state or
 * control authority enter the renderer. Creation families mirror their existing
 * Bootstrap columns; identity/profile forms use the same half-width primitive. */
function fieldLayout(): readonly number[] {
    if (props.fieldWidths) return props.fieldWidths;
    if (props.variant === 'list-create' || props.variant === 'packing-create') return [12, 12, 12, 12];
    if (props.variant === 'survey-create') return [12, 12, 12];
    if (props.variant === 'activity-create') return [6, 3, 3, 12, 12, 12];
    if (props.variant === 'event-create') return [12, 6, 6, 8, 4, 8, 4, 12, 12];
    if (props.variant === 'guest') return Array(count.value).fill(8);
    if (['identity', 'login', 'profile'].includes(props.variant)) return Array(count.value).fill(6);
    if (props.variant === 'workflow') return [6];
    return Array(count.value).fill(12);
}

/** Match existing submit-row widths without giving decorative blocks actions. */
function footerWidth(): NonNullable<FrontendLoadingSkeleton['footer']> {
    if (props.footer) return props.footer;
    if (props.variant === 'guest') return 'two-thirds';
    if (props.variant === 'profile' || props.variant === 'workflow') return 'full';
    if (props.variant === 'identity' || props.variant === 'login') return 'half';
    return 'compact';
}
</script>

<template>
    <span class="frontend-skeleton" :data-loading-skeleton="variant" :data-skeleton-page="page || undefined"
        :data-skeleton-decoration="decorative || undefined">
        <!-- Phrasing wrappers also fit compact badges/paragraphs without the HTML parser
             relocating them before hydration. Shared CSS owns the block/grid geometry. -->
        <!-- Announce the loading region once. Placeholder geometry has no authority,
             focus targets or accessible field/table semantics of its own. -->
        <span v-if="!decorative" class="visually-hidden" role="status">{{ label ?? messages.t('common.loading') }}</span>
        <span class="frontend-skeleton-shapes" :class="[{'frontend-skeleton-animated': !decorative,
            'card bg-dark text-white mb-3': page}, 'frontend-skeleton-' + variant]" aria-hidden="true">
            <!-- Whole-page admission has no real header yet. Scoped data placeholders
                 live inside the feature's existing card and never duplicate it. -->
            <span v-if="page" class="card-header frontend-skeleton-page-header" :class="{'frontend-skeleton-balanced-header': balancedHeader}">
                <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                <span v-if="balancedHeader && headerActions" class="frontend-skeleton-bar frontend-skeleton-header-actions" />
            </span>
            <span class="frontend-skeleton-content" :class="{'card-body': page}">
                <template v-if="variant === 'table'">
                    <!-- List columns retain horizontal clipping. Only callers
                         whose real table deliberately hides a column opt into the
                         same Bootstrap breakpoint; no authority is inferred here. -->
                    <span class="frontend-skeleton-table-viewport">
                        <span class="frontend-skeleton-table-grid" :data-skeleton-columns="columnCount"
                            :data-skeleton-hide-column="hideColumnOnMobile"
                            :style="{'--frontend-skeleton-columns': columnCount,
                                '--frontend-skeleton-mobile-columns': hideColumnOnMobile ? columnCount - 1 : columnCount}">
                            <span class="frontend-skeleton-table-heading">
                                <span v-for="column in columnCount" :key="column" class="frontend-skeleton-bar"
                                    :class="{'d-none d-md-block': column === hideColumnOnMobile}" />
                            </span>
                            <span v-for="row in count" :key="row" class="frontend-skeleton-table-row">
                                <span v-for="column in columnCount" :key="column" class="frontend-skeleton-bar"
                                    :class="{'d-none d-md-block': column === hideColumnOnMobile}" />
                            </span>
                        </span>
                    </span>
                </template>
                <template v-else-if="variant === 'cards'">
                    <!-- Reuse the OverviewItems Bootstrap utilities so the
                         responsive columns and gutters have one presentation owner. -->
                    <span class="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 g-4">
                        <span v-for="row in count" :key="row" class="col">
                            <span class="card bg-dark border-secondary p-3 h-100">
                                <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                                <span class="frontend-skeleton-bar" />
                                <span class="frontend-skeleton-bar frontend-skeleton-short" />
                            </span>
                        </span>
                    </span>
                </template>
                <template v-else-if="variant === 'article'">
                    <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                    <span v-for="row in count" :key="row" class="frontend-skeleton-paragraph">
                        <span class="frontend-skeleton-bar" />
                        <span class="frontend-skeleton-bar" />
                        <span class="frontend-skeleton-bar frontend-skeleton-short" />
                    </span>
                </template>
                <template v-else-if="variant === 'overview'">
                    <!-- The two collection panels are structural, not a claim about
                         actor membership, available collections or record counts. -->
                    <span v-for="panel in 2" :key="panel" class="frontend-skeleton-collection">
                        <span class="frontend-skeleton-introduction">
                            <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                            <span class="frontend-skeleton-bar" />
                        </span>
                        <span class="card bg-dark text-white border-secondary">
                            <span class="card-header"><span class="frontend-skeleton-bar frontend-skeleton-heading" /></span>
                            <span class="card-body frontend-skeleton-content">
                                <span class="frontend-skeleton-toolbar">
                                    <span class="frontend-skeleton-bar frontend-skeleton-control" />
                                    <span class="frontend-skeleton-bar frontend-skeleton-control" />
                                </span>
                                <LoadingSkeleton variant="cards" :rows="4" decorative />
                            </span>
                        </span>
                    </span>
                </template>
                <template v-else-if="variant === 'list-detail'">
                    <LoadingSkeleton :rows="2" decorative />
                    <span class="frontend-skeleton-counters">
                        <span class="frontend-skeleton-bar" /><span class="frontend-skeleton-bar" />
                    </span>
                    <LoadingSkeleton variant="table" :rows="count" :columns="columnCount" decorative />
                    <span class="card bg-dark text-white border-secondary">
                        <span class="card-header"><span class="frontend-skeleton-bar frontend-skeleton-heading" /></span>
                        <LoadingSkeleton class="card-body" variant="form" :field-widths="[4, 4, 2, 2]" decorative />
                    </span>
                </template>
                <template v-else-if="variant === 'activity'">
                    <!-- Activity has shared notes, a workspace tab strip and a
                         weekly schedule. It has no list Quick Add form. -->
                    <LoadingSkeleton :rows="2" decorative />
                    <span class="frontend-skeleton-toolbar">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <span class="frontend-skeleton-counters">
                        <span class="frontend-skeleton-bar" /><span class="frontend-skeleton-bar" />
                    </span>
                    <LoadingSkeleton variant="table" :rows="count" :columns="columnCount" decorative />
                </template>
                <template v-else-if="variant === 'survey'">
                    <!-- Voting and named results have separate horizontally scrolling
                         tables. A standalone two-select combination form follows them;
                         Surveys have neither list counters nor a Quick Add card. -->
                    <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                    <LoadingSkeleton variant="table" :rows="1" :columns="columnCount" decorative />
                    <span class="frontend-skeleton-form-footer frontend-skeleton-form-footer-full">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <span class="frontend-skeleton-bar frontend-skeleton-heading mt-5" />
                    <LoadingSkeleton variant="table" :rows="count" :columns="columnCount" decorative />
                    <span class="frontend-skeleton-bar frontend-skeleton-heading mt-5" />
                    <LoadingSkeleton variant="form" :field-widths="[6, 6]" decorative />
                    <span class="frontend-skeleton-form-footer frontend-skeleton-form-footer-full">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                </template>
                <template v-else-if="variant === 'event' || variant === 'event-admin'">
                    <span class="card bg-dark border-secondary-subtle p-3 frontend-skeleton-summary">
                        <LoadingSkeleton :rows="4" decorative />
                        <LoadingSkeleton :rows="3" decorative />
                    </span>
                    <LoadingSkeleton v-if="variant === 'event'" variant="form" :field-widths="[6, 6, 12]" decorative />
                    <span v-else class="frontend-skeleton-toolbar">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <LoadingSkeleton variant="table" :rows="3" :columns="4" decorative />
                </template>
                <template v-else-if="variant === 'roster'">
                    <span v-for="row in count" :key="row" class="frontend-skeleton-roster-row">
                        <span class="frontend-skeleton-bar" /><span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                </template>
                <template v-else-if="variant === 'form' || variant === 'list-create' || variant === 'packing-create' || variant === 'survey-create' || variant === 'activity-create' || variant === 'event-create'
                    || variant === 'identity' || variant === 'login' || variant === 'profile' || variant === 'workflow' || variant === 'guest'">
                    <LoadingSkeleton v-if="variant === 'identity' || variant === 'login' || variant === 'profile' || variant === 'workflow' || variant === 'guest'"
                        class="frontend-skeleton-introduction" :rows="variant === 'guest' || variant === 'workflow' ? 3 : 2" decorative />
                    <span v-if="variant === 'guest'" class="frontend-skeleton-toolbar frontend-skeleton-choices">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" /><span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <span class="row g-3 justify-content-center">
                        <span v-for="(width, index) in fields" :key="index" class="col-12 frontend-skeleton-field" :class="'col-md-' + width">
                            <span class="frontend-skeleton-bar frontend-skeleton-label" />
                            <span class="frontend-skeleton-bar frontend-skeleton-control"
                                :class="{'frontend-skeleton-textarea': ((variant === 'list-create' || variant === 'packing-create' || variant === 'survey-create') && index === 1)
                                    || (variant === 'activity-create' && index === 3)
                                    || (variant === 'event-create' && index === 7)}" />
                        </span>
                    </span>
                    <!-- Collection-specific editable rows follow the matching fields;
                         Drivers retains its separate creation family without rows. -->
                    <LoadingSkeleton v-if="variant === 'packing-create'" variant="table" :rows="2" :columns="4" decorative />
                    <LoadingSkeleton v-if="variant === 'activity-create'" variant="table" :rows="2" :columns="4" decorative />
                    <LoadingSkeleton v-if="variant === 'survey-create'" variant="table" :rows="1" :columns="3" decorative />
                    <span v-if="variant === 'survey-create'" class="frontend-skeleton-toolbar justify-content-between">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <span v-else-if="variant !== 'form'" class="frontend-skeleton-form-footer"
                        :class="'frontend-skeleton-form-footer-' + footerLayout">
                        <span class="frontend-skeleton-bar frontend-skeleton-control" />
                    </span>
                    <span v-if="variant === 'login'" class="frontend-skeleton-recovery">
                        <span class="frontend-skeleton-introduction">
                            <span class="frontend-skeleton-bar frontend-skeleton-heading" />
                            <span class="frontend-skeleton-bar" />
                        </span>
                        <LoadingSkeleton variant="form" :field-widths="[6, 6]" decorative />
                    </span>
                </template>
                <template v-else>
                    <span v-for="row in count" :key="row" class="frontend-skeleton-bar" />
                </template>
            </span>
        </span>
    </span>
</template>
