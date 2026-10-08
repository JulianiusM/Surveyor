<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate} from 'vue-router';
import {usePilot} from '../app/context';

const props = defineProps<{
    value: string | number | null;
    token: string;
    editable: boolean;
    label: string;
    numeric?: boolean;
    required?: boolean;
    maxLength?: number;
    disabled?: boolean;
    save: (value: string, token: string) => Promise<boolean>;
}>();
const emit = defineEmits<{editing: [active: boolean]}>();
const context = usePilot();
const {messages} = context;
const editing = ref(false);
const input = ref<HTMLInputElement | null>(null);
// Keep the DOM's string value even for number inputs. Vue's numeric v-model coercion
// otherwise changes this draft to a number before its trim/validation/save boundary.
const local = ref('');
const original = ref('');
const token = ref('');
const pending = ref(false);
const remoteChanged = computed(() => editing.value && String(props.value ?? '') !== original.value);
const dirty = computed(() => editing.value && local.value.trim() !== original.value);
watch(() => props.token, latest => {
    // An item's other field can change while this one is being edited. The server compares
    // only this PATCH field, and an unchanged displayed value can adopt the new token safely.
    if (editing.value && !remoteChanged.value) token.value = latest;
});
const removeUpdateGuard = context.updates.registerGuard(() => !pending.value && !dirty.value);
onBeforeUnmount(removeUpdateGuard);
watch(
    () => props.editable,
    (allowed) => {
        if (!allowed && !pending.value) cancel();
    },
);

async function begin(): Promise<void> {
    if (!props.editable || props.disabled || editing.value) return;
    original.value = String(props.value ?? '');
    local.value = original.value;
    token.value = props.token;
    editing.value = true;
    emit('editing', true);
    await nextTick();
    input.value?.focus();
    input.value?.select();
}
function cancel(): void {
    if (pending.value || !editing.value) return;
    editing.value = false;
    emit('editing', false);
}
function review(): void {
    token.value = props.token;
    original.value = String(props.value ?? '');
    void nextTick(() => input.value?.focus());
}
async function commit(): Promise<void> {
    if (!editing.value || !props.editable || props.disabled || pending.value || remoteChanged.value) return;
    if (!dirty.value) {
        cancel();
        return;
    }
    if (!input.value?.reportValidity()) return;
    pending.value = true;
    try {
        if (await props.save(local.value.trim(), token.value)) {
            editing.value = false;
            emit('editing', false);
        }
    } finally {
        pending.value = false;
    }
}
function mayLeave(): boolean {
    return !pending.value && (!dirty.value || window.confirm(messages.value.t('draft.discard')));
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate(mayLeave);
function beforeUnload(event: BeforeUnloadEvent): void {
    if (!pending.value && !dirty.value) return;
    event.preventDefault();
    event.returnValue = '';
}
let removeIdentityGuard: (() => void) | undefined;
onMounted(() => {
    removeIdentityGuard = context.registerIdentityGuard(mayLeave);
    window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
    removeIdentityGuard?.();
    window.removeEventListener('beforeunload', beforeUnload);
    // A remotely deleted row must release the page's drag lock exactly once.
    if (editing.value) emit('editing', false);
});
</script>

<template>
    <td
        :data-edit="editable ? label : undefined"
        @dblclick="begin"
        @keydown.enter.self.prevent="begin"
        :tabindex="editable ? 0 : undefined"
        :aria-label="editable ? label : undefined"
    >
        <template v-if="editing">
            <input
                ref="input"
                :value="local"
                class="form-control form-control-sm text-bg-dark"
                :type="numeric ? 'number' : 'text'"
                :aria-label="label"
                :disabled="pending || disabled || !editable"
                :required="numeric || required"
                :min="numeric ? 1 : undefined"
                :maxlength="maxLength"
                @input="local = ($event.target as HTMLInputElement).value"
                @blur="commit"
                @keydown.enter.prevent="commit"
                @keydown.esc.prevent="cancel"
            />
            <div v-if="remoteChanged" class="pilot-inline-conflict small text-warning mt-1">
                {{ messages.t('packing.readConflict') }}
                <div>{{ messages.t('packing.conflictValue', {value: String(value ?? '')}) }}</div>
                <button
                    type="button"
                    class="btn btn-sm btn-outline-warning"
                    @mousedown.prevent
                    @click="review"
                >
                    {{ messages.t('draft.review') }}
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary ms-1" @click="cancel">
                    {{ messages.t('common.cancel') }}
                </button>
            </div>
        </template>
        <slot v-else>{{ value }}</slot>
    </td>
</template>
