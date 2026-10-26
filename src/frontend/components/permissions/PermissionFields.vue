<script setup lang="ts">
import {computed} from 'vue';
import type {components} from '../../../types/api/v1';
import {permissionLabel} from '../../../common/localization/permissionLabels';
import type {MessageKey} from '../../../types/LocalizationTypes';
import {useFrontend} from '../../app/context';
import ActionButton from '../ActionButton.vue';

const props = defineProps<{
    modelValue: number;
    permissions: components['schemas']['PermissionDefinition'][];
    presets: components['schemas']['PermissionPreset'][];
    prefix: string;
    disabled?: boolean;
    /** Opt-in applies to local mask inputs, never preset/select-all action buttons. */
    hydrationDraft?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [mask: number]}>();
const {messages} = useFrontend();
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
                <summary class="small">{{ messages.t('permissions.presets') }}</summary>
                <div
                    class="d-flex flex-wrap gap-1 mt-2"
                    role="group"
                    :aria-label="messages.t('permissions.presets')"
                >
                    <ActionButton
                        v-for="preset in presets"
                        :key="preset.key"
                        type="button"
                        class="btn-sm"
                        variant="outline-light"
                        :disabled="disabled"
                        @click="emit('update:modelValue', preset.mask)"
                    >
                        {{ label(preset.key) }}
                    </ActionButton>
                </div>
            </details>
            <div
                class="btn-group btn-group-sm"
                role="group"
                :aria-label="messages.t('permissions.selectPermissions')"
            >
                <ActionButton
                    type="button"
                    variant="outline-light"
                    :disabled="disabled"
                    :title="messages.t('permissions.selectAll')"
                    @click="
                        emit(
                            'update:modelValue',
                            permissions.reduce((mask, permission) => mask | permission.bit, 0),
                        )
                    "
                >
                    {{ messages.t('common.all') }}
                </ActionButton>
                <ActionButton
                    type="button"
                    variant="outline-light"
                    :disabled="disabled"
                    :title="messages.t('permissions.clearAll')"
                    @click="emit('update:modelValue', 0)"
                >
                    {{ messages.t('common.none') }}
                </ActionButton>
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
                            :data-hydration-draft="hydrationDraft ? '' : undefined"
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
