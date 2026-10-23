<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useActionState, usePilot} from '../../app/context';
import {belongsToQueryFamily, eventKeys, overviewKeys} from '../../app/queryKeys';
import {evictQueryFamilies, refetchFreshQueries} from '../../app/queryCache';
import {isReadDenial} from '../../app/transport';
import {useSettingsAccessRetirement} from '../../composables/listDetail';
import {usePageTitle} from '../../composables/pageTitle';
import {useEventApi} from './api';
import {eventDeniedQueries, useEventSection} from './useEventSection';
import EventSummary from './EventSummary.vue';
import EventSettings from './EventSettings.vue';
import EventRegistration from './EventRegistration.vue';
import EventParticipants from './EventParticipants.vue';
import EventBypassLinks from './EventBypassLinks.vue';
import EventThingsToDo from './EventThingsToDo.vue';
import FinanceSection from '../finance/FinanceSection.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import EntityHeader from '../../components/EntityHeader.vue';
import RefreshButton from '../../components/RefreshButton.vue';

const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const route = useRoute();
const eventId = computed(() => String(route.params.eventId).toLowerCase());
const admin = computed(() => route.path.endsWith('/admin'));
const key = computed(() => eventKeys.detail(context.session.value?.context, eventId.value, admin.value));
const section = useEventSection(key, readEvent, computed(() => true));
const event = section.data;
// The page GET can finish before its selected subsection reads. Retain only
// this initiating presentation lifetime; each query keeps its own authority.
const refreshingPage = ref(false);
const pageReadAction = useActionState({eligible: () => section.readAction.isAvailable(),
    pending: () => refreshingPage.value || section.query.isFetching.value});
const financeEnabled = computed(() => !!event.value && (admin.value
    ? event.value.capabilities.manageAssignments : !!event.value.registration && event.value.hasInvoicePools));
const editorOpen = ref(false);
const retireSettingsAccess = useSettingsAccessRetirement({active: () => section.readAction.isAvailable(), refresh: refreshPresentation});
// Event supplies its admitted image/query operation to the same displayed
// header as Packing. Dashboard headings deliberately retain their native shape.
const readHeader = api.header.bind(api);
usePageTitle(pageTitle, true);
watch(section.denied, closeDeniedSettings);
watch(section.query.error, retireDeniedProjections, {flush: 'sync'});
watch(financeEnabled, retireUnavailableFinance, {flush: 'sync'});

/** A fresh Event projection can release financial admission without denying the
 * whole page. Retire that intent's private finance snapshots and lazy details;
 * ordinary disclosure changes keep their admitted data and invoice draft. */
function retireUnavailableFinance(enabled: boolean): void {
    if (enabled) return;
    const actor = context.session.value?.context;
    void evictQueryFamilies(context.queryClient, [eventKeys.finance(actor, eventId.value, admin.value)], 'all');
}

/** Detail failures use the same Event-specific boundaries as page admission.
 * Preserve this observer's error/recovery while releasing affected sibling caches. */
function retireDeniedProjections(failure: Error | null): void {
    if (!isReadDenial(failure)) return;
    const actor = context.session.value?.context;
    const resource = eventId.value;
    const intent = admin.value ? 'admin' : 'detail';
    const selection = eventDeniedQueries(actor, resource, intent, failure.status);
    // The read owner already cleared its producing query's private body. Removing
    // that observed Query would detach the visible explicit recovery control.
    void evictQueryFamilies(context.queryClient, selection.families, 'all', key.value);
    if (selection.inactiveFamilies?.length)
        void evictQueryFamilies(context.queryClient, selection.inactiveFamilies, 'inactive', eventKeys.entry(actor, resource, intent));
}

function pageTitle(): string {
    // Document branding differs from the visible dashboard heading. Keep both
    // native page intents explicit while the shared owner follows locale changes.
    if (!event.value) return messages.value.t('event.createDocumentTitle');
    return messages.value.t(admin.value ? 'event.adminDocumentTitle' : 'event.documentTitle', {title: event.value.title});
}
function readEvent(scope: Parameters<typeof api.event>[1], signal: AbortSignal) {
    return api.event(eventId.value, scope, signal, admin.value);
}
function closeDeniedSettings(denied: boolean): void {
    if (denied) editorOpen.value = false;
}
/** Release Settings separately from independently granted Event projections.
 * The shared retirement owner cancels private editor reads before safe detail recovery. */
function settingsAccessLost(): void {
    // Close this dialog immediately; its loss does not revoke roster/child grants.
    editorOpen.value = false;
    const actor = context.session.value?.context;
    void retireSettingsAccess({resourceId: eventId.value, currentResource: () => eventId.value,
        families: [eventKeys.editors(actor, eventId.value)]});
}

/** UI events leave failed-read presentation with its query. Causal command
 * follow-ups still call the rejecting refresh below to preserve saved/stale outcomes. */
