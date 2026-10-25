import {inject, nextTick, onBeforeUnmount, watch} from 'vue';
import {frontendContextKey} from '../app/context';
import type {FrontendPendingFocusControl, FrontendPendingFocusSource} from '../../types/FrontendUiTypes';

/** Retain only the initiating control's temporary DOM focus across native pending
 * disabling. Operations, drafts and admission remain with the existing caller;
 * another interaction or an obsolete actor always releases this claim. */
export function usePendingFocus(source: FrontendPendingFocusSource): void {
    const context = inject(frontendContextKey, null);
    let mounted = true;
    let focusTarget: FrontendPendingFocusControl | null = null;
    let focusGeneration = 0;

    // Capture in this component's pre-render queue before native disabling. At
    // completion nextTick then awaits its already queued available DOM patch;
    // a synchronous observer could request that tick before rendering is queued.
    watch(source.pending, receivePendingFocus, {flush: 'pre'});
    // Persistent controls can survive actor replacement, but their old operation
    // has no focus claim in the replacement identity's interface.
    if (context) watch([context.epoch, () => context.session.value?.context], clearPendingFocus, {flush: 'sync'});
    onBeforeUnmount(retirePendingFocus);

    /** Capture only this currently focused control. A command started elsewhere,
     * including an editor's ordinary blur save, never acquires document focus. */
    function receivePendingFocus(pending: boolean): void {
        if (!pending) { void restorePendingFocus(); return; }
        clearPendingFocus();

        const target = source.element.value;
        if (!target?.isConnected || document.activeElement !== target) return;
        focusTarget = target;
        document.addEventListener('pointerdown', clearPendingFocus, true);
        document.addEventListener('keydown', clearPendingFocus, true);
        document.addEventListener('focusin', receiveOtherFocus, true);
        window.addEventListener('blur', clearPendingFocus);
    }

    /** Restore only unclaimed focus after the same mounted control becomes
     * available. A successful editor removal or any explicit interaction wins. */
    async function restorePendingFocus(): Promise<void> {
        const target = focusTarget;
        const generation = focusGeneration;
        if (!target) return;

        // Retain cancellation listeners until Vue has applied the enabled state.
        // Generation checks also retire a completion superseded by a new cycle.
        await nextTick();
        if (focusTarget !== target || generation !== focusGeneration) return;
        // A parent fieldset can disable a field without setting its own disabled
        // property. Effective native disabling must also veto restoration.
        if (mounted && source.element.value === target && target.isConnected && !target.disabled && !target.matches(':disabled')
            && !source.pending.value && source.isAvailable() && document.activeElement === document.body)
            target.focus({preventScroll: true});
        clearPendingFocus();
    }

    function receiveOtherFocus(event: FocusEvent): void {
        if (event.target !== focusTarget && event.target !== document.body) clearPendingFocus();
    }

    /** Release this temporary DOM reference and every listener together, including
     * any queued completion that belongs to an earlier pending generation. */
    function clearPendingFocus(): void {
        focusGeneration++;
        if (!focusTarget) return;
        focusTarget = null;
        document.removeEventListener('pointerdown', clearPendingFocus, true);
        document.removeEventListener('keydown', clearPendingFocus, true);
        document.removeEventListener('focusin', receiveOtherFocus, true);
        window.removeEventListener('blur', clearPendingFocus);
    }

    function retirePendingFocus(): void {
        mounted = false;
        clearPendingFocus();
    }
}
