<script setup lang="ts">
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose} from 'reka-ui';
import {watch} from 'vue';
import {usePilot} from '../app/context';

const props = withDefaults(
    defineProps<{
        open: boolean;
        title: string;
        subtitle?: string;
        pending?: boolean;
        compact?: boolean;
        fullscreenOnSmall?: boolean;
        initialFocus?: string;
    }>(),
    {fullscreenOnSmall: true},
);
const emit = defineEmits<{close: []}>();
const {messages} = usePilot();
// Features may open a modal from several buttons instead of one Reka DialogTrigger.
// Remember the actual invoker so Escape/cancel returns keyboard focus to the right control.
let opener: HTMLElement | null = null;
// A picker can stay mounted while closed. Capture each actual opening, rather than the
// element focused when its parent page was first created.
watch(
    () => props.open,
    (open) => {
        if (open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement)
            opener = document.activeElement;
    },
    {immediate: true, flush: 'sync'},
);

/** Feature focus targets are scoped to the body; the default remains Reka's first control. */
function focusInitial(event: Event): void {
    if (!props.initialFocus || !(event.target instanceof HTMLElement)) return;
    const target = event.target
        .querySelector<HTMLElement>('.modal-body')
        ?.querySelector<HTMLElement>(props.initialFocus);
    if (!target) return;
    event.preventDefault();
    target.focus({preventScroll: true});
}

/** The feature owns discard decisions. This wrapper only prevents dismissal while its command is pending. */
function requestOpen(open: boolean): void {
    if (!open && !props.pending) emit('close');
}
function preventPending(event: Event): void {
    if (props.pending) event.preventDefault();
}
function restoreFocus(event: Event): void {
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus({preventScroll: true});
}
</script>

<template>
    <DialogRoot :open="open" @update:open="requestOpen">
        <DialogPortal>
            <DialogOverlay class="pilot-dialog-backdrop" />
            <DialogContent
                class="pilot-dialog modal-content bg-dark text-white"
                :class="{'pilot-dialog-compact': compact, 'pilot-dialog-fullscreen': fullscreenOnSmall}"
                :aria-describedby="undefined"
                @escape-key-down="preventPending"
                @pointer-down-outside="preventPending"
                @open-auto-focus="focusInitial"
                @close-auto-focus="restoreFocus"
            >
                <header class="modal-header">
                    <div>
                        <DialogTitle as="h2" class="modal-title" :class="{'fs-5': !compact}">{{
                            title
                        }}</DialogTitle>
                        <p v-if="subtitle" class="small text-secondary mb-0 text-break">{{ subtitle }}</p>
                    </div>
                    <DialogClose
                        class="btn-close btn-close-white"
                        :disabled="pending"
                        :aria-label="messages.t('common.close')"
                    />
                </header>
                <slot name="navigation" />
                <div class="modal-body"><slot /></div>
                <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