async function refreshPresentation(mode: 'dependencies' | 'page' = 'dependencies'): Promise<void> {
    if (mode === 'page') {
        if (!pageReadAction.isAvailable()) return;
        refreshingPage.value = true;
    }
    try {
        await refresh(mode);
    } catch {
        // The affected query retains its durable failure and recovery action.
    } finally {
        // Ordinary command callbacks retain their narrow dependency read. Only
        // the explicit page gesture owns this whole-page pending/focus claim.
        if (mode === 'page') refreshingPage.value = false;
    }
}

/** The own Event GET is required authority before dependent reads. Explicit page
 * Refresh includes every admitted subsection; command callbacks retain only
 * their existing participant/Overview dependencies and rejection semantics. */
async function refresh(mode: 'dependencies' | 'page' = 'dependencies'): Promise<void> {
    const scope = context.capture();
    const resource = eventId.value;
    const intent = admin.value;
    const families: (readonly unknown[])[] = [eventKeys.participants(scope.context, resource), overviewKeys.all(scope.context)];
    if (mode === 'page') families.push(eventKeys.links(scope.context, resource), eventKeys.things(scope.context, resource, intent),
        eventKeys.finance(scope.context, resource, intent));

    await section.refresh();
    // Each subsection keeps its own read, admission and draft owner. Captured
    // keys cannot turn a late completion into reads for another Event or intent.
    await refetchFreshQueries(context.queryClient, {
        type: 'active',
        predicate: query => families.some(family => belongsToQueryFamily(query, family)),
    }, () => context.mayRead(scope) && resource === eventId.value && intent === admin.value, {allowEmpty: true});
}
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <EntityHeader
            :resource-id="eventId"
            :title="admin ? messages.t('event.dashboard', {title: event?.title ?? ''}) : event?.title ?? ''"
            :icon="admin ? 'bi-speedometer2' : 'bi-calendar2-event'"
            :image-version="event?.headerVersion"
            :image-query-key="key"
            :read-image="readHeader"
            :image-enabled="!admin && !!event && !section.denied.value"
            :settings-available="!!event?.capabilities.settings"
            @settings="editorOpen = true"
        >
            <template #actions>
                <RefreshButton v-if="!section.denied.value" :state="pageReadAction" @refresh="refreshPresentation('page')" />
            </template>
        </EntityHeader>
        <div class="card-body">
            <StatusNotice
                v-if="section.query.error.value"
                kind="warning"
                :read-error="section.query.error.value"
                :retry-at="section.retryAt.value"
                :last-updated-at="event ? section.query.dataUpdatedAt.value : undefined"
                :action="{state: pageReadAction, label: messages.t('common.refresh')}"
                @action="refreshPresentation('page')"
            >
                {{ section.failure.value }}
            </StatusNotice>
            <LoadingSkeleton v-if="section.loading.value" v-bind="route.meta.loadingSkeleton" />

            <template v-if="event">
                <!-- One bounded projection drives both page intents. Registration,
                     roster, management and export remain independent capabilities. -->
                <StatusNotice v-if="event.archive.direct || event.archive.inherited" kind="info">
                    {{ messages.t('packing.archived') }}
                </StatusNotice>
                <EventSummary :event="event" :admin="admin" />

                <EventRegistration v-if="!admin" :event="event" :refresh="refresh" />
                <EventBypassLinks v-if="admin && event.capabilities.manageRegistrations" :event-id="event.id" />
                <EventParticipants
                    v-if="event.capabilities.participants && (admin || !!event.registration)"
                    :event-id="event.id"
                    :start-date="event.startDate"
                    :end-date="event.endDate"
                    :manage-registrations="admin && event.capabilities.manageRegistrations"
                />
                <EventThingsToDo
                    v-if="admin || (event.registration && event.capabilities.items)"
                    :event-id="event.id"
                    :admin="admin"
                />

                <!-- Finance has its own role-scoped read. Participant submission
                     and saved accounting share presentation without broadening
                     this page's Event projection or organizer command authority. -->
                <FinanceSection v-if="financeEnabled" :key="`${event.id}:${admin}`"
                    :event-id="event.id" :admin="admin" :enabled="financeEnabled" />
                <template v-if="admin && event.capabilities.exportParticipants">
                    <hr />
                    <h2 class="fs-3 mb-3">{{ messages.t('event.exports') }}</h2>
                    <a
                        class="btn btn-sm btn-outline-light"
                        :href="`/event/${event.id}/export/participants`"
                        target="_blank"
                        rel="noopener"
                    >
                        <i class="bi bi-printer me-1" aria-hidden="true"></i>{{ messages.t('event.participantsPdf') }}
                    </a>
                </template>

                <EventSettings
                    v-if="editorOpen && event.capabilities.settings"
                    :key="event.id"
                    :event-id="event.id"
                    :event-title="event.title"
                    @close="editorOpen = false"
                    @saved="refreshPresentation()"
                    @access-lost="settingsAccessLost"
                />
            </template>
        </div>
    </section>
</template>
