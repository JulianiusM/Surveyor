<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref, shallowRef, watch} from 'vue';
import {useQuery} from '@tanstack/vue-query';
import type {QueryFunctionContext} from '@tanstack/vue-query';
import type {PilotEventPickerOption, PilotEventPickerQuery, PilotEventPickerSelection, PilotEventPickerSource} from '../../types/FrontendPilotUiTypes';
import {usePilot, refreshInterval} from '../app/context';
import {isReadDenial, ObsoleteRequestError} from '../app/transport';
import {retireQueryFamily} from '../app/queryCache';
import {useDebouncedValue} from '../composables/debounced';
import {useReadRetry, useReadRetryAt} from '../composables/feedback';
import ActionButton from './ActionButton.vue';
import AppDialog from './AppDialog.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
import StatusNotice from './StatusNotice.vue';

const props = withDefaults(defineProps<{
    modelValue: string | null;
    current?: PilotEventPickerSelection | null;
    source: PilotEventPickerSource;
    disabled?: boolean;
    prefix: string;
    inline?: boolean;
    active?: boolean;
}>(), {active: true});
const emit = defineEmits<{'update:modelValue': [value: string | null]}>();
const context = usePilot();
const {messages} = context;
const open = ref(false);
// Cursor history describes confirmed visits only. A failed Next/Previous request keeps
// this page and its history intact; Retry repeats the requested read, never a selection.
const history = ref<{cursor: string | undefined; number: number}[]>([]);
const requestedCursor = ref<string>();
const requestedPage = ref(1);
const direction = ref<'reset' | 'next' | 'previous' | 'current'>('reset');
const shownPage = computed(() => history.value.at(-1)?.number ?? 1);
const filters = reactive({q: '', from: '', to: '', period: 'all', archive: 'all', deadline: 'all'});
const searchPending = ref(false);
const search = useDebouncedValue(computed(() => filters.q), 200, finishTypedSearch);
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const selected = ref<PilotEventPickerSelection | null>(
    props.current ?? null,
);
const resolvedSelection = ref(props.current?.id === props.modelValue ? props.modelValue : null);
type Query = PilotEventPickerQuery;
type Options = Awaited<ReturnType<PilotEventPickerSource['search']>>;
let readGeneration = 0;
let completedRead: {generation: number; direction: typeof direction.value; cursor: string | undefined; page: number} | undefined;
const confirmedPage = shallowRef<{family: string; result: Options; updatedAt: number}>();
const invalidDates = computed(() => !!filters.from && !!filters.to && filters.from > filters.to);
const filterKey = computed(() => JSON.stringify({...filters, q: search.value}));
const family = computed(() => JSON.stringify([
    props.source.filterKey(context.session.value?.context, context.locale.value, filterKey.value), context.epoch.value,
]));
const query = computed<Query>(() => ({
    q: search.value.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    period: filters.period as Query['period'],
    archive: filters.archive as Query['archive'],
    deadline: filters.deadline as Query['deadline'],
    selectedId: props.modelValue ?? undefined,
    cursor: requestedCursor.value,
}));
const key = computed(() => props.source.pageKey(context.session.value?.context, context.locale.value, filterKey.value, query.value));
const disclosed = computed(() => props.active !== false && (!!props.inline || open.value));
const enabled = computed(() => context.hydrated.value && context.ready.value && context.visible.value
    && props.active !== false && !props.disabled && !invalidDates.value && !searchPending.value
    // A closed picker resolves an unknown selected ID once, including authoritative null.
    // Its current parent projection can retire that resolution; hidden tabs never search.
    && (disclosed.value || (!!props.modelValue && resolvedSelection.value !== props.modelValue)));
const options = useQuery({
    queryKey: key,
    enabled,
    queryFn: readOptions,
    gcTime: 0,
    refetchInterval: (state) => enabled.value && disclosed.value
        ? refreshInterval(state.state.error, state.state.fetchFailureCount, jitter) : false,
});
const retryAvailable = useReadRetry(() => options.error.value);
const retryAt = useReadRetryAt(() => options.error.value, retryAvailable);
// TanStack placeholder data disappears on terminal pagination errors. Retain one confirmed
// presentation explicitly, scoped to this actor/epoch/filter/locale; it is never edit authority.
const displayed = computed(() => context.ready.value && !isReadDenial(options.error.value)
    && confirmedPage.value?.family === family.value
    ? confirmedPage.value.result : undefined);
const visibleOptions = computed(uniqueOptions);
watch(options.error, retireDeniedOptions, {flush: 'sync'});

/** Confirmed denial retires discovery's protected options/label, not the user's
 * selected draft ID. Retain its resolution guard so retirement cannot trigger
 * another hidden discovery read. A matching current parent projection owns its
 * readable title independently of discovery permission and remains authoritative. */
