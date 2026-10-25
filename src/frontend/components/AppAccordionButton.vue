<script setup lang="ts">
import {useActionState} from '../app/context';

// Features own disclosure state, panel DOM and readable contents. This button
// shares only accordion presentation and initialized activation admission.
const props = withDefaults(defineProps<{expanded: boolean; controls?: string; disabled?: boolean}>(), {disabled: false});
const emit = defineEmits<{click: [source: MouseEvent]}>();
const action = useActionState({blocked: () => props.disabled});

/** Guard deliberate and programmatic activation without changing feature state.
 * The existing action owner retires admission before initialization or disposal. */
function activate(source: MouseEvent): void {
    // Synthetic clicks cannot bypass the same disabled boundary as the DOM.
    if (action.isAvailable()) emit('click', source);
}
</script>

<template>
    <button type="button" class="accordion-button" :class="{collapsed: !expanded}"
        :aria-expanded="expanded" :aria-controls="controls" :disabled="action.disabled.value" @click="activate">
        <slot />
    </button>
</template>
