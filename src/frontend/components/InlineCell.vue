<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {usePilot} from '../app/context';
import {useDraftProtection} from '../composables/command';

const props = withDefaults(defineProps<{
    value: string | number | null;
    token: string;
    editable: boolean;
    // Native field affordance can be broader than its browser write guard.
    // The feature supplies that distinction; this component derives no grants.
    writeAdmission?: boolean;
    label: string;
    numeric?: boolean;
    // Input presentation does not define a feature's accepted values. Callers opt
    // into constraints only where their native editor already enforces them.
    required?: boolean;
    maxLength?: number;
    disabled?: boolean;
    tag?: string;
    multiline?: boolean;
    rows?: number;
    placeholder?: string;
    save: (value: string, token: string) => Promise<boolean>;
}>(), {writeAdmission: true});
const emit = defineEmits<{editing: [active: boolean]; denied: [source?: Event]}>();
const context = usePilot();
const {messages} = context;
const editing = ref(false);
const input = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
// Keep the DOM's string value even for number inputs. Vue's numeric v-model coercion
// otherwise changes this draft to a number before its trim/validation/save boundary.
const local = ref('');
// The raw snapshot remains the concurrency authority. Native editing presents trimmed
// text, so its no-change baseline must be separate: merely opening padded stored text
// must neither normalize persistence nor mark the enclosing page dirty.
const original = ref('');
const editableOriginal = ref('');
const token = ref('');
const pending = ref(false);
const remoteChanged = computed(() => editing.value && String(props.value ?? '') !== original.value);
const dirty = computed(() => editing.value && local.value.trim() !== editableOriginal.value);
watch(() => props.token, latest => {
    // An item's other field can change while this one is being edited. The server compares
    // only this PATCH field, and an unchanged displayed value can adopt the new token safely.
    if (editing.value && !remoteChanged.value) token.value = latest;
});
// The containing page aggregates this editor with other mounted forms. A standalone
// cell remains its own departure owner; no form values leave this component.
useDraftProtection({
    dirty: () => dirty.value,
    busy: () => pending.value,
    unknownMessage: 'draft.leaveUnknown',
});
watch(
    () => props.editable,
    (allowed) => {
        // Field-only grant loss does not revoke the readable row or discard its
        // dirty draft. Retain that disabled input until explicit Cancel/departure.
        if (!allowed && !pending.value && !dirty.value) cancel();
    },
);

/** Capture the displayed value and comparison token once on editor entry.
 * Display permission remains distinct from command admission; the original
 * lexical value also preserves native trim/no-change and focus behavior. */
async function begin(source?: Event): Promise<void> {
    if (!props.editable || props.disabled || editing.value) return;
    if (!props.writeAdmission) {
        emit('denied', source);
        return;
    }

    original.value = String(props.value ?? '');
    editableOriginal.value = original.value.trim();
    local.value = editableOriginal.value;
    token.value = props.token;
    editing.value = true;
    emit('editing', true);

    await nextTick();
    // Native editing focuses the existing value without selecting it. Selecting
    // here changes the first typed character from an insertion into a replacement.
    input.value?.focus();
}
function cancel(): void {
    if (pending.value || !editing.value) return;
    editing.value = false;
    emit('editing', false);
}
function review(): void {
    token.value = props.token;
    original.value = String(props.value ?? '');
    // Reviewing new authority retains the user's draft, while no-change detection
    // adopts the same normalized baseline as a newly opened native editor.
    editableOriginal.value = original.value.trim();
    void nextTick(() => input.value?.focus());
}
/** Submit only this editor's reviewed draft through its injected save owner.
 * Current write admission and declared field constraints are checked first;
 * rejected/unconfirmed writes keep the input, and pending blur/Enter cannot duplicate it. */
async function commit(source?: Event): Promise<void> {
    if (!editing.value || !props.editable || props.disabled || pending.value || remoteChanged.value) return;
    if (!dirty.value) {
        cancel();
        return;
    }

    // A refreshed write grant can retire while the user's readable draft stays
    // mounted. Neither an old input nor a synthetic blur authorizes submission.
    if (!props.writeAdmission) {
        emit('denied', source);
        return;
    }
    // Native inline editors submit on blur/Enter without validating a containing
    // form. A number input's implicit step must not add a new rejection policy;
    // validate only constraints explicitly supplied by the field's owner.
    if ((props.required || props.maxLength !== undefined) && !input.value?.reportValidity()) return;

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
onBeforeUnmount(() => {
    // A remotely deleted row must release the page's drag lock exactly once.
    if (editing.value) emit('editing', false);
});
// Explicit edit buttons delegate to the same field entry/authority/lifetime as
// double-click; callers never maintain a second inline draft or input mirror.
defineExpose({begin});
</script>

<template>
    <component :is="tag ?? 'td'"
        :data-edit="editable ? label : undefined"
        @dblclick="begin"
        @keydown.enter.self.prevent="begin"
        :tabindex="editable ? 0 : undefined"
        :aria-label="editable ? label : undefined"
    >
        <template v-if="editing">
            <textarea v-if="multiline" ref="input" :value="local"
                class="form-control form-control-sm text-bg-dark" :aria-label="label"
                :disabled="pending || disabled || !editable" :required="required" :maxlength="maxLength"
                :rows="rows ?? 5" :placeholder="placeholder" @input="local = ($event.target as HTMLTextAreaElement).value"
                @blur="commit" @keydown.ctrl.enter.prevent="commit" @keydown.esc.prevent="cancel"></textarea>
            <input v-else
                ref="input"
                :value="local"
                class="form-control form-control-sm text-bg-dark"
                :type="numeric ? 'number' : 'text'"
                :aria-label="label"
                :disabled="pending || disabled || !editable"
                :required="required"
                :maxlength="maxLength"
                @input="local = ($event.target as HTMLInputElement).value"
                @blur="commit"
                @keydown.enter.prevent="commit"
                @keydown.esc.prevent="cancel"
            />
            <button v-if="!editable && !remoteChanged" type="button"
                class="btn btn-sm btn-outline-secondary mt-1" :disabled="pending || disabled" @click="cancel">
                {{ messages.t('common.cancel') }}
            </button>
            <div v-if="remoteChanged" class="pilot-inline-conflict small text-warning mt-1">
                {{ messages.t('draft.readConflict') }}
                <div>{{ messages.t('draft.conflictValue', {value: String(value ?? '')}) }}</div>
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
    </component>
</template>
