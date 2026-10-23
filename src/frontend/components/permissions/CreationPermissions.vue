<script setup lang="ts">
import {ref} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import AppAccordionButton from '../AppAccordionButton.vue';
import AudiencePermissions from './AudiencePermissions.vue';

// Matching creation and duplicate forms share this compact disclosure only.
// Their existing form owners retain all masks, defaults and submission decisions.
defineProps<{
    modelValue: components['schemas']['PermissionDefaults'];
    permissions: components['schemas']['PermissionDefinition'][];
    presets: components['schemas']['PermissionPreset'][];
    prefix: string;
    disabled?: boolean;
    hydrationDraft?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [value: components['schemas']['PermissionDefaults']]}>();
const {messages} = usePilot();
const expanded = ref(false);
</script>

<template>
    <div class="accordion" data-creation-permissions>
        <section class="accordion-item bg-dark border-secondary">
            <h2 class="accordion-header">
                <AppAccordionButton :id="prefix + '-heading'" class="text-light bg-dark"
                    :expanded="expanded" :controls="prefix + '-panel'" :disabled="disabled"
                    @click="expanded = !expanded">
                    <i class="bi bi-shield-lock me-2" aria-hidden="true"></i>{{ messages.t('packing.groupPermissions') }}
                </AppAccordionButton>
            </h2>
            <!-- Closing preserves the actual audience selector and checkbox nodes.
                 The matrix has no required/invalid hidden fields; its feature-owned
                 masks remain submitted even when this presentation is collapsed. -->
            <div v-show="expanded" :id="prefix + '-panel'" class="accordion-body"
                role="region" :aria-labelledby="prefix + '-heading'">
                <AudiencePermissions :model-value="modelValue" :permissions="permissions" :presets="presets"
                    :prefix="prefix" :disabled="disabled" :hydration-draft="hydrationDraft"
                    @update:model-value="emit('update:modelValue', $event)" />
            </div>
        </section>
    </div>
</template>
