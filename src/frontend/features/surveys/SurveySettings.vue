<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {useFrontend} from '../../app/context';
import {surveyKeys} from '../../app/queryKeys';
import {useSurveysApi} from './api';
import BasicEntityMetadataFields from '../../components/BasicEntityMetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// Survey supplies its owner-only projection to the matching shared editors.
// It has no parent event, permission matrix, administrators or automation panel.
const props = defineProps<{surveyId: string; surveyTitle?: string}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = useSurveysApi(context);
const key = computed(() => surveyKeys.settings(context.session.value?.context, props.surveyId));
const metadataProps = computed(() => ({prefix: 'survey', resourceId: props.surveyId, resourceTitle: props.surveyTitle,
    queryKey: surveyKeys.metadata(context.session.value?.context, props.surveyId), read: readMetadata, save: saveMetadata}));

function readMetadata(id: string, scope: FrontendRequestScope, signal?: AbortSignal, previous?: FrontendRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as FrontendRead<components['schemas']['SurveyMetadata']> | undefined);
}
function saveMetadata(id: string, patch: EntityMetadataValues, token: string, scope: FrontendRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['SurveyMetadataPatch'], token, scope);
}
const operations = {settings: api.settings.bind(api), uploadHeader: api.uploadHeader.bind(api),
    removeHeader: api.removeHeader.bind(api), archive: api.archive.bind(api), deleteResource: api.deleteSurvey.bind(api)};
</script>

<template>
    <EntitySettingsDialog :resource-id="surveyId" :resource-title="surveyTitle" metadata-available
        :metadata-component="BasicEntityMetadataFields" :metadata-props="metadataProps" :operations="operations"
        :settings-key="key" :duplicate-to="'/survey/' + surveyId + '/duplicate'" deleted-key="survey.deleted"
        @close="emit('close')" @saved="emit('saved')" @access-lost="emit('accessLost')" />
</template>
