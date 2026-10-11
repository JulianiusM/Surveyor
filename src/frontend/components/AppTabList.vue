<script setup lang="ts">
import {RovingFocusGroup, RovingFocusItem} from 'reka-ui';

/** The shared keyboard primitive owns focus movement; feature pages own their mounted panels.
 * Keeping panel visibility in the page preserves dirty editors when another tab is selected.
 * A pending owner disables both native activation and registration in the focus sequence. */
const props = withDefaults(defineProps<{
    modelValue: string;
    tabs: readonly {key: string; label: string; id: string; controls: string; icon?: string}[];
    linkClass?: string;
    disabled?: boolean;
}>(), {disabled: false});
const emit = defineEmits<{'update:modelValue': [value: string]}>();

/** Guard focus as well as clicks: a programmatic event cannot switch a locked owner's panel. */
function selectTab(key: string): void {
    if (!props.disabled) emit('update:modelValue', key);
}
</script>

<template>
    <RovingFocusGroup as-child loop>
        <ul role="tablist" class="nav nav-pills">
            <li v-for="tab in tabs" :key="tab.key" class="nav-item" role="presentation">
                <RovingFocusItem as-child :active="modelValue === tab.key" :focusable="!disabled">
                    <button
                        :id="tab.id"
                        type="button"
                        role="tab"
                        class="nav-link"
                        :class="[linkClass, {active: modelValue === tab.key}]"
                        :aria-selected="modelValue === tab.key"
                        :aria-controls="tab.controls"
                        :disabled="disabled"
                        @click="selectTab(tab.key)"
                        @focus="selectTab(tab.key)"
                    >
                        <i v-if="tab.icon" class="bi me-1" :class="tab.icon" aria-hidden="true"></i>{{ tab.label }}
                    </button>
                </RovingFocusItem>
            </li>
        </ul>
    </RovingFocusGroup>
</template>
