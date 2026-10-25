<script setup lang="ts">
import {computed} from 'vue';
import type {EntityAutomationLabels} from '../../../types/FrontendEntityDialogTypes';
import {useFrontend} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {useActivityApi} from './api';
import ActivityMetadataFields from './ActivityMetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// Activity supplies actual generated operations and its scoped query families.
// Shared settings, metadata, access, image, event and lifecycle owners retain
// their existing draft/command responsibilities without a second settings store.
const props = defineProps<{planId: string; planTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = useActivityApi(context);
const key = computed(() => activityKeys.settings(context.session.value?.context, props.planId));
const profiles = computed(() => activityKeys.profilesFamily(context.session.value?.context, props.planId));
const metadataProps = computed(() => ({planId: props.planId, planTitle: props.planTitle}));
const automationLabels = computed<EntityAutomationLabels>(() => ({pause: context.messages.value.t('event.organizer.pauseAutomation'),
    resume: context.messages.value.t('event.organizer.resumeAutomation'), pausedHint: context.messages.value.t('event.automationPausedHint'),
    confirmResume: 'event.organizer.confirmResumeAutomation', pausedSuccess: 'event.organizer.automationPaused', resumedSuccess: 'event.organizer.automationResumed'}));
const exportLink = computed(() => ({url: '/activity/' + props.planId + '/export/schedule', label: context.messages.value.t('activity.exportSchedule')}));
function profileKey(query: string) { return activityKeys.profiles(context.session.value?.context, props.planId, query); }

const operations = {settings: api.settings.bind(api), profiles: api.profiles.bind(api),
    setDefaults: api.setDefaults.bind(api), addAdmin: api.addAdmin.bind(api), updateAdmin: api.updateAdmin.bind(api),
    removeAdmin: api.removeAdmin.bind(api), uploadHeader: api.uploadHeader.bind(api), removeHeader: api.removeHeader.bind(api),
    archive: api.archive.bind(api), automate: api.automate.bind(api), deleteResource: api.deleteActivity.bind(api),
    eventPicker: api.eventPicker, linkEvent: api.linkEvent.bind(api)};
</script>

<template>
    <EntitySettingsDialog
        :resource-id="planId"
        :resource-title="planTitle"
        :metadata-available="metadataAvailable"
        :metadata-component="ActivityMetadataFields"
        :metadata-props="metadataProps"
        :operations="operations"
        :settings-key="key"
        :profile-key="profileKey"
        :profile-family="profiles"
        :duplicate-to="'/activity/' + planId + '/duplicate'"
        deleted-key="activity.deleted"
        :automation-labels="automationLabels"
        :event-extra-hint="context.messages.value.t('activity.eventLinkHint')"
        :linked-event-archive-hint="context.messages.value.t('activity.linkedArchiveHint')"
        :export-link="exportLink"
        @close="emit('close')"
        @saved="emit('saved')"
        @access-lost="emit('accessLost')"
    />
</template>
