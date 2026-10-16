<script setup lang="ts">
withDefaults(
    defineProps<{
        id: string;
        name?: string;
        label: string;
        labelClass?: string;
        requiredMarker?: boolean;
        modelValue: string;
        type?: string;
        required?: boolean;
        maxLength?: number;
        minLength?: number;
        min?: string | number;
        max?: string | number;
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
    {type: 'text', labelClass: 'mb-1', requiredMarker: true},
);
const emit = defineEmits<{'update:modelValue': [value: string]; focus: []; blur: []}>();

/** Inputs expose string drafts; feature owners decide when a value becomes a submitted command. */
function updateValue(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
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
            <input
                :id="id"
                :name="name ?? id"
                :type="type"
                :value="modelValue"
                class="form-control text-bg-dark"
                :class="{'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}"
                :required="required"
                :maxlength="maxLength"
                :minlength="minLength"
                :min="min"
                :max="max"
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
        </div>
        <slot />
    </div>
</template>
