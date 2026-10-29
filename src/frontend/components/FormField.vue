<script setup lang="ts">
import {computed, ref} from 'vue';
import type {ComponentPublicInstance} from 'vue';
import type {FrontendFormFieldControlSlot} from '../../types/FrontendUiTypes';
import {useClientInitialization} from '../app/context';
import {usePendingFocus} from '../composables/pendingFocus';

const props = withDefaults(
    defineProps<{
        id: string;
        name?: string | null;
        label: string;
        labelFor?: string;
        labelClass?: string;
        requiredMarker?: boolean;
        modelValue?: string;
        checked?: boolean;
        checkboxValue?: string;
        multiline?: boolean;
        rows?: number;
        type?: string;
        lexicalNumber?: boolean;
        required?: boolean;
        maxLength?: number;
        minLength?: number;
        min?: string | number;
        max?: string | number;
        step?: string | number;
        autocomplete?: string;
        disabled?: boolean;
        pending?: boolean;
        readOnly?: boolean;
        controlClass?: string;
        placeholder?: string;
        labelIcon?: string;
        inputIcon?: string;
        largeGroup?: boolean;
        groupClass?: string;
        inputMode?: 'email' | 'text' | 'numeric' | 'decimal';
        ariaLabel?: string;
        controlData?: Record<`data-${string}`, string | number | boolean | undefined>;
        state?: 'valid' | 'invalid';
        describedBy?: string;
    }>(),
    {type: 'text', requiredMarker: true, modelValue: '', pending: false},
);
const emit = defineEmits<{'update:modelValue': [value: string]; 'update:checked': [value: boolean]; focus: []; blur: []}>();
const control = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const controlSlot: FrontendFormFieldControlSlot = {controlRef: receiveControl};
const initialized = useClientInitialization();
const pending = computed(isPending);
// Enter submission can natively disable a still-focused field. Share the same
// transient focus owner as actions and inline editors; the feature retains its
// actual pending/disabled policies, model and any secret-clearing behavior.
usePendingFocus({element: control, pending, isAvailable: isControlAvailable});
const controlValue = computed({get: readValue, set: updateValue});
const controlAttributes = computed(readControlAttributes);
const inputAttributes = computed(readInputAttributes);

function readValue(): string { return props.modelValue; }
function isPending(): boolean { return props.pending; }
function isControlAvailable(): boolean { return initialized.value && !props.disabled; }

/** Custom controls opt in with their actual ref while retaining their
 * directives and models. No descendant lookup or component proxy becomes a
 * second field owner; slot removal releases the previous DOM reference. */
function receiveControl(element: Element | ComponentPublicInstance | null): void {
    control.value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
}

/** Textareas and native input lifecycles share names, validity and presentation.
 * Feature constraints and data hooks remain explicit inputs, so one branch
 * cannot silently omit accessible naming or the original submitted field name. */
function readControlAttributes() {
    // Data hooks identify existing feature controls without exposing another
    // mutable model, event policy or general attribute override to callers.
    return {
        ...props.controlData,
        id: props.id,
        name: props.name === null ? undefined : props.name ?? props.id,
        class: [props.type === 'checkbox' ? 'form-check-input' : ['form-control', 'text-bg-dark'], props.controlClass,
        {'is-valid': props.state === 'valid', 'is-invalid': props.state === 'invalid'}],
        required: props.required,
        maxlength: props.maxLength,
        minlength: props.minLength,
        autocomplete: props.autocomplete,
        disabled: props.disabled,
        readonly: props.readOnly,
        placeholder: props.placeholder,
        inputmode: props.inputMode,
        'aria-label': props.ariaLabel,
        'aria-invalid': props.state === 'invalid' || undefined,
        'aria-describedby': props.describedBy,
    };
}

/** Preserve text/number attributes and the checkbox's independent submitted value. */
function readInputAttributes() {
    // Native boolean flags submit "on" only while checked. Choice lists supply
    // their own spelling; neither checkbox path uses the string model channel.
    if (props.type === 'checkbox') return {...controlAttributes.value, type: props.type, value: props.checkboxValue ?? 'on'};
    return {...controlAttributes.value, type: props.type, min: props.min, max: props.max, step: props.step};
}

/** Publish native checked state without coercing or mirroring a feature's draft. */
function updateChecked(event: Event): void {
    emit('update:checked', (event.target as HTMLInputElement).checked);
}

/** Feature owners retain normalization, admission and submitted values. Text
 * controls use Vue's composition/caret handling; opted-in number controls read
 * the native DOM directly so blur cannot rewrite an unfinished lexical draft. */
function updateValue(): void {
    // A supplied control slot owns its own input and never calls this setter.
    // No local value mirror competes with the feature's draft or restored model.
    if (control.value) emit('update:modelValue', control.value.value);
}
</script>

<template>
    <div :class="{'form-check': type === 'checkbox'}">
        <!-- Checkbox placement and native submission belong to this same field
             owner. Features retain boolean maps or selected-choice arrays, and
             supply their existing disabled policy without a second local model. -->
        <input v-if="type === 'checkbox'" ref="control" v-bind="inputAttributes" :checked="checked"
            @change="updateChecked" @focus="emit('focus')" @blur="emit('blur')" />
        <!-- Label, native field name and accessible feedback remain one shared form contract.
             Labels put text immediately after the icon: me-1 owns that gap.
             Extra template whitespace would widen it and change narrow-screen wrapping. -->
        <label :class="[type === 'checkbox' ? 'form-check-label' : 'form-label', labelClass ?? (type === 'checkbox' ? undefined : 'mb-1')]"
            :for="labelFor ?? id">
            <i v-if="labelIcon" class="bi me-1" :class="labelIcon" aria-hidden="true"></i><slot name="label">{{ label }}</slot><template v-if="required && requiredMarker"> *</template>
        </label>
        <div v-if="type !== 'checkbox'" :class="[groupClass, {'input-group': inputIcon || largeGroup || $slots.append, 'input-group-lg': largeGroup}]">
            <span v-if="inputIcon" class="input-group-text">
                <i class="bi" :class="inputIcon" aria-hidden="true"></i>
            </span>
            <!-- Distinct controls can replace this slot. Matching lexical numbers
                 use the same native input below; intentional numeric directives
                 remain available without changing their established lifecycle. -->
            <slot name="control" v-bind="controlSlot">
                <textarea v-if="multiline"
                    ref="control"
                    v-model="controlValue"
                    v-bind="controlAttributes"
                    :rows="rows"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                ></textarea>
                <!-- Vue normalizes number inputs on change even when its setter
                     returns a string. The explicit lexical branch retains entered
                     spelling and validity without replacing text composition. -->
                <input v-else-if="type === 'number' && lexicalNumber"
                    ref="control"
                    v-bind="inputAttributes"
                    :value="modelValue"
                    @input="updateValue"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                />
                <input v-else
                    ref="control"
                    v-model="controlValue"
                    v-bind="inputAttributes"
                    @focus="emit('focus')"
                    @blur="emit('blur')"
                />
            </slot>
            <!-- Adjacent actions share the existing input group. Their feature
                 owns eligibility and commands, such as requirement calculation. -->
            <slot name="append" />
        </div>
        <slot />
    </div>
</template>
