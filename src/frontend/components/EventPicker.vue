<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {PilotEventPickerOption, PilotEventPickerQuery, PilotEventPickerSelection, PilotEventPickerSource} from '../../types/FrontendPilotUiTypes';
import {usePilot, refreshInterval} from '../app/context';
import {belongsToQueryFamily} from '../app/queryKeys';
import {useDebouncedValue} from '../composables/debounced';
import ActionButton from './ActionButton.vue';
import AppDialog from './AppDialog.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';

const props = defineProps<{
    modelValue: string | null;
    current?: PilotEventPickerSelection | null;
    source: PilotEventPickerSource;
    disabled?: boolean;
    prefix: string;
    inline?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [value: string | null]}>();
const context = usePilot();
const {messages} = context;
const open = ref(false);
const cursors = ref<(string | undefined)[]>([undefined]);
const page = ref(0);
const pageOffset = ref(0);
const shownPage = ref(1);
const filters = reactive({q: '', from: '', to: '', period: 'all', archive: 'all', deadline: 'all'});
const search = useDebouncedValue(computed(() => filters.q));
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const selected = ref<PilotEventPickerSelection | null>(
    props.current ?? null,
);
type Query = PilotEventPickerQuery;
const invalidDates = computed(() => !!filters.from && !!filters.to && filters.from > filters.to);
const filterKey = computed(() => JSON.stringify({...filters, q: search.value}));
const query = computed<Query>(() => ({
    q: search.value.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    period: filters.period as Query['period'],
    archive: filters.archive as Query['archive'],
    deadline: filters.deadline as Query['deadline'],
    selectedId: props.modelValue ?? undefined,
    cursor: cursors.value[page.value],
}));
// Keep one displayed page and bounded cursor history. Searching never changes the submitted
// selection: an explicitly chosen event survives filters, pagination and failed reads.
watch(filterKey, () => {
    cursors.value = [undefined];
    page.value = 0;
    pageOffset.value = 0;
});
const options = useQuery({
    queryKey: computed(() => props.source.pageKey(context.session.value?.context, context.locale.value, filterKey.value, query.value)),
    enabled: computed(
        () =>
            context.hydrated.value &&
            context.ready.value &&
            context.visible.value &&
            !props.disabled &&
            !invalidDates.value &&
            // A closed picker may resolve its initial selection once. It does not keep reading
            // selection results after that title is known, or poll while the dialog is hidden.
            (!!props.inline || open.value || (!!props.modelValue && selected.value?.id !== props.modelValue)),
    ),
    queryFn: ({signal}) => props.source.search(query.value, context.capture(), signal),
    gcTime: 0,
    refetchInterval: (state) => context.visible.value && (!!props.inline || open.value)
        ? refreshInterval(state.state.error, state.state.fetchFailureCount, jitter) : false,
    placeholderData: (previous, previousQuery) =>
        previousQuery && belongsToQueryFamily(previousQuery,
            props.source.filterKey(context.session.value?.context, context.locale.value, filterKey.value))
            ? previous : undefined,
});
/** Discovery reauthorizes the selected ID independently of its result page. An explicit
 * null revokes its display projection, not the user's selected draft ID. Observe completed
 * fetches too: structural sharing and same-millisecond responses can retain the data/ref time. */
function receiveOptions(): void {
    const result = options.data.value;
    if (!result || options.isPlaceholderData.value || options.isFetching.value || options.isError.value) return;
    shownPage.value = pageOffset.value + page.value + 1;
    selected.value = result.selected;
}
watch([options.data, options.dataUpdatedAt, options.isFetching], receiveOptions, {immediate: true});
watch(
    () => props.current,
    (value, previous) => {
        if (value?.id === props.modelValue) selected.value = value;
        else if (previous?.id === props.modelValue && selected.value?.id === previous.id) {
            // A closed picker consumes its owner's refreshed authority. Resolve this
            // still-selected draft once through discovery instead of retaining an old label.
            selected.value = null;
        }
    },
);
const selection = computed(() =>
    props.modelValue ? (selected.value?.id === props.modelValue ? selected.value : null) : null,
);
const selectionTitle = computed(() =>
    props.modelValue
        ? selection.value?.title || messages.value.t('packing.currentEvent')
        : messages.value.t('packing.noEvent'),
);
function choose(value: PilotEventPickerOption | null): void {
    if (props.disabled) return;
    selected.value = value;
    emit('update:modelValue', value?.id ?? null);
    open.value = false;
}
function next(): void {
    const cursor = options.data.value?.nextCursor;
    if (!cursor || options.isFetching.value || options.error.value) return;
    cursors.value = [...cursors.value.slice(0, page.value + 1), cursor];
    if (cursors.value.length > 100) {
        cursors.value.shift();
        pageOffset.value++;
    } else page.value++;
}
function previous(): void {
    if (page.value && !options.isFetching.value) page.value--;
}
function reset(): void {
    Object.assign(filters, {q: '', from: '', to: '', period: 'all', archive: 'all', deadline: 'all'});
}
function details(event: PilotEventPickerOption): string {
    const today = new Date().toISOString().slice(0, 10);
    const period =
        event.startDate > today
            ? 'packing.upcoming'
            : event.endDate < today
              ? 'packing.ended'
              : 'packing.ongoing';
    return [
        event.startDate && event.endDate ? event.startDate + ' – ' + event.endDate : '',
        event.startDate && event.endDate ? messages.value.t(period) : '',
        messages.value.t(event.archived ? 'packing.archivedOption' : 'packing.active'),
        event.deadlinePassed ? messages.value.t('packing.deadlinePassed') : '',
        event.description,
    ]
        .filter(Boolean)
        .join(' · ');
}
</script>

