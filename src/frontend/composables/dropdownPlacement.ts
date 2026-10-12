import {onBeforeUnmount, onMounted, ref, type CSSProperties, type Ref} from 'vue';

/** Keep native disclosure menus beside their trigger when the viewport has less room below it. */
export function useDropdownPlacement(element: Ref<HTMLDetailsElement | null>) {
    const dropdownStyle = ref<CSSProperties>({});

    /** Measure the actual disclosure/menu after toggle, scroll or viewport change.
     * Desktop collision handling may choose above; Bootstrap's static mobile
     * menu keeps normal flow and must not inherit an earlier absolute placement. */
    function updatePlacement(): void {
        const disclosure = element.value;
        if (!disclosure?.open) return;
        const trigger = disclosure.querySelector('summary');
        const menu = disclosure.querySelector<HTMLElement>(':scope > .dropdown-menu');
        if (!trigger || !menu) return;

        // Bootstrap keeps collapsed mobile navigation menus in normal document flow.
        // Those menus need no collision handling and must retain their natural height.
        if (getComputedStyle(menu).position === 'static') {
            dropdownStyle.value = {};
            return;
        }

        const bounds = trigger.getBoundingClientRect();
        const height = menu.getBoundingClientRect().height;
        const roomBelow = window.innerHeight - bounds.bottom;
        const roomAbove = bounds.top;
        const above = height + 2 > roomBelow && roomAbove > roomBelow;
        dropdownStyle.value = above
            ? {top: 'auto', bottom: '100%', marginTop: '0', marginBottom: 'var(--bs-dropdown-spacer)'}
            : {top: '100%', bottom: 'auto', marginTop: 'var(--bs-dropdown-spacer)', marginBottom: '0'};
    }

    onMounted(() => {
        element.value?.addEventListener('toggle', updatePlacement);
        window.addEventListener('resize', updatePlacement);
        // A card can move relative to the viewport while any ancestor scrolls.
        document.addEventListener('scroll', updatePlacement, true);
    });
    onBeforeUnmount(() => {
        element.value?.removeEventListener('toggle', updatePlacement);
        window.removeEventListener('resize', updatePlacement);
        document.removeEventListener('scroll', updatePlacement, true);
    });
    return {dropdownStyle, updatePlacement};
}
