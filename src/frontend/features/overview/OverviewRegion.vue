<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, watch} from 'vue';
import {isNavigationFailure, useRoute, useRouter} from 'vue-router';
import type {LocationQuery, NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components, paths} from '../../../types/api/v1';
import type {PilotOverviewCardInteraction, PilotOverviewCountRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {overviewQueryParameters, useOverviewApi} from './api';
import {usePackingApi} from '../packing/api';
import {useEventApi} from '../event/api';
import {useDriversApi} from '../drivers/api';
import {useSurveysApi} from '../surveys/api';
import {useActivityApi} from '../activity/api';
import {createEntityLifecycle, useEntityRemoval} from '../../composables/entityLifecycle';
import {useActionState, usePilot, refreshInterval} from '../../app/context';
import {useCommand} from '../../composables/command';
import {isOrdinaryNavigation, useConfirmedNavigation} from '../../composables/pageEntry';
import {useDebouncedValue} from '../../composables/debounced';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {observePageNavigation} from '../../composables/pageNavigation';
import {ApiFailure, isReadDenial, isTerminalReadFailure, ObsoleteRequestError} from '../../app/transport';
import {overviewKeys} from '../../app/queryKeys';
import {observeQueryReads, refetchFreshQueries, refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import AppNavigationDropdown from '../../components/AppNavigationDropdown.vue';
import OverviewCard from './OverviewCard.vue';
import OverviewItems from './OverviewItems.vue';

const props = withDefaults(defineProps<{
    collection: components['schemas']['OverviewRegion']['collection'];
    region: components['schemas']['OverviewRegion']['region'];
    active?: boolean;
}>(), {active: true});
const emit = defineEmits<{counts: [source: PilotOverviewCountRead | null, scope: PilotRequestScope]}>();
const context = usePilot();
const api = useOverviewApi(context);
const packingApi = usePackingApi(context);
const eventApi = useEventApi(context);
const driversApi = useDriversApi(context);
const surveyApi = useSurveysApi(context);
const activityApi = useActivityApi(context);
// The mixed projection already owns feature command dispatch. Keep its bounded
// migration decision here too; card components receive operations, never import
// feature APIs or grow a registry as subsequent route families migrate.
const packingInteraction: PilotOverviewCardInteraction = {migrated: true, readHeader: packingApi.header.bind(packingApi)};
const nativeInteraction: PilotOverviewCardInteraction = {migrated: false};

function cardInteraction(card: components['schemas']['OverviewCard']): PilotOverviewCardInteraction {
    if (card.type === 'event') return {migrated: true, readHeader: eventApi.header.bind(eventApi), duplicateUrl: card.url + '/duplicate'};
    if (card.type === 'drivers') return {migrated: true, readHeader: driversApi.header.bind(driversApi), duplicateUrl: card.url + '/duplicate'};
    if (card.type === 'survey') return {migrated: true, readHeader: surveyApi.header.bind(surveyApi), duplicateUrl: card.url + '/duplicate'};
    if (card.type === 'activity') return {migrated: true, readHeader: activityApi.header.bind(activityApi), duplicateUrl: card.url + '/duplicate'};
    if (card.type !== 'packing') return nativeInteraction;
    return {...packingInteraction, duplicateUrl: card.url + '/duplicate'};
}
const {messages} = context;
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const route = useRoute();
const router = useRouter();
// Visible/hidden regions coexist, including across collections. Keep confirmed
// delivery scoped to this logical region through any actor-driven remount.
const destination = useConfirmedNavigation(props.collection + ':' + props.region);
// Remaining feature families retain native administration destinations until
// their explicit migration phases; this region already shares Vue navigation.
let readGeneration = 0;
let mounted = true;
const element = ref<HTMLElement | null>(null);
const searchPending = ref(false);
const navigation = observePageNavigation(router, {scope: 'all', started: rememberNavigation, finished: finishNavigation});
onBeforeUnmount(() => {
    mounted = false;
    readGeneration++;
    navigation.dispose();
});
const title = computed(() =>
    messages.value.t(props.collection === 'participant' ? 'overview.participation' : 'overview.managed'),
);
const prefix = computed(() => props.collection + '_' + props.region + '_');
const regionId = computed(() => 'overview-' + props.collection + '-' + props.region);
type Query = NonNullable<paths['/overview']['get']['parameters']['query']>;
type NavigationAction = 'filter' | 'page' | 'expand' | 'back';
interface NavigationRead {
    parameters: Query;
    scope: PilotRequestScope;
    generation: number;
    action: NavigationAction;
    history: 'push' | 'replace';
}
const pendingRead = shallowRef<NavigationRead | null>(null);
const failedRead = shallowRef<NavigationRead | null>(null);
const navigationError = shallowRef<Error | null>(null);
let preparedRead: NavigationRead | undefined;
let pendingFocus: {key: string; scope: PilotRequestScope; action: NavigationAction} | undefined;
let returnPosition: {eventId: string; filters: string; scrollY: number} | undefined;
const lastConfirmed = shallowRef<{
    scope: PilotRequestScope;
    data: components['schemas']['OverviewRegion'];
    updatedAt: number;
} | null>(null);
const deniedRead = shallowRef<{scope: PilotRequestScope; error: ApiFailure} | null>(null);

function parameter(name: string, values = route.query): string | undefined {
    const value = values[prefix.value + name];
    return typeof value === 'string' ? value : undefined;
}
function regionParameters(values: LocationQuery): Query {
    return overviewQueryParameters(values, props.collection, props.region);
}
const query = computed<Query>(() => regionParameters(route.query));
const search = ref(query.value.q ?? '');
useDebouncedValue(search, 300, finishTypedSearch);
watch(
    () => query.value.q,
    (value) => {
        // Back may commit while the next typed search is still debouncing. Preserve
        // that input; its filter will apply to the settled/pending destination below.
        if (!searchPending.value) search.value = value ?? '';
    },
);
const overviewKey = computed(() => overviewKeys.region(context.session.value?.context, context.locale.value, query.value));
const readAdmission = useQueryAdmission(context, overviewKey,
    computed(() => props.active !== false && context.hydrated.value && context.visible.value));
const overview = useQuery({
    queryKey: overviewKey,
    ...readAdmission,
    queryFn: ({signal}) => loadOverview(signal),
    initialData: () => context.initialDocumentFor(route.fullPath)?.session.locale === context.locale.value
        ? context.initialDocumentFor(route.fullPath)?.overview?.find(value => value.collection === props.collection && value.region === props.region) : undefined,
    refetchOnMount: 'always',
    refetchInterval: (value) =>
        props.active !== false && context.mayRead() && context.visible.value
            ? refreshInterval(value.state.error, value.state.fetchFailureCount, jitter) : false,
});
// A navigation failure retains readable cards, never new edit authority. Keep only this
// region's confirmed projection, fenced by actor/locale and discarded on a known denial.
const currentDenial = computed(() => deniedRead.value && context.isCurrent(deniedRead.value.scope, true)
    ? deniedRead.value : undefined);
// A later failed recovery owns its current diagnostic and server deadline. The
// original denial remains an authority barrier, including while another key has
// no error, until an actual successful read restores this region's projection.
const readError = computed(() => overview.error.value ?? currentDenial.value?.error ?? null);
const displayed = computed(() => {
    if (currentDenial.value || isReadDenial(readError.value)) return;
    if (overview.data.value) return overview.data.value;
    return lastConfirmed.value && context.isCurrent(lastConfirmed.value.scope, true) ? lastConfirmed.value.data : undefined;
});
// A failed target can have no query timestamp of its own. Keep the last successful
// receipt with its scoped projection, never borrow a date from unrelated or denied data.
const lastUpdatedAt = computed(() => {
    const confirmed = lastConfirmed.value;
    return confirmed && toRaw(displayed.value) === toRaw(confirmed.data) && context.isCurrent(confirmed.scope, true)
        ? confirmed.updatedAt : undefined;
});
// Every mounted region resolves independently. Keep confirmed cards and focused filters
// during background refreshes; only missing, pending authority receives card shapes.
const initialLoading = computed(() => props.active !== false && !displayed.value
    && overview.isPending.value && !overview.error.value);
const filterTypes = computed(() => {
    const types = displayed.value?.availableTypes ?? [];
    const selected = displayed.value?.type;
    // A saved filter can outlive its last visible member after another client's edit or a
    // personal hide. Retain the validated choice so an empty result does not claim All types.
    return selected && selected !== 'all' && !types.includes(selected) ? [...types, selected] : types;
});
// Cards retain their identity when an equal JSON result is structurally shared.
// An actual readable response supplies its successful-read timestamp and an
// explicit presentation-recovery hint. Neither grants command authority; healthy
// card images ignore the hint. Failed/canceled reads and manual cache aliases
// advance neither observation; canonical navigation owns its admitted delivery.
const imageReadRevision = ref(0);
const stopOverviewReads = observeQueryReads<components['schemas']['OverviewRegion']>(
    context.queryClient, () => overviewKey.value, finishOverviewRead);
onBeforeUnmount(stopOverviewReads);

function finishOverviewRead(value: components['schemas']['OverviewRegion'], updatedAt: number): void {
    // The shared owner supplies this exact key's actual DTO and success receipt.
    // Do not depend on observer notification timing or compare its reactive proxy
    // with raw cache action data; the feature's route/actor fences own admission.
    const scope = context.capture();
    if (!mayPresentRead(scope, readGeneration) || deniedRead.value) return;
    // Equal JSON can retain the same object, so the data watcher alone cannot
    // record a later successful refresh. Count emissions still belong to that watcher.
    lastConfirmed.value = {scope, data: value, updatedAt};
    // Parent badges use the same actual successful receipt, including equal reads.
    // Only its key/lifetime crosses this boundary; no numeric snapshot is duplicated.
    emit('counts', {scope, key: overviewKey.value, updatedAt}, scope);
    imageReadRevision.value++;
}

watch(overview.data, (value) => {
    if (value && !deniedRead.value) {
        // Native bookmarked reads render the server's normalized query. Adopt it
        // only while this field still represents the route's unchanged input;
        // a newer typed draft or target navigation owns its separate confirmation.
        // Equal text leaves the focused input and its selection untouched.
        if (!searchPending.value && !pendingRead.value && search.value === (query.value.q ?? '')
            && search.value !== value.q) search.value = value.q;
        lastConfirmed.value = {scope: context.capture(), data: value, updatedAt: overview.dataUpdatedAt.value};
        // Initial SSR/cached delivery is already admitted by this observer's scope.
        // Subsequent network receipts advance independently through finishOverviewRead.
        const scope = context.capture();
        emit('counts', {scope, key: overviewKey.value, updatedAt: overview.dataUpdatedAt.value}, scope);
    }
}, {immediate: true});
watch([overview.dataUpdatedAt, overview.isFetching, overview.error], restoreCommittedFocus, {flush: 'post'});
const retryAvailable = useReadRetry(() => navigationError.value ?? readError.value);
const retryAt = useReadRetryAt(() => navigationError.value ?? readError.value, retryAvailable);
watch([context.epoch, context.locale], retirePresentation, {flush: 'sync'});
// A private preference can change both collection appearances. Refresh all mounted regions
// together; server-owned placement remains separate from authoritative archival.
async function refresh(): Promise<void> {
    const scope = context.capture();
    const generation = readGeneration;
    // A terminal rejection suspends automatic observation. Explicit recovery
    // still admits this exact mounted region, without reviving closed siblings.
    if (isTerminalReadFailure(overview.error.value)) {
        await refetchFreshQuery(context.queryClient, overviewKey.value, refetchRegion, mayRead);
        return;
    }
    await refetchFreshQueries(context.queryClient,
        {
            queryKey: overviewKeys.all(context.session.value?.context),
            type: 'active',
        },
        mayRead,
    );

    function mayRead(): boolean {
        return context.mayRead(scope) && mayPresentRead(scope, generation);
    }
}

function refetchRegion(): Promise<unknown> {
    return overview.refetch({throwOnError: true});
}
const command = useCommand(refresh);
const packingLifecycle = createEntityLifecycle(packingApi, command, messages);
const eventLifecycle = createEntityLifecycle(eventApi, command, messages);
const driversLifecycle = createEntityLifecycle(driversApi, command, messages);
const surveyLifecycle = createEntityLifecycle(surveyApi, command, messages);
const activityLifecycle = createEntityLifecycle(activityApi, command, messages);
const removal = useEntityRemoval(command, destination);
const blocked = computed(() => command.action.disabled.value
    || !!destination.target.value);
const actionsBlocked = computed(() => blocked.value || !!pendingRead.value || !overview.data.value || !displayed.value);
// Filters can replace an earlier in-flight filter. Only their existing admission
// and command locks apply; Refresh separately waits for current read progress.
const navigationAction = useActionState({eligible: mayNavigateRegion, blocked: () => blocked.value});
const retryNavigationAction = useActionState({eligible: mayRetryNavigation,
    pending: () => !!pendingRead.value, blocked: () => blocked.value});
const refreshAction = useActionState({eligible: mayRefreshRegion,
    pending: () => overview.isFetching.value || !!pendingRead.value,
    blocked: () => command.recoveryAction.disabled.value});

function mayNavigateRegion(): boolean {
    return mounted && props.active !== false && context.mayRead() && retryAvailable.value;
}

function mayRetryNavigation(): boolean {
    return !!failedRead.value && context.mayRead(failedRead.value.scope, true) && retryAvailable.value;
}

function mayRefreshRegion(): boolean {
    return failedRead.value ? retryNavigationAction.isAvailable() : mayNavigateRegion();
}

/** A failed explicit read is already represented by its region's query warning.
 * Keep that read-owned recovery surface without leaking a rejected Vue event promise
 * or replacing another region's command feedback with duplicate error state. */
async function refreshOverview(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    if (failedRead.value) { await retryNavigation(); return; }
    await command.reconcileSafely();
}

/** Capture a read before awaiting its response. Input retires the generation immediately,
 * so even a transport that finishes after cancellation cannot publish obsolete results. */
async function loadOverview(signal: AbortSignal): Promise<components['schemas']['OverviewRegion']> {
    return readRegion({...query.value}, context.capture(), readGeneration, signal);
}

/** Both route-owned refreshes and enhanced navigation share the same captured read fence. */
async function readRegion(requested: Query, scope: PilotRequestScope, generation: number,
                          signal: AbortSignal): Promise<components['schemas']['OverviewRegion']> {
    try {
        const result = await api.overview(requested, scope, signal);
        if (!mayPresentRead(scope, generation)) throw new ObsoleteRequestError();

        // Only a newer, admitted read can restore this region after a denial. Cached
        // variants and a temporary recovery failure cannot restore its old authority.
        deniedRead.value = null;
        return result;
    } catch (failure) {
        if (isReadDenial(failure) && mayPresentRead(scope, generation)) retireDeniedRegion(scope, failure);
        throw failure;
    }
}

/** A current denial retires this region's fallback and every cached filter/page variant.
 * Advance the generation before cache cancellation so a held target response cannot
 * publish cards, a canonical cache alias or history after access has been withdrawn. */
function retireDeniedRegion(scope: PilotRequestScope, error: ApiFailure): void {
    readGeneration++;
    pendingRead.value = null;
    failedRead.value = null;
    navigationError.value = null;
    pendingFocus = undefined;
    lastConfirmed.value = null;
    returnPosition = undefined;
    deniedRead.value = {scope, error};
    // This region's aggregate authority disappears with its cards. A sibling
    // region can retain its own independently admitted receipt in the parent.
    emit('counts', null, scope);

    // Preserve unrelated collection/region observations and their independent reads.
    void retireQueryFamily(context.queryClient,
        overviewKeys.regionAuthority(scope.context, props.collection, props.region), error);
}

function mayPresentRead(scope: PilotRequestScope, generation: number): boolean {
    return mounted && props.active !== false && generation === readGeneration && context.isCurrent(scope, true)
        && route.path === '/frontend-pilot' && (!navigation.destination.value || navigation.destination.value.path === '/frontend-pilot');
}

/** Fence this region when Router starts a relevant Back/Forward or page change.
 * Its own prepared read stays attached to that destination; sibling regions
 * retain their requests and only a later admitted render may restore focus. */
function rememberNavigation(to: RouteLocationNormalized): void {
    // Back/Forward can start outside this component. Only changed parameters for this
    // region retire its requests; another region's navigation must leave them running.
    const parameters = ['q', 'type', 'page', 'childPage', 'event'];
    if (parameters.some(name => to.query[prefix.value + name] !== route.query[prefix.value + name])) {
        if (preparedRead && navigationKey(preparedRead.parameters) === navigationKey(regionParameters(to.query))) return;
        const action = parameter('event') && !parameter('event', to.query) ? 'back' : 'page';
        retireReads();
        if (to.path === '/frontend-pilot') {
            pendingFocus = {key: navigationKey(regionParameters(to.query)), scope: context.capture(), action};
        }
    }
}

function finishNavigation(to: RouteLocationNormalized, _from?: RouteLocationNormalized, failure?: NavigationFailure | void): void {
    if (failure && pendingFocus?.key === navigationKey(regionParameters(to.query))) pendingFocus = undefined;
}

/** Cancel this region's previous reads before the native debounce expires. Other regions
 * retain their independent requests, and the last confirmed cards stay readable. */
function retireReads(): void {
    readGeneration++;
    pendingRead.value = null;
    failedRead.value = null;
    navigationError.value = null;
    pendingFocus = undefined;
    void context.queryClient.cancelQueries({queryKey: overviewKeys.regionFamily(
        context.session.value?.context, context.locale.value, props.collection, props.region,
    )});
}

function editSearch(event: Event): void {
    search.value = (event.target as HTMLInputElement).value;
    if (blocked.value) return;
    searchPending.value = true;
    retireReads();
}

function submitSearch(): void {
    if (!navigationAction.isAvailable()) return;
    searchPending.value = false;
    void navigate({q: search.value || undefined, page: undefined, childPage: undefined}, 'replace');
}

function finishTypedSearch(value: string): void {
    if (searchPending.value && value === search.value) submitSearch();
}
watch(() => props.active, active => {
    if (active !== false) return;
    searchPending.value = false;
    retireReads();
});
/** Merge this region's sparse parameters into the latest requested whole-page
 * URL. Undefined removes only its own field; other collections, selected events
 * and hidden-region disclosure survive independent navigation in a sibling. */
function navigationQuery(values: Record<string, string | undefined>) {
    // Native typing during Back targets the requested destination rather than the
    // still-rendered old event. Merge only this region into the latest whole-page URL.
    const next = {...(navigation.destination.value?.query ?? route.query)};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[prefix.value + key];
        else next[prefix.value + key] = value;
    }

    // Native region URLs explicitly retain disclosure even when entered through a
    // selected-event deep link that did not originally include the open parameter.
    if (props.region === 'hidden') next[prefix.value + 'open'] = '1';
    return next;
}
function navigationHref(values: Record<string, string | undefined>): string {
    return router.resolve({path: '/frontend-pilot', query: navigationQuery(values), hash: '#' + regionId.value}).href;
}

/** Locale/actor replacement cannot reuse private cards, scroll origins or a failed request. */
function retirePresentation(): void {
    retireReads();
    lastConfirmed.value = null;
    deniedRead.value = null;
    returnPosition = undefined;
}

/** Keep saved-link/new-tab semantics before the shared region navigation owns an ordinary click. */
function followNavigation(event: MouseEvent, values: Record<string, string | undefined>,
                          history: 'push' | 'replace' = 'push', action: NavigationAction = 'filter'): void {
    if (!isOrdinaryNavigation(event)) return;
    event.preventDefault();
    void navigate(values, history, action);
}

function navigationKey(parameters: Query): string {
    return JSON.stringify([parameters.q || '', parameters.type || 'all', parameters.page || '1',
        parameters.childPage || '1', parameters.eventId || '']);
}

function filterKey(parameters: Query): string {
    return JSON.stringify([parameters.q || '', parameters.type || 'all']);
}

/** Read the target first, then commit only this region's URL parameters. A failed Next
 * leaves its cards, focus and browser history unchanged; Retry retains the exact target. */
async function navigate(values: Record<string, string | undefined>, history: 'push' | 'replace' = 'push',
                        action: NavigationAction = 'filter'): Promise<void> {
    if (!navigationAction.isAvailable()) return;
    const parameters = regionParameters(navigationQuery(values));
    searchPending.value = false;
    retireReads();
    await deliverNavigation({parameters, history, action, scope: context.capture(), generation: readGeneration});
}

/** A retry is another authorized GET, never a replay of an entity mutation. The query
 * client retains server cooldown/retry policy; the descriptor holds request data and delivery policy only. */
async function retryNavigation(): Promise<void> {
    const failed = failedRead.value;
    if (!failed || !retryNavigationAction.isAvailable()) return;
    retireReads();
    await deliverNavigation({...failed, generation: readGeneration});
}

/** The cache remains the read authority. Prefetch forces an explicit fresh read, while
 * the route observer adopts that validated result without requesting it a second time. */
async function deliverNavigation(read: NavigationRead): Promise<void> {
    pendingRead.value = read;
    try {
        const result = await context.queryClient.fetchQuery({
            queryKey: overviewKeys.region(read.scope.context, read.scope.locale, read.parameters),
            queryFn: readTarget,
            staleTime: 0,
        });
        if (!mayPresentRead(read.scope, read.generation)) return;

        // The server clamps pages and clears an event that no longer qualifies. Adopt
        // that authoritative navigation state before publishing its URL; alias the same
        // validated projection under its canonical key so the observer needs no extra GET.
        const canonical = {...read.parameters, q: result.q || undefined, type: result.type === 'all' ? undefined : result.type,
            page: result.page > 1 ? String(result.page) : undefined,
            childPage: result.childPage > 1 ? String(result.childPage) : undefined, eventId: result.eventId || undefined};
        if (JSON.stringify(canonical) !== JSON.stringify(read.parameters))
            context.queryClient.setQueryData(overviewKeys.region(read.scope.context, read.scope.locale, canonical), result);
        read.parameters = canonical;

        // Another region may have committed while this GET was pending. Merge the captured
        // region only into the latest route/pending history target, never its old whole URL.
        preparedRead = read;
        const destination = {path: '/frontend-pilot', query: targetQuery(read.parameters), hash: '#' + regionId.value};
        const failure = read.history === 'replace' ? await router.replace(destination) : await router.push(destination);
        if (isNavigationFailure(failure) && router.currentRoute.value.fullPath !== router.resolve(destination).fullPath) return;
        if (!mayPresentRead(read.scope, read.generation)) return;

        // A successful response also canonicalizes the submitted search text. The
        // route watcher cannot do this when trimming leaves the same q parameter;
        // this admitted generation still excludes any newer local input.
        search.value = result.q;
        failedRead.value = null;
        pendingFocus = {key: navigationKey(read.parameters), scope: read.scope, action: read.action};
        await restoreCommittedFocus();
    } catch (error) {
        if (mayPresentRead(read.scope, read.generation)) {
            failedRead.value = read;
            navigationError.value = error instanceof Error ? error : new Error(String(error));
        }
    } finally {
        if (preparedRead === read) preparedRead = undefined;
        if (pendingRead.value === read) pendingRead.value = null;
    }

    function readTarget({signal}: {signal: AbortSignal}): Promise<components['schemas']['OverviewRegion']> {
        return readRegion(read.parameters, read.scope, read.generation, signal);
    }
}

/** Commit this region's admitted target while preserving the latest sibling URL fields. */
function targetQuery(parameters: Query): LocationQuery {
    // Start from current/pending whole-page navigation, then replace only this prefix.
    const result = navigationQuery({});
    const values = {q: parameters.q, type: parameters.type, page: parameters.page,
        childPage: parameters.childPage, event: parameters.eventId};
    for (const [name, value] of Object.entries(values)) {
        if (value === undefined) delete result[prefix.value + name];
        else result[prefix.value + name] = String(value);
    }
    return result;
}

/** Native event expansion remembers its originating card and scroll position. Filter
 * changes retain that origin so Back can reveal the card instead of restoring an obsolete offset. */
function expand(card: components['schemas']['OverviewCard']): void {
    if (!navigationAction.isAvailable()) return;
    returnPosition = {eventId: card.id, filters: filterKey(query.value), scrollY: window.scrollY};
    void navigate({event: card.id, childPage: undefined}, 'push', 'expand');
}

/** Restore focus only after a matching successful read renders. Focused search controls
 * take precedence; failed/obsolete/background and other-region reads move neither focus nor scroll. */
async function restoreCommittedFocus(): Promise<void> {
    // Require the intended region/actor and a completed readable projection before
    // waiting for its DOM. Background or unrelated reads own no navigation intent.
    const intent = pendingFocus;
    if (!intent || !overview.data.value || overview.isFetching.value || overview.error.value
        || intent.key !== navigationKey(query.value) || !context.isCurrent(intent.scope, true)) return;

    await nextTick();

    // Rendering yields: a newer visit, disclosure, read or actor may have replaced
    // the intended destination. Recheck before consuming it or moving any focus.
    if (pendingFocus !== intent || !mounted || props.active === false || intent.key !== navigationKey(query.value)
        || !context.isCurrent(intent.scope, true) || overview.isFetching.value || overview.error.value) return;
    pendingFocus = undefined;

    // Consume the intent while retaining an actively edited search control. A
    // later blur/background refresh must not revive this navigation's focus move.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && element.value?.contains(active) && active.type === 'search') return;

    // Back returns to its originating event link. Restore the saved scroll only
    // for unchanged filters; a changed card layout instead reveals that link nearby.
    if (intent.action === 'back' && returnPosition) {
        const origin = [...(element.value?.querySelectorAll<HTMLAnchorElement>('[data-overview-event]') ?? [])]
            .find(link => link.dataset.overviewEvent === returnPosition?.eventId);
        if (origin) {
            origin.focus({preventScroll: true});
            if (returnPosition.filters === filterKey(query.value)) window.scrollTo({top: returnPosition.scrollY, behavior: 'instant'});
            else origin.scrollIntoView({block: 'nearest'});
            return;
        }
    }

    // Ordinary page/filter delivery, or a removed origin, announces this region
    // without imitating the old document-submit jump to its heading.
    element.value?.querySelector<HTMLElement>('.js-overview-heading')?.focus({preventScroll: true});
}
// GET search submits this region's controls, preserves other regions and the selected
// event, and drops both old pagers. Navigation needs no server-held per-tab state.
const nativeSearchFields = computed(() => Object.entries(route.query).filter(([key, value]) => typeof value === 'string'
    && !['q', 'type', 'page', 'childPage'].some(name => key === prefix.value + name)) as Array<[string, string]>);
function pageHref(next: number): string {
    return navigationHref({[displayed.value?.parent ? 'childPage' : 'page']: String(next)});
}
function expandHref(card: components['schemas']['OverviewCard']): string {
    return navigationHref({event: card.id, childPage: undefined});
}
function filterType(type: string): void {
    // Native type buttons submit the search field's current draft as well. Preserve that
    // behavior and reset both pagers without disturbing the selected event or other regions.
    void navigate({q: search.value || undefined, type: type === 'all' ? undefined : type,
        page: undefined, childPage: undefined}, 'replace');
}
/** Change only this actor's placement, independently of shared archival.
 * The server checks membership; the region's command owner refreshes current
 * projections without turning the selected visibility label into authority. */
async function setVisibility(
    card: components['schemas']['OverviewCard'],
    value: components['schemas']['OverviewVisibilityInput']['visibility'],
): Promise<void> {
    if (actionsBlocked.value) return;
    const success = value === 'hidden' ? 'overview.visibilityHidden'
        : value === 'shown' ? 'overview.visibilityShown' : 'overview.visibilityDefault';
    await command.run((scope) => api.visibility(card.type, card.id, value, scope), true, false,
        {success});
}

/** Confirm the shared lifecycle action using the card's inherited-state wording.
 * Fresh server policy remains authoritative; the command refreshes affected
 * regions and cannot silently turn restore/archive into personal hiding. */
async function archive(card: components['schemas']['OverviewCard'], restore: boolean): Promise<void> {
    if (actionsBlocked.value) return;
    const lifecycle = card.type === 'event' ? eventLifecycle : card.type === 'drivers' ? driversLifecycle
        : card.type === 'survey' ? surveyLifecycle : card.type === 'activity' ? activityLifecycle : packingLifecycle;
    await lifecycle.archive(card.id, restore, card.inheritedArchived,
        card.type === 'event' ? restore ? 'event.confirmRestore' : 'event.confirmArchive' : undefined, !!card.automation);
}

/** Personal Overview retains native schedule controls for admitted Event and
 * standalone Activity roots. Reuse their generated operations and this region's
 * command/refresh lifetime; card state never replaces server authorization. */
async function automate(card: components['schemas']['OverviewCard'], paused: boolean): Promise<void> {
    if (actionsBlocked.value || !card.automation?.canManage) return;

    // Only these existing feature APIs support independent schedules. Other
    // cards stay inert even if an obsolete callback survives their replacement.
    const lifecycle = card.type === 'event' ? eventLifecycle : card.type === 'activity' ? activityLifecycle : null;
    if (!lifecycle) return;
    await lifecycle.automate(card.id, paused);
}

/** Deliver permanent deletion through the existing confirmed-navigation owner.
 * A failed destination retains its receipt for navigation-only Retry; the
 * deleted card cannot become another eligible DELETE just because delivery failed. */
async function remove(card: components['schemas']['OverviewCard']): Promise<void> {
    if (actionsBlocked.value) return;
    const success = card.type === 'event' ? 'event.deleted' : card.type === 'drivers' ? 'drivers.deleted'
        : card.type === 'survey' ? 'survey.deleted' : card.type === 'activity' ? 'activity.deleted' : 'packing.deleted';
    await removal.remove({operation: deleteCard, confirmation: 'overview.confirmDelete', success});

    async function deleteCard(commandScope: PilotRequestScope): Promise<void> {
        if (card.type === 'event') await eventApi.deleteEvent(card.id, commandScope);
        else if (card.type === 'drivers') await driversApi.deleteDrivers(card.id, commandScope);
        else if (card.type === 'survey') await surveyApi.deleteSurvey(card.id, commandScope);
        else if (card.type === 'activity') await activityApi.deleteActivity(card.id, commandScope);
        else await packingApi.deletePacking(card.id, commandScope);
    }
}
function page(next: number): void {
    void navigate({[displayed.value?.parent ? 'childPage' : 'page']: String(next)}, 'push', 'page');
}
</script>
<template>
    <!-- Keep initial skeleton status unsuppressed; only confirmed content is busy
         during background reads, which leave cards and focused controls mounted. -->
    <section ref="element" :id="regionId" class="js-overview-region" :data-collection="collection" :data-region="region"
        :aria-busy="!!displayed && (overview.isFetching.value || !!pendingRead)">
        <h3 class="visually-hidden js-overview-heading" tabindex="-1">{{ title }}</h3>
        <StatusNotice v-if="destination.target.value" kind="success"
            :action="{state: destination.retryAction, label: messages.t('common.retry'), class: 'ms-2'}" @action="destination.retry">
            {{ messages.t('packing.deleted') }}
        </StatusNotice>
        <!-- Lifecycle/visibility results use common notifications. Read
             failures and unknown outcomes retain this region's recovery surface. -->
        <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value" />
        <StatusNotice v-if="readError || failedRead" kind="warning" :last-updated-at="lastUpdatedAt" :retry-at="retryAt"
            :read-error="navigationError ?? readError"
            :action="{state: refreshAction, label: messages.t('common.retry'), class: 'ms-2'}" @action="refreshOverview">{{
            messages.t(displayed ? 'state.stale' : 'state.loadFailed')
        }}</StatusNotice>
        <!-- Pending authority and an unsent local search draft keep the
             progressive controls mounted. Once an empty unfiltered region is confirmed
             without a local draft, omit the toolbar as the native presentation does. -->
        <form
            v-if="!displayed || displayed.regionEntities || displayed.q || displayed.type !== 'all' || searchPending || search"
            class="d-flex flex-wrap gap-2 mb-3 align-items-center"
            method="get" action="/frontend-pilot"
            @submit.prevent="submitSearch"
        >
            <input v-for="[name, value] in nativeSearchFields" :key="name" type="hidden" :name="name" :value="value" />
            <div class="input-group input-group-sm" style="max-width: 320px">
                <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span
                ><input
                    :value="search"
                    @input="editSearch"
                    :name="prefix + 'q'"
                    class="form-control"
                    type="search"
                    maxlength="200"
                    :aria-label="
                        messages.t('overview.collectionSearch', {
                            title: title.toLocaleLowerCase(context.locale.value),
                        })
                    "
                    :placeholder="
                        messages.t('overview.collectionSearch', {
                            title: title.toLocaleLowerCase(context.locale.value),
                        }) + '…'
                    "
                />
            </div>
            <ActionButton type="submit" class="btn-sm" variant="outline-secondary" :state="navigationAction"
                :name="prefix + 'type'" :value="query.type ?? 'all'">{{
                messages.t('overview.search')
            }}</ActionButton>
            <!-- Preserve the native Filter disclosure and ordinary type submit buttons.
                 Search stays first in DOM order so Enter retains the current type. The
                 shared disclosure owns dismissal/focus; this region owns URL selection. -->
            <AppNavigationDropdown :navigation="false" menu-tag="ul"
                :label="messages.t('overview.filter')"
                trigger-class="btn btn-outline-secondary btn-sm dropdown-toggle">
                <li>
                    <button class="dropdown-item" type="submit" :name="prefix + 'type'"
                        value="all" data-type="all" :aria-pressed="(query.type ?? 'all') === 'all'" :disabled="navigationAction.disabled.value"
                        @click.prevent="filterType('all')">{{ messages.t('overview.allTypes') }}</button>
                </li>
                <li><hr class="dropdown-divider" /></li>
                <li v-for="type in filterTypes" :key="type">
                    <button class="dropdown-item" type="submit" :name="prefix + 'type'"
                        :value="type" :data-type="type" :aria-pressed="query.type === type" :disabled="navigationAction.disabled.value"
                        @click.prevent="filterType(type)">{{ messages.t(`overview.types.${type}`) }}</button>
                </li>
            </AppNavigationDropdown>
            <span v-if="displayed" class="small text-body-secondary" aria-live="polite">{{
                messages.t('overview.matching', {count: displayed.matchingEntities})
            }}</span>
            <ActionButton
                class="btn-sm ms-auto"
                variant="outline-secondary"
                :state="refreshAction"
                @click="refreshOverview"
                >{{ messages.t('common.refresh') }}</ActionButton
            >
        </form>
        <LoadingSkeleton v-if="initialLoading" variant="cards" :rows="4" />
        <template v-if="displayed">
            <template v-if="displayed.parent">
                <a
                    class="btn btn-sm mb-3 btn-outline-secondary"
                    :href="navigationHref({event: undefined, childPage: undefined})" :aria-disabled="navigationAction.disabled.value"
                    @click="followNavigation($event, {event: undefined, childPage: undefined}, 'push', 'back')"
                >
                    <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ messages.t('overview.back') }}
                </a>
                <OverviewCard
                    :card="displayed.parent"
                    :interaction="cardInteraction(displayed.parent)"
                    :disabled="actionsBlocked"
                    :navigation-state="navigationAction"
                    :read-revision="imageReadRevision"
                    :active="active"
                    @visibility="setVisibility(displayed.parent, $event)"
                    @archive="archive(displayed.parent, $event)"
                    @automate="automate(displayed.parent, $event)"
                    @remove="remove(displayed.parent)"
                >
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <h4 class="h5 mb-0">
                            {{
                                messages.t('overview.linkedHeading', {
                                    title,
                                    count: displayed.totalChildren,
                                })
                            }}
                        </h4>
                        <a
                            v-if="query.q || (query.type && query.type !== 'all')"
                            class="btn btn-sm btn-outline-secondary"
                            :href="navigationHref({q: undefined, type: undefined, page: undefined, childPage: undefined})" :aria-disabled="navigationAction.disabled.value"
                            @click="followNavigation($event, {q: undefined, type: undefined, page: undefined, childPage: undefined}, 'replace')"
                            >{{ messages.t('overview.showAllLinked') }}</a
                        >
                    </div>
                    <OverviewItems
                        :view="displayed"
                        :disabled="actionsBlocked"
                        :navigation-state="navigationAction"
                        :read-revision="imageReadRevision"
                        :active="active"
                        :page-href="pageHref"
                        :expand-href="expandHref"
                        :card-interaction="cardInteraction"
                        @visibility="setVisibility"
                        @archive="archive"
                        @automate="automate"
                        @remove="remove"
                        @page="page"
                    />
                </OverviewCard>
            </template>
            <OverviewItems
                v-else
                :view="displayed"
                :disabled="actionsBlocked"
                :navigation-state="navigationAction"
                :read-revision="imageReadRevision"
                :active="active"
                :page-href="pageHref"
                :expand-href="expandHref"
                :card-interaction="cardInteraction"
                @visibility="setVisibility"
                @archive="archive"
                @automate="automate"
                @remove="remove"
                @expand="expand"
                @page="page"
            />
        </template>
    </section>
</template>
