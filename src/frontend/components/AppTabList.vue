<script setup lang="ts">
import {RovingFocusGroup, RovingFocusItem} from 'reka-ui';

/** The shared keyboard owner retains Bootstrap's tab behavior; Reka owns the roving tab stop.
 * Feature pages own their mounted panels.
 * Keeping panel visibility in the page preserves dirty editors when another tab is selected.
 * A pending owner disables both activation and registration in the focus sequence. */
const props = withDefaults(defineProps<{
    modelValue: string;
    tabs: readonly {key: string; label: string; id: string; controls: string; icon?: string}[];
    linkClass?: string;
    variant?: 'pills' | 'tabs';
    disabled?: boolean;
}>(), {disabled: false, variant: 'pills'});
const emit = defineEmits<{'update:modelValue': [value: string]}>();

/** Guard focus as well as clicks: a programmatic event cannot switch a locked owner's panel. */
function selectTab(key: string): void {
    if (!props.disabled) emit('update:modelValue', key);
}

/** Bootstrap activates on six navigation keys, including modified keys, without
 * scrolling the page. Capture before Reka: its broader PageUp/PageDown behavior
 * and default focus scrolling would change the tab list's focus contract. */
function moveFocus(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLButtonElement)) return;
    // Retain browser Page scrolling without Reka's additional tab activation.
    if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.stopPropagation();
        return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.stopPropagation();
    event.preventDefault();
    if (props.disabled || !(event.currentTarget instanceof HTMLElement)) return;
    // Order and wrapping include every enabled tab, independent of layout.
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .filter(button => !button.disabled);
    if (!buttons.length) return;
    const current = buttons.indexOf(event.target);
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
    // Focus drives the existing selection handler and Reka's current tab stop.
    buttons[index]?.focus({preventScroll: true});
}
</script>

<template>
    <RovingFocusGroup as-child loop>
        <ul role="tablist" class="nav" :class="'nav-' + variant" @keydown.capture="moveFocus">
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
