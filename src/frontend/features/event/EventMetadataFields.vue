<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {EntityMetadataSnapshot, EntityMetadataValues} from '../../../types/FrontendEntityMetadataTypes';
import type {PilotRead, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useEventApi} from './api';
import {usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {normalizeNullableMetadataText} from '../../composables/metadataDraft';
import {useMetadataEditorHandle} from '../../composables/metadataEditor';
import EventFields from './EventFields.vue';
import EntityMetadataEditor from '../../components/EntityMetadataEditor.vue';

// Event owns its permitted fields and local deadline/capacity semantics; the shared
// editor owns admitted reads, sparse drafts, confirmation and explicit recovery.
const props = withDefaults(defineProps<{eventId: string; eventTitle?: string; disabled?: boolean; busy?: boolean; active?: boolean}>(), {active: true});
const emit = defineEmits<{close: []; saved: []; accessLost: []}>();
const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const editor = ref<InstanceType<typeof EntityMetadataEditor> | null>(null);
const key = computed(() => eventKeys.metadata(context.session.value?.context, props.eventId));
const fieldPolicy = {description: normalizeNullableMetadataText, location: normalizeNullableMetadataText,
    bindingDeadline: normalizeNullableMetadataText, maxParticipants: normalizeCapacity};
const families = [
    {key: 'details', label: 'packing.details', fields: ['title', 'location', 'description']},
    {key: 'schedule', label: 'event.propertyDates', fields: ['startDate', 'endDate', 'bindingDeadline', 'deadlineTz']},
    {key: 'registration', label: 'event.propertyRegistration', fields: ['maxParticipants', 'allowRegDateUpdatesAfterDeadline', 'allowRegCancelationAfterDeadline']},
    {key: 'dietary', label: 'event.propertyDietary', fields: ['requireDietaryInfo', 'allowDietComment', 'allowRegDietUpdateAfterDeadline']},
] as const;
/** Omit empty property families while retaining the native order and first-open rule. */
function admittedFamilies(fields: readonly string[]) {
    // A family appears only for its own current field grants; peer field grants
    // never expose values or controls from another property responsibility.
    return families.filter(family => family.fields.some(field => fields.includes(field)));
}
/** Numeric controls compare their DOM spelling without changing controller coercion. */
function normalizeCapacity(value: EntityMetadataValues[string]): EntityMetadataValues[string] { return value === '' || value === null ? null : String(value); }
function fieldLabel(field: string): string {
    const key = {title: 'event.title', description: 'event.description', startDate: 'event.startDate', endDate: 'event.endDate',
        location: 'event.location', bindingDeadline: 'event.bindingDeadline', deadlineTz: 'event.timezone', maxParticipants: 'event.maxParticipants',
        requireDietaryInfo: 'event.requireDiet', allowDietComment: 'event.allowComment', allowRegDateUpdatesAfterDeadline: 'event.dateUpdates',
        allowRegCancelationAfterDeadline: 'event.cancelUpdates', allowRegDietUpdateAfterDeadline: 'event.dietUpdates'} as const;
    return messages.value.t(key[field as keyof typeof key] ?? 'packing.properties');
}
/** Native zone changes apply to the displayed local deadline. Unrelated changes omit
 * both fields and preserve the stored instant; no client-side timezone coercion occurs. */
function preparePatch(patch: EntityMetadataValues, values: EntityMetadataValues): EntityMetadataValues {
    return 'deadlineTz' in patch && 'bindingDeadline' in values ? {...patch, bindingDeadline: values.bindingDeadline} : patch;
}

/** Generated Event declarations and validators keep wire policy in the feature. */
function read(id: string, scope: PilotRequestScope, signal?: AbortSignal, previous?: PilotRead<EntityMetadataSnapshot>) {
    return api.metadata(id, scope, signal, previous as PilotRead<components['schemas']['EventMetadata']> | undefined);
}
function save(id: string, patch: EntityMetadataValues, token: string, scope: PilotRequestScope) {
    return api.saveMetadata(id, patch as components['schemas']['EventMetadataPatch'], token, scope);
}
// Settings calls the shared editor's public workflow, preserving one draft owner.
defineExpose(useMetadataEditorHandle(editor));
</script>

<template>
    <EntityMetadataEditor ref="editor" form-id="event-metadata-form" :resource-id="eventId"
        :resource-title="eventTitle" :disabled="disabled" :busy="busy" :active="active" :query-key="key"
        :field-policy="fieldPolicy" :field-label="fieldLabel" :prepare-patch="preparePatch" :read="read" :save="save"
        @saved="emit('saved')" @close="emit('close')" @access-lost="emit('accessLost')">
        <template #default="{values, fields, pending}">
            <!-- Event property families are permitted by the controller independently. -->
            <details v-for="(family, index) in admittedFamilies(fields)" :key="family.key"
                class="entity-property-group mb-3" :open="index === 0">
                <summary class="fw-semibold">{{ messages.t(family.label) }}</summary>
                <EventFields :values="values"
                    :fields="fields.filter(field => (family.fields as readonly string[]).includes(field))"
                    :prefix="'event-properties-' + family.key" :disabled="disabled || busy" :pending="pending" />
            </details>
        </template>
    </EntityMetadataEditor>
</template>
