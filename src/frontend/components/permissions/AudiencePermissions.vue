<script setup lang="ts">
import {ref} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import PermissionFields from './PermissionFields.vue';
const props = defineProps<{
    modelValue: components['schemas']['PermissionDefaults'];
    permissions: components['schemas']['PermissionDefinition'][];
    presets: components['schemas']['PermissionPreset'][];
    prefix: string;
    disabled?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [value: components['schemas']['PermissionDefaults']]}>();
const {messages} = usePilot();
const audiences = ['participant', 'guest', 'authenticated', 'public'] as const;
const audience = ref<(typeof audiences)[number]>('participant');
function update(mask: number): void {
    emit('update:modelValue', {...props.modelValue, [audience.value]: mask});
}
</script>
<template>
    <div class="perm-matrix text-bg-dark">
        <div class="mb-3">
            <label class="form-label" :for="prefix + '-audience'">{{ messages.t('packing.audience') }}</label>
            <select :id="prefix + '-audience'" v-model="audience" class="form-select text-bg-dark">
                <option v-for="value in audiences" :key="value" :value="value">
                    {{ messages.t(('audiences.' + value) as 'audiences.public') }}
                </option>
            </select>
        </div>
        <PermissionFields
            :model-value="modelValue[audience]"
            :permissions="permissions"
            :presets="presets"
            :prefix="prefix + '-' + audience"
            :disabled="disabled"
            @update:model-value="update"
        />
    </div>
</template>
