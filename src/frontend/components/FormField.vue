<script setup lang="ts">
import {computed, ref} from 'vue';

const props = withDefaults(
    defineProps<{
        id: string;
        name?: string | null;
        label: string;
        labelClass?: string;
        requiredMarker?: boolean;
        modelValue?: string;
        multiline?: boolean;
        rows?: number;
        type?: string;
        required?: boolean;
        maxLength?: number;
        minLength?: number;
        min?: string | number;
        max?: string | number;
        step?: string | number;
        autocomplete?: string;
        disabled?: boolean;
        readOnly?: boolean;
        controlClass?: string;
        placeholder?: string;
        labelIcon?: string;
        inputIcon?: string;
        largeGroup?: boolean;
        inputMode?: 'email' | 'text' | 'numeric';
        state?: 'valid' | 'invalid';
        describedBy?: string;
    }>(),
    {type: 'text', labelClass: 'mb-1', requiredMarker: true, modelValue: ''},
);
const emit = defineEmits<{'update:modelValue': [value: string]; focus: []; blur: []}>();
const control = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const controlValue = computed({get: readValue, set: updateValue});

function readValue(): string { return props.modelValue; }

/** Text inputs and textareas expose lexical drafts. Feature owners retain
 * normalization, admission and the decision to include that value in a command.
 * Vue's native directive owns composition/caret handling; read the DOM string
 * here so its implicit number conversion cannot change a feature's raw input. */
function updateValue(): void {
    // A supplied control slot owns its own input and never calls this setter.
    // No local value mirror competes with the feature's draft or restored model.
    if (control.value) emit('update:modelValue', control.value.value);
}
</script>

<template>
    <div>
        <!-- Label, native field name and accessible feedback remain one shared form contract.
             Native labels put text immediately after the icon: me-1 owns that gap.
             Extra template whitespace would widen it and change narrow-screen wrapping. -->
        <label class="form-label" :class="labelClass" :for="id">
            <i v-if="labelIcon" class="bi me-1" :class="labelIcon" aria-hidden="true"></i><slot name="label">{{ label }}</slot><template v-if="required && requiredMarker"> *</template>
        </label>
        <div :class="{'input-group': inputIcon || largeGroup, 'input-group-lg': largeGroup}">
            <span v-if="inputIcon" class="input-group-text">
                <i class="bi" :class="inputIcon" aria-hidden="true"></i>
            </span>
            <!-- File and native-number adapters replace only this control. Their
                 values stay with the feature, while label geometry and surrounding
                 feedback still have this single presentation owner. -->
            <slot name="control">
                <textarea v-if="multiline"
                    ref="control"
                    v-model="controlValue"
                    :id="id"
                    :name="name === null ? undefined : name ?? id"
                    class="form-control text-bg-dark"
                    :class="[controlClass, {'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}]"
                    :rows="rows"
                    :required="required"
                    :maxlength="maxLength"
                    :minlength="minLength"
                    :disabled="disabled"
                    :readonly="readOnly"
                    :placeholder="placeholder"
                    :aria-invalid="state === 'invalid' || undefined"
                    :aria-describedby="describedBy"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                ></textarea>
                <input v-else
                    ref="control"
                    v-model="controlValue"
                    :id="id"
                    :name="name === null ? undefined : name ?? id"
                    :type="type"
                    class="form-control text-bg-dark"
                    :class="[controlClass, {'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}]"
                    :required="required"
                    :maxlength="maxLength"
                    :minlength="minLength"
                    :min="min"
                    :max="max"
                    :step="step"
                    :autocomplete="autocomplete"
                    :disabled="disabled"
                    :readonly="readOnly"
                    :placeholder="placeholder"
                    :inputmode="inputMode"
                    :aria-invalid="state === 'invalid' || undefined"
                    :aria-describedby="describedBy"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                />
            </slot>
        </div>
        <slot />
    </div>
</template>
