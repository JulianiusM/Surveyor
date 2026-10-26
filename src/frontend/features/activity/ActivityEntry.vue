<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {useFrontend} from '../../app/context';
import {entityEntryRetirement, resourceRouteIntent} from '../../composables/pageEntry';
import {overviewKeys, activityKeys} from '../../app/queryKeys';
import {useActivityApi} from './api';
import ActivityPage from './ActivityPage.vue';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';

const context = useFrontend();
const api = useActivityApi(context);
const route = useRoute();
const planId = computed(() => String(route.params.planId).toLowerCase());
const guestRoute = computed(() => resourceRouteIntent(route) === 'guest');

// Initial admission belongs to one URL and identity. Reusing this wrapper for another
// list, locale or explicit guest route gets its own query through the shared entry owner.
const initialDocument = context.initialDocumentFor(route.fullPath);
const initialEntry: components['schemas']['ActivityResourceEntry'] | undefined = initialDocument
    ? {entry: initialDocument.pageEntry ?? {kind: 'render'},
        guest: initialDocument.guestEntry ?? null}
    : undefined;


/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source list's read authority. */
function deniedQueries(entry: {readonly status: number}, scope: FrontendRequestScope): EntityEntryRetirement {
    return entityEntryRetirement({status: entry.status, actor: scope.context, resource: planId.value,
        intent: guestRoute.value ? 'guest' : 'detail', keys: activityKeys, additionalFamilies: [activityKeys.events(scope.context), overviewKeys.all(scope.context)]});
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: FrontendRequestScope, signal: AbortSignal): Promise<components['schemas']['ActivityResourceEntry']> {
    return api.resourceEntry(planId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

/** Inject Activity's generated operations into the shared guest presentation. */
function readGuestEntry(scope: FrontendRequestScope, signal?: AbortSignal) {
    return api.guestEntry(planId.value, scope, signal);
}

function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) {
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
                :destination="'/activity/' + planId"
                title-key="app.activity"
                :query-key="activityKeys.guest(context.session.value?.context, planId)"
                :read-entry="readGuestEntry"
                :register-guest="registerGuest"
            />
            <ActivityPage v-else />
        </template>
    </EntityEntryPage>
</template>
