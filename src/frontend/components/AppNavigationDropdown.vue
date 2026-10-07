<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue';
import {useDropdownPlacement} from '../composables/dropdownPlacement';

defineProps<{label: string; icon: string; alignEnd?: boolean}>();
const element = ref<HTMLDetailsElement | null>(null);
const open = ref(false);
const {dropdownStyle, updatePlacement} = useDropdownPlacement(element);

// Ordinary links use native disclosure semantics; Vue owns dismissal without Bootstrap DOM plugins.
function close(restoreFocus = false): void {
    if (!element.value) return;
    element.value.open = false;
    if (restoreFocus) element.value.querySelector('summary')?.focus();
}
function outside(event: PointerEvent): void {
    if (element.value && !element.value.contains(event.target as Node)) close();
}
function follow(event: MouseEvent): void {
    if ((event.target as Element).closest('a, button.dropdown-item')) close();
}
function navigate(event: KeyboardEvent): void {
    if (!element.value || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    // A profile selector inside the account menu retains its native arrow-key behavior.
    if ((event.target as Element).closest('input, select, textarea')) return;
    event.preventDefault();
    element.value.open = true;
    updatePlacement();
    const links = [...element.value.querySelectorAll<HTMLElement>('a.dropdown-item, button.dropdown-item:not(:disabled)')];
    const current = links.indexOf(document.activeElement as HTMLElement);
    const index = current < 0 ? (event.key === 'ArrowDown' ? 0 : links.length - 1)
        : Math.max(0, Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    links[index]?.focus({preventScroll: true});
}
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
    <li class="nav-item dropdown">
        <details ref="element" class="pilot-nav-dropdown" @toggle="open = !!element?.open"
                 @keydown.esc.prevent="close(true)" @keydown="navigate">
            <summary class="nav-link dropdown-toggle" :class="{show: open}" :aria-expanded="open">
                <i class="bi me-1" :class="icon" aria-hidden="true"></i>{{ label }}
            </summary>
            <ul class="dropdown-menu" :class="{'dropdown-menu-end': alignEnd}" :style="dropdownStyle" @click="follow"><slot /></ul>
        </details>
    </li>
</template>
