<script setup lang="ts">
import {useActionState} from '../app/context';
import type {PilotActionState} from '../../types/FrontendPilotUiTypes';

const props = withDefaults(defineProps<{state?: PilotActionState; pending?: boolean; disabled?: boolean; variant?: string; type?: 'button' | 'submit'}>(),
    {pending: false, disabled: false, variant: 'primary', type: 'button'});
// Render actual disabled controls until their JS handlers have initialized. HTML
// navigation and Help GET submission retain their own ordinary anchors/buttons.
const action = useActionState({eligible: isEligible, pending: isPending, blocked: isBlocked});

function isEligible(): boolean { return props.state?.available.value ?? true; }
function isPending(): boolean { return props.pending || (props.state?.pending.value ?? false); }
function isBlocked(): boolean { return props.disabled; }
</script>

<template>
    <button :type="type" class="btn" :class="`btn-${variant}`" :disabled="action.disabled.value" :aria-busy="action.pending.value">
        <span v-if="action.pending.value" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        <slot />
    </button>
</template>
