<script setup lang="ts">
import {ref} from 'vue';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../types/FrontendEntityMetadataTypes';
import type {PilotRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {usePilot} from '../app/context';
import {normalizeNullableMetadataText} from '../composables/metadataDraft';
import {useMetadataEditorHandle} from '../composables/metadataEditor';
import EntityMetadataEditor from './EntityMetadataEditor.vue';

// Packing and Drivers have the same title/nullable-description editor. Their
// feature adapters inject scoped reads and generated sparse saves; one shared
// editor still owns every baseline, draft, comparison and recovery decision.
withDefaults(defineProps<{
    prefix: string; resourceId: string; resourceTitle?: string; queryKey: readonly unknown[];
    disabled?: boolean; busy?: boolean; active?: boolean;
    read(id: string, scope: PilotRequestScope, signal?: AbortSignal, previous?: PilotRead<EntityMetadataSnapshot>): Promise<PilotRead<EntityMetadataSnapshot>>;
    save(id: string, patch: EntityMetadataValues, token: string, scope: PilotRequestScope): Promise<PilotRead<EntityMetadataSnapshot>>;
}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const {messages} = usePilot();
const editor = ref<InstanceType<typeof EntityMetadataEditor> | null>(null);
const fieldPolicy = {description: normalizeNullableMetadataText};
function fieldLabel(field: string): string { return messages.value.t(field === 'title' ? 'packing.title' : 'packing.description'); }
defineExpose(useMetadataEditorHandle(editor));
</script>

<template>
    <EntityMetadataEditor ref="editor" :form-id="prefix + '-metadata-form'" :resource-id="resourceId" :resource-title="resourceTitle"
        :disabled="disabled" :busy="busy" :active="active" :query-key="queryKey" :field-policy="fieldPolicy" :field-label="fieldLabel"
        :read="read" :save="save" @saved="emit('saved')" @close="emit('close')" @access-lost="emit('accessLost')">
        <template #default="{values, fields}">
            <!-- Keep native disclosure and field nodes mounted during reads so
                 focused input remains the same feature-owned unsaved draft. -->
            <details class="entity-property-group mb-3" open>
                <summary class="fw-semibold">{{ messages.t('packing.details') }}</summary>
                <div class="row g-3 pt-3">
                    <div v-if="fields.includes('title')" class="col-md-6">
                        <label class="form-label" :for="prefix + '-title'">{{ messages.t('packing.title') }}</label>
                        <input :id="prefix + '-title'" v-model="values.title" name="title" class="form-control text-bg-dark" required maxlength="255" />
                    </div>
                    <div v-if="fields.includes('description')" class="col-12">
                        <label class="form-label" :for="prefix + '-description'">{{ messages.t('packing.description') }}</label>
                        <textarea :id="prefix + '-description'" :value="String(values.description ?? '')" name="description" class="form-control text-bg-dark" rows="4" maxlength="16000"
                            @input="values.description = ($event.target as HTMLTextAreaElement).value"></textarea>
                    </div>
                </div>
            </details>
        </template>
    </EntityMetadataEditor>
</template>
