<script setup lang="ts">
import type {FrontendCreationAdmissionNoticesProps} from '../../types/FrontendCreationTypes';
import {useFrontend} from '../app/context';
import StatusNotice from './StatusNotice.vue';

// Event, standalone Survey and list creation keep their admitted definitions,
// local drafts and retry operations. This owner presents their matching read
// warnings only; it creates no query, command, timer or authority snapshot.
defineProps<FrontendCreationAdmissionNoticesProps>();
const emit = defineEmits<{retryRead: []; retrySubmission: []}>();
const {messages} = useFrontend();
</script>

<template>
    <StatusNotice
        v-if="read.error"
        :kind="read.kind ?? 'warning'"
        :last-updated-at="read.lastUpdatedAt"
        :retry-at="read.retryAt"
        :read-error="read.error"
        :action="{state: read.action, label: messages.t('common.retry')}"
        @action="emit('retryRead')"
    >
        {{ messages.t(read.stale ? 'state.stale' : 'state.loadFailed') }}
    </StatusNotice>
    <StatusNotice
        v-if="submission.error"
        kind="warning"
        :last-updated-at="submission.lastUpdatedAt"
        :retry-at="submission.retryAt"
        :read-error="submission.error"
        :action="{state: submission.action, label: messages.t('common.retry')}"
        @action="emit('retrySubmission')"
    >
        {{ messages.t(submission.lastUpdatedAt ? 'state.stale' : 'state.loadFailed') }}
    </StatusNotice>
</template>
