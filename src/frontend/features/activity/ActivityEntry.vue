<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {usePilot} from '../../app/context';
import {overviewKeys, activityKeys} from '../../app/queryKeys';
import {useActivityApi} from './api';
import ActivityPage from './ActivityPage.vue';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';

const context = usePilot();
const api = useActivityApi(context);
const route = useRoute();
const planId = computed(() => String(route.params.planId).toLowerCase());
const guestRoute = computed(() => route.path.endsWith('/guest'));

// Initial admission belongs to one URL and identity. Reusing this wrapper for another
// list, locale or explicit guest route gets its own query through the shared entry owner.
const nativeInitial = context.initialDocumentFor(route.fullPath);
const initialEntry: components['schemas']['ActivityResourceEntry'] | undefined = nativeInitial
    ? {entry: nativeInitial.pageEntry ?? {kind: 'render'},
        guest: nativeInitial.guestEntry ?? null}
    : undefined;


/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source list's read authority. */
function deniedQueries(entry: {readonly status: number}, scope: PilotRequestScope): EntityEntryRetirement {
    const actor = scope.context;
    const resource = planId.value;
    const families: (readonly unknown[])[] = [activityKeys.detailFamily(actor, resource), activityKeys.editors(actor, resource),
        activityKeys.events(actor), overviewKeys.all(actor)];
    if (entry.status === 404) {
        // Missing resources invalidate both intents. The shared owner handles the current
        // admission family without canceling the response that produced this denial.
        families.push(activityKeys.entry(actor, resource, guestRoute.value ? 'detail' : 'guest'), activityKeys.guest(actor, resource));
    }
    // A future duplicate visit needs fresh source admission after deletion. An observed
    // copy already belongs to its independent creation draft and must remain intact.
    return {families, inactiveFamilies: entry.status === 404 ? [activityKeys.duplicate(actor, resource)] : []};
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['ActivityResourceEntry']> {
    return api.resourceEntry(planId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

/** Inject Activity's generated operations into the shared guest presentation. */
function readGuestEntry(scope: PilotRequestScope, signal?: AbortSignal) {
    return api.guestEntry(planId.value, scope, signal);
}

function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) {
    return api.registerGuest(planId.value, input, scope);
}

</script>

<template>
    <EntityEntryPage
        :query-key="activityKeys.entry(context.session.value?.context, planId, guestRoute ? 'guest' : 'detail')"
        :initial="initialEntry"
        :read="readEntry"
        :denied-queries="deniedQueries"
        >
        <template #default="{guest}">
            <GuestEntryPage
                v-if="guestRoute"
                :entry="guest"
                :resource-id="planId"
                :destination="'/frontend-pilot/activity/' + planId"
                title-key="app.activity"
                :query-key="activityKeys.guest(context.session.value?.context, planId)"
                :read-entry="readGuestEntry"
                :register-guest="registerGuest"
            />
            <ActivityPage v-else />
        </template>
    </EntityEntryPage>
</template>
