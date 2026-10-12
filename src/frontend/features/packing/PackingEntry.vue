<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {overviewKeys, packingKeys} from '../../app/queryKeys';
import {evictQueryFamilies} from '../../app/queryCache';
import {usePackingApi} from './api';
import {usePageEntry} from '../../composables/pageEntry';
import {usePageTitle} from '../../composables/pageTitle';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import PageMessage from '../../components/PageMessage.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
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
    key: computed(() => packingKeys.entry(context.session.value?.context, listId.value, guestRoute.value ? 'guest' : 'detail')),
    read: readEntry,
    initial: initialEntry,
    onDenied: retireDeniedProjections,
});

/** Admission and detail reads are independent. A typed entry denial must retire private
 * projections even when it unmounts the detail before that read can report its own failure.
 * Public guest admission has its own policy; a participant denial does not revoke it.
 * Copied duplicate drafts also remain independent of their source list's read authority. */
async function retireDeniedProjections(entry: {readonly status: number}, scope: PilotRequestScope): Promise<void> {
    const actor = scope.context;
    const resource = listId.value;
    const families: (readonly unknown[])[] = [packingKeys.detailFamily(actor, resource), packingKeys.editors(actor, resource),
        packingKeys.events(actor), overviewKeys.all(actor)];
    if (entry.status === 404) {
        // Missing resources invalidate both intents. The shared owner handles the current
        // admission family without canceling the response that produced this denial.
        families.push(packingKeys.entry(actor, resource, guestRoute.value ? 'detail' : 'guest'), packingKeys.guest(actor, resource));
    }
    const retirements = [evictQueryFamilies(context.queryClient, families)];
    if (entry.status === 404) {
        // A future duplicate visit needs fresh source admission after deletion. An observed
        // copy already belongs to its independent creation draft and must remain intact.
        retirements.push(evictQueryFamilies(context.queryClient, [packingKeys.duplicate(actor, resource)], 'inactive'));
    }
    await Promise.all(retirements);
}

/** The server owns the distinction between detail admission and the explicit public guest
 * entry exception. The feature supplies only its route intent and resource identifier. */
function readEntry(scope: PilotRequestScope, signal: AbortSignal): Promise<components['schemas']['PackingResourceEntry']> {
    return api.resourceEntry(listId.value, guestRoute.value ? 'guest' : 'detail', scope, signal);
}

// A typed server denial keeps its native wording. Transport failure instead
// offers read recovery, and neither case exposes a private detail payload merely
// because an earlier admission query retained data in the cache.
const admissionError = computed(() => {
    const entry = admission.outcome.value;
    if (entry?.kind === 'denied') {
        return context.messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    }
    return admission.error.value && entry?.kind !== 'render' ? context.messages.value.t('state.loadFailed') : undefined;
});
// A transport failure is recoverable without changing the typed native denial
// outcome. Keep one deadline owner; Retry repeats only this resource admission GET.
const recoverableRead = computed(() => !!admission.error.value && admission.outcome.value?.kind !== 'denied');
const retryAvailable = useReadRetry(() => admission.error.value);
const retryAt = useReadRetryAt(() => admission.error.value, retryAvailable);
usePageTitle(() => admissionError.value ? context.messages.value.t('common.errorTitle') : undefined);
</script>

<template>
    <!-- Reuse the ordinary error card/Home action. Admission errors disclose no
         private list values and mount no resource queries. -->
    <PageMessage v-if="admissionError" kind="error" :message="admissionError"
        :renewal="admission.outcome.value?.kind === 'denied' ? admission.outcome.value.messageKey : admission.error.value"
        :transient="admission.outcome.value?.kind === 'denied'"
        :retry-at="recoverableRead ? retryAt : undefined"
        :read-error="recoverableRead ? admission.error.value : undefined">
        <ActionButton v-if="recoverableRead" variant="outline-light" :pending="admission.reading.value"
            :disabled="!retryAvailable" @click="admission.retry">{{ context.messages.value.t('common.retry') }}</ActionButton>
    </PageMessage>
    <template v-else-if="admission.outcome.value?.kind === 'render'">
        <!-- Admission can fail independently of the child's resource read. Keep
             that authorized subtree and its local draft mounted while exposing
             this read's own stale receipt, deadline and read-only recovery. -->
        <StatusNotice v-if="recoverableRead" kind="warning" :last-updated-at="admission.admittedAt.value"
            :retry-at="retryAt" :read-error="admission.error.value">
            {{ context.messages.value.t(admission.admittedAt.value ? 'state.stale' : 'state.loadFailed') }}
            <ActionButton class="btn-sm ms-2" variant="outline-light" :pending="admission.reading.value"
                :disabled="!retryAvailable" @click="admission.retry">{{ context.messages.value.t('common.retry') }}</ActionButton>
        </StatusNotice>
        <PackingGuestPage v-if="guestRoute" :entry="admission.data.value?.guest ?? undefined" />
        <PackingPage v-else />
    </template>
    <LoadingSkeleton v-else variant="form" />
</template>
