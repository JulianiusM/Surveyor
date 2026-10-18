<script setup lang="ts">
import {useFileSelectionRelease} from '../composables/fileSelection';
import FormField from './FormField.vue';

// Matching creation and settings choosers share their label/control markup.
// The feature owns selected bytes and decides when a confirmed operation or
// accepted departure releases them; this control never persists or copies them.
const props = withDefaults(defineProps<{
    id: string;
    name?: string;
    label: string;
    labelIcon?: string;
    labelClass?: string;
    selectedFile: File | null;
    disabled?: boolean;
    dark?: boolean;
    hydrationDraft?: boolean;
}>(), {labelClass: '', dark: true});
const emit = defineEmits<{choose: [file: File | null]}>();
const input = useFileSelectionRelease(() => props.selectedFile);

/** Decode the existing browser chooser once. A rejected or unknown command
 * leaves its File and DOM node mounted; only the feature can release selection. */
function chooseFile(event: Event): void {
    emit('choose', (event.target as HTMLInputElement).files?.[0] ?? null);
}
</script>

<template>
    <FormField :id="id" :label="label" :label-icon="labelIcon" :label-class="labelClass">
        <template #control>
            <input ref="input" :id="id" :name="name" type="file" class="form-control"
                :class="{'text-bg-dark': dark}" :data-hydration-draft="hydrationDraft ? '' : undefined"
                accept="image/jpeg,image/png,image/gif" :disabled="disabled" @change="chooseFile" />
        </template>
        <slot />
    </FormField>
</template>
