<script setup lang="ts">
import {ref} from 'vue';
import {useActionState} from '../app/context';
import {usePendingFocus} from '../composables/pendingFocus';
import type {FrontendActionState} from '../../types/FrontendUiTypes';

// Specialized list-group actions retain their caller-owned appearance, while
// this same button owns initialization, pending and transient focus behavior.
const props = withDefaults(defineProps<{state?: FrontendActionState; pending?: boolean; disabled?: boolean; showSpinner?: boolean; unstyled?: boolean;
    variant?: string; type?: 'button' | 'submit'}>(),
    {pending: false, disabled: false, showSpinner: true, unstyled: false, variant: 'primary', type: 'button'});
// Render actual disabled controls until their JS handlers have initialized. HTML
// navigation and Help GET submission retain their own ordinary anchors/buttons.
const action = useActionState({eligible: isEligible, pending: isPending, blocked: isBlocked});
const element = ref<HTMLButtonElement | null>(null);
// Buttons and retained inline editors share one pending DOM-focus owner; actual
// availability, operation admission and visual treatment stay with this control.
usePendingFocus({element, pending: action.pending, isAvailable: action.isAvailable});

function isEligible(): boolean { return props.state?.available.value ?? true; }
function isPending(): boolean { return props.pending || (props.state?.pending.value ?? false); }
function isBlocked(): boolean { return props.disabled; }
</script>

<template>
    <button ref="element" :type="type" :class="unstyled ? undefined : ['btn', `btn-${variant}`]"
        :disabled="action.disabled.value" :aria-busy="action.pending.value">
        <!-- Operation ownership is independent of its visual treatment. Existing
             no-spinner actions still expose busy state and retain pending focus. -->
        <span v-if="action.pending.value && showSpinner" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <slot />
    </button>
</template>
