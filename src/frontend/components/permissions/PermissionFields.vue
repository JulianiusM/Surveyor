<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import {permissionLabel} from '../../../modules/localization/permissionLabels';
import type {MessageKey} from '../../../types/LocalizationTypes';
import {usePilot} from '../../app/context';

const props = defineProps<{
    modelValue: number;
    permissions: components['schemas']['PermissionDefinition'][];
    presets: components['schemas']['PermissionPreset'][];
    prefix: string;
    disabled?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [mask: number]}>();
const {messages} = usePilot();
const categories = ['ACCESS', 'EDIT', 'ITEM', 'MANAGE', 'DATA', 'OTHER'];
const groups = computed(permissionGroups);

/** Preserve the established category order while grouping the server-projected definitions.
 * Unknown prefixes belong to Other; empty categories disappear without changing permissions
 * or masks. Named phases avoid nested callbacks obscuring this presentation-only operation. */
function permissionGroups() {
    const grouped = new Map<string, components['schemas']['PermissionDefinition'][]>();
    for (const category of categories) grouped.set(category, []);

    for (const permission of props.permissions) {
        const prefix = permission.key.split('_')[0]!;
        const category = categories.includes(prefix) ? prefix : 'OTHER';
        grouped.get(category)!.push(permission);
    }

    const result: {category: string; permissions: components['schemas']['PermissionDefinition'][]}[] = [];
    for (const [category, permissions] of grouped) {
        if (permissions.length) result.push({category, permissions});
    }
    return result;
}
function label(key: string): string {
    return permissionLabel(key, messages.value.t);
}
function toggle(bit: number, event: Event): void {
    emit(
        'update:modelValue',
        (event.target as HTMLInputElement).checked ? props.modelValue | bit : props.modelValue & ~bit,
    );
}
</script>

<template>
    <fieldset :disabled="disabled">
        <div class="d-flex flex-wrap gap-2 justify-content-between align-items-start mb-3">
            <details v-if="presets.length">
                <summary class="small">{{ messages.t('packing.presets') }}</summary>
                <div
                    class="d-flex flex-wrap gap-1 mt-2"
                    role="group"
                    :aria-label="messages.t('packing.presets')"
                >
                    <button
                        v-for="preset in presets"
                        :key="preset.key"
                        type="button"
                        class="btn btn-sm btn-outline-light"
                        @click="emit('update:modelValue', preset.mask)"
                    >
                        {{ label(preset.key) }}
                    </button>
                </div>
            </details>
            <div
                class="btn-group btn-group-sm"
                role="group"
                :aria-label="messages.t('packing.selectPermissions')"
            >
                <button
                    type="button"
                    class="btn btn-outline-light"
                    :title="messages.t('packing.selectAll')"
                    @click="
                        emit(
                            'update:modelValue',
                            permissions.reduce((mask, permission) => mask | permission.bit, 0),
                        )
                    "
                >
                    {{ messages.t('packing.all') }}
                </button>
                <button
                    type="button"
                    class="btn btn-outline-light"
                    :title="messages.t('packing.clearAll')"
                    @click="emit('update:modelValue', 0)"
                >
                    {{ messages.t('packing.none') }}
                </button>
            </div>
        </div>
        <fieldset v-for="group in groups" :key="group.category" class="mb-3">
            <legend class="small fw-semibold text-secondary mb-1">
                {{ messages.t(`permissionGroups.${group.category}` as MessageKey) }}
            </legend>
            <div class="row row-cols-1 row-cols-sm-2 g-1">
                <div v-for="permission in group.permissions" :key="permission.key" class="col">
                    <div class="form-check">
                        <input
                            :id="`${prefix}-${permission.key}`"
                            class="form-check-input bg-dark border-secondary"
                            type="checkbox"
                            :checked="!!(modelValue & permission.bit)"
                            @change="toggle(permission.bit, $event)"
                        />
                        <label class="form-check-label text-light" :for="`${prefix}-${permission.key}`">{{
                            label(permission.key)
                        }}</label>
                    </div>
                </div>
            </div>
        </fieldset>
    </fieldset>
</template>
