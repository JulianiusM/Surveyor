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
        // Feature dialogs preserve native geometry/type without replacing this
        // shared focus, pending-dismissal and portal owner. Defaults retain Settings.
        standard?: boolean;
        titleClass?: string;
        titleIcon?: string;
        closeClass?: string;
        contentClass?: string;
        footerClass?: string;
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

/** Native Bootstrap dialogs initially focus their container, without highlighting Close.
 * A feature may instead request a body field, as the native event picker does. Keep
 * Reka's trap and focus return, but do not let its first-control default change that
 * observable native entry behavior when no usable feature target is present. */
function focusInitial(event: Event): void {
    if (!(event.target instanceof HTMLElement)) return;
    const target = props.initialFocus ? event.target
        .querySelector<HTMLElement>('.modal-body')
        ?.querySelector<HTMLElement>(props.initialFocus) : null;
    event.preventDefault();
    (target ?? event.target).focus({preventScroll: true});
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
                class="pilot-dialog modal-content bg-dark"
                :class="[contentClass ?? 'text-white', {'pilot-dialog-compact': compact, 'pilot-dialog-standard': standard, 'pilot-dialog-fullscreen': fullscreenOnSmall}]"
                :aria-describedby="undefined"
                @escape-key-down="preventPending"
                @pointer-down-outside="preventPending"
                @open-auto-focus="focusInitial"
                @close-auto-focus="restoreFocus"
            >
                <header class="modal-header">
                    <div>
                        <DialogTitle as="h2" class="modal-title" :class="[{'fs-5': !compact}, titleClass]"><i v-if="titleIcon" class="bi me-2" :class="titleIcon" aria-hidden="true"></i>{{ title }}</DialogTitle>
                        <p v-if="subtitle" class="small text-secondary mb-0 text-break">{{ subtitle }}</p>
                    </div>
                    <DialogClose
                        class="btn-close" :class="closeClass ?? 'btn-close-white'"
                        :disabled="pending"
                        :aria-label="messages.t('common.close')"
                    />
                </header>
                <slot name="navigation" />
                <div class="modal-body"><slot /></div>
                <footer v-if="$slots.footer" class="modal-footer" :class="footerClass"><slot name="footer" /></footer>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
