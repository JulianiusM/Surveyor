<script setup lang="ts">
import {computed} from 'vue';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import type {EntityAutomationLabels} from '../../../types/FrontendEntityDialogTypes';
import {useEventApi} from './api';
import MetadataFields from './EventMetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// The feature supplies generated operation selection, actual metadata fields and
// scoped cache families. The shared dialog owns all matching root-settings flows.
const props = defineProps<{eventId: string; eventTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = useEventApi(context);
const key = computed(() => eventKeys.settings(context.session.value?.context, props.eventId));
const profiles = computed(() => eventKeys.profilesFamily(context.session.value?.context, props.eventId));
const metadataProps = computed(() => ({eventId: props.eventId, eventTitle: props.eventTitle}));
const automationLabels = computed<EntityAutomationLabels>(() => ({pause: context.messages.value.t('event.organizer.pauseAutomation'),
    resume: context.messages.value.t('event.organizer.resumeAutomation'), pausedHint: context.messages.value.t('event.automationPausedHint'),
    confirmResume: 'event.organizer.confirmResumeAutomation', pausedSuccess: 'event.organizer.automationPaused', resumedSuccess: 'event.organizer.automationResumed'}));
// The existing document export remains available through its independent native
// grants. The shared dialog checks the admitted capability before showing it.
const exportLink = computed(() => ({url: '/event/' + props.eventId + '/export/participants',
    label: context.messages.value.t('event.participantsPdf')}));
function profileKey(query: string) { return eventKeys.profiles(context.session.value?.context, props.eventId, query); }
// Bind methods to the feature's existing adapter; no shared control constructs endpoints.
const operations = {settings: api.settings.bind(api), profiles: api.profiles.bind(api),
    setDefaults: api.setDefaults.bind(api), addAdmin: api.addAdmin.bind(api), updateAdmin: api.updateAdmin.bind(api),
    removeAdmin: api.removeAdmin.bind(api), uploadHeader: api.uploadHeader.bind(api), removeHeader: api.removeHeader.bind(api),
    archive: api.archive.bind(api), automate: api.automate.bind(api), deleteResource: api.deleteEvent.bind(api)};
</script>

<template>
    <EntitySettingsDialog :resource-id="eventId" :resource-title="eventTitle" :metadata-available="metadataAvailable"
        :metadata-component="MetadataFields" :metadata-props="metadataProps" :operations="operations"
        :settings-key="key" :profile-key="profileKey" :profile-family="profiles"
        :automation-labels="automationLabels" :export-link="exportLink"
        :duplicate-to="'/frontend-pilot/event/' + eventId + '/duplicate'" deleted-key="event.deleted" restore-confirmation="event.confirmRestore" archive-confirmation="event.confirmArchive"
        @close="emit('close')" @saved="emit('saved')" @access-lost="emit('accessLost')" />
</template>
