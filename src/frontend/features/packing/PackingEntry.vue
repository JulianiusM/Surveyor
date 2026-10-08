<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {usePackingApi} from './api';
import {usePageEntry} from '../../composables/pageEntry';
import {usePageTitle} from '../../composables/pageTitle';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import PageMessage from '../../components/PageMessage.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PackingPage from './PackingPage.vue';
import PackingGuestPage from '../identity/PackingGuestPage.vue';

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
const admission = usePageEntry({
    key: computed(() => [...packingKeys.resource(context.session.value?.context, listId.value), 'entry',
        guestRoute.value ? 'guest' : 'detail']),
    read: readEntry,
    initial: initialEntry,
});

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['PackingResourceEntry']> {
    return api.resourceEntry(listId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

const admissionError = computed(() => {
    const entry = admission.outcome.value;
    if (entry?.kind === 'denied') {
        return context.messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    }
    return admission.error.value && entry?.kind !== 'render' ? context.messages.value.t('state.loadFailed') : undefined;
});
usePageTitle(() => admissionError.value ? context.messages.value.t('common.errorTitle') : undefined);
</script>

<template>
    <!-- Reuse the ordinary error card/Home action. Admission errors disclose no
         private list values and mount no resource queries. -->
    <PageMessage v-if="admissionError" kind="error" :message="admissionError" />
    <PackingGuestPage v-else-if="admission.outcome.value?.kind === 'render' && guestRoute"
        :entry="admission.data.value?.guest ?? undefined" />
    <PackingPage v-else-if="admission.outcome.value?.kind === 'render'" />
    <LoadingSkeleton v-else variant="form" />
</template>
