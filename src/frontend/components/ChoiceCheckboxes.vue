<script setup lang="ts" generic="Value extends string">
import type {FrontendCheckboxChoice} from '../../types/FrontendUiTypes';
import FormField from './FormField.vue';

// Features own their selected values, labels and mutual-exclusion rules. This
// shared renderer supplies native IDs and field spelling to the shared field;
// it keeps no state that could outlive the admitted draft or actor.
const props = defineProps<{
    choices: readonly FrontendCheckboxChoice<Value>[];
    selected: readonly Value[];
    idPrefix: string;
    name: string;
    disabled?: boolean;
}>();
const emit = defineEmits<{change: [value: Value, checked: boolean]}>();

function inputValue(choice: FrontendCheckboxChoice<Value>): string {
    return choice.inputValue ?? choice.value;
}

function choiceId(choice: FrontendCheckboxChoice<Value>): string {
    return `${props.idPrefix}-${inputValue(choice)}`;
}

/** Forward the shared field's checked state; the feature decides how selection
 * changes its own draft and whether other choices should be retained or cleared. */
function changeChoice(choice: FrontendCheckboxChoice<Value>, checked: boolean): void {
    emit('change', choice.value, checked);
}
</script>

<template>
    <!-- Values are fully controlled by the caller, including after rejected or
         recovered commands. Reused DOM controls always reflect that same draft. -->
    <div class="frontend-choice-grid">
        <div v-for="choice in choices" :key="choice.value">
            <FormField :id="choiceId(choice)" type="checkbox" :label="choice.label" :name="name"
                :checkbox-value="inputValue(choice)" :checked="selected.includes(choice.value)"
                :disabled="disabled" @update:checked="changeChoice(choice, $event)" />
        </div>
    </div>
</template>