<template>
    <div class="entity-picker">
        <template v-if="!inline">
            <label class="form-label" :for="prefix + '-event-button'">{{
                messages.t('packing.assignEvent')
            }}</label>
            <ActionButton
                :id="prefix + '-event-button'"
                class="w-100 text-start"
                variant="outline-light"
                :disabled="disabled"
                @click="open = true"
                ><i class="bi bi-calendar-event me-2" aria-hidden="true"></i
                >{{ selectionTitle }}</ActionButton
            >
        </template>
        <component
            :is="inline ? 'div' : AppDialog"
            :open="open"
            :title="messages.t('packing.chooseEvent')"
            :pending="disabled"
            :fullscreen-on-small="false"
            :initial-focus="'#' + prefix + '-search'"
            @close="open = false"
        >
            <div class="entity-picker-content">
                <div class="row g-2 align-items-end mb-2">
                    <div class="col">
                        <label class="form-label" :for="prefix + '-search'">{{
                            messages.t('packing.searchEvents')
                        }}</label>
                        <input
                            :id="prefix + '-search'"
                            v-model="filters.q"
                            type="search"
                            autocomplete="off"
                            class="form-control text-bg-dark"
                            :placeholder="messages.t('packing.eventSearchPlaceholder')"
                            :disabled="disabled"
                            :aria-controls="prefix + '-list'"
                        />
                    </div>
                    <div class="col-auto">
                        <ActionButton
                            class="btn-sm"
                            variant="outline-secondary"
                            :disabled="disabled"
                            @click="reset"
                            >{{ messages.t('packing.resetFilters') }}</ActionButton
                        >
                    </div>
                </div>
                <details class="border border-secondary rounded p-2 mb-2">
                    <summary class="small">{{ messages.t('packing.advancedFilters') }}</summary>
                    <div class="row g-2 mt-1">
                        <div class="col-sm-6">
                            <label class="form-label small" :for="prefix + '-from'">{{
                                messages.t('packing.dateFrom')
                            }}</label
                            ><input
                                :id="prefix + '-from'"
                                v-model="filters.from"
                                class="form-control form-control-sm text-bg-dark"
                                type="date"
                                :disabled="disabled"
                            />
                        </div>
                        <div class="col-sm-6">
                            <label class="form-label small" :for="prefix + '-to'">{{
                                messages.t('packing.dateTo')
                            }}</label
                            ><input
                                :id="prefix + '-to'"
                                v-model="filters.to"
                                class="form-control form-control-sm text-bg-dark"
                                type="date"
                                :disabled="disabled"
                            />
                        </div>
                        <div class="col-sm-4">
                            <label class="form-label small" :for="prefix + '-period'">{{
                                messages.t('packing.period')
                            }}</label
                            ><select
                                :id="prefix + '-period'"
                                v-model="filters.period"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('packing.all') }}</option>
                                <option value="upcoming">{{ messages.t('packing.upcoming') }}</option>
                                <option value="ongoing">{{ messages.t('packing.ongoing') }}</option>
                                <option value="ended">{{ messages.t('packing.ended') }}</option>
                            </select>
                        </div>
                        <div class="col-sm-4">
                            <label class="form-label small" :for="prefix + '-archive'">{{
                                messages.t('packing.archiveFilter')
                            }}</label
                            ><select
                                :id="prefix + '-archive'"
                                v-model="filters.archive"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('packing.all') }}</option>
                                <option value="active">{{ messages.t('packing.active') }}</option>
                                <option value="archived">{{ messages.t('packing.archivedOption') }}</option>
                            </select>
                        </div>
                        <div class="col-sm-4">
                            <label class="form-label small" :for="prefix + '-deadline'">{{
                                messages.t('packing.deadlineFilter')
                            }}</label
                            ><select
                                :id="prefix + '-deadline'"
                                v-model="filters.deadline"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('packing.all') }}</option>
                                <option value="open">{{ messages.t('packing.openDeadline') }}</option>
                                <option value="passed">{{ messages.t('packing.passedDeadline') }}</option>
                            </select>
                        </div>
                    </div>
                </details>
                <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <ActionButton
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled"
                        :aria-pressed="!modelValue"
                        @click="choose(null)"
                        >{{ messages.t('packing.noEvent') }}</ActionButton
                    >
                    <p class="small mb-0" role="status">
                        {{ messages.t('packing.currentSelection', {title: selectionTitle}) }}
                    </p>
                </div>
                <p v-if="selection?.archived" class="small text-info">
                    {{ messages.t('packing.archivedEventHint') }}
                </p>
                <p v-if="invalidDates || options.error.value" class="small text-danger" role="alert">
                    {{ messages.t(invalidDates ? 'packing.invalidEventDates' : 'state.loadFailed') }}
                </p>
                <!-- Search/filter controls stay usable while the independently authorized
                     options load. Background reads retain the known choices and selection. -->
                <LoadingSkeleton v-if="!invalidDates && !options.data.value && !options.error.value" :rows="4" />
                <p v-if="options.isFetching.value && options.data.value" class="small text-secondary" role="status">
                    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ messages.t('common.loading') }}
                </p>
                <ul
                    :id="prefix + '-list'"
                    class="list-group list-group-flush text-bg-dark overflow-auto"
                    :aria-label="messages.t('packing.availableEvents')"
                    :aria-describedby="prefix + '-summary'"
                    :aria-busy="options.isFetching.value"
                    style="max-height: 22rem"
                >
                    <li
                        v-for="event in invalidDates ? [] : (options.data.value?.items ?? [])"
                        :key="event.id"
                        class="list-group-item text-bg-dark px-0"
                    >
                        <ActionButton
                            class="w-100 text-start"
                            variant="outline-light"
                            :class="{active: modelValue === event.id}"
                            :data-event-id="event.id"
                            :aria-pressed="modelValue === event.id"
                            :disabled="disabled"
                            @click="choose(event)"
                            ><span class="d-block fw-semibold text-break">{{ event.title }}</span
                            ><span class="d-block small text-secondary text-break">{{
                                details(event)
                            }}</span></ActionButton
                        >
                    </li>
                </ul>
                <p
                    v-if="!invalidDates && options.data.value"
                    :id="prefix + '-summary'"
                    class="small text-secondary mt-2 mb-2"
                    aria-live="polite"
                >
                    <template v-if="options.data.value.items.length"
                        >{{
                            messages.t('packing.eventPage', {
                                page: shownPage,
                                count: options.data.value.items.length,
                            })
                        }}
                        {{ options.data.value.nextCursor ? messages.t('packing.moreEvents') : '' }}</template
                    ><template v-else>{{
                        messages.t(
                            options.data.value.nextCursor
                                ? 'packing.emptyEventBatch'
                                : 'packing.noMatchingEvents',
                        )
                    }}</template>
                </p>
                <div class="d-flex gap-2">
                    <ActionButton
                        v-if="page"
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled || options.isFetching.value"
                        @click="previous"
                        >{{ messages.t('packing.previousPage') }}</ActionButton
                    ><ActionButton
                        v-if="options.data.value?.nextCursor"
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled || options.isFetching.value || !!options.error.value"
                        @click="next"
                        >{{ messages.t('packing.nextPage') }}</ActionButton
                    ><ActionButton
                        v-if="options.error.value"
                        class="btn-sm"
                        variant="outline-secondary"
                        :disabled="disabled || options.isFetching.value"
                        @click="options.refetch()"
                        >{{ messages.t('common.retry') }}</ActionButton
                    >
                </div>
            </div>
            <template #footer
                ><ActionButton variant="secondary" :disabled="disabled" @click="open = false">{{
                    messages.t('common.cancel')
                }}</ActionButton></template
            >
        </component>
    </div>
</template>
