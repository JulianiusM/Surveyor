<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePackingApi} from './api';
import {usePilot} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {useMetadataEditorHandle} from '../../composables/metadataEditor';
import BasicEntityMetadataFields from '../../components/BasicEntityMetadataFields.vue';

// Packing owns its two fields and nullable-description semantics; the shared
// editor owns admitted reads, sparse drafts, confirmation and explicit recovery.
const props = withDefaults(defineProps<{listId: string; listTitle?: string; disabled?: boolean; busy?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const api = usePackingApi(context);
const editor = ref<InstanceType<typeof BasicEntityMetadataFields> | null>(null);
const key = computed(() => packingKeys.metadata(context.session.value?.context, props.listId));

/** Generated Packing declarations and validators keep wire policy in the feature. */
function read(id: string, scope: PilotRequestScope, signal?: AbortSignal, previous?: PilotRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as PilotRead<components['schemas']['PackingMetadata']> | undefined);
}
function save(id: string, patch: EntityMetadataValues, token: string, scope: PilotRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['PackingMetadataPatch'], token, scope);
}
// Settings calls the shared editor's public workflow, preserving one draft owner.
defineExpose(useMetadataEditorHandle(editor));
</script>

<template>
    <BasicEntityMetadataFields ref="editor" prefix="packing" :resource-id="listId" :resource-title="listTitle" :disabled="disabled"
        :busy="busy" :active="active" :query-key="key" :read="read" :save="save"
        @saved="emit('saved')" @close="emit('close')" @access-lost="emit('accessLost')" />
</template>
