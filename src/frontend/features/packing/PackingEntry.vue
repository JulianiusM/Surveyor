<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {usePilot} from '../../app/context';
import {overviewKeys, packingKeys} from '../../app/queryKeys';
import {usePackingApi} from './api';
import PackingPage from './PackingPage.vue';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';

const context = usePilot();
const api = usePackingApi(context);
const route = useRoute();
const listId = computed(() => String(route.params.listId).toLowerCase());
const guestRoute = computed(() => route.path.endsWith('/guest'));

// Initial admission belongs to one URL and identity. Reusing this wrapper for another
// list, locale or explicit guest route gets its own query through the shared entry owner.
const nativeInitial = context.initialDocumentFor(route.fullPath);
const initialEntry: components['schemas']['PackingResourceEntry'] | undefined = nativeInitial
    ? {entry: nativeInitial.pageEntry ?? (nativeInitial.packingError
        ? {kind: 'denied', status: 404, messageKey: nativeInitial.packingError} : {kind: 'render'}),
        guest: nativeInitial.guestEntry ?? null}
    : undefined;


/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source list's read authority. */
function deniedQueries(entry: {readonly status: number}, scope: PilotRequestScope): EntityEntryRetirement {
    const actor = scope.context;
    const resource = listId.value;
    const families: (readonly unknown[])[] = [packingKeys.detailFamily(actor, resource), packingKeys.editors(actor, resource),
        packingKeys.events(actor), overviewKeys.all(actor)];
    if (entry.status === 404) {
        // Missing resources invalidate both intents. The shared owner handles the current
        // admission family without canceling the response that produced this denial.
        families.push(packingKeys.entry(actor, resource, guestRoute.value ? 'detail' : 'guest'), packingKeys.guest(actor, resource));
    }
    // A future duplicate visit needs fresh source admission after deletion. An observed
    // copy already belongs to its independent creation draft and must remain intact.
    return {families, inactiveFamilies: entry.status === 404 ? [packingKeys.duplicate(actor, resource)] : []};
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['PackingResourceEntry']> {
    return api.resourceEntry(listId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

/** Inject Packing's generated operations into the shared guest presentation. */
function readGuestEntry(scope: PilotRequestScope, signal?: AbortSignal) {
    return api.guestEntry(listId.value, scope, signal);
}

function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
    return api.registerGuest(listId.value, input, scope);
}

</script>

<template>
    <EntityEntryPage
        :query-key="packingKeys.entry(context.session.value?.context, listId, guestRoute ? 'guest' : 'detail')"
        :initial="initialEntry" :read="readEntry" :denied-queries="deniedQueries"
    >
        <template #default="{guest}">
            <GuestEntryPage v-if="guestRoute" :entry="guest" :resource-id="listId" :destination="'/frontend-pilot/packing/' + listId"
                title-key="app.packing"
                :query-key="packingKeys.guest(context.session.value?.context, listId)"
                :read-entry="readGuestEntry" :register-guest="registerGuest" />
            <PackingPage v-else />
        </template>
    </EntityEntryPage>
</template>
