import {onBeforeUnmount, onMounted, ref, type CSSProperties, type Ref} from 'vue';

/** Keep mixed-content disclosure menus usable within the actual viewport. */
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
        const menuBounds = menu.getBoundingClientRect();
        const height = Math.max(menuBounds.height, menu.scrollHeight);
        const roomBelow = window.innerHeight - bounds.bottom;
        const roomAbove = bounds.top;
        const above = height + 2 > roomBelow && roomAbove > roomBelow;
        const vertical: CSSProperties = above
            ? {top: 'auto', bottom: '100%', marginTop: '0', marginBottom: 'var(--bs-dropdown-spacer)'}
            : {top: '100%', bottom: 'auto', marginTop: 'var(--bs-dropdown-spacer)', marginBottom: '0'};

        // End-aligned profile menus can otherwise extend left of a narrow
        // viewport; card menus can extend past either edge. Correct the measured
        // position without changing their trigger, DOM ownership or focus.
        const previousShift = Number.parseFloat(menu.style.translate) || 0;
        const horizontalCorrection = Math.max(16 - menuBounds.left,
            Math.min(0, window.innerWidth - 16 - menuBounds.right));
        dropdownStyle.value = {...vertical, translate: `${previousShift + horizontalCorrection}px 0`,
            maxHeight: `${Math.max(1, (above ? roomAbove : roomBelow) - 2)}px`, overflowY: 'auto'};
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
