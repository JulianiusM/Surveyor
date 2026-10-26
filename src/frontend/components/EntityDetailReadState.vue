<script setup lang="ts">
import type {FrontendLoadingSkeleton} from '../../types/FrontendUiTypes';
import {useFrontend} from '../app/context';
import LoadingSkeleton from './LoadingSkeleton.vue';
import StatusNotice from './StatusNotice.vue';

// Detail owners supply their admitted/read state and successful timestamp. This
// composition presents the same denial, stale/cold warning and missing-data shape
// without another query, receipt, retry timer, data store or authority decision.
defineProps<{
    denied: boolean;
    error: Error | null;
    hasData: boolean;
    pending: boolean;
    refreshing?: boolean;
    lastUpdatedAt?: number;
    retryAt?: number;
    skeleton?: FrontendLoadingSkeleton;
}>();
const {messages} = useFrontend();
</script>

<template>
    <StatusNotice v-if="denied" kind="danger" :retry-at="retryAt" :read-error="error">
        {{ messages.t('state.forbidden') }}
    </StatusNotice>
    <StatusNotice v-else-if="error" kind="warning" :last-updated-at="lastUpdatedAt"
        :retry-at="retryAt" :read-error="error">{{ messages.t(hasData ? 'state.stale' : 'state.loadFailed') }}</StatusNotice>
    <!-- Features may supply contextual recovery while heading Refresh remains
         independent. The fragment never replaces admitted data or mounted drafts
         during background reads. -->
    <slot />
    <LoadingSkeleton v-if="!hasData && !denied && pending" v-bind="skeleton" />
    <!-- Background reads retain usable content and drafts. Reserve one small
         status row so periodic progress never shifts the controls below it. -->
    <div v-else-if="hasData && !denied" style="min-height: 1.5rem">
        <span v-if="refreshing" class="d-inline-flex align-items-center gap-2 small text-body-secondary" role="status">
            <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
            {{ messages.t('common.loading') }}
        </span>
    </div>
</template>
