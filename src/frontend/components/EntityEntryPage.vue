<script setup lang="ts">
import {computed} from 'vue';
import type {EntityEntryPageProps} from '../../types/FrontendEntityEntryTypes';
import type {PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {usePilot} from '../app/context';
import {evictQueryFamilies} from '../app/queryCache';
import {usePageEntry} from '../composables/pageEntry';
import {usePageTitle} from '../composables/pageTitle';
import {useReadRetryAt} from '../composables/feedback';
import {isPlainMessageKey} from '../../modules/localization/translator';
import PageMessage from './PageMessage.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
import ActionButton from './ActionButton.vue';
import StatusNotice from './StatusNotice.vue';

// A feature supplies its actual native admission and dependent invalidation.
// Matching resources share one recovery/feedback lifetime and admitted subtree.
const props = defineProps<EntityEntryPageProps>();
const context = usePilot();
const admission = usePageEntry({key: computed(() => props.queryKey), initial: props.initial,
    read: props.read, onDenied: retireDeniedProjections});
const admissionError = computed(admissionErrorText);
const recoverableRead = computed(() => !!admission.error.value && admission.outcome.value?.kind !== 'denied');
const retryAt = useReadRetryAt(() => admission.error.value, admission.retryAvailable);
usePageTitle(() => admissionError.value ? context.messages.value.t('common.errorTitle') : undefined);

/** Admission and feature data have separate observers. Retire the feature-selected
 * projections before exposing denial, even when the detail subtree has unmounted.
 * Inactive creation copies retire separately so a live draft retains its values. */
async function retireDeniedProjections(entry: {readonly status: number}, scope: PilotRequestScope): Promise<void> {
    const producingFamily = [...props.queryKey];
    const selection = props.deniedQueries(entry, scope);
    const retirements = [evictQueryFamilies(context.queryClient, selection.families)];

    // The caller owns which intents become invalid. The query-cache owner keeps
    // cancellation/removal consistent without inferring feature permissions here.
    if (selection.inactiveFamilies?.length) {
        retirements.push(evictQueryFamilies(context.queryClient, selection.inactiveFamilies, 'inactive', producingFamily));
    }
    await Promise.all(retirements);
}

/** A validated denial owns its native message. Temporary read failures retain
 * an admitted subtree and its draft; unreadable delivery never creates authority. */
function admissionErrorText(): string | undefined {
    const entry = admission.outcome.value;
    // Known catalog keys translate safely; future parameterized keys remain generic.
    if (entry?.kind === 'denied') return context.messages.value.t(isPlainMessageKey(entry.messageKey) ? entry.messageKey : 'common.error');
    return admission.error.value && entry?.kind !== 'render' ? context.messages.value.t('state.loadFailed') : undefined;
}
</script>

<template>
    <PageMessage v-if="admissionError" kind="error" :message="admissionError"
        :renewal="admission.outcome.value?.kind === 'denied' ? admission.outcome.value.messageKey : admission.error.value"
        :transient="admission.outcome.value?.kind === 'denied'" :retry-at="recoverableRead ? retryAt : undefined"
        :read-error="recoverableRead ? admission.error.value : undefined">
        <ActionButton v-if="recoverableRead" variant="outline-light" :state="admission.retryAction" @click="admission.retry">{{ context.messages.value.t('common.retry') }}</ActionButton>
    </PageMessage>
    <template v-else-if="admission.outcome.value?.kind === 'render'">
        <StatusNotice v-if="recoverableRead" kind="warning" :last-updated-at="admission.admittedAt.value"
            :retry-at="retryAt" :read-error="admission.error.value"
            :action="{state: admission.retryAction, label: context.messages.value.t('common.retry')}" @action="admission.retry">
            {{ context.messages.value.t(admission.admittedAt.value ? 'state.stale' : 'state.loadFailed') }}
        </StatusNotice>
        <!-- Feature guest/detail branches consume this admitted envelope directly;
             a private detail never appears merely because its cache remains warm. -->
        <slot :guest="admission.data.value?.guest ?? undefined" />
    </template>
    <LoadingSkeleton v-else variant="form" />
</template>
