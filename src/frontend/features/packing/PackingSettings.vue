<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {FrontendRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {useFrontend} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {usePackingApi} from './api';
import BasicEntityMetadataFields from '../../components/BasicEntityMetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// The feature supplies generated operation selection, actual metadata fields and
// scoped cache families. The shared dialog owns all matching root-settings flows.
const props = defineProps<{listId: string; listTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = usePackingApi(context);
const key = computed(() => packingKeys.settings(context.session.value?.context, props.listId));
const profiles = computed(() => packingKeys.profilesFamily(context.session.value?.context, props.listId));
const metadataProps = computed(() => ({prefix: 'packing', resourceId: props.listId, resourceTitle: props.listTitle,
    queryKey: packingKeys.metadata(context.session.value?.context, props.listId), read: readMetadata, save: saveMetadata}));
function profileKey(query: string) { return packingKeys.profiles(context.session.value?.context, props.listId, query); }

/** Feature API declarations keep the conditional metadata wire protocol local;
 * the existing common editor owns fields, draft, public handle and recovery. */
function readMetadata(id: string, scope: FrontendRequestScope, signal?: AbortSignal, previous?: FrontendRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as FrontendRead<components['schemas']['PackingMetadata']> | undefined);
}
function saveMetadata(id: string, patch: EntityMetadataValues, token: string, scope: FrontendRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['BasicEntityMetadataPatch'], token, scope);
}
// Bind methods to the feature's existing adapter; no shared control constructs endpoints.
const operations = {settings: api.settings.bind(api), profiles: api.profiles.bind(api),
    setDefaults: api.setDefaults.bind(api), addAdmin: api.addAdmin.bind(api), updateAdmin: api.updateAdmin.bind(api),
    removeAdmin: api.removeAdmin.bind(api), uploadHeader: api.uploadHeader.bind(api), removeHeader: api.removeHeader.bind(api),
    archive: api.archive.bind(api), deleteResource: api.deletePacking.bind(api),
    eventPicker: api.eventPicker, linkEvent: api.linkEvent.bind(api)};
</script>

<template>
    <EntitySettingsDialog :resource-id="listId" :resource-title="listTitle" :metadata-available="metadataAvailable"
        :metadata-component="BasicEntityMetadataFields" :metadata-props="metadataProps" :operations="operations"
        :settings-key="key" :profile-key="profileKey" :profile-family="profiles"
        :duplicate-to="'/packing/' + listId + '/duplicate'" deleted-key="packing.deleted"
        @close="emit('close')" @saved="emit('saved')" @access-lost="emit('accessLost')" />
</template>
