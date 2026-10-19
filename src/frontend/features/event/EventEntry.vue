<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useEventApi} from './api';
import {eventDeniedQueries} from './useEventSection';
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
    return eventDeniedQueries(scope.context, eventId.value, intent.value, entry.status);
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
