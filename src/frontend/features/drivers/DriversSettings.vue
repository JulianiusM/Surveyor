<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {useFrontend} from '../../app/context';
import {driversKeys} from '../../app/queryKeys';
import {useDriversApi} from './api';
import BasicEntityMetadataFields from '../../components/BasicEntityMetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// Drivers supplies actual generated operations and its scoped query families.
// Shared settings, metadata, access, image, event and lifecycle owners retain
// their existing draft/command responsibilities without a second settings store.
const props = defineProps<{listId: string; listTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = useDriversApi(context);
const key = computed(() => driversKeys.settings(context.session.value?.context, props.listId));
const profiles = computed(() => driversKeys.profilesFamily(context.session.value?.context, props.listId));
const metadataProps = computed(() => ({prefix: 'drivers', resourceId: props.listId, resourceTitle: props.listTitle,
    queryKey: driversKeys.metadata(context.session.value?.context, props.listId), read: readMetadata, save: saveMetadata}));
function profileKey(query: string) { return driversKeys.profiles(context.session.value?.context, props.listId, query); }

/** Generated Drivers declarations and validation remain with its feature API;
 * the shared field editor receives only its admitted metadata protocol. */
function readMetadata(id: string, scope: FrontendRequestScope, signal?: AbortSignal, previous?: FrontendRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as FrontendRead<components['schemas']['DriversMetadata']> | undefined);
}
function saveMetadata(id: string, patch: EntityMetadataValues, token: string, scope: FrontendRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['DriversMetadataPatch'], token, scope);
}

const operations = {settings: api.settings.bind(api), profiles: api.profiles.bind(api),
    setDefaults: api.setDefaults.bind(api), addAdmin: api.addAdmin.bind(api), updateAdmin: api.updateAdmin.bind(api),
    removeAdmin: api.removeAdmin.bind(api), uploadHeader: api.uploadHeader.bind(api), removeHeader: api.removeHeader.bind(api),
    archive: api.archive.bind(api), deleteResource: api.deleteDrivers.bind(api),
    eventPicker: api.eventPicker, linkEvent: api.linkEvent.bind(api)};
</script>

<template>
    <EntitySettingsDialog :resource-id="listId" :resource-title="listTitle" :metadata-available="metadataAvailable"
        :metadata-component="BasicEntityMetadataFields" :metadata-props="metadataProps" :operations="operations"
        :settings-key="key" :profile-key="profileKey" :profile-family="profiles"
        :duplicate-to="'/drivers/' + listId + '/duplicate'" deleted-key="drivers.deleted"
        @close="emit('close')" @saved="emit('saved')" @access-lost="emit('accessLost')" />
</template>