function retireDeniedOptions(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    // Retire the outstanding visit before clearing its observed cache family.
    // gcTime only removes unused queries; a mounted picker must also release
    // its previously readable protected response while keeping Retry attached.
    retireReads();
    confirmedPage.value = undefined;
    selected.value = props.current?.id === props.modelValue ? props.current : null;
    void retireQueryFamily(context.queryClient,
        props.source.filterKey(context.session.value?.context, context.locale.value, filterKey.value), failure);
}

/** Discovery can repeat an ID within a bounded batch. Render one choice per ID, matching
 * native selection, without mutating the shared authoritative response in the query cache. */
function uniqueOptions(): PilotEventPickerOption[] {
    const result: PilotEventPickerOption[] = [];
    const seen = new Set<string>();
    for (const option of displayed.value?.items ?? []) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        result.push(option);
    }
    return result;
}

/** Snapshot the request before awaiting discovery. Typing, filters, disclosure and disposal
 * retire it immediately, even if a caller's transport cannot interrupt the old response. */
async function readOptions({signal}: QueryFunctionContext<readonly unknown[]>): Promise<Options> {
    const generation = readGeneration;
    const scope = context.capture();
    const visit = {generation, direction: direction.value, cursor: requestedCursor.value, page: requestedPage.value};
    const result = await props.source.search({...query.value}, scope, signal);
    if (generation !== readGeneration || !context.isCurrent(scope) || !enabled.value) throw new ObsoleteRequestError();
    completedRead = visit;
    return result;
}

/** Cancellation is limited to this picker's current query. Other selectors and regions keep
 * their own requests; the last confirmed page remains readable while a new read is pending. */
function retireReads(): void {
    readGeneration++;
    completedRead = undefined;
    void context.queryClient.cancelQueries({queryKey: key.value, exact: true});
}

/** New filters start bounded history again, without changing the independently selected ID. */
function resetBrowsing(): void {
    retireReads();
    history.value = [];
    requestedCursor.value = undefined;
    requestedPage.value = 1;
    direction.value = 'reset';
    confirmedPage.value = undefined;
}

function editSearch(): void {
    searchPending.value = true;
    retireReads();
}

/** Returning to the original text also performs a fresh first-page read: the canceled query
 * key may be unchanged, so re-enabling alone is not evidence that its read has resumed. */
function finishTypedSearch(): void {
    if (!searchPending.value) return;
    resetBrowsing();
    searchPending.value = false;
    if (enabled.value) void options.refetch({cancelRefetch: false});
}

watch(() => filters.q, editSearch, {flush: 'sync'});
watch(family, resetBrowsing, {flush: 'sync'});
watch(enabled, pauseDiscovery, {flush: 'sync'});
watch(() => props.modelValue, retireReads, {flush: 'sync'});
watch([() => context.session.value?.context, context.epoch], retireIdentity, {flush: 'sync'});
onBeforeUnmount(retireReads);

function pauseDiscovery(value: boolean): void {
    if (!value) retireReads();
}

/** A same-actor session refresh is not a new selection scope. Retire labels only when
 * the actual actor/generation changes; future parent authority resolves that scope again. */
function retireIdentity(): void {
    selected.value = null;
    resolvedSelection.value = null;
}

/** Discovery reauthorizes the selected ID independently of its result page. An explicit
 * null revokes its display projection, not the user's selected draft ID. Observe completed
 * fetches too: structural sharing and same-millisecond responses can retain the data/ref time. */
function receiveOptions(): void {
    const result = options.data.value;
    const visit = completedRead;
    if (!result || !visit || visit.generation !== readGeneration || options.isFetching.value || options.isError.value) return;
    completedRead = undefined;
    if (visit.direction === 'previous') history.value = history.value.slice(0, -1);
    else if (visit.direction !== 'current') {
        history.value = [...history.value, {cursor: visit.cursor, number: visit.page}].slice(-100);
    }
    direction.value = 'current';
    // The settled query supplies its actual successful receipt, including equal
    // responses. Failed/pending pages never manufacture a new freshness timestamp.
    confirmedPage.value = {family: family.value, result, updatedAt: options.dataUpdatedAt.value};
    selected.value = result.selected;
    resolvedSelection.value = props.modelValue;
}
watch([options.data, options.dataUpdatedAt, options.isFetching], receiveOptions, {immediate: true});
watch(
    () => props.current,
    (value, previous) => {
        if (value?.id === props.modelValue) {
            selected.value = value;
            resolvedSelection.value = props.modelValue;
        } else if (previous?.id === props.modelValue && selected.value?.id === previous.id) {
            // A closed picker consumes its owner's refreshed authority. Resolve this
            // still-selected draft once through discovery instead of retaining an old label.
            selected.value = null;
            resolvedSelection.value = null;
        }
    },
);
const selection = computed(() =>
    props.modelValue ? (selected.value?.id === props.modelValue ? selected.value : null) : null,
);
const selectionTitle = computed(() =>
    props.modelValue
        ? selection.value?.title || messages.value.t('eventPicker.currentEvent')
        : messages.value.t('eventPicker.noEvent'),
);
function choose(value: PilotEventPickerOption | null): void {
    if (props.disabled) return;
    selected.value = value;
    resolvedSelection.value = value?.id ?? null;
    emit('update:modelValue', value?.id ?? null);
    open.value = false;
}
function next(): void {
    const cursor = displayed.value?.nextCursor;
    if (!cursor || options.isFetching.value || !enabled.value || !retryAvailable.value) return;
    requestPage('next', cursor, shownPage.value + 1);
}
function previous(): void {
    const prior = history.value.at(-2);
    if (!prior || options.isFetching.value || !enabled.value || !retryAvailable.value) return;
    requestPage('previous', prior.cursor, prior.number);
}

