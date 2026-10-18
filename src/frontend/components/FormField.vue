<script setup lang="ts">
withDefaults(
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

/** Text inputs and textareas expose lexical drafts. Feature owners retain
 * normalization, admission and the decision to include that value in a command. */
function updateValue(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
    <div>
        <!-- Label, native field name and accessible feedback remain one shared form contract.
             Native labels put text immediately after the icon: me-1 owns that gap.
             Extra template whitespace would widen it and change narrow-screen wrapping. -->
        <label class="form-label" :class="labelClass" :for="id">
            <i v-if="labelIcon" class="bi me-1" :class="labelIcon" aria-hidden="true"></i>{{ label }}<template v-if="required && requiredMarker"> *</template>
        </label>
        <div :class="{'input-group': inputIcon || largeGroup, 'input-group-lg': largeGroup}">
            <span v-if="inputIcon" class="input-group-text">
                <i class="bi" :class="inputIcon" aria-hidden="true"></i>
            </span>
            <!-- File controls replace only the control through this slot. Their
                 selected bytes stay with the feature, while label geometry and
                 surrounding feedback still have this single presentation owner. -->
            <slot name="control">
                <textarea v-if="multiline"
                    :id="id"
                    :name="name === null ? undefined : name ?? id"
                    :value="modelValue"
                    class="form-control text-bg-dark"
                    :class="{'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}"
                    :rows="rows"
                    :required="required"
                    :maxlength="maxLength"
                    :minlength="minLength"
                    :disabled="disabled"
                    :placeholder="placeholder"
                    :aria-invalid="state === 'invalid' || undefined"
                    :aria-describedby="describedBy"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                    @input="updateValue"
                ></textarea>
                <input v-else
                    :id="id"
                    :name="name === null ? undefined : name ?? id"
                    :type="type"
                    :value="modelValue"
                    class="form-control text-bg-dark"
                    :class="{'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}"
                    :required="required"
                    :maxlength="maxLength"
                    :minlength="minLength"
                    :min="min"
                    :max="max"
                    :step="step"
                    :autocomplete="autocomplete"
                    :disabled="disabled"
                    :placeholder="placeholder"
                    :inputmode="inputMode"
                    :aria-invalid="state === 'invalid' || undefined"
                    :aria-describedby="describedBy"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                    @input="updateValue"
                />
            </slot>
        </div>
        <slot />
    </div>
</template>
