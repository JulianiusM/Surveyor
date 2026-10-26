<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {useFrontend} from '../app/context';
import {useDraftProtection} from '../composables/command';
import {usePendingFocus} from '../composables/pendingFocus';
import ActionButton from './ActionButton.vue';

const props = withDefaults(defineProps<{
    value: string | number | null;
    token: string;
    editable: boolean;
    // Field affordance can be broader than its browser write guard.
    // The feature supplies that distinction; this component derives no grants.
    writeAdmission?: boolean;
    label: string;
    numeric?: boolean;
    // Input presentation does not define a feature's accepted values. Callers opt
    // into constraints only where their editor already enforces them.
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
const context = useFrontend();
const {messages} = context;
const editing = ref(false);
const input = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
// Keep the DOM's string value even for number inputs. Vue's numeric v-model coercion
// otherwise changes this draft to a number before its trim/validation/save boundary.
const local = ref('');
// The raw snapshot remains the concurrency authority. Editing presents trimmed
// text, so its no-change baseline must be separate: merely opening padded stored text
// must neither normalize persistence nor mark the enclosing page dirty.
const original = ref('');
const editableOriginal = ref('');
const token = ref('');
const pending = ref(false);
// Enter/Ctrl+Enter can disable the focused editor before a rejected save retains
// its draft. Reuse the action focus lifetime instead of copying DOM recovery;
// ordinary blur saves and successful removal acquire no replacement focus.
usePendingFocus({element: input, pending, isAvailable: isEditorAvailable});
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

/** A retained readable conflict can stay focused for review, but field/write
 * admission loss and initialization never authorize a deferred focus claim. */
function isEditorAvailable(): boolean {
    return editing.value && props.editable && props.writeAdmission && !props.disabled && context.hydrated.value;
}

/** Capture the displayed value and comparison token once on editor entry.
 * Display permission remains distinct from command admission; the original
 * lexical value also preserves trim/no-change and focus behavior. */
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
    // Editing focuses the existing value without selecting it. Selecting
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
    // adopts the same normalized baseline as a newly opened editor.
    editableOriginal.value = original.value.trim();
    void nextTick(() => input.value?.focus());
}

/** Submit an explicit Enter shortcut only after text composition has finished.
 * The same boundary serves input Enter and textarea Ctrl+Enter; blur keeps its
 * independent save behavior through the existing commit owner. */
function commitOnEnter(event: KeyboardEvent): Promise<void> | void {
    // A composing Enter belongs to the browser/IME, including its default action.
    // Guard before preventing it so no partial draft is saved or editor removed.
    if (event.isComposing) return;
    event.preventDefault();
    return commit(event);
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
    // Inline editors submit on blur/Enter without validating a containing
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
                @blur="commit" @keydown.ctrl.enter="commitOnEnter" @keydown.esc.prevent="cancel"></textarea>
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
                @keydown.enter="commitOnEnter"
                @keydown.esc.prevent="cancel"
            />
            <!-- Blur/Enter saves have no initiating button. Keep progress beside
                 the retained editor for its entire existing save/read lifetime. -->
            <span v-if="pending" class="d-inline-flex align-items-center gap-1 small text-body-secondary mt-1" role="status">
                <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
                {{ messages.t('common.pending') }}
            </span>
            <ActionButton v-if="!editable && !remoteChanged"
                class="btn-sm mt-1" variant="outline-secondary" :disabled="pending || disabled" @click="cancel">
                {{ messages.t('common.cancel') }}
            </ActionButton>
            <div v-if="remoteChanged" class="frontend-inline-conflict small text-warning mt-1">
                {{ messages.t('draft.readConflict') }}
                <div>{{ messages.t('draft.conflictValue', {value: String(value ?? '')}) }}</div>
                <ActionButton
                    class="btn-sm"
                    variant="outline-warning"
                    @mousedown.prevent
                    @click="review"
                >
                    {{ messages.t('draft.review') }}
                </ActionButton>
                <ActionButton class="btn-sm ms-1" variant="outline-secondary" @click="cancel">
                    {{ messages.t('common.cancel') }}
                </ActionButton>
            </div>
        </template>
        <slot v-else>{{ value }}</slot>
    </component>
</template>
