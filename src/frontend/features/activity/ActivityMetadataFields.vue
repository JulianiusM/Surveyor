<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {normalizeNullableMetadataText} from '../../composables/metadataDraft';
import {useMetadataEditorHandle} from '../../composables/metadataEditor';
import {useActivityApi} from './api';
import EntityMetadataEditor from '../../components/EntityMetadataEditor.vue';
import FormField from '../../components/FormField.vue';

// Activity supplies dated root fields; admitted reads, sparse values, comparison
// review and departure protection remain with the shared metadata editor.
const props = withDefaults(defineProps<{planId: string; planTitle?: string; disabled?: boolean; busy?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const editor = ref<InstanceType<typeof EntityMetadataEditor> | null>(null);
const key = computed(() => activityKeys.metadata(context.session.value?.context, props.planId));
const fieldPolicy = {description: normalizeNullableMetadataText};
const groups = [
    {label: 'packing.details', fields: ['title', 'description']},
    {label: 'event.propertyDates', fields: ['startDate', 'endDate']},
] as const;

/** Omit empty native disclosure groups and open the first independently admitted family. */
function admittedGroups(fields: string[]) {
    return groups.filter(group => group.fields.some(field => fields.includes(field)));
}
function fieldLabel(field: string): string {
    return messages.value.t(field === 'startDate' ? 'event.startDateLabel' : field === 'endDate' ? 'event.endDateLabel'
        : field === 'title' ? 'packing.title' : 'packing.description');
}
function read(id: string, scope: PilotRequestScope, signal?: AbortSignal, previous?: PilotRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as PilotRead<components['schemas']['ActivityMetadata']> | undefined);
}
function save(id: string, patch: EntityMetadataValues, token: string, scope: PilotRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['ActivityMetadataPatch'], token, scope);
}
defineExpose(useMetadataEditorHandle(editor));
</script>

<template>
    <EntityMetadataEditor
        ref="editor"
        form-id="activity-metadata-form"
        :resource-id="planId"
        :resource-title="planTitle"
        :disabled="disabled"
        :busy="busy"
        :active="active"
        :query-key="key"
        :field-policy="fieldPolicy"
        :field-label="fieldLabel"
        :read="read"
        :save="save"
        @saved="emit('saved')"
        @close="emit('close')"
        @access-lost="emit('accessLost')">
        <template #default="{values, fields, pending}">
            <details
                v-for="(group, index) in admittedGroups(fields)"
                :key="group.label"
                class="entity-property-group mb-3"
                :open="index === 0">
                <summary class="fw-semibold">{{ messages.t(group.label) }}</summary>
                <!-- Native Details and Dates are separate disclosures in one save.
                Every field still follows its own controller grant. -->
                <div class="row g-3 pt-3">
                    <FormField
                        v-for="field in group.fields.filter(field => fields.includes(field))"
                        :id="'activity-property-' + field"
                        :key="field"
                        :class="field === 'description' ? 'col-12' : 'col-md-6'"
                        :name="field"
                        :model-value="String(values[field] ?? '')"
                        :label="fieldLabel(field)"
                        label-class=""
                        :multiline="field === 'description'"
                        :rows="4"
                        :type="field.endsWith('Date') ? 'date' : 'text'"
                        :required="field !== 'description'"
                        :required-marker="false"
                        :pending="pending"
                        :max-length="field === 'description' ? 16000 : field === 'title' ? 255 : undefined"
                        @update:model-value="values[field] = $event"
                    />
                </div>
            </details>
        </template>
    </EntityMetadataEditor>
</template>
