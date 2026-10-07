<script setup lang="ts">
withDefaults(
    defineProps<{
        id: string;
        label: string;
        modelValue: string;
        type?: string;
        required?: boolean;
        maxLength?: number;
        minLength?: number;
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
    {type: 'text'},
);
const emit = defineEmits<{'update:modelValue': [value: string]; focus: []; blur: []}>();
</script>
<template>
    <div>
        <label class="form-label mb-1" :for="id"><i v-if="labelIcon" class="bi me-1" :class="labelIcon" aria-hidden="true"></i>{{ label }}<template v-if="required"> *</template></label>
        <div :class="{'input-group': inputIcon || largeGroup, 'input-group-lg': largeGroup}">
        <span v-if="inputIcon" class="input-group-text"><i class="bi" :class="inputIcon" aria-hidden="true"></i></span>
        <input
            :id="id"
            :name="id"
            :type="type"
            :value="modelValue"
            class="form-control text-bg-dark"
            :class="{'is-valid': state === 'valid', 'is-invalid': state === 'invalid'}"
            :required="required"
            :maxlength="maxLength"
            :minlength="minLength"
            :autocomplete="autocomplete"
            :disabled="disabled"
            :placeholder="placeholder"
            :inputmode="inputMode"
            :aria-invalid="state === 'invalid' || undefined"
            :aria-describedby="describedBy"
            @focus="emit('focus')"
            @blur="emit('blur')"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        </div>
        <slot />
    </div>
</template>