/** Pagination starts a requested visit. History and page numbering commit only in receiveOptions. */
function requestPage(nextDirection: 'next' | 'previous', cursor: string | undefined, number: number): void {
    const previousKey = JSON.stringify(key.value);
    retireReads();
    direction.value = nextDirection;
    requestedCursor.value = cursor;
    requestedPage.value = number;
    // Retrying Next/Previous can reuse the failed query key. Keep query-owned automatic
    // delivery and this explicit retry on the same in-flight read rather than issuing twice.
    if (enabled.value && JSON.stringify(key.value) === previousKey) void options.refetch({cancelRefetch: false});
}

function retry(): void {
    if (enabled.value && !options.isFetching.value && retryAvailable.value) void options.refetch();
}
/** Clear this browsing draft immediately without changing the selected event.
 * Reset the cursor/search generation together so delayed typing cannot restore
 * the old filters or dispatch another page after this explicit reset. */
function reset(): void {
    if (props.disabled) return;
    Object.assign(filters, {q: '', from: '', to: '', period: 'all', archive: 'all', deadline: 'all'});
    // Clear filters is immediate. A queued typing timer may settle later, but cannot start
    // another search once this explicit reset has consumed the pending input.
    search.value = '';
    searchPending.value = false;
    resetBrowsing();
    if (enabled.value) void options.refetch({cancelRefetch: false});
}

/** Describe only the admitted option using its civil dates and server flags.
 * The UTC date comparison affects the visible period label; it never decides
 * event eligibility, archival authority or whether a relationship can be saved. */
