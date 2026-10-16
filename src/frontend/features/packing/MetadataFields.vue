<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePackingApi} from './api';
import {usePilot} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {normalizeNullableMetadataText} from '../../composables/metadataDraft';
import {useMetadataEditorHandle} from '../../composables/metadataEditor';
import EntityMetadataEditor from '../../components/EntityMetadataEditor.vue';

// Packing owns its two fields and nullable-description semantics; the shared
// editor owns admitted reads, sparse drafts, confirmation and explicit recovery.
const props = withDefaults(defineProps<{listId: string; listTitle?: string; disabled?: boolean; busy?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const {messages} = context;
const api = usePackingApi(context);
const editor = ref<InstanceType<typeof EntityMetadataEditor> | null>(null);
const key = computed(() => packingKeys.metadata(context.session.value?.context, props.listId));
const fieldPolicy = {description: normalizeNullableMetadataText};
function fieldLabel(field: string): string { return messages.value.t(field === 'title' ? 'packing.title' : 'packing.description'); }

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
    <EntityMetadataEditor ref="editor" form-id="packing-metadata-form" :resource-id="listId" :resource-title="listTitle" :disabled="disabled"
        :busy="busy" :active="active" :query-key="key" :field-policy="fieldPolicy" :field-label="fieldLabel"
        :read="read" :save="save" @saved="emit('saved')" @close="emit('close')" @access-lost="emit('accessLost')">
        <template #default="{values, fields}">
            <!-- Preserve native disclosure, labels and focused field nodes. -->
            <details class="entity-property-group mb-3" open>
                <summary class="fw-semibold">{{ messages.t('packing.details') }}</summary>
                <div class="row g-3 pt-3">
                    <div v-if="fields.includes('title')" class="col-md-6">
                        <label class="form-label" for="packing-title">{{ messages.t('packing.title') }}</label>
                        <input id="packing-title" v-model="values.title" name="title" class="form-control text-bg-dark" required maxlength="255" />
                    </div>
                    <div v-if="fields.includes('description')" class="col-12">
                        <label class="form-label" for="packing-description">{{ messages.t('packing.description') }}</label>
                        <textarea id="packing-description" :value="String(values.description ?? '')" name="description" class="form-control text-bg-dark" rows="4" maxlength="16000" @input="values.description = ($event.target as HTMLTextAreaElement).value"></textarea>
                    </div>
                </div>
            </details>
        </template>
    </EntityMetadataEditor>
</template>
