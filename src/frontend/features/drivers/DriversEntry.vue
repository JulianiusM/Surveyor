<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {usePilot} from '../../app/context';
import {overviewKeys, driversKeys} from '../../app/queryKeys';
import {useDriversApi} from './api';
import DriversPage from './DriversPage.vue';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';

const context = usePilot();
const api = useDriversApi(context);
const route = useRoute();
const listId = computed(() => String(route.params.listId).toLowerCase());
const guestRoute = computed(() => route.path.endsWith('/guest'));

// Initial admission belongs to one URL and identity. Reusing this wrapper for another
// list, locale or explicit guest route gets its own query through the shared entry owner.
const nativeInitial = context.initialDocumentFor(route.fullPath);
const initialEntry: components['schemas']['DriversResourceEntry'] | undefined = nativeInitial
    ? {entry: nativeInitial.pageEntry ?? {kind: 'render'},
        guest: nativeInitial.guestEntry ?? null}
    : undefined;


/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source list's read authority. */
function deniedQueries(entry: {readonly status: number}, scope: PilotRequestScope): EntityEntryRetirement {
    const actor = scope.context;
    const resource = listId.value;
    const families: (readonly unknown[])[] = [driversKeys.detailFamily(actor, resource), driversKeys.editors(actor, resource),
        driversKeys.events(actor), overviewKeys.all(actor)];
    if (entry.status === 404) {
        // Missing resources invalidate both intents. The shared owner handles the current
        // admission family without canceling the response that produced this denial.
        families.push(driversKeys.entry(actor, resource, guestRoute.value ? 'detail' : 'guest'), driversKeys.guest(actor, resource));
    }
    // A future duplicate visit needs fresh source admission after deletion. An observed
    // copy already belongs to its independent creation draft and must remain intact.
    return {families, inactiveFamilies: entry.status === 404 ? [driversKeys.duplicate(actor, resource)] : []};
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['DriversResourceEntry']> {
    return api.resourceEntry(listId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

/** Inject Drivers's generated operations into the shared guest presentation. */
function readGuestEntry(scope: PilotRequestScope, signal?: AbortSignal) {
    return api.guestEntry(listId.value, scope, signal);
}

function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
    return api.registerGuest(listId.value, input, scope);
}

</script>

<template>
    <EntityEntryPage
        :query-key="driversKeys.entry(context.session.value?.context, listId, guestRoute ? 'guest' : 'detail')"
        :initial="initialEntry" :read="readEntry" :denied-queries="deniedQueries"
    >
        <template #default="{guest}">
            <GuestEntryPage v-if="guestRoute" :entry="guest" :resource-id="listId" :destination="'/frontend-pilot/drivers/' + listId"
                title-key="app.drivers"
                :query-key="driversKeys.guest(context.session.value?.context, listId)"
                :read-entry="readGuestEntry" :register-guest="registerGuest" />
            <DriversPage v-else />
        </template>
    </EntityEntryPage>
</template>
