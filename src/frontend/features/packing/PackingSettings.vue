<script setup lang="ts">
import {computed} from 'vue';
import {useFrontend} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {usePackingApi} from './api';
import MetadataFields from './MetadataFields.vue';
import EntitySettingsDialog from '../../components/EntitySettingsDialog.vue';

// The feature supplies generated operation selection, actual metadata fields and
// scoped cache families. The shared dialog owns all matching root-settings flows.
const props = defineProps<{listId: string; listTitle?: string; metadataAvailable?: boolean}>();
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = useFrontend();
const api = usePackingApi(context);
const key = computed(() => packingKeys.settings(context.session.value?.context, props.listId));
const profiles = computed(() => packingKeys.profilesFamily(context.session.value?.context, props.listId));
const metadataProps = computed(() => ({listId: props.listId, listTitle: props.listTitle}));
function profileKey(query: string) { return packingKeys.profiles(context.session.value?.context, props.listId, query); }
// Bind methods to the feature's existing adapter; no shared control constructs endpoints.
const operations = {settings: api.settings.bind(api), profiles: api.profiles.bind(api),
    setDefaults: api.setDefaults.bind(api), addAdmin: api.addAdmin.bind(api), updateAdmin: api.updateAdmin.bind(api),
    removeAdmin: api.removeAdmin.bind(api), uploadHeader: api.uploadHeader.bind(api), removeHeader: api.removeHeader.bind(api),
    archive: api.archive.bind(api), deleteResource: api.deletePacking.bind(api),
    eventPicker: api.eventPicker, linkEvent: api.linkEvent.bind(api)};
</script>

<template>
    <EntitySettingsDialog :resource-id="listId" :resource-title="listTitle" :metadata-available="metadataAvailable"
        :metadata-component="MetadataFields" :metadata-props="metadataProps" :operations="operations"
        :settings-key="key" :profile-key="profileKey" :profile-family="profiles"
        :duplicate-to="'/packing/' + listId + '/duplicate'" deleted-key="packing.deleted"
        @close="emit('close')" @saved="emit('saved')" @access-lost="emit('accessLost')" />
</template>
