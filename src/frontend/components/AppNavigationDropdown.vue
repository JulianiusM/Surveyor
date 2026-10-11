<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue';
import {useDropdownPlacement} from '../composables/dropdownPlacement';

withDefaults(defineProps<{
    label: string;
    icon?: string;
    alignEnd?: boolean;
    navigation?: boolean;
    // Menu markup follows the caller's native presentation independently of whether
    // this disclosure belongs to navigation, a card, or an ordinary filter form.
    menuTag?: 'ul' | 'div';
    triggerClass?: string;
    triggerLabel?: string;
}>(), {navigation: true});
const element = ref<HTMLDetailsElement | null>(null);
const open = ref(false);
const {dropdownStyle, updatePlacement} = useDropdownPlacement(element);

// Header links/native form controls and card actions share disclosure behavior. Reka's
// public menu adds registered/roving/hover-focused items; its Popover adds dialog semantics.
// Neither replaces this mixed native content unchanged, and DismissableLayer is internal-only.
// Keep native DOM/Tab semantics here, without competing Bootstrap plugin ownership.
/** Dismissal retains the outside destination's focus; Escape alone restores the trigger. */
function close(restoreFocus = false): void {
    if (!element.value) return;
    element.value.open = false;
    open.value = false;
    if (restoreFocus) element.value.querySelector('summary')?.focus();
}

/** Pointer or keyboard focus in another disclosure closes this one, while its form stays mounted. */
function outside(event: Event): void {
    if (element.value?.open && !element.value.contains(event.target as Node)) close();
}

/** Native links/actions dismiss the menu; clicking or submitting contained fields does not. */
function follow(event: MouseEvent): void {
    if ((event.target as Element).closest('a, button.dropdown-item')) close();
}

/** Native details supplies pointer/Enter/Space toggling; synchronize its one open-state projection. */
function synchronizeOpen(): void {
    open.value = !!element.value?.open;
}

/** Arrow keys visit enabled actions without taking over native input/select navigation. */
function navigate(event: KeyboardEvent): void {
    if (!element.value || event.defaultPrevented) return;
    if (event.key === 'Escape') {
        if (!element.value.open) return;
        event.preventDefault();
        close(true);
        return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    // An embedded profile selector retains its own browser keyboard behavior.
    if ((event.target as Element).closest('input, select, textarea')) return;
    event.preventDefault();
    element.value.open = true;
    open.value = true;
    updatePlacement();
    const links = [...element.value.querySelectorAll<HTMLElement>('.dropdown-item:not(:disabled):not(.disabled)')]
        .filter(link => link.getAttribute('aria-disabled') !== 'true');
    const current = links.indexOf(document.activeElement as HTMLElement);
    const index = current < 0 ? (event.key === 'ArrowDown' ? 0 : links.length - 1)
        : Math.max(0, Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    links[index]?.focus({preventScroll: true});
}

onMounted(() => {
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('focusin', outside);
});
</script>

<template>
    <component :is="navigation ? 'li' : 'div'" :class="navigation ? 'nav-item dropdown' : 'd-inline-block'">
        <details ref="element" :class="navigation ? 'pilot-nav-dropdown' : 'position-relative'"
                 @toggle="synchronizeOpen" @keydown="navigate">
            <!-- Native header links and card/filter buttons expose the button role.
                 Preserve that role while details retains disclosure keyboard/open-state ownership. -->
            <summary role="button" :class="[navigation ? 'nav-link dropdown-toggle' : triggerClass, {show: navigation && open}]"
                     :aria-expanded="open" :aria-label="triggerLabel">
                <slot name="trigger"><i v-if="icon" class="bi me-1" :class="icon" aria-hidden="true"></i>{{ label }}</slot>
            </summary>
            <!-- The native ul/li navigation and card div/button structures remain separate
                 presentation choices; dismissal and keyboard policy have one owner. -->
            <component :is="menuTag ?? (navigation ? 'ul' : 'div')" class="dropdown-menu"
                       :class="{'dropdown-menu-end': alignEnd, show: !navigation}" :style="dropdownStyle" @click="follow"><slot /></component>
        </details>
    </component>
</template>
