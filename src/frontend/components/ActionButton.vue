<script setup lang="ts">
import {inject, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {pilotContextKey, useActionState} from '../app/context';
import type {PilotActionState} from '../../types/FrontendPilotUiTypes';

const props = withDefaults(defineProps<{state?: PilotActionState; pending?: boolean; disabled?: boolean; variant?: string; type?: 'button' | 'submit'}>(),
    {pending: false, disabled: false, variant: 'primary', type: 'button'});
// Render actual disabled controls until their JS handlers have initialized. HTML
// navigation and Help GET submission retain their own ordinary anchors/buttons.
const action = useActionState({eligible: isEligible, pending: isPending, blocked: isBlocked});
const context = inject(pilotContextKey, null);
const element = ref<HTMLButtonElement | null>(null);
let mounted = true;
let focusTarget: HTMLButtonElement | null = null;
let focusGeneration = 0;
// Chromium can release focus when pending work natively disables this button.
// Observe before its DOM patch; ownership covers only that temporary focus loss.
watch(action.pending, receivePendingFocus, {flush: 'sync'});
// A persistent shell can retain this DOM node across an actor replacement.
// Its old pending action has no claim to focus in the new identity's interface.
if (context) watch([context.epoch, () => context.session.value?.context], clearPendingFocus, {flush: 'sync'});
onBeforeUnmount(retirePendingFocus);

function isEligible(): boolean { return props.state?.available.value ?? true; }
function isPending(): boolean { return props.pending || (props.state?.pending.value ?? false); }
function isBlocked(): boolean { return props.disabled; }

/** Capture only this focused control before pending disables it. Any deliberate
 * interaction releases restoration, leaving subsequent focus with the user. */
function receivePendingFocus(pending: boolean): void {
    if (!pending) { void restorePendingFocus(); return; }
    clearPendingFocus();

    // An action started elsewhere must never claim document focus on completion.
    const target = element.value;
    if (!target?.isConnected || document.activeElement !== target) return;
    focusTarget = target;
    document.addEventListener('pointerdown', clearPendingFocus, true);
    document.addEventListener('keydown', clearPendingFocus, true);
    document.addEventListener('focusin', receiveOtherFocus, true);
    window.addEventListener('blur', clearPendingFocus);
}

/** Restore only unclaimed focus after the same button becomes available again.
 * Pending work, retirement, another focus owner or an explicit interaction wins. */
async function restorePendingFocus(): Promise<void> {
    const target = focusTarget;
    const generation = focusGeneration;
    if (!target) return;

    // Availability changes before Vue patches disabled. Wait for that patch,
    // retaining listeners so an intervening user action can still cancel.
    await nextTick();
    if (focusTarget !== target || generation !== focusGeneration) return;
    if (mounted && element.value === target && target.isConnected && !target.disabled
        && !action.pending.value && action.isAvailable() && document.activeElement === document.body)
        target.focus({preventScroll: true});
    clearPendingFocus();
}

function receiveOtherFocus(event: FocusEvent): void {
    if (event.target !== focusTarget && event.target !== document.body) clearPendingFocus();
}

/** Cancel this temporary DOM reference and every listener together. A new pending
 * cycle advances its generation so an older queued completion cannot restore it. */
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
</script>

<template>
    <button ref="element" :type="type" class="btn" :class="`btn-${variant}`" :disabled="action.disabled.value" :aria-busy="action.pending.value">
        <span v-if="action.pending.value" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <slot />
    </button>
</template>
