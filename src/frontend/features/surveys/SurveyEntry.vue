<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {EntityEntryRetirement} from '../../../types/FrontendEntityEntryTypes';
import {useFrontend} from '../../app/context';
import {resourceRouteIntent} from '../../composables/pageEntry';
import {overviewKeys, surveyKeys} from '../../app/queryKeys';
import {useSurveysApi} from './api';
import EntityEntryPage from '../../components/EntityEntryPage.vue';
import GuestEntryPage from '../identity/GuestEntryPage.vue';
import SurveyPage from './SurveyPage.vue';

const context = useFrontend();
const api = useSurveysApi(context);
const route = useRoute();
const surveyId = computed(() => String(route.params.surveyId).toLowerCase());
const guestRoute = computed(() => resourceRouteIntent(route) === 'guest');
const initial = context.initialDocumentFor(route.fullPath);
const initialEntry: components['schemas']['SurveyResourceEntry'] | undefined = initial
    ? {entry: initial.pageEntry ?? {kind: 'render'}, guest: initial.guestEntry ?? null} : undefined;

/** Detail denial retires its private projections without revoking an independent
 * guest admission. An active copied creation draft owns its values separately. */
function deniedQueries(entry: {readonly status: number}, scope: FrontendRequestScope): EntityEntryRetirement {
    const actor = scope.context;
    const id = surveyId.value;
    const families: (readonly unknown[])[] = [surveyKeys.detailFamily(actor, id), surveyKeys.editors(actor, id), overviewKeys.all(actor)];
    if (entry.status === 404) families.push(surveyKeys.entry(actor, id, guestRoute.value ? 'detail' : 'guest'), surveyKeys.guest(actor, id));
    return {families, inactiveFamilies: entry.status === 404 ? [surveyKeys.duplicate(actor, id)] : []};
}

function readEntry(scope: FrontendRequestScope, signal: AbortSignal) {
    return api.resourceEntry(surveyId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}
function readGuestEntry(scope: FrontendRequestScope, signal?: AbortSignal) { return api.guestEntry(surveyId.value, scope, signal); }
function registerGuest(input: components['schemas']['GuestRegistrationInput'], scope: FrontendRequestScope) {
    return api.registerGuest(surveyId.value, input, scope);
}
</script>

<template>
    <EntityEntryPage :query-key="surveyKeys.entry(context.session.value?.context, surveyId, guestRoute ? 'guest' : 'detail')"
        :initial="initialEntry" :read="readEntry" :denied-queries="deniedQueries">
        <template #default="{guest}">
            <GuestEntryPage v-if="guestRoute" :entry="guest" :resource-id="surveyId" :destination="'/survey/' + surveyId"
                title-key="app.survey" :query-key="surveyKeys.guest(context.session.value?.context, surveyId)"
                :read-entry="readGuestEntry" :register-guest="registerGuest" />
            <SurveyPage v-else />
        </template>
    </EntityEntryPage>
</template>
