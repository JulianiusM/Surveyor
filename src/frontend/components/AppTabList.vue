<script setup lang="ts">
import {RovingFocusGroup, RovingFocusItem} from 'reka-ui';

/** The shared keyboard primitive owns focus movement; feature pages own their mounted panels.
 * Keeping panel visibility in the page preserves dirty editors when another tab is selected. */
defineProps<{
    modelValue: string;
    tabs: readonly {key: string; label: string; id: string; controls: string; icon?: string}[];
    linkClass?: string;
}>();
const emit = defineEmits<{'update:modelValue': [value: string]}>();
</script>

<template>
    <RovingFocusGroup as-child loop>
        <ul role="tablist" class="nav nav-pills">
            <li v-for="tab in tabs" :key="tab.key" class="nav-item" role="presentation">
                <RovingFocusItem as-child :active="modelValue === tab.key">
                    <button
                        :id="tab.id"
                        type="button"
                        role="tab"
                        class="nav-link"
                        :class="[linkClass, {active: modelValue === tab.key}]"
                        :aria-selected="modelValue === tab.key"
                        :aria-controls="tab.controls"
                        @click="emit('update:modelValue', tab.key)"
                        @focus="emit('update:modelValue', tab.key)"
                    >
                        <i v-if="tab.icon" class="bi me-1" :class="tab.icon" aria-hidden="true"></i>{{ tab.label }}
                    </button>
                </RovingFocusItem>
            </li>
        </ul>
    </RovingFocusGroup>
</template>