function details(event: PilotEventPickerOption): string {
    const today = new Date().toISOString().slice(0, 10);
    const period =
        event.startDate > today
            ? 'eventPicker.upcoming'
            : event.endDate < today
              ? 'eventPicker.ended'
              : 'eventPicker.ongoing';

    return [
        event.startDate && event.endDate ? event.startDate + ' – ' + event.endDate : '',
        event.startDate && event.endDate ? messages.value.t(period) : '',
        messages.value.t(event.archived ? 'common.archived' : 'common.active'),
        event.deadlinePassed ? messages.value.t('eventPicker.deadlinePassed') : '',
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
                messages.t('eventPicker.assignEvent')
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
            :title="messages.t('eventPicker.chooseEvent')"
            :pending="disabled"
            :fullscreen-on-small="false"
            :initial-focus="'#' + prefix + '-search'"
            @close="open = false"
        >
            <div class="entity-picker-content">
                <div class="row g-2 align-items-end mb-2">
                    <div class="col">
                        <label class="form-label" :for="prefix + '-search'">{{
                            messages.t('eventPicker.searchEvents')
                        }}</label>
                        <input
                            :id="prefix + '-search'"
                            v-model="filters.q"
                            type="search"
                            autocomplete="off"
                            class="form-control text-bg-dark"
                            :placeholder="messages.t('eventPicker.eventSearchPlaceholder')"
                            :disabled="disabled"
                            :aria-controls="prefix + '-list'"
                            @keydown.enter.prevent
                        />
                    </div>
                    <div class="col-auto">
                        <ActionButton
                            class="btn-sm"
                            variant="outline-secondary"
                            :disabled="disabled"
                            @click="reset"
                            >{{ messages.t('eventPicker.resetFilters') }}</ActionButton
                        >
                    </div>
                </div>
                <details class="border border-secondary rounded p-2 mb-2">
                    <summary class="small">{{ messages.t('eventPicker.advancedFilters') }}</summary>
                    <div class="row g-2 mt-1">
                        <div class="col-sm-6">
                            <label class="form-label small" :for="prefix + '-from'">{{
                                messages.t('eventPicker.dateFrom')
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
                                messages.t('eventPicker.dateTo')
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
                                messages.t('eventPicker.period')
                            }}</label
                            ><select
                                :id="prefix + '-period'"
                                v-model="filters.period"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('common.all') }}</option>
                                <option value="upcoming">{{ messages.t('eventPicker.upcoming') }}</option>
                                <option value="ongoing">{{ messages.t('eventPicker.ongoing') }}</option>
                                <option value="ended">{{ messages.t('eventPicker.ended') }}</option>
                            </select>
                        </div>
                        <div class="col-sm-4">
                            <label class="form-label small" :for="prefix + '-archive'">{{
                                messages.t('eventPicker.archiveFilter')
                            }}</label
                            ><select
                                :id="prefix + '-archive'"
                                v-model="filters.archive"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('common.all') }}</option>
                                <option value="active">{{ messages.t('common.active') }}</option>
                                <option value="archived">{{ messages.t('common.archived') }}</option>
                            </select>
                        </div>
                        <div class="col-sm-4">
                            <label class="form-label small" :for="prefix + '-deadline'">{{
                                messages.t('eventPicker.deadlineFilter')
                            }}</label
                            ><select
                                :id="prefix + '-deadline'"
                                v-model="filters.deadline"
                                class="form-select form-select-sm text-bg-dark"
                                :disabled="disabled"
                            >
                                <option value="all">{{ messages.t('common.all') }}</option>
                                <option value="open">{{ messages.t('eventPicker.openDeadline') }}</option>
                                <option value="passed">{{ messages.t('eventPicker.passedDeadline') }}</option>
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
                        >{{ messages.t('eventPicker.noEvent') }}</ActionButton
                    >
                    <p class="small mb-0" role="status">
                        {{ messages.t('eventPicker.currentSelection', {title: selectionTitle}) }}
                    </p>
                </div>
                <p v-if="selection?.archived" class="small text-info">
                    {{ messages.t('eventPicker.archivedEventHint') }}
                </p>
                <p v-if="invalidDates" class="small text-danger" role="alert">
                    {{ messages.t('eventPicker.invalidEventDates') }}
                </p>
                <!-- Retain only this admitted family's successful page/time after
                     a temporary read failure; confirmed denial hides old choices. -->
                <StatusNotice v-else-if="options.error.value" kind="warning" class="small"
                    :last-updated-at="displayed ? confirmedPage?.updatedAt : undefined"
                    :retry-at="retryAt" :read-error="options.error.value">{{
                    messages.t(displayed ? 'state.stale' : 'state.loadFailed')
                }}</StatusNotice>
                <!-- Search/filter controls stay usable while the independently authorized
                     options load. Background reads retain the known choices and selection. -->
                <LoadingSkeleton v-if="!invalidDates && !displayed && !options.error.value" :rows="4" />
                <p v-if="options.isFetching.value && displayed" class="small text-secondary" role="status">
                    <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ messages.t('common.loading') }}
                </p>
                <ul
                    :id="prefix + '-list'"
                    class="list-group list-group-flush text-bg-dark overflow-auto"
                    :aria-label="messages.t('eventPicker.availableEvents')"
                    :aria-describedby="prefix + '-summary'"
                    :aria-busy="options.isFetching.value"
                    style="max-height: 22rem"
                >
                    <li
                        v-for="event in invalidDates ? [] : visibleOptions"
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
                    v-if="!invalidDates && displayed"
                    :id="prefix + '-summary'"
                    class="small text-secondary mt-2 mb-2"
                    aria-live="polite"
                >
                    <template v-if="visibleOptions.length"
                        >{{
                            messages.t('eventPicker.eventPage', {
                                page: shownPage,
                                count: visibleOptions.length,
                            })
                        }}
                        {{ displayed.nextCursor ? messages.t('eventPicker.moreEvents') : '' }}</template
                    ><template v-else>{{
                        messages.t(
                            displayed.nextCursor
                                ? 'eventPicker.emptyEventBatch'
                                : 'eventPicker.noMatchingEvents',
                        )
                    }}</template>
                </p>
                <div class="d-flex gap-2">
                    <ActionButton
                        v-if="history.length > 1"
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled || searchPending || options.isFetching.value || !retryAvailable"
                        @click="previous"
                        >{{ messages.t('eventPicker.previousPage') }}</ActionButton
                    ><ActionButton
                        v-if="displayed?.nextCursor"
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled || searchPending || options.isFetching.value || !retryAvailable"
                        @click="next"
                        >{{ messages.t('eventPicker.nextPage') }}</ActionButton
                    ><ActionButton
                        v-if="options.error.value"
                        class="btn-sm"
                        variant="outline-secondary"
                        :disabled="disabled || searchPending || options.isFetching.value || !retryAvailable"
                        @click="retry"
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
