<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {usePilot} from '../../app/context';
import {overviewKeys, eventKeys} from '../../app/queryKeys';
import {useEventApi} from './api';
import EventPage from './EventPage.vue';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';

const context = usePilot();
const api = useEventApi(context);
const route = useRoute();
const eventId = computed(() => String(route.params.eventId).toLowerCase());
const guestRoute = computed(() => route.path.endsWith('/guest'));
const intent = computed(() => guestRoute.value ? 'guest' : route.path.endsWith('/admin') ? 'admin' : 'detail');
const regToken = computed(() => typeof route.query.regToken === 'string' ? route.query.regToken : undefined);
// A token-changing visit obtains its own canonical admission. This feature
// family uses an ordinal; shared page entry also binds the exact document URL.
const tokenVisit = ref(0);
watch(regToken, () => { tokenVisit.value++; }, {flush: 'sync'});
const destination = computed(() => '/frontend-pilot/event/' + eventId.value
    + (regToken.value ? '?regToken=' + encodeURIComponent(regToken.value) : ''));

// Initial admission belongs to one URL and identity. Reusing this wrapper for another
// Event, locale or explicit guest route gets its own query through the shared entry owner.
const nativeInitial = context.initialDocumentFor(route.fullPath);
const initialEntry = nativeInitial?.eventEntry;


/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source Event's read authority. */
function deniedQueries(entry: {readonly status: number}, scope: PilotRequestScope): EntityEntryRetirement {
    const actor = scope.context;
    const resource = eventId.value;
    // Losing administration does not revoke independent roster, participant or
    // metadata grants. Retire only this page intent unless the root is missing.
    const families: (readonly unknown[])[] = guestRoute.value ? [eventKeys.guest(actor, resource)]
        : [eventKeys.detail(actor, resource, intent.value === 'admin'), eventKeys.things(actor, resource, intent.value === 'admin')];
    if (entry.status === 404) {
        // Missing resources invalidate every other intent and token visit. The
        // shared owner preserves the current response that produced this denial.
        for (const view of ['detail', 'guest', 'admin'] as const) {
            if (view !== intent.value) families.push(eventKeys.entry(actor, resource, view));
        }
        families.push(eventKeys.guest(actor, resource));
        families.push(eventKeys.detail(actor, resource), eventKeys.detail(actor, resource, true),
            eventKeys.participants(actor, resource), eventKeys.links(actor, resource), eventKeys.things(actor, resource),
            eventKeys.things(actor, resource, true), eventKeys.editors(actor, resource), overviewKeys.all(actor));
    }
    // Previous token visits and unused duplicate seeds retire only while inactive.
    // A mounted creation draft stays independent of the source's missing detail.
    const inactiveFamilies = entry.status === 404
        ? [eventKeys.entry(actor, resource, intent.value), eventKeys.duplicate(actor, resource)] : [];
    return {families, inactiveFamilies};
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['EventResourceEntry']> {
    return api.resourceEntry(eventId.value, intent.value, scope, signal, regToken.value);
}

/** Inject Event's generated operations into the shared guest presentation. */
function readGuestEntry(scope: PilotRequestScope, signal?: AbortSignal) {
    return api.guestEntry(eventId.value, scope, signal, regToken.value);
}

function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
    return api.registerGuest(eventId.value, input, scope, regToken.value);
}

</script>

<template>
    <EntityEntryPage
        :query-key="eventKeys.entry(context.session.value?.context, eventId, intent, tokenVisit)"
        :initial="initialEntry" :read="readEntry" :denied-queries="deniedQueries"
    >
        <template #default="{guest}">
            <GuestEntryPage v-if="guestRoute" :entry="guest" :resource-id="eventId" :destination="destination"
                title-key="app.event"
                :query-key="eventKeys.guest(context.session.value?.context, eventId)"
                :read-entry="readGuestEntry" :register-guest="registerGuest" />
            <EventPage v-else />
        </template>
    </EntityEntryPage>
</template>
